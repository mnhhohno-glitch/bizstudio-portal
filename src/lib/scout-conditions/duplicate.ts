// T-216: 同日・別号機の配信条件どうしの「重複」判定（純関数。DB も現在時刻も見ない。today は呼び出し側が Asia/Tokyo 基準で渡す。罠#17）。
//
// T-214 は「7軸すべてが**交わる**（範囲が少しでも触れる）」を “重なり” と呼んでいた。
// ところが最終ログイン日は「N日以内」が必ず今日を含むため実質つねに交わり、居住地の「全国」や
// 希望勤務地の「指定なし」も何とでも交わるので、条件がまったく違う組にまで印が付いていた
// （2026-09-21 の一覧では 1-016 / 2-008 / 2-009 / 3-007 / 3-008 / 4-011 / 4-012 / 5-005 の8行）。
// 印が付いていても見に行く意味が無い状態だったため、T-216 で判定を
// **「7軸すべての値が一致する組だけ」** に改めた（旧「少しでも交わる」判定は廃止）。
//
// 重複＝次を**すべて**満たすとき。
//   - **同じ配信日**（配信日が空の有効・予約は「今日」とみなす。T-214 と同じ約束）
//   - **別の号機**（同じ号機どうしは対象外。同じ号機の中は有効1件＋予約列なので同時には走らない）
//   - 相手の状態が有効（RUNNING）または予約（QUEUED）
//   - **7軸すべてが同じ値**
//
// 境界の考え方: **一致のみ**。範囲が触れているかどうかは見ない。
//   例) 卒業年度 15-26 と 21-22 は T-214 では「交わる」＝重なりだったが、T-216 では値が違うので重複ではない。
//       経験社数 ～3社 と ～1社 も同様に重複ではない。登録日 7日以内 と 3日以内 も別物。
//   判定は軸ごとに「正規化した文字列キーが等しいか」で行う（axisKey）。キーの作り方は下表のとおり。
//
//   | 軸           | 一致とみなす値（axisKey） |
//   | 検索対象     | 値そのもの（EXCLUDE / ONLY / INCLUDE） |
//   | 登録日       | 指定方法＋値。期間指定は `PERIOD:7`（日数。未選択＝指定なしは `PERIOD:`）、日付入力は `DATE:2026-09-01~2026-09-07`（端が空はそのまま空）。
//   |              | 指定方法が違えば別物（`PERIOD:7` と `DATE:…` は一致しない） |
//   | 最終ログイン | 日数そのもの（1日以内 と 3日以内 は別物） |
//   | 卒業年度     | 開始と終了の組（`2015-2026`。指定なしは空文字） |
//   | 経験社数     | 値そのもの（指定なし＝空文字。0社／～N社／7社以上はそれぞれ別物） |
//   | 居住地       | 都道府県の集合（全国／東日本／西日本は都道府県に展開してから比べる。expandAreaToPrefectures）。
//   |              | 「全国」と「47都道府県を選んだ都道府県指定」は同じ集合なので一致する |
//   | 希望勤務地   | 都道府県の集合（指定なし〔ALL〕は RPA が「全国」を入れるので全都道府県に展開して比べる） |
//
// 画面の編集モーダル（フォームを変えるたびにクライアントで再判定・保存前の確認画面）と
// 一覧の「重複」印（サーバー側）が同じ関数を使う。
import { ALL_PREFECTURES, expandAreaToPrefectures } from "./constants";

