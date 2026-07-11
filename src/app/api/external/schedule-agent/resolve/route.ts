import { NextResponse } from "next/server";
import { isAuthorizedExternal, parseJstDefaultDate, toJstIso } from "@/lib/schedule-tasks";
import { generateWithGemini, parseJsonResponse } from "@/lib/ai/gemini-client";
import {
  matchSlot,
  jstTodayYmd,
  addDaysYmd,
  nextBusinessDayYmd,
  getTargetUserIds,
  HORIZON_DAYS,
  type DesiredSlot,
} from "@/lib/schedule-agent/match-slot";
import { createReservation, getReservationConfig, formatSlotJa } from "@/lib/schedule-agent/reserve";

// T-139 step3: 日程調整AIエージェント 外部判定受け口。
//
// POST /api/external/schedule-agent/resolve   （x-api-secret = EXTERNAL_API_SECRET）
//   body: { candidateName, messageBody, executedAt }
//
// 処理:
//   1. messageBody を Gemini に渡し日時候補を構造化抽出。**年は LLM に出力させない**（ハルシネーション回避）。
//      responseSchema で { candidates: [{ month, day, startTime, endTime }] } を強制。
//   2. 年はサーバー側で機械決定: executedAt の「翌営業日〜2週間以内」に収まる年を各候補に付与。
//      12月→1月跨ぎは baseYear+1 を試すことで正しく解決する。
//   3. 共通コア（match-slot）で対象CA群の空き枠を探索 → 仮予約書き込み。
//   4. 確保できたら { status:"reserved", replyText, reservedAt }、
//      確保不可・日時抽出不可なら { status:"unavailable" }（RPAは返信しない区分）。

/** 返信文面の暫定テンプレート。詳細未確定のため env で差し替え可能にする。 */
const DEFAULT_REPLY_TEMPLATE =
  "お世話になっております。ご希望の日程を確認し、{日時} で面談のお時間を仮確保いたしました。ご都合が合わない場合は、お手数ですがその旨ご返信ください。";

function getReplyTemplate(): string {
  const t = process.env.SCHEDULE_AGENT_REPLY_TEMPLATE?.trim();
  return t && t.length > 0 ? t : DEFAULT_REPLY_TEMPLATE;
}

const SYSTEM_INSTRUCTION = [
  "あなたは日本語の応募者メッセージから「面談の希望日時」を抽出する抽出器です。",
  "メッセージ本文に書かれた希望日時の候補を、書かれている順に列挙してください。",
  "重要: 年（year）は絶対に出力しないでください。月(month)・日(day)・開始時刻(startTime)・終了時刻(endTime) のみ出力します。",
  "startTime / endTime は 24時間表記の HH:MM 形式（例: 09:00, 17:30）で出力してください。",
  "「終日」「いつでも」など時間帯の指定が無い場合は startTime=09:00, endTime=18:00 としてください。",
  "「午前」は 09:00〜12:00、「午後」は 13:00〜18:00 と解釈してください。",
  "希望日時がまったく読み取れない場合は candidates を空配列にしてください。推測で捏造しないこと。",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          month: { type: "INTEGER" },
          day: { type: "INTEGER" },
          startTime: { type: "STRING" },
          endTime: { type: "STRING" },
        },
        required: ["month", "day", "startTime", "endTime"],
      },
    },
  },
  required: ["candidates"],
};

type ExtractedCandidate = { month: number; day: number; startTime: string; endTime: string };

/**
 * 年をサーバー側で機械決定する。
 * executedAt の年を基準に baseYear → baseYear+1 → baseYear-1 の順で試し、
 * 「翌営業日〜2週間以内」の窓に収まる年を採用する。窓外なら null（候補として捨てる）。
 * 12月→1月跨ぎ（例: 12/28 実行・1/5 希望）は baseYear+1 で解決される。
 */
