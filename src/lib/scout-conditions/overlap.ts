// T-214: 同日の他号機の条件との「重なり」判定（純関数。DB も現在時刻も見ない。today は呼び出し側が Asia/Tokyo 基準で渡す。罠#17）。
//
// 2つの条件が「重なる」＝ 7軸すべてが交わる。1軸でも交わらなければ重ならない。
//   | 軸           | 交わる条件 |
//   | 検索対象     | 同じ値（未送信/送信済/含む） |
//   | 登録日       | 期間が交わる。「N日以内」は「今日−N日〜今日」に直してから比較。片方が指定なし（端が空）なら交わる |
//   | 最終ログイン | 同上（「N日以内」は必ず今日を含むので、実質つねに交わる） |
//   | 卒業年度     | 範囲が交わる（15-26 と 21-22 は交わる／15-17 と 21-22 は交わらない）。端が空は開区間 |
//   | 経験社数     | 範囲が交わる（～3社 と ～1社 は交わる）。-- は指定なし／0社=[0,0]／～N社=[0,N]／7社以上=[7,∞) |
//   | 居住地       | 都道府県の集合が交わる。全国は何とでも交わる。東日本と西日本は交わらない。
//   |              | 全国/東日本/西日本は都道府県に展開して比較する（expandAreaToPrefectures。東京 と 神奈川 は交わらない） |
//   | 希望勤務地   | 都道府県の集合が交わる。指定なし（全国）は何とでも交わる |
// 境界（今日ちょうど・端の年度）は「含む」。
//
// 画面の編集モーダル（フォームを変えるたびにクライアントで再判定）と一覧の「重なり」印（サーバー側）が同じ関数を使う。
import { expandAreaToPrefectures } from "./constants";
import { addDaysYmd } from "./dates";

/** 判定に要る 7 軸の値。ConditionDto / ConditionInput / RunHistoryRowDto のどれからも作れる形 */
export type OverlapInput = {
  searchTarget: string;
  registDateMode: string; // PERIOD / DATE
  registDays: number | null;
  registDateFrom: string | null; // "YYYY-MM-DD"
  registDateTo: string | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string; // NATIONWIDE / EAST / WEST / PREFECTURE
  residencePrefectures: string[];
  workPrefMode: string; // ALL / SELECTED
  workPrefectures: string[];
};

export type OverlapAxisKey = "searchTarget" | "registDate" | "lastLogin" | "gradYear" | "companyCount" | "residence" | "workPref";

export const OVERLAP_AXES: { key: OverlapAxisKey; label: string }[] = [
  { key: "searchTarget", label: "検索対象" },
  { key: "registDate", label: "登録日" },
  { key: "lastLogin", label: "最終ログイン日" },
  { key: "gradYear", label: "卒業年度" },
  { key: "companyCount", label: "経験社数" },
  { key: "residence", label: "居住地" },
  { key: "workPref", label: "希望勤務地" },
];

type Bound = string | number | null; // null = 開いた端（指定なし）

/** [aFrom, aTo] と [bFrom, bTo] が交わるか（端は含む。null は無限に開いた端） */
function rangesIntersect(aFrom: Bound, aTo: Bound, bFrom: Bound, bTo: Bound): boolean {
  // a の開始が b の終わりより後、または b の開始が a の終わりより後なら交わらない
  if (aFrom !== null && bTo !== null && aFrom > bTo) return false;
  if (bFrom !== null && aTo !== null && bFrom > aTo) return false;
  return true;
}

/** 登録日の区間（"YYYY-MM-DD"）。期間指定 N日以内 → [today−N, today]。日付入力 → [from, to]（空は開く） */
function registDateRange(c: OverlapInput, todayYmd: string): [Bound, Bound] {
  if (c.registDateMode === "PERIOD") {
    if (c.registDays == null) return [null, null]; // 指定なし
    return [addDaysYmd(todayYmd, -c.registDays), todayYmd];
  }
  return [c.registDateFrom ?? null, c.registDateTo ?? null];
}

/** 最終ログイン日の区間。N日以内 → [today−N, today] */
function lastLoginRange(c: OverlapInput, todayYmd: string): [Bound, Bound] {
  return [addDaysYmd(todayYmd, -c.lastLoginDays), todayYmd];
}

/** 経験社数の区間。null=指定なし／0=0社／1〜6=～N社（0〜N）／7=7社以上（7〜） */
function companyCountRange(v: number | null): [Bound, Bound] {
  if (v == null) return [null, null];
  if (v === 0) return [0, 0];
  if (v >= 7) return [7, null];
  return [0, v];
}

function setsIntersect(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((p) => set.has(p));
}

