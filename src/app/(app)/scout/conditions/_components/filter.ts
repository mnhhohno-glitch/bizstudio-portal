// T-194: 絞り込み・並び順・CSV 生成（画面側のロジック。API は全件を返し、絞り込みはここで行う）
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  DEFAULT_LAST_LOGIN_DAYS,
  gradYearRangeLabel,
  isDrySentCount,
  periodDaysLabel,
  searchTargetLabel,
  templateKindLabel,
  type SortKey,
} from "@/lib/scout-conditions/constants";
import {
  formatYmdWithWeekday,
  instantToJstDateTime,
  instantToJstYmd,
  ymdWeekdayLabel,
} from "@/lib/scout-conditions/dates";
import type { ConditionDto } from "@/lib/scout-conditions/types";

export type FilterState = {
  machineNos: number[];
  statuses: string[];
  searchTargets: string[];
  registMode: "" | "PERIOD" | "DATE"; // "" = 指定なし
  registDays: number | null;
  registFrom: string; // "YYYY-MM-DD" or ""
  registTo: string;
  lastLoginDays: number | null; // null = 指定なし。初期値は 1日以内（UI仕様）
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: string; // "" = 指定なし / "null" = -- / "0".."7"
  areaModes: string[]; // NATIONWIDE / EAST / WEST のチップ
  prefectures: string[]; // 都道府県指定
  templateKinds: string[];
  execFrom: string;
  execTo: string;
};

export const DEFAULT_FILTER: FilterState = {
  machineNos: [],
  statuses: [],
  searchTargets: [],
  registMode: "",
  registDays: null,
  registFrom: "",
  registTo: "",
  lastLoginDays: DEFAULT_LAST_LOGIN_DAYS,
  gradYearFrom: null,
  gradYearTo: null,
  companyCount: "",
  areaModes: [],
  prefectures: [],
  templateKinds: [],
  execFrom: "",
  execTo: "",
};

export type DayFilter = "prev" | "today" | "next" | "all";

function overlaps(aFrom: string | null, aTo: string | null, bFrom: string, bTo: string): boolean {
  const af = aFrom ?? "0000-00-00";
  const at = aTo ?? "9999-99-99";
  const bf = bFrom || "0000-00-00";
  const bt = bTo || "9999-99-99";
  return af <= bt && at >= bf;
}

export function applyFilter(rows: ConditionDto[], f: FilterState): ConditionDto[] {
  const prefSet = new Set(f.prefectures);
  return rows.filter((c) => {
    if (f.machineNos.length && !f.machineNos.includes(c.machineNo)) return false;
    if (f.statuses.length && !f.statuses.includes(c.status)) return false;
    if (f.searchTargets.length && !f.searchTargets.includes(c.searchTarget)) return false;

    if (f.registMode === "PERIOD") {
      if (c.registDateMode !== "PERIOD") return false;
      if (f.registDays != null && c.registDays !== f.registDays) return false;
    } else if (f.registMode === "DATE") {
      if (c.registDateMode !== "DATE") return false;
      if ((f.registFrom || f.registTo) && !overlaps(c.registDateFrom, c.registDateTo, f.registFrom, f.registTo))
        return false;
    }

    if (f.lastLoginDays != null && c.lastLoginDays !== f.lastLoginDays) return false;

    if (f.gradYearFrom != null || f.gradYearTo != null) {
      const cf = c.gradYearFrom ?? -Infinity;
      const ct = c.gradYearTo ?? Infinity;
      const ff = f.gradYearFrom ?? -Infinity;
      const ft = f.gradYearTo ?? Infinity;
      if (!(cf <= ft && ct >= ff)) return false;
    }

    if (f.companyCount !== "") {
      if (f.companyCount === "null") {
        if (c.companyCount != null) return false;
      } else if (c.companyCount !== Number(f.companyCount)) return false;
    }

    if (f.areaModes.length || prefSet.size) {
      const byMode = f.areaModes.includes(c.areaMode);
      const byPref = prefSet.size > 0 && c.areaMode === "PREFECTURE" && c.prefectures.some((p) => prefSet.has(p));
      if (!byMode && !byPref) return false;
    }

    if (f.templateKinds.length && !(c.templateKind && f.templateKinds.includes(c.templateKind))) return false;

    if (f.execFrom || f.execTo) {
      if (!c.latestRun) return false;
      const ymd = instantToJstYmd(c.latestRun.executedAt);
      if (f.execFrom && ymd < f.execFrom) return false;
      if (f.execTo && ymd > f.execTo) return false;
    }
    return true;
  });
}

export function applyDayFilter(rows: ConditionDto[], day: DayFilter, ymd: string | null): ConditionDto[] {
  if (day === "all" || !ymd) return rows;
  return rows.filter((c) => c.deliveryDate === ymd);
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
    "号機",
    "状態",
    "予約登録日時",
    "配信日",
    "配信日曜日",
    "検索対象",
    "登録日指定",
    "登録日",
    "最終ログイン",
    "卒業年度",
    "経験社数",
    "希望勤務地",
    "都道府県",
    "テンプレート種別",
    "テンプレート",
    "予定件数",
    "抽出件数",
    "送信件数",
    "実行日時",
    "枯渇",
  ];
  const lines = rows.map((c) =>
    [
      `${c.machineNo}号機`,
      conditionStatusLabel(c.status),
      instantToJstDateTime(c.createdAt),
      c.deliveryDate ?? "",
      c.deliveryDate ? ymdWeekdayLabel(c.deliveryDate) : "",
      searchTargetLabel(c.searchTarget),
      c.registDateMode === "PERIOD" ? "期間指定" : "日付入力",
      registDateLabel(c),
      periodDaysLabel(c.lastLoginDays),
      gradYearRangeLabel(c.gradYearFrom, c.gradYearTo),
      companyCountLabel(c.companyCount),
      areaLabel(c.areaMode, c.prefectures),
      c.prefectures.join("/"),
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
