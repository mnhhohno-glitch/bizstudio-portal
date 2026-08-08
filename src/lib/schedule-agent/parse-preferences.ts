// T-139 step4: モードA（taskId）用の定型パース。LLM は使わない。
//
// 「希望日時」フィールドは 100% 定型:
//   第1希望: 2026年7月15日（火） 19:00〜20:00
//   第2希望: 2026年7月16日（水） 17:00〜17:30
//   第3希望: なし              ← 正規表現に一致しない＝自然にスキップ
import type { DesiredWindow } from "./match-slot";
import type { MeetingMethod } from "./reply-templates";

/** 全角数字→半角。 */
function normalizeDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

const DESIRED_RE =
  /第\s*([0-9０-９]+)\s*希望\s*[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][^）)]*[）)]\s*(\d{1,2})\s*[：:]\s*(\d{2})\s*[〜~～ー–—-]\s*(\d{1,2})\s*[：:]\s*(\d{2})/g;

/** 「希望日時」を第1→第2→第3 の順にパースする。0件なら空配列（呼び出し側は no_reply）。 */
export function parseDesiredWindows(raw: string | null | undefined): DesiredWindow[] {
  if (!raw) return [];
  const text = normalizeDigits(raw);
  const p = (n: number) => String(n).padStart(2, "0");
  const out: { n: number; w: DesiredWindow }[] = [];

  for (const m of text.matchAll(DESIRED_RE)) {
    out.push({
      n: Number(m[1]),
      w: {
        date: `${Number(m[2])}-${p(Number(m[3]))}-${p(Number(m[4]))}`,
        startTime: `${p(Number(m[5]))}:${m[6]}`,
        endTime: `${p(Number(m[7]))}:${m[8]}`,
      },
    });
  }

  return out.sort((a, b) => a.n - b.n).map((x) => x.w);
}

/** mynavi_new タイトルから氏名を抽出: `【... 新規面談調整】新規応募者 山田太郎` */
export function extractCandidateName(title: string): string | null {
  const m = /新規応募者\s+(.+)$/.exec(String(title).trim());
  const name = m ? m[1].trim() : "";
  return name.length > 0 ? name : null;
}

/**
 * 「面談形式」フィールド → 面談方法。実値は「電話」or「オンライン（Google Meet）」。
 * 「電話」を含む → 電話 / それ以外（オンライン・どちらでも 等）→ オンライン。LLM 推測はしない。
 */
export function methodFromFormatField(raw: string | null | undefined): MeetingMethod {
  return raw && raw.includes("電話") ? "電話" : "オンライン";
}
