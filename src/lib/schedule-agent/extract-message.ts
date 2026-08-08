// T-139 step4: モードB（メッセージ本文）の LLM 構造化抽出。
//
// ★年（year）は絶対に LLM に出力させない（プロンプト・responseSchema の両方で禁止）。
//   月・日・時刻・条件・面談方法・日程の話か否か だけを抽出させ、**年はサーバー側で機械決定**する
//   （jst.ts の resolveYearNearestFuture: 今日以降の最も近い出現。12月末実行×1月の月日 → 翌年）。
import { generateWithGemini, parseJsonResponse } from "@/lib/ai/gemini-client";
import type { DesiredWindow } from "./match-slot";
import {
  EARLIEST_START_MIN,
  HORIZON_DAYS,
  LATEST_START_MIN,
  SLOT_MINUTES,
  addDaysYmd,
  dowJa,
  isBusinessDayYmd,
  jstYmd,
  resolveYearNearestFuture,
  toHHMM,
} from "./jst";

export type ExtractedConditions = {
  weekdaysOnly: boolean | null;
  allowedWeekdays: string[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  excludedDates: { month: number; day: number }[];
};

export type Extraction = {
  isScheduleRelated: boolean;
  candidates: { month: number; day: number; startTime: string; endTime: string | null }[];
  conditions: ExtractedConditions | null;
  meetingMethod: "電話" | "オンライン" | "不明";
};

const SYSTEM_INSTRUCTION = [
  "あなたは日本語の応募者メッセージから「面談の希望日時」に関する情報を抽出する抽出器です。",
  "",
  "【最重要】年（year）は絶対に出力しないでください。スキーマにも年は存在しません。",
  "抽出するのは 月(month)・日(day)・時刻・条件・面談方法・日程の話か否か のみです。",
  "",
  "- isScheduleRelated: メッセージが面談日程に関する内容なら true。求人内容の質問・条件確認など日程と無関係なら false。",
  "- candidates: 具体的な日時候補を、書かれている優先順に列挙。時刻は24時間表記 HH:MM。",
  "  終了時刻の指定が無ければ endTime は null。",
  "  「午前」は 09:00〜12:00、「午後」は 13:00〜18:00 と解釈。",
  "- conditions: 「平日なら」「◯曜以外」「19時以降」「7/16以外」等の条件指定があれば設定。無ければ null。",
  "  allowedWeekdays は 月/火/水/木/金/土/日 の1文字で列挙。timeFrom/timeTo は HH:MM。",
  "  excludedDates は除外したい月日。",
  "- meetingMethod: 電話希望なら「電話」、オンライン/Web/Meet希望なら「オンライン」、明示が無ければ「不明」。",
  "",
  "推測で日時を捏造しないこと。読み取れない場合は candidates を空配列、conditions を null にしてください。",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isScheduleRelated: { type: "BOOLEAN" },
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          month: { type: "INTEGER" },
          day: { type: "INTEGER" },
          startTime: { type: "STRING" },
          endTime: { type: "STRING", nullable: true },
        },
        required: ["month", "day", "startTime"],
      },
    },
    conditions: {
      type: "OBJECT",
      nullable: true,
      properties: {
        weekdaysOnly: { type: "BOOLEAN", nullable: true },
        allowedWeekdays: { type: "ARRAY", nullable: true, items: { type: "STRING" } },
        timeFrom: { type: "STRING", nullable: true },
        timeTo: { type: "STRING", nullable: true },
        excludedDates: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { month: { type: "INTEGER" }, day: { type: "INTEGER" } },
            required: ["month", "day"],
          },
        },
      },
    },
    meetingMethod: { type: "STRING", enum: ["電話", "オンライン", "不明"] },
  },
  required: ["isScheduleRelated", "candidates", "meetingMethod"],
};

/** メッセージ本文から構造化抽出する。失敗時は null（呼び出し側は no_reply）。 */
export async function extractFromMessage(messageBody: string): Promise<Extraction | null> {
  try {
    const raw = await generateWithGemini({
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt: `以下の応募者メッセージから抽出してください。\n\n---\n${messageBody}\n---`,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
      log: { endpoint: "schedule-agent-extract" },
    });
    const parsed = parseJsonResponse<Partial<Extraction>>(raw);
    return {
      isScheduleRelated: parsed.isScheduleRelated === true,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      conditions: parsed.conditions ?? null,
      meetingMethod:
        parsed.meetingMethod === "電話" || parsed.meetingMethod === "オンライン"
          ? parsed.meetingMethod
          : "不明",
    };
  } catch (e) {
    console.error("[schedule-agent] LLM extraction failed:", e);
    return null;
  }
}

/** 具体的な日時候補 → DesiredWindow[]（年をサーバー側で付与。解決不能は捨てる）。 */
export function windowsFromCandidates(ex: Extraction, now: Date): DesiredWindow[] {
  const out: DesiredWindow[] = [];
  for (const c of ex.candidates) {
    const date = resolveYearNearestFuture(c.month, c.day, now);
    if (!date) continue;
    out.push({ date, startTime: c.startTime, endTime: c.endTime ?? null });
  }
  return out;
}

/**
 * 条件指定 → DesiredWindow[]。
 * 翌営業日から2週間以内を日付順に走査し、条件（曜日・時間帯・除外日）を満たす営業日を早い順に並べる。
 * 各日は timeFrom〜timeTo（既定 9:00〜最終枠終了）を1つの幅として渡し、枠生成側が最も早い60分枠から試す。
 */
export function windowsFromConditions(cond: ExtractedConditions, now: Date): DesiredWindow[] {
  const today = jstYmd(now);
  const startTime = cond.timeFrom ?? toHHMM(EARLIEST_START_MIN);
  const endTime = cond.timeTo ?? toHHMM(LATEST_START_MIN + SLOT_MINUTES); // 21:00（20:00開始が最終）
  const excluded = new Set((cond.excludedDates ?? []).map((e) => `${e.month}/${e.day}`));
  const allowed = cond.allowedWeekdays?.length ? new Set(cond.allowedWeekdays) : null;

  const out: DesiredWindow[] = [];
  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const date = addDaysYmd(today, i);
    if (!isBusinessDayYmd(date)) continue; // 平日のみ（weekdaysOnly は営業日判定に内包）
    const [, m, d] = date.split("-").map(Number);
    if (excluded.has(`${m}/${d}`)) continue;
    if (allowed && !allowed.has(dowJa(date))) continue;
    out.push({ date, startTime, endTime });
  }
  return out;
}
