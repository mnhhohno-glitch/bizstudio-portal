// パターン名の自動生成。UIプレビューと保存時の両方でこの関数を使う（同じ選択なら必ず同じ名前）
import { DEFAULT_WORK_LOCATIONS } from "./area";

export type PatternNameInput = {
  sendStatus?: string | null; // "UNSENT" | "SENT"
  registDays?: number | null;
  registDirection?: string | null; // "WITHIN" | "AFTER"
  lastLoginDays?: number | null; // デフォルト1
  areaType?: string | null; // "EAST" | "WEST" | "NATIONWIDE" | "PREFECTURES"
  prefectures?: string[] | null;
  education?: string | null; // "NONE" | "高卒" | ...
  gradYearFrom?: number | null;
  gradYearTo?: number | null;
  companyCount?: number | null;
  jobCategories?: string[] | null;
  jobCategoryPriority?: string | null; // "FIRST" | "SECOND"
  workLocations?: string[] | null;
  workLocationPriority?: string | null; // "NONE" | "SECOND"
  transferTiming?: string | null;
};

function isDefaultWorkLocations(locations: string[]): boolean {
  if (locations.length !== DEFAULT_WORK_LOCATIONS.length) return false;
  return DEFAULT_WORK_LOCATIONS.every((l, i) => locations[i] === l);
}

export function generatePatternName(input: PatternNameInput): string {
  // --- 基本部品（常に含める・「_」連結） ---
  const baseParts: string[] = [];

  // 2. 登録日
  if (input.registDays != null && input.registDirection) {
    if (input.registDays === 7 && input.registDirection === "WITHIN") {
      baseParts.push("開放日");
    } else if (input.registDays === 8 && input.registDirection === "AFTER") {
      baseParts.push("既登録");
    } else if (input.registDirection === "WITHIN") {
      baseParts.push(`登録${input.registDays}日以内`);
    } else {
      baseParts.push(`登録${input.registDays}日以降`);
    }
  }

  // 3. エリア
  if (input.areaType === "EAST") baseParts.push("東日本");
  else if (input.areaType === "WEST") baseParts.push("西日本");
  else if (input.areaType === "NATIONWIDE") baseParts.push("全国");
  else if (input.areaType === "PREFECTURES" && input.prefectures?.length) {
    baseParts.push(input.prefectures.join("/"));
  }

  // 4. 学歴
  if (input.education === "NONE") baseParts.push("学歴不問");
  else if (input.education) baseParts.push(`${input.education}以上`);

  // 5. 卒業年度（下2桁ハイフン連結）
  if (input.gradYearFrom != null || input.gradYearTo != null) {
    const two = (y: number) => String(y % 100).padStart(2, "0");
    const from = input.gradYearFrom != null ? two(input.gradYearFrom) : "";
    const to = input.gradYearTo != null ? two(input.gradYearTo) : "";
    baseParts.push(`${from}-${to}`);
  }

  // 6. 経験社数
  if (input.companyCount != null) baseParts.push(`経験${input.companyCount}社`);

  // 7. 勤務地順位
  if (input.workLocationPriority === "NONE") baseParts.push("エリア不順");
  else if (input.workLocationPriority === "SECOND") baseParts.push("エリア第2");

  // --- 追加部品（デフォルトから変更時のみ末尾に追加。この順） ---
  const extraParts: string[] = [];

  // 最終ログイン日（デフォルト1）
  if (input.lastLoginDays != null && input.lastLoginDays !== 1) {
    extraParts.push(`ログ${input.lastLoginDays}日以内`);
  }

  // 希望勤務地（デフォルト 首都圏/愛知/大阪/兵庫/京都）
  if (input.workLocations?.length && !isDefaultWorkLocations(input.workLocations)) {
    extraParts.push(input.workLocations.join("/"));
  }

  // 転職希望時期（デフォルト未選択）
  if (input.transferTiming) extraParts.push(input.transferTiming);

  // 希望職種（デフォルト指定なし・最大3件）
  if (input.jobCategories?.length) extraParts.push(input.jobCategories.join("/"));

  // 希望職種順位（デフォルト指定なし）
  if (input.jobCategoryPriority === "FIRST") extraParts.push("職種第1");
  else if (input.jobCategoryPriority === "SECOND") extraParts.push("職種第2");

  // 1. 送信状態（先頭記号のみ連結子なし）
  let prefix = "";
  if (input.sendStatus === "UNSENT") prefix = "【未送信】";
  else if (input.sendStatus === "SENT") prefix = "≪送信済≫";

  return prefix + [...baseParts, ...extraParts].join("_");
}

// 号機プレフィックス付きの表示名（画面表示・コピーは常にこの形式）
export function machineLabel(machineNo: number | null | undefined): string {
  return machineNo == null ? "全号機" : `${machineNo}号機`;
}

export function displayPatternName(
  machineNo: number | null | undefined,
  name: string
): string {
  return `${machineLabel(machineNo)}：${name}`;
}