/** 居住地の集合。全国は「開いた集合」（null）にして何とでも交わるようにする。都道府県指定の空配列も開いた扱い（入力途中の安全側） */
function residenceSet(c: OverlapInput): string[] | null {
  if (c.residenceMode === "NATIONWIDE") return null;
  const prefs = expandAreaToPrefectures(c.residenceMode, c.residencePrefectures);
  return prefs.length === 0 ? null : prefs;
}

/** 希望勤務地の集合。指定なし（ALL）は開いた集合。空配列も開いた扱い */
function workPrefSet(c: OverlapInput): string[] | null {
  if (c.workPrefMode === "ALL") return null;
  return c.workPrefectures.length === 0 ? null : c.workPrefectures;
}

function openSetsIntersect(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return true;
  return setsIntersect(a, b);
}

/** 軸ごとの交差判定 */
export function axisIntersects(key: OverlapAxisKey, a: OverlapInput, b: OverlapInput, todayYmd: string): boolean {
  switch (key) {
    case "searchTarget":
      return a.searchTarget === b.searchTarget;
    case "registDate": {
      const [af, at] = registDateRange(a, todayYmd);
      const [bf, bt] = registDateRange(b, todayYmd);
      return rangesIntersect(af, at, bf, bt);
    }
    case "lastLogin": {
      const [af, at] = lastLoginRange(a, todayYmd);
      const [bf, bt] = lastLoginRange(b, todayYmd);
      return rangesIntersect(af, at, bf, bt);
    }
    case "gradYear":
      return rangesIntersect(a.gradYearFrom, a.gradYearTo, b.gradYearFrom, b.gradYearTo);
    case "companyCount": {
      const [af, at] = companyCountRange(a.companyCount);
      const [bf, bt] = companyCountRange(b.companyCount);
      return rangesIntersect(af, at, bf, bt);
    }
    case "residence":
      return openSetsIntersect(residenceSet(a), residenceSet(b));
    case "workPref":
      return openSetsIntersect(workPrefSet(a), workPrefSet(b));
  }
}

/** 7軸それぞれの交差結果（デバッグ・説明表示用） */
export function overlapAxes(a: OverlapInput, b: OverlapInput, todayYmd: string): { key: OverlapAxisKey; label: string; intersects: boolean }[] {
  return OVERLAP_AXES.map((ax) => ({ ...ax, intersects: axisIntersects(ax.key, a, b, todayYmd) }));
}

/** 2つの条件が重なるか（7軸すべてが交わる） */
export function isOverlapping(a: OverlapInput, b: OverlapInput, todayYmd: string): boolean {
  return OVERLAP_AXES.every((ax) => axisIntersects(ax.key, a, b, todayYmd));
}

/** target と重なる others の要素だけを返す（順序は others のまま） */
export function findOverlapping<T extends OverlapInput>(target: OverlapInput, others: T[], todayYmd: string): T[] {
  return others.filter((o) => isOverlapping(target, o, todayYmd));
}

// ---- 一覧の「重なり」印（サーバー側で一覧取得時に判定） ----

/** 一覧側の判定に要る最小の形（ConditionDto から作れる） */
export type OverlapListRow = OverlapInput & {
  id: string;
  machineId: string;
  machineNo: number;
  recordNo: string | null;
  status: string;
  deliveryDate: string | null; // "YYYY-MM-DD"
};

/** 条件の「日」。配信日が空なら今日とみなす（編集モーダルの右パネルと同じ約束） */
export function overlapDayOf(deliveryDate: string | null, todayYmd: string): string {
  return deliveryDate ?? todayYmd;
}

const OVERLAP_STATUSES = new Set(["RUNNING", "QUEUED"]);

/**
 * 有効・予約の条件ごとに、同じ日の**他の稼働中号機**の有効・予約の条件で重なるものを返す（id → 相手の一覧。号機順→▲▼順）。
 * 完了・枯渇の行は判定しない（相手にもならない）。停止中の号機は相手にならない。
 */
export function computeListOverlaps<T extends OverlapListRow & { queueOrder: number; createdAt: string }>(
  rows: T[],
  activeMachineIds: Set<string>,
  todayYmd: string,
): Map<string, T[]> {
  const candidates = rows
    .filter((r) => OVERLAP_STATUSES.has(r.status) && activeMachineIds.has(r.machineId))
    .sort((a, b) => a.machineNo - b.machineNo || a.queueOrder - b.queueOrder || a.createdAt.localeCompare(b.createdAt));
  const byDay = new Map<string, T[]>();
  for (const r of candidates) {
    const day = overlapDayOf(r.deliveryDate, todayYmd);
    const list = byDay.get(day) ?? [];
    list.push(r);
    byDay.set(day, list);
  }
  const out = new Map<string, T[]>();
  for (const list of byDay.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      const hits = list.filter((o) => o.machineId !== r.machineId && isOverlapping(r, o, todayYmd));
      if (hits.length) out.set(r.id, hits);
    }
  }
  return out;
}
