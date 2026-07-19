// T-139 step6: 仮予約成立時（result=reserved かつ alreadyReserved=false）の後続処理。
//
// 発火条件は「resolve が **新規に** 仮予約を作成できたとき」だけ（alreadyReserved=false）。
// 成立は1候補者につき1回（reserve.ts の二重予約チェックで担保）なので、夜間ポーリングでも連発しない。
// これまで resolve は通知部品を一切呼ばない設計だったが、成立時に限り通知を許可する例外（承認済み）。
//
// 実行する3点（この順・失敗隔離）:
//   (1) 面談管理への登録（InterviewRecord）… 担当CAは placeholder「仮予約」
//   (2) LINE WORKS 通知（既存タスク通知と同じ Bot/チャンネル）
//   (3) 翌朝の担当CA確定用タスク（カテゴリ「その他」・マイナビ管理担当へ割当）
//
// 安全設計:
//   - この関数は **絶対に throw しない**（各処理を try/catch で隔離）。resolve 本体の応答は不変。
//   - (1) が失敗/スキップしても (2)(3) は実行する（特に (3) を最優先で成立させる）。
//   - いずれかが失敗したら、大野さんへ 1 通のメール（Resend）にまとめて通知する
//     （step5 の日次重複抑止は掛けない＝成立ごとの単発通知）。
import { prisma } from "@/lib/prisma";
import { sendBotMessage } from "@/lib/lineworks";
import { resolveSystemUserId } from "@/lib/schedule-tasks";
import { jstIso, reservedLabel } from "./jst";
import type { Slot } from "./match-slot";
import type { MeetingMethod } from "./reply-templates";

/** 翌朝トリアージ用フォローアップタスクのカテゴリ。日程調整はRPAが再ポーリングし二重予約になり得るため使わない。 */
const FOLLOWUP_CATEGORY_NAME = "その他";
/** 「その他」カテゴリの必須フィールド（本文の格納先）。 */
const FOLLOWUP_FIELD_LABEL = "タスク内容";
/**
 * placeholder 面談の interviewType。実績集計（初回=interviewCount 1 / 既存=>=2）に依存しないが、
 * 面接対策集計だけは interviewType で判定されるため、その定数と一致しない任意値にする。
 */
const INTERVIEW_TYPE = "初回";

const RESEND_API_URL = "https://api.resend.com/emails";
const MAIL_FROM = "BizStudio <noreply@bizstudio.co.jp>";
const FAILURE_RECIPIENT = "masayuki_oono@bizstudio.co.jp";

export type PostReservationInput = {
  candidateName: string;
  /** モードAでタスクに candidateId が紐付いていれば求職者ID。無ければ null（面談登録はスキップ）。 */
  candidateId: string | null;
  slot: Slot;
  method: MeetingMethod;
  mode: "task" | "message";
  taskId: string | null;
};

type StepResult = { ok: boolean; skipped?: boolean; detail: string };

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * env SCHEDULE_PLACEHOLDER_CA_USER_ID（User.id）→ 面談レコードFKが要求する Employee.id へ解決する。
 * InterviewRecord.interviewerUserId / createdByUserId は名前に反して **Employee.id** を参照する。
 */
async function resolvePlaceholderEmployeeId(): Promise<string | null> {
  const userId = process.env.SCHEDULE_PLACEHOLDER_CA_USER_ID?.trim();
  if (!userId) return null;
  const emp = await prisma.employee.findFirst({ where: { userId }, select: { id: true } });
  return emp?.id ?? null;
}

/**
 * (1) 面談管理への登録。
 *   - candidateId が無ければ **スキップ**（モードB／モードAで未紐付け。同姓同名の誤爆を避け無理に紐付けない）。
 *   - candidateId はあるが placeholder Employee を解決できない場合は **失敗**（env未設定/Employee不在）。
 *   - 非破壊のため interviewCount=null（実績集計から除外）・isLatest=false（最新面談判定を乱さない）・status="draft"。
 */
