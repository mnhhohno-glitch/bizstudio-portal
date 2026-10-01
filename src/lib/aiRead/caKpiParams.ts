// T-XXX step2: /api/ai/ca-kpi のパラメータ検証と期間の区切り（純粋関数・DB 不要）。
//
// - 日付はすべて JST の "YYYY-MM-DD"（壁時計日付の文字列操作のみ。toISOString().slice(0,10) は使わない＝罠 #17）。
// - 週の区切りは実績表（splitIntoFiveWeeks）と同じ **月曜始まり・日曜終わり**。最初の週は from から最初の日曜まで、
//   最後の週は to までの端数になる。月は暦月（from/to で切り詰め）。
// - 期間の上限: day は 92 日、week/month は 400 日（両端を含む日数）。

import { jstDayOfWeek } from "@/lib/dailyReport/jstDate";

export type CaKpiGranularity = "day" | "week" | "month";

export const CA_KPI_GROUPS = ["interview", "proposal", "rating", "entry", "selection", "activity"] as const;
export type CaKpiGroup = (typeof CA_KPI_GROUPS)[number];
/** 既定で返すグループ。activity（タスク・チャット等の利用回数）は応答を小さく保つため指定時のみ。 */
export const CA_KPI_DEFAULT_GROUPS: readonly CaKpiGroup[] = ["interview", "proposal", "rating", "entry", "selection"];

export const CA_KPI_LIMITS = {
  dayMaxDays: 92,
  weekMonthMaxDays: 400,
  /**
   * rows 全体の推定バイト数の上限。ChatGPT Actions の応答は約 10 万文字までなので、定義文（約 6KB）を足しても収まる値にする。
   * 本番実測（2026-10-01）: 既定グループで 1 行 ≈ 1.1KB（全CA × 11 か月 = 99 行で 114KB → 超過）。
   */
  maxRowsBytes: 85_000,
} as const;

/** グループごとの 1 行あたりの推定バイト数（本番の実測から。キー名 + 3〜4 桁の数値）。 */
const GROUP_BYTES: Record<CaKpiGroup, number> = {
  interview: 230,
  proposal: 100,
  rating: 190,
  entry: 90,
  selection: 420,
  activity: 130,
};
const ROW_BASE_BYTES = 40; // {"ca":"1000001","bucket":"2026-08",…}

/** 1 行あたりの推定バイト数。 */
export function estimateCaKpiRowBytes(groups: readonly CaKpiGroup[]): number {
  return ROW_BASE_BYTES + groups.reduce((s, g) => s + GROUP_BYTES[g], 0);
}

/**
 * 応答の rows（区切り × （全員 + CA 人数） × 1 行の推定サイズ）が上限を超えないか。超えるときは 400 に載せる理由文を返す。
 * @param bucketCount 区切りの数
 * @param rowsPerBucket 1 区切りあたりの行数（caId 指定時は 1、全CAなら CA 人数 + 1（全員行））
 * @param groups 返すグループ（少ないほど 1 行が小さい）
 */
export function checkCaKpiSizeLimit(bucketCount: number, rowsPerBucket: number, groups: readonly CaKpiGroup[]): string | null {
  const rows = bucketCount * rowsPerBucket;
  const perRow = estimateCaKpiRowBytes(groups);
  const bytes = rows * perRow;
  if (bytes <= CA_KPI_LIMITS.maxRowsBytes) return null;
  const maxBuckets = Math.max(1, Math.floor(CA_KPI_LIMITS.maxRowsBytes / (rowsPerBucket * perRow)));
  return (
    `応答が大きすぎます（${bucketCount} 区切り × ${rowsPerBucket} 行 = ${rows} 行・推定 ${Math.round(bytes / 1000)}KB、上限 ${Math.round(CA_KPI_LIMITS.maxRowsBytes / 1000)}KB）。` +
    `同じ条件なら区切りは ${maxBuckets} 個まで。期間を短くする、caId で CA を 1 人に絞る、granularity を粗くする、groups で返す項目を減らす（例 groups=interview,entry,selection）のいずれかで対応してください`
  );
}

export interface CaKpiBucket {
  /** day: "YYYY-MM-DD" / week: 週の初日 "YYYY-MM-DD" / month: "YYYY-MM" */
  key: string;
  from: string; // JST "YYYY-MM-DD"
  to: string; // JST "YYYY-MM-DD"（両端を含む）
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, "0");

export function isValidYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysYmd(s: string, delta: number): string {
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** from〜to の日数（両端を含む）。from > to なら 0。 */
export function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map((x) => parseInt(x, 10));
  const [ty, tm, td] = to.split("-").map((x) => parseInt(x, 10));
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
  return diff < 0 ? 0 : diff + 1;
}

