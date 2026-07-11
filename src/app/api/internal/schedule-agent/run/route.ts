import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { AI_COMMENT_PREFIX, SCHEDULE_CATEGORY_NAME, resolveSystemUserId } from "@/lib/schedule-tasks";
import {
  matchSlot,
  isBusinessDayYmd,
  jstTodayYmd,
  getTargetUserIds,
  type DesiredSlot,
} from "@/lib/schedule-agent/match-slot";
import { createReservation, getReservationConfig } from "@/lib/schedule-agent/reserve";

// T-139 step3: 日程調整AIエージェント 夜間バッチ。
//
// POST /api/internal/schedule-agent/run   （x-api-key = INTERNAL_API_KEY。auto-expire と同一方式）
//   ?force=true → 稼働時間ガードだけを外す（手動疎通/動作確認用。cron は付けない）
//
// 処理:
//   1. 稼働時間ガード（Q5: 平日19:00〜翌9:00 + 土日祝終日）。範囲外なら skipped。
//   2. 「日程調整」カテゴリ / NOT_STARTED / タイトルに「新規面談調整」を含む（mynavi_new）を取得。
//   3. 同一応募者（candidateId 優先、無ければ氏名）の重複は最新1件のみ。
//   4. 先に IN_PROGRESS に更新 → 枠探索（二重予約防止）→ 仮予約 → コメント → COMPLETED。
//      確保不可なら「確保不可」コメントを一度だけ付けて NOT_STARTED に戻す（IN_PROGRESS で放置しない）。

/** mynavi_new 識別（タイトル部分一致）。 */
const MYNAVI_NEW_TITLE_MARK = "新規面談調整";
/** 確保不可コメントの再掲防止マーカー。 */
const UNAVAILABLE_MARK = "確保不可";

/** Q5 稼働時間帯: 平日 19:00〜翌9:00 + 土日祝は終日。 */
export function isWithinAgentWindow(now: Date): boolean {
  const ymd = jstTodayYmd(now);
  if (!isBusinessDayYmd(ymd)) return true; // 土日祝は終日稼働
  const hour = Number(
    now.toLocaleString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false })
  );
  return hour >= 19 || hour < 9; // 平日は 19:00〜翌 9:00
}

/** 全角数字→半角。 */
function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 希望日時は 100% 定型: `第N希望: YYYY年M月D日（曜） HH:MM〜HH:MM`
// 「第3希望: なし」等は単に一致しない＝自然にスキップされる。
const DESIRED_RE =
  /第\s*([0-9０-９]+)\s*希望\s*[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][^）)]*[）)]\s*(\d{1,2})\s*[：:]\s*(\d{2})\s*[〜~～ー–—-]\s*(\d{1,2})\s*[：:]\s*(\d{2})/g;

/** 「希望日時」フィールドを正規表現でパースし、第1→第2→第3 の順に並べて返す（LLM不要）。 */
export function parseDesiredSlots(raw: string | null | undefined): DesiredSlot[] {
  if (!raw) return [];
  const text = normalizeDigits(raw);
  const p = (n: number) => String(n).padStart(2, "0");
  const out: { n: number; slot: DesiredSlot }[] = [];

  for (const m of text.matchAll(DESIRED_RE)) {
    const n = Number(m[1]);
    out.push({
      n,
      slot: {
        label: `第${n}希望`,
        date: `${Number(m[2])}-${p(Number(m[3]))}-${p(Number(m[4]))}`,
        startTime: `${p(Number(m[5]))}:${m[6]}`,
        endTime: `${p(Number(m[7]))}:${m[8]}`,
      },
    });
  }

  return out.sort((a, b) => a.n - b.n).map((x) => x.slot);
}

