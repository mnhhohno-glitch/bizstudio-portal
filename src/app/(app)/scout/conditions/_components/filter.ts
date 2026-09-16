// T-194: 日付切替・並び順・CSV 生成（画面側のロジック。API は全件を返し、日付の絞り込みはここで行う）
// T-197: 左の絞り込みパネル（7軸検索）は廃止したので、その絞り込みロジックは削除した
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  isDrySentCount,
  periodDaysLabel,
  searchTargetLabel,
  templateKindLabel,
  workPrefLabel,
  type SortKey,
} from "@/lib/scout-conditions/constants";
import {
  formatYmdWithWeekday,
  instantToJstDateTime,
  instantToJstYmd,
  ymdWeekdayLabel,
} from "@/lib/scout-conditions/dates";
import type { ConditionDto } from "@/lib/scout-conditions/types";

export type DayFilter = "prev" | "today" | "next" | "all";

/** 日付タブ（前日/当日/翌日/すべて）の絞り込み。基準は配信日（deliveryDate）。作成日では絞らない（T-198 で明記） */
export function applyDayFilter(rows: ConditionDto[], day: DayFilter, ymd: string | null): ConditionDto[] {
  if (day === "all" || !ymd) return rows;
  return rows.filter((c) => c.deliveryDate === ymd);
}

/** T-199: 期間指定の基準。reserved=予約日（createdAt を JST の日付に直したもの）/ delivery=配信日 */
export type RangeBasis = "reserved" | "delivery";
export type DateRange = { from: string; to: string };

/** 行の「基準日」（YYYY-MM-DD）。配信日が未設定の行は delivery 基準では null（期間指定時は除外される） */
export function basisYmd(c: ConditionDto, basis: RangeBasis): string | null {
  return basis === "reserved" ? instantToJstYmd(c.createdAt) : c.deliveryDate;
}

/**
 * T-199: 任意期間での絞り込み。開始のみ＝その日以降、終了のみ＝その日以前、両方＝その範囲。
 * 開始・終了とも空なら何もしない（呼び出し側が日付タブを使う）。
 */
export function applyRangeFilter(rows: ConditionDto[], range: DateRange, basis: RangeBasis): ConditionDto[] {
  if (!range.from && !range.to) return rows;
  return rows.filter((c) => {
    const ymd = basisYmd(c, basis);
    if (!ymd) return false;
    if (range.from && ymd < range.from) return false;
    if (range.to && ymd > range.to) return false;
    return true;
  });
}

/** T-199: 号機の絞り込み（複数選択・OR）。空配列＝絞り込みなし（担当CAフィルタと同じ約束） */
export function applyMachineFilter(rows: ConditionDto[], machineNos: number[]): ConditionDto[] {
  if (machineNos.length === 0) return rows;
  const set = new Set(machineNos);
  return rows.filter((c) => set.has(c.machineNo));
}

/** T-201: 状態の絞り込み（複数選択・OR）。空配列＝絞り込みなし（号機フィルタと同じ約束） */
export function applyStatusFilter(rows: ConditionDto[], statuses: string[]): ConditionDto[] {
  if (statuses.length === 0) return rows;
  const set = new Set(statuses);
  return rows.filter((c) => set.has(c.status));
}

const STATUS_ORDER: Record<string, number> = { RUNNING: 0, QUEUED: 1, DRY: 2, DONE: 3 };

export function sortConditions(rows: ConditionDto[], key: SortKey): ConditionDto[] {
  const byMachine = (a: ConditionDto, b: ConditionDto) =>
    a.machineNo - b.machineNo ||
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    a.queueOrder - b.queueOrder ||
    a.createdAt.localeCompare(b.createdAt);
  const arr = [...rows];
  if (key === "machine") return arr.sort(byMachine);
  if (key === "sentAsc") {
    return arr.sort((a, b) => {
      const sa = a.latestRun?.sentCount;
      const sb = b.latestRun?.sentCount;
      if (sa == null && sb == null) return byMachine(a, b);
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sa - sb || byMachine(a, b);
    });
  }
  if (key === "plannedDesc") {
    return arr.sort((a, b) => {
      const pa = a.plannedCount;
      const pb = b.plannedCount;
      if (pa == null && pb == null) return byMachine(a, b);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pb - pa || byMachine(a, b);
    });
  }
  // executedDesc
  return arr.sort((a, b) => {
    const ea = a.latestRun?.executedAt;
    const eb = b.latestRun?.executedAt;
    if (!ea && !eb) return byMachine(a, b);
    if (!ea) return 1;
    if (!eb) return -1;
    return eb.localeCompare(ea) || byMachine(a, b);
  });
}

