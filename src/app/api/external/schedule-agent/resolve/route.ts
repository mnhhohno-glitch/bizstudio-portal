// T-139 step4: POST /api/external/schedule-agent/resolve
// 日程調整AIエージェント（RPA機）からの判定受け口。枠取り＋仮予約登録＋返信文面生成をportalが担う。
//
// 認証: x-api-secret = EXTERNAL_API_SECRET（isAuthorizedExternal を再利用）。
//
// 入力は2モード（判別は taskId の有無）:
//   モードA: { taskId }                                  … URL申し込み分（既存タスク）
//   モードB: { candidateName, messageBody, executedAt }  … マイナビ直接返信分
//
// 出力（両モード共通）:
//   { result: "reserved"|"today_only"|"unavailable"|"no_reply",
//     reservedAt, reservedAtLabel, method, replyText, alreadyReserved }
//
// 分業: portal は **タスクを読み取るだけ**。status 変更・コメント追加は一切しない（RPAが後で PATCH する）。
// 対象外判定も portal はしない（RPA が判定済みの前提）。
// 稼働時間帯の制御は RPA 側の責務（portal に時間帯制限は実装しない）。
//
// step6（2026-07）: 仮予約が **新規に成立したとき**（result=reserved かつ alreadyReserved=false）に限り、
//   後続処理3点（面談登録・LINE通知・タスク作成）を runPostReservation で発火する。成立は1候補者1回のため
//   夜間ポーリングでも連発しない。後続処理は失敗隔離済みで resolve 応答には一切影響しない（下記参照）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SCHEDULE_CATEGORY_NAME, isAuthorizedExternal, parseJstDefaultDate } from "@/lib/schedule-tasks";
import { getReservationConfig, getTargetUserIds } from "@/lib/schedule-agent/config";
import { jstIso, reservedLabel } from "@/lib/schedule-agent/jst";
import {
  extractFromMessage,
  windowsFromCandidates,
  windowsFromConditions,
} from "@/lib/schedule-agent/extract-message";
import {
  extractCandidateName,
  methodFromFormatField,
  parseDesiredWindows,
} from "@/lib/schedule-agent/parse-preferences";
import { findAvailableSlot, type DesiredWindow, type Slot } from "@/lib/schedule-agent/match-slot";
import { brokenUserIds, probeCalendarConnections } from "@/lib/schedule-agent/probe-connections";
import { sendBrokenCalendarAlert } from "@/lib/schedule-agent/alert";
import {
  createReservation,
  fetchReservedEvents,
  findExistingReservation,
} from "@/lib/schedule-agent/reserve";
import {
  buildReservedReply,
  buildTodayOnlyReply,
  buildUnavailableReply,
  type MeetingMethod,
} from "@/lib/schedule-agent/reply-templates";
import { runPostReservation } from "@/lib/schedule-agent/post-reserve";

export const dynamic = "force-dynamic";

type ResolveResponse = {
  result: "reserved" | "today_only" | "unavailable" | "no_reply";
  reservedAt: string | null;
  reservedAtLabel: string | null;
  method: MeetingMethod | null;
  replyText: string | null;
  alreadyReserved: boolean;
};

/** 返信不要（文面なし）。解釈不能・日程外・env未設定時の安全終了。 */
function noReply(): NextResponse {
  const body: ResolveResponse = {
    result: "no_reply",
    reservedAt: null,
    reservedAtLabel: null,
    method: null,
    replyText: null,
    alreadyReserved: false,
  };
  return NextResponse.json(body);
}

function reservedResponse(
  candidateName: string,
  slot: Slot,
  method: MeetingMethod,
  alreadyReserved: boolean
): NextResponse {
  const label = reservedLabel(slot.date, slot.startTime);
  const body: ResolveResponse = {
    result: "reserved",
    reservedAt: jstIso(slot.date, slot.startTime),
    reservedAtLabel: label,
    method,
    replyText: buildReservedReply(candidateName, method, label),
    alreadyReserved,
  };
  return NextResponse.json(body);
}