async function createInterviewRecord(input: PostReservationInput, whenLabel: string): Promise<StepResult> {
  if (!input.candidateId) {
    return { ok: true, skipped: true, detail: "candidateId 無し（モードB/未紐付け）のため面談登録をスキップ" };
  }
  const employeeId = await resolvePlaceholderEmployeeId();
  if (!employeeId) {
    throw new Error("SCHEDULE_PLACEHOLDER_CA_USER_ID から Employee(担当:仮予約) を解決できません");
  }
  await prisma.interviewRecord.create({
    data: {
      candidateId: input.candidateId,
      interviewDate: new Date(jstIso(input.slot.date, input.slot.startTime)),
      startTime: input.slot.startTime,
      endTime: input.slot.endTime,
      interviewTool: input.method, // "電話" | "オンライン"（面談ツール選択肢と一致）
      interviewType: INTERVIEW_TYPE,
      interviewCount: null, // 実績表の初回/既存集計から除外＝非破壊
      interviewerUserId: employeeId, // 担当CA=仮予約（Employee.id）
      createdByUserId: employeeId,
      status: "draft",
      isLatest: false, // 候補者の「最新面談」判定を乱さない
      interviewMemo: [
        "AIエージェント自動仮予約（翌朝に担当CA確定・振り分け）",
        `由来: ${input.mode === "task" ? "URL申し込み" : "マイナビ直接返信"}`,
        `元taskId: ${input.taskId ?? "（なし）"}`,
        `仮予約: ${whenLabel} ${input.method}`,
      ].join("\n"),
    },
  });
  return { ok: true, detail: `面談登録（担当: 仮予約 / ${whenLabel} ${input.method}）` };
}

/**
 * (2) LINE WORKS 通知。既存タスク通知と同じ Bot/チャンネル（LINEWORKS_TASK_*）。
 *   env 未設定なら **スキップ**（失敗扱いにしない＝他機能と同じ env ゲート挙動）。送信エラーは失敗。
 */
async function sendLineNotification(input: PostReservationInput, whenLabel: string): Promise<StepResult> {
  const botId = process.env.LINEWORKS_TASK_BOT_ID;
  const channelId = process.env.LINEWORKS_TASK_CHANNEL_ID;
  if (!botId || !channelId) {
    return { ok: true, skipped: true, detail: "LINEWORKS_TASK_BOT_ID/CHANNEL_ID 未設定のため通知スキップ" };
  }
  const baseUrl = process.env.PORTAL_BASE_URL;
  const lines = [
    "🤖 AIエージェントが面談を自動仮予約しました",
    "",
    "■ 求職者",
    `${input.candidateName} さん`,
    "",
    "■ 仮予約日時",
    whenLabel,
    "",
    "■ 面談方法",
    input.method,
    "",
    "翌朝に担当CAを確定し、仮予約カレンダーから振り分けてください。",
  ];
  if (baseUrl) lines.push("", `🔗 ${baseUrl}/tasks`);
  await sendBotMessage(botId, channelId, lines.join("\n"));
  return { ok: true, detail: "LINE通知送信" };
}

/** 翌朝トリアージ担当（マイナビ管理担当）の Employee.id 群。create-schedule-task のフォールバックと同一。 */
async function resolveMorningTriageEmployeeIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isMynaviAssignee: true, status: "active" },
    include: { employee: { select: { id: true } } },
  });
  const ids: string[] = [];
  for (const u of users) {
    let empId = u.employee?.id;
    if (!empId) {
      const emp = await prisma.employee.findFirst({ where: { name: u.name, status: "active" }, select: { id: true } });
      empId = emp?.id;
    }
    if (empId && !ids.includes(empId)) ids.push(empId);
  }
  return ids;
}

/**
 * (3) 翌朝の担当CA確定用タスク。カテゴリ「その他」・status NOT_STARTED。
 *   createdByUserId は placeholder env に依存させない（placeholder 未設定でもタスクは作る＝最優先成立）。
 *   assignee はマイナビ管理担当（慣例）。解決できなければ未割り当てで作成する。
 */