/** 判定に要る 7 軸の値。ConditionDto / ConditionInput / RunHistoryRowDto のどれからも作れる形 */
export type DuplicateInput = {
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

export type DuplicateAxisKey = "searchTarget" | "registDate" | "lastLogin" | "gradYear" | "companyCount" | "residence" | "workPref";

export const DUPLICATE_AXES: { key: DuplicateAxisKey; label: string }[] = [
  { key: "searchTarget", label: "検索対象" },
  { key: "registDate", label: "登録日" },
  { key: "lastLogin", label: "最終ログイン日" },
  { key: "gradYear", label: "卒業年度" },
  { key: "companyCount", label: "経験社数" },
  { key: "residence", label: "居住地" },
  { key: "workPref", label: "希望勤務地" },
];

/** 都道府県の集合キー（重複除去＋並びを揃える。入力の順番・重複に左右されないようにする） */
function prefectureSetKey(prefectures: string[]): string {
  return [...new Set(prefectures)].sort().join(",");
}

/**
 * 軸ごとの「一致判定用キー」。同じ文字列になる2条件はその軸が同じ値とみなす。
 * 範囲の広さ・交差は見ない（T-216。一致のみ）。
 */
export function axisKey(key: DuplicateAxisKey, c: DuplicateInput): string {
  switch (key) {
    case "searchTarget":
      return c.searchTarget;
    case "registDate":
      return c.registDateMode === "PERIOD"
        ? `PERIOD:${c.registDays ?? ""}`
        : `DATE:${c.registDateFrom ?? ""}~${c.registDateTo ?? ""}`;
    case "lastLogin":
      return String(c.lastLoginDays);
    case "gradYear":
      return `${c.gradYearFrom ?? ""}-${c.gradYearTo ?? ""}`;
    case "companyCount":
      return c.companyCount == null ? "" : String(c.companyCount);
    case "residence":
      return prefectureSetKey(expandAreaToPrefectures(c.residenceMode, c.residencePrefectures));
    case "workPref":
      // 指定なし（ALL）はマイナビ上「全国」を入れる＝全都道府県と同じ集合
      return prefectureSetKey(c.workPrefMode === "ALL" ? ALL_PREFECTURES : c.workPrefectures);
  }
}

/** 7軸をまとめた1本のキー。これが等しい2条件は検索条件が同じ */
export function conditionKey(c: DuplicateInput): string {
  return DUPLICATE_AXES.map((ax) => axisKey(ax.key, c)).join("|");
}

export function axisMatches(key: DuplicateAxisKey, a: DuplicateInput, b: DuplicateInput): boolean {
  return axisKey(key, a) === axisKey(key, b);
}

/** 7軸それぞれの一致結果（デバッグ・説明表示用） */
export function duplicateAxes(a: DuplicateInput, b: DuplicateInput): { key: DuplicateAxisKey; label: string; matches: boolean }[] {
  return DUPLICATE_AXES.map((ax) => ({ ...ax, matches: axisMatches(ax.key, a, b) }));
}

/** 2つの条件の検索条件が完全に同じか（7軸すべて一致）。配信日・号機・状態はここでは見ない */
export function isDuplicate(a: DuplicateInput, b: DuplicateInput): boolean {
  return conditionKey(a) === conditionKey(b);
}

/** target と検索条件が完全に同じ others の要素だけを返す（順序は others のまま） */
export function findDuplicates<T extends DuplicateInput>(target: DuplicateInput, others: T[]): T[] {
  const key = conditionKey(target);
  return others.filter((o) => conditionKey(o) === key);
}

// ---- 一覧の「重複」印（サーバー側で一覧取得時に判定） ----

/** 一覧側の判定に要る最小の形（ConditionDto から作れる） */
export type DuplicateListRow = DuplicateInput & {
  id: string;
  machineId: string;
  machineNo: number;
  recordNo: string | null;
  status: string;
  deliveryDate: string | null; // "YYYY-MM-DD"
};

/** 条件の「日」。配信日が空なら今日とみなす（編集モーダルの右パネルと同じ約束） */
export function duplicateDayOf(deliveryDate: string | null, todayYmd: string): string {
  return deliveryDate ?? todayYmd;
}

const DUPLICATE_STATUSES = new Set(["RUNNING", "QUEUED"]);

/**
 * 有効・予約の条件ごとに、**同じ配信日**・**別の号機**（稼働中）で**7軸が完全に一致する**条件を返す
 * （id → 相手の一覧。号機順→▲▼順）。完了・枯渇の行は判定しない（相手にもならない）。停止中の号機は相手にならない。
 */
export function computeListDuplicates<T extends DuplicateListRow & { queueOrder: number; createdAt: string }>(
  rows: T[],
  activeMachineIds: Set<string>,
  todayYmd: string,
): Map<string, T[]> {
  const candidates = rows
    .filter((r) => DUPLICATE_STATUSES.has(r.status) && activeMachineIds.has(r.machineId))
    .sort((a, b) => a.machineNo - b.machineNo || a.queueOrder - b.queueOrder || a.createdAt.localeCompare(b.createdAt));
  // 「同じ日 × 同じ検索条件」でまとめてから、その中の他号機だけを拾う
  const byDayAndCondition = new Map<string, T[]>();
  for (const r of candidates) {
    const key = `${duplicateDayOf(r.deliveryDate, todayYmd)} ${conditionKey(r)}`;
    const list = byDayAndCondition.get(key) ?? [];
    list.push(r);
    byDayAndCondition.set(key, list);
  }
  const out = new Map<string, T[]>();
  for (const list of byDayAndCondition.values()) {
    if (list.length < 2) continue;
    for (const r of list) {
      const hits = list.filter((o) => o.machineId !== r.machineId);
      if (hits.length) out.set(r.id, hits);
    }
  }
  return out;
}