function simpleResponse(
  result: "today_only" | "unavailable",
  candidateName: string,
  method: MeetingMethod | null
): NextResponse {
  const body: ResolveResponse = {
    result,
    reservedAt: null,
    reservedAtLabel: null,
    method,
    replyText:
      result === "today_only"
        ? buildTodayOnlyReply(candidateName)
        : buildUnavailableReply(candidateName),
    alreadyReserved: false,
  };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const taskId = typeof body.taskId === "string" && body.taskId.trim() ? body.taskId.trim() : null;

  // ---- 入力の正規化（モードA / モードB）----
  let candidateName: string;
  let method: MeetingMethod;
  let windows: DesiredWindow[];
  let now: Date;
  let mode: "task" | "message";
  // step6: 面談登録の紐付け用。モードAでタスクに紐付いていれば求職者ID。モードB/未紐付けは null。
  let candidateId: string | null = null;

  if (taskId) {
    // ===== モードA: taskId 指定 =====
    mode = "task";
    now = new Date();

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: { select: { name: true } },
        fieldValues: { include: { field: { select: { label: true } } } },
      },
    });

    // 存在しない / カテゴリ「日程調整」以外 → 404（カテゴリ柵。step1 PATCH と同じ考え方）
    if (!task || task.category?.name !== SCHEDULE_CATEGORY_NAME) {
      return NextResponse.json({ error: "Schedule task not found" }, { status: 404 });
    }

    const name = extractCandidateName(task.title);
    if (!name) return noReply(); // 氏名が取れない → 返信不要
    candidateName = name;
    candidateId = task.candidateId ?? null; // step6: 面談登録の紐付け材料（無ければ面談登録はスキップ）

    const byLabel = new Map(task.fieldValues.map((fv) => [fv.field?.label ?? "", fv.value]));
    method = methodFromFormatField(byLabel.get("面談形式")); // LLM推測はしない
    windows = parseDesiredWindows(byLabel.get("希望日時"));
    if (windows.length === 0) return noReply(); // 定型パース0件 → 返信不要
  } else {
    // ===== モードB: 氏名＋メッセージ本文 =====
    mode = "message";

    const name = typeof body.candidateName === "string" ? body.candidateName.trim() : "";
    const messageBody = typeof body.messageBody === "string" ? body.messageBody.trim() : "";
    if (!name || !messageBody) {
      return NextResponse.json(
        { error: "taskId, or candidateName and messageBody are required" },
        { status: 400 }
      );
    }
    candidateName = name;
    now = parseJstDefaultDate(typeof body.executedAt === "string" ? body.executedAt : null) ?? new Date();

    const ex = await extractFromMessage(messageBody);
    if (!ex || !ex.isScheduleRelated) return noReply(); // 日程の話ではない／解釈不能

    // 面談方法: 電話→A系 / オンライン・不明→B系（不明時のオンライン既定はモードBのみの規則）
    method = ex.meetingMethod === "電話" ? "電話" : "オンライン";

    const fromCandidates = windowsFromCandidates(ex, now);
    const fromConditions = ex.conditions ? windowsFromConditions(ex.conditions, now) : [];

    if (ex.candidates.length === 0 && fromConditions.length === 0) return noReply(); // 候補・条件とも空

    // 具体候補があればそれを優先し、無ければ条件走査の結果を使う。
    windows = fromCandidates.length > 0 ? fromCandidates : fromConditions;

    // 具体候補があったが年解決の結果すべて捨てられた（＝どの候補も解決不能）場合も条件にフォールバック。
    if (windows.length === 0 && fromConditions.length > 0) windows = fromConditions;

    if (windows.length === 0) {
      // 具体候補はあったが1つも日付として解決できなかった → 範囲外扱い（テンプレD）
      return simpleResponse("unavailable", candidateName, method);
    }
  }

  // ---- 以降は両モード共通 ----

  // env 未設定なら枠取り・カレンダー登録を一切行わず「返信不要」で安全終了（誤送信防止・Q5）
  if (!getReservationConfig()) return noReply();

  const targets = getTargetUserIds();
  if (targets.length === 0) return simpleResponse("unavailable", candidateName, method);

  // 仮予約カレンダーを1回だけ走査（二重予約チェック＋枠占有カウントの両方に使う）
  const reserved = await fetchReservedEvents(now);
  if (!reserved) return noReply(); // カレンダーが読めない＝安全側（誤送信しない）

  // 二重予約防止: 同一氏名の未来の仮予約が既にあれば、新規登録せず同じ文面を再生成
  const existing = findExistingReservation(reserved.events, candidateName, now);
  if (existing) {
    return reservedResponse(candidateName, existing.slot, existing.method, true);
  }

  // 対象CAの連携状態プローブ。壊れているCAがあればメール通知（重複抑止付き）を副作用で発火。
  //   - 通知は完全に副作用: 失敗しても resolve 応答は正常に返す（例外は内部で握りつぶす）。
  //   - 壊れた CA は枠探索の対象から明示除外し、「空き」と誤判定されるのを防ぐ。
  const probe = await probeCalendarConnections(targets);
  const broken = brokenUserIds(probe);
  if (broken.length > 0) {
    try {
      await sendBrokenCalendarAlert(broken);
    } catch (e) {
      console.error("[resolve] alert dispatch failed:", e);
    }
  }

  // 枠探索（壊れたCAは除外）
  const outcome = await findAvailableSlot(windows, targets, reserved.events, now, broken);
  if (outcome.kind === "today_only") return simpleResponse("today_only", candidateName, method);
  if (outcome.kind === "unavailable") return simpleResponse("unavailable", candidateName, method);

  // 仮予約登録
  const eventId = await createReservation({
    candidateName,
    slot: outcome.slot,
    method,
    mode,
    taskId,
  });
  if (!eventId) return noReply(); // 書き込み失敗 → 誤送信しない（RPAは返信しない）

  // step6: 新規仮予約成立時のみ後続処理（面談登録・LINE通知・タスク作成）を発火。
  //   - alreadyReserved=true（既存再返信）ではここに来ない＝二重作成しない。
  //   - runPostReservation は内部で失敗隔離し throw しない設計だが、防御的に try/catch で囲い、
  //     後続処理の成否を resolve 応答（reserved 文面・HTTPコード）に一切影響させない。
  try {
    await runPostReservation({
      candidateName,
      candidateId,
      slot: outcome.slot,
      method,
      mode,
      taskId,
    });
  } catch (e) {
    console.error("[resolve] post-reservation dispatch failed:", e);
  }

  return reservedResponse(candidateName, outcome.slot, method, false);
}