async function createFollowupTask(
  input: PostReservationInput,
  whenLabel: string,
  interviewResult: StepResult,
): Promise<StepResult> {
  const category = await prisma.taskCategory.findFirst({
    where: { name: FOLLOWUP_CATEGORY_NAME },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!category) throw new Error(`カテゴリ「${FOLLOWUP_CATEGORY_NAME}」が見つかりません`);

  const createdByUserId = await resolveSystemUserId();
  if (!createdByUserId) throw new Error("createdByUserId を解決できません（system user 不在）");

  const assigneeEmployeeIds = await resolveMorningTriageEmployeeIds();

  const title =
    `【AI仮予約】${input.candidateName}さん ${whenLabel} ${input.method}` +
    " → 担当CAの確定とカレンダー振り分け";

  const bodyLines = [
    `求職者: ${input.candidateName}`,
    `仮予約日時: ${whenLabel}`,
    `面談方法: ${input.method}`,
    `由来: ${input.mode === "task" ? "URL申し込み（フローA）" : "マイナビ直接返信（フローB）"}`,
    `元taskId: ${input.taskId ?? "（なし）"}`,
    "",
    "仮予約カレンダーと面談管理（担当: 仮予約）に登録済み。担当CA確定後に付け替えること。",
  ];
  if (interviewResult.skipped) {
    bodyLines.push("", `※ 面談管理への登録はスキップ: ${interviewResult.detail}`);
  } else if (!interviewResult.ok) {
    bodyLines.push("", `※ 面談管理への登録に失敗: ${interviewResult.detail}（手動で登録してください）`);
  }
  const body = bodyLines.join("\n");

  const field = category.fields.find((f) => f.label === FOLLOWUP_FIELD_LABEL);

  await prisma.task.create({
    data: {
      title,
      description: body,
      status: "NOT_STARTED",
      categoryId: category.id,
      candidateId: input.candidateId, // null 可
      createdByUserId,
      completionType: "any",
      ...(assigneeEmployeeIds.length > 0
        ? { assignees: { create: assigneeEmployeeIds.map((id) => ({ employeeId: id })) } }
        : {}),
      ...(field ? { fieldValues: { create: [{ fieldId: field.id, value: body }] } } : {}),
    },
  });

  const assigneeNote = assigneeEmployeeIds.length > 0 ? `担当 ${assigneeEmployeeIds.length}名` : "未割り当て";
  return { ok: true, detail: `タスク作成（${assigneeNote}）` };
}

/** 後続処理の一部失敗を大野さんへ 1 通のメールでまとめて通知（日次重複抑止なし・成立ごとの単発）。 */
async function sendFailureEmail(input: PostReservationInput, whenLabel: string, failures: string[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[post-reserve] RESEND_API_KEY 未設定、失敗メール送信をスキップ");
    return;
  }
  const text = [
    "日程調整AIエージェントの仮予約成立後、後続処理の一部が失敗しました。",
    "仮予約カレンダーへの登録と応募者への自動返信は成立しています（この2つは失敗していません）。",
    "以下の後続処理を手動で補ってください。",
    "",
    `求職者: ${input.candidateName}`,
    `仮予約日時: ${whenLabel} ${input.method}`,
    `由来: ${input.mode === "task" ? "URL申し込み（フローA）" : "マイナビ直接返信（フローB）"}`,
    `元taskId: ${input.taskId ?? "（なし）"}`,
    `candidateId: ${input.candidateId ?? "（なし）"}`,
    "",
    "▼失敗した処理",
    ...failures.map((f) => `・${f}`),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [FAILURE_RECIPIENT],
        subject: `【日程調整AI】仮予約後続処理の失敗（${input.candidateName}）`,
        text,
      }),
      signal: controller.signal,
    });
    if (res.status !== 200 && res.status !== 201) {
      const t = await res.text().catch(() => "");
      console.error(`[post-reserve] failure email Resend error: status=${res.status} body=${t.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 仮予約成立時の後続処理を実行する。**この関数は絶対に throw しない**（resolve 応答を壊さない）。
 * 呼び出し側は結果を待つ（await）だけでよく、返り値も例外も気にしなくてよい。
 */
export async function runPostReservation(input: PostReservationInput): Promise<void> {
  try {
    const whenLabel = reservedLabel(input.slot.date, input.slot.startTime);
    const failures: string[] = [];

    // (1) 面談管理登録
    let interviewResult: StepResult = { ok: true, skipped: true, detail: "未実行" };
    try {
      interviewResult = await createInterviewRecord(input, whenLabel);
    } catch (e) {
      interviewResult = { ok: false, detail: msg(e) };
      failures.push(`面談登録: ${msg(e)}`);
      console.error("[post-reserve] interview create failed:", e);
    }

    // (2) LINE通知
    try {
      const r = await sendLineNotification(input, whenLabel);
      if (!r.ok) failures.push(`LINE通知: ${r.detail}`);
    } catch (e) {
      failures.push(`LINE通知: ${msg(e)}`);
      console.error("[post-reserve] LINE notify failed:", e);
    }

    // (3) タスク作成（最優先で成立させる）
    try {
      await createFollowupTask(input, whenLabel, interviewResult);
    } catch (e) {
      failures.push(`タスク作成: ${msg(e)}`);
      console.error("[post-reserve] task create failed:", e);
    }

    if (failures.length > 0) {
      await sendFailureEmail(input, whenLabel, failures).catch((e) =>
        console.error("[post-reserve] failure email send failed:", e),
      );
    }
  } catch (e) {
    // 想定外（reservedLabel 生成失敗等）。resolve 応答を壊さないため最終的にも握りつぶす。
    console.error("[post-reserve] unexpected error:", e);
  }
}