export function assignYear(
  month: number,
  day: number,
  minYmd: string,
  maxYmd: string,
  baseYear: number
): string | null {
  const p = (n: number) => String(n).padStart(2, "0");
  for (const y of [baseYear, baseYear + 1, baseYear - 1]) {
    const ymd = `${y}-${p(month)}-${p(day)}`;
    if (ymd >= minYmd && ymd <= maxYmd) return ymd;
  }
  return null;
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

  const candidateName = typeof body.candidateName === "string" ? body.candidateName.trim() : "";
  const messageBody = typeof body.messageBody === "string" ? body.messageBody.trim() : "";
  if (!candidateName || !messageBody) {
    return NextResponse.json(
      { error: "candidateName and messageBody are required" },
      { status: 400 }
    );
  }

  // 仮予約カレンダー未設定なら安全に終了（エラーにしない）
  if (!getReservationConfig()) {
    return NextResponse.json({ skipped: true, reason: "reservation calendar not configured" });
  }
  if (getTargetUserIds().length === 0) {
    return NextResponse.json({ skipped: true, reason: "no target CA configured" });
  }

  // executedAt は JST 既定で解釈。未指定・不正なら現在時刻。
  const executedAt =
    parseJstDefaultDate(typeof body.executedAt === "string" ? body.executedAt : null) ?? new Date();

  // 1. LLM で日時候補を抽出（年は出力させない）
  let extracted: ExtractedCandidate[] = [];
  try {
    const raw = await generateWithGemini({
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt: `以下の応募者メッセージから希望日時の候補を抽出してください。\n\n---\n${messageBody}\n---`,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
    });
    const parsed = parseJsonResponse<{ candidates?: ExtractedCandidate[] }>(raw);
    extracted = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch (e) {
    console.error("[schedule-agent/resolve] extraction failed:", e);
    return NextResponse.json({ status: "unavailable", reason: "extraction failed" });
  }

  if (extracted.length === 0) {
    return NextResponse.json({ status: "unavailable", reason: "no date candidates" });
  }

  // 2. 年をサーバー側で付与（翌営業日〜2週間の窓に収まる年）
  const todayYmd = jstTodayYmd(executedAt);
  const minYmd = nextBusinessDayYmd(todayYmd);
  const maxYmd = addDaysYmd(todayYmd, HORIZON_DAYS);
  const baseYear = Number(todayYmd.slice(0, 4));

  const desired: DesiredSlot[] = [];
  extracted.forEach((c, i) => {
    if (!Number.isInteger(c.month) || !Number.isInteger(c.day)) return;
    if (c.month < 1 || c.month > 12 || c.day < 1 || c.day > 31) return;
    const date = assignYear(c.month, c.day, minYmd, maxYmd, baseYear);
    if (!date) return; // 窓外の候補は捨てる
    desired.push({
      label: `第${i + 1}希望`,
      date,
      startTime: c.startTime,
      endTime: c.endTime,
    });
  });

  if (desired.length === 0) {
    return NextResponse.json({ status: "unavailable", reason: "no candidate within window" });
  }

  // 3. 空き枠マッチング
  const { matched, reason } = await matchSlot(desired, executedAt);
  if (!matched) {
    return NextResponse.json({ status: "unavailable", reason: reason ?? "no free slot" });
  }

  // 4. 仮予約書き込み
  const res = await createReservation({
    candidateName,
    slot: matched,
    meetingFormat: typeof body.meetingFormat === "string" ? body.meetingFormat : null,
    taskId: null,
  });
  if (!res.ok) {
    return NextResponse.json({ status: "unavailable", reason: res.reason });
  }

  const when = formatSlotJa(matched);
  const replyText = getReplyTemplate().replace(/\{日時\}/g, when);
  const reservedAt = toJstIso(new Date(`${matched.date}T${matched.startTime}:00+09:00`));

  return NextResponse.json({
    status: "reserved",
    replyText,
    reservedAt,
    reservedFor: matched.userName,
    when,
    eventId: res.eventId,
  });
}