/** mynavi_new タイトルから応募者名を抽出: `【...新規面談調整】新規応募者 山田太郎` */
export function extractCandidateName(title: string): string | null {
  const m = /新規応募者\s+(.+)$/.exec(title.trim());
  return m ? m[1].trim() : null;
}

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const force = request.nextUrl.searchParams.get("force") === "true";

  // 1. 稼働時間ガード（Q5）
  if (!force && !isWithinAgentWindow(now)) {
    return NextResponse.json({ skipped: true, reason: "business hours" });
  }

  // 仮予約カレンダー未設定なら安全に終了（エラーにしない）
  if (!getReservationConfig()) {
    return NextResponse.json({ skipped: true, reason: "reservation calendar not configured" });
  }
  if (getTargetUserIds().length === 0) {
    return NextResponse.json({ skipped: true, reason: "no target CA configured" });
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  // 2. 対象タスク（mynavi_new・未着手）
  const tasks = await prisma.task.findMany({
    where: {
      status: "NOT_STARTED",
      category: { name: SCHEDULE_CATEGORY_NAME },
      title: { contains: MYNAVI_NEW_TITLE_MARK },
    },
    include: { fieldValues: { include: { field: { select: { label: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  // 3. 同一応募者の重複は最新のみ（createdAt desc の先頭を残す）
  const seen = new Set<string>();
  const targets = tasks.filter((t) => {
    const key = t.candidateId ?? extractCandidateName(t.title) ?? `title:${t.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const details: {
    taskId: string;
    candidateName: string | null;
    result: "reserved" | "unavailable" | "failed";
    when?: string;
    ca?: string;
    reason?: string;
  }[] = [];

  for (const task of targets) {
    const candidateName = extractCandidateName(task.title);
    const byLabel = new Map(task.fieldValues.map((fv) => [fv.field?.label ?? "", fv.value]));
    const desired = parseDesiredSlots(byLabel.get("希望日時"));
    const meetingFormat = byLabel.get("面談形式") ?? null;

    // 4. 先に IN_PROGRESS（二重予約防止: 同時/連続実行で同じタスクを二重に拾わない）
    await prisma.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS" } });

    try {
      const { matched } = await matchSlot(desired, now);

      if (matched) {
        const res = await createReservation({
          candidateName: candidateName ?? task.title,
          slot: matched,
          meetingFormat,
          taskId: task.id,
        });

        if (res.ok) {
          await prisma.taskComment.create({
            data: {
              taskId: task.id,
              userId: systemUserId,
              content: `${AI_COMMENT_PREFIX}AI仮予約: ${res.when} で仮確定、仮予約カレンダー記載済み（担当候補: ${matched.userName}）`,
            },
          });
          await prisma.task.update({ where: { id: task.id }, data: { status: "COMPLETED" } });
          details.push({
            taskId: task.id,
            candidateName,
            result: "reserved",
            when: res.when,
            ca: matched.userName,
          });
          continue;
        }

        // カレンダー書き込み失敗は一時障害扱い: 確保不可コメントは付けず NOT_STARTED に戻して次回再試行。
        await prisma.task.update({ where: { id: task.id }, data: { status: "NOT_STARTED" } });
        details.push({ taskId: task.id, candidateName, result: "failed", reason: res.reason });
        continue;
      }

      // 確保不可: コメントは一度だけ（一晩の再ポーリングで積み上げない）
      const already = await prisma.taskComment.findFirst({
        where: {
          taskId: task.id,
          content: { contains: UNAVAILABLE_MARK },
        },
        select: { id: true },
      });
      if (!already) {
        await prisma.taskComment.create({
          data: {
            taskId: task.id,
            userId: systemUserId,
            content: `${AI_COMMENT_PREFIX}${UNAVAILABLE_MARK}: 希望枠に空きが見つかりませんでした`,
          },
        });
      }
      await prisma.task.update({ where: { id: task.id }, data: { status: "NOT_STARTED" } });
      details.push({ taskId: task.id, candidateName, result: "unavailable" });
    } catch (e) {
      // 例外時も IN_PROGRESS で放置しない
      console.error("[schedule-agent] task failed:", task.id, e);
      await prisma.task
        .update({ where: { id: task.id }, data: { status: "NOT_STARTED" } })
        .catch(() => {});
      details.push({
        taskId: task.id,
        candidateName,
        result: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 5. 集計
  return NextResponse.json({
    ok: true,
    executedAt: now.toISOString(),
    forced: force,
    processed: targets.length,
    reserved: details.filter((d) => d.result === "reserved").length,
    unavailable: details.filter((d) => d.result === "unavailable").length,
    failed: details.filter((d) => d.result === "failed").length,
    details,
  });
}