export function lastDayOfMonthYmd(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map((x) => parseInt(x, 10));
  const last = new Date(Date.UTC(y, m, 0)); // 翌月 0 日 = 当月末日
  return `${yyyyMm}-${pad2(last.getUTCDate())}`;
}

const minYmd = (a: string, b: string) => (a < b ? a : b);

/** from〜to を粒度ごとの区切りに分ける。区切りは from/to で切り詰める（最初・最後は端数になり得る）。 */
export function buildCaKpiBuckets(from: string, to: string, granularity: CaKpiGranularity): CaKpiBucket[] {
  const out: CaKpiBucket[] = [];
  if (from > to) return out;
  if (granularity === "day") {
    for (let cur = from; cur <= to; cur = addDaysYmd(cur, 1)) out.push({ key: cur, from: cur, to: cur });
    return out;
  }
  if (granularity === "week") {
    let cur = from;
    while (cur <= to) {
      // 月曜始まり: その週の日曜までの残日数（日曜=0, 月曜=6, …, 土曜=1）。fiveWeeks.ts と同じ式。
      const dow = jstDayOfWeek(cur);
      const daysToSunday = dow === 0 ? 0 : 7 - dow;
      const end = minYmd(addDaysYmd(cur, daysToSunday), to);
      out.push({ key: cur, from: cur, to: end });
      cur = addDaysYmd(end, 1);
    }
    return out;
  }
  // month
  let cur = from;
  while (cur <= to) {
    const ym = cur.slice(0, 7);
    const end = minYmd(lastDayOfMonthYmd(ym), to);
    out.push({ key: ym, from: cur, to: end });
    cur = addDaysYmd(end, 1);
  }
  return out;
}

export interface CaKpiQuery {
  from: string;
  to: string; // 今日より後は今日に丸めた後の値
  requestedTo: string;
  toClamped: boolean;
  granularity: CaKpiGranularity;
  caId: string | null; // 社員番号（employeeNumber）または Employee.id
  groups: CaKpiGroup[];
}

export type ParseResult = { ok: true; query: CaKpiQuery } | { ok: false; error: string };

/**
 * クエリ文字列を検証する。today は JST の "YYYY-MM-DD"（todayJstDateString()）。
 * エラー文は 400 の本文にそのまま入れる（ChatGPT が読んで言い直せるよう理由を書く）。
 */
export function parseCaKpiQuery(sp: URLSearchParams, today: string): ParseResult {
  const from = sp.get("from");
  const requestedTo = sp.get("to");
  if (!from || !requestedTo) return { ok: false, error: "from と to（YYYY-MM-DD・JST）は必須です" };
  if (!isValidYmd(from)) return { ok: false, error: "from は実在する日付を YYYY-MM-DD 形式で指定してください" };
  if (!isValidYmd(requestedTo)) return { ok: false, error: "to は実在する日付を YYYY-MM-DD 形式で指定してください" };
  if (from > requestedTo) return { ok: false, error: "from は to 以前の日付にしてください" };
  if (from > today) return { ok: false, error: `from が未来の日付です（今日は ${today}）` };

  const gRaw = sp.get("granularity") ?? "month";
  if (gRaw !== "day" && gRaw !== "week" && gRaw !== "month") {
    return { ok: false, error: "granularity は day / week / month のいずれかです（既定 month）" };
  }
  const granularity: CaKpiGranularity = gRaw;

  // 上限は丸める前の期間で判定する（未来を指定して上限を回避させない）。
  const days = daysInclusive(from, requestedTo);
  const max = granularity === "day" ? CA_KPI_LIMITS.dayMaxDays : CA_KPI_LIMITS.weekMonthMaxDays;
  if (days > max) {
    return {
      ok: false,
      error: `期間が長すぎます（${days}日）。granularity=${granularity} の上限は ${max} 日です。期間を分けるか粒度を変えてください`,
    };
  }

  const toClamped = requestedTo > today;
  const to = toClamped ? today : requestedTo;

  const caIdRaw = sp.get("caId");
  const caId = caIdRaw && caIdRaw.trim() ? caIdRaw.trim() : null;
  if (caId && !/^[A-Za-z0-9_-]{1,64}$/.test(caId)) {
    return { ok: false, error: "caId は社員番号（例 1000001）を指定してください" };
  }

  let groups: CaKpiGroup[] = [...CA_KPI_DEFAULT_GROUPS];
  const groupsRaw = sp.get("groups");
  if (groupsRaw && groupsRaw.trim()) {
    const parts = groupsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((p) => !(CA_KPI_GROUPS as readonly string[]).includes(p));
    if (bad.length) {
      return { ok: false, error: `groups に不明な値があります: ${bad.join(", ")}（使える値: ${CA_KPI_GROUPS.join(", ")}）` };
    }
    groups = CA_KPI_GROUPS.filter((g) => parts.includes(g));
  }

  return { ok: true, query: { from, to, requestedTo, toClamped, granularity, caId, groups } };
}