/** 登録日の表示（期間指定なら「7日以内」、日付入力なら「9/1(月)〜9/7(日)」） */
export function registDateLabel(c: ConditionDto): string {
  if (c.registDateMode === "PERIOD") return periodDaysLabel(c.registDays);
  const f = c.registDateFrom ? formatYmdWithWeekday(c.registDateFrom) : "";
  const t = c.registDateTo ? formatYmdWithWeekday(c.registDateTo) : "";
  return `${f}〜${t}`;
}

export function isDryRow(c: ConditionDto): boolean {
  return c.status === "DRY" || isDrySentCount(c.latestRun?.sentCount);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: ConditionDto[]): string {
  const header = [
    "NO",
    "号機",
    "状態",
    "予約登録日時",
    "配信日",
    "作成日",
    "配信日曜日",
    "検索対象",
    "登録日指定",
    "登録日",
    "最終ログイン",
    "卒業年度",
    "経験社数",
    "居住地",
    "居住地の都道府県",
    "希望勤務地",
    "希望勤務地の都道府県",
    "テンプレート種別",
    "テンプレート",
    "予測件数",
    "抽出件数",
    "送信件数",
    "実行日時",
    "枯渇",
  ];
  const lines = rows.map((c) =>
    [
      c.recordNo ?? "",
      `${c.machineNo}号機`,
      conditionStatusLabel(c.status),
      instantToJstDateTime(c.createdAt),
      c.deliveryDate ?? "",
      c.deliveryDate ? ymdWeekdayLabel(c.deliveryDate) : "",
      instantToJstYmd(c.createdAt),
      searchTargetLabel(c.searchTarget),
      c.registDateMode === "PERIOD" ? "期間指定" : "日付入力",
      registDateLabel(c),
      periodDaysLabel(c.lastLoginDays),
      gradYearRangeLabel(c.gradYearFrom, c.gradYearTo),
      companyCountLabel(c.companyCount),
      areaLabel(c.residenceMode, c.residencePrefectures),
      c.residencePrefectures.join("/"),
      workPrefLabel(c.workPrefMode, c.workPrefectures),
      c.workPrefectures.join("/"),
      templateKindLabel(c.templateKind),
      c.templateName ?? "",
      c.plannedCount ?? "",
      c.latestRun?.extractedCount ?? "",
      c.latestRun?.sentCount ?? "",
      c.latestRun ? instantToJstDateTime(c.latestRun.executedAt) : "",
      isDryRow(c) ? "枯渇" : "",
    ]
      .map(csvCell)
      .join(","),
  );
  // Excel で文字化けしないよう UTF-8 BOM を先頭に付ける
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * T-209: 「翌朝有効」を出す条件の id（号機ごとに最大1件）。
 * 明日の朝、自動で有効になる予定の予約に印を付けるためのもので、判定そのものは持たない
 * （実際に有効へ上げるのはサーバー側の activate.ts。こちらは同じ規則を画面に映すだけ）。
 *
 *   - 状態が予約（QUEUED）
 *   - その号機に有効（RUNNING）が無い
 *   - 配信日が「翌日」ちょうど（当日以前は開いた時点で有効に上がっているので出さない。明後日以降も出さない）
 *   - 同じ号機で該当が複数あれば ▲▼ の並び順が一番上の1件だけ
 *
 * activeMachineIds には稼働中の号機だけを渡す（停止中の号機は RPA が条件を取りに来ないため上がらない）。
 */
export function nextMorningConditionIds(
  conditions: ConditionDto[],
  tomorrowYmd: string,
  activeMachineIds: string[],
): string[] {
  const active = new Set(activeMachineIds);
  const hasRunning = new Set(conditions.filter((c) => c.status === "RUNNING").map((c) => c.machineId));
  const candidates = new Map<string, ConditionDto>();
  for (const c of conditions) {
    if (c.status !== "QUEUED" || c.deliveryDate !== tomorrowYmd) continue;
    if (!active.has(c.machineId) || hasRunning.has(c.machineId)) continue;
    const cur = candidates.get(c.machineId);
    if (!cur || c.queueOrder < cur.queueOrder || (c.queueOrder === cur.queueOrder && c.createdAt < cur.createdAt)) {
      candidates.set(c.machineId, c);
    }
  }
  return [...candidates.values()].map((c) => c.id);
}
