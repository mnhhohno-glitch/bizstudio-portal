// T-194: 日付切替・並び順・CSV 生成（画面側のロジック。API は全件を返し、日付の絞り込みはここで行う）
// T-197: 左の絞り込みパネル（7軸検索）は廃止したので、その絞り込みロジックは削除した
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  isDrySentCount,
  periodDaysLabel,
  ratePercentLabel,
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
import { pickQueuedToActivate, shouldCompleteRunning } from "@/lib/scout-conditions/rollover";
import type { ConditionDto, RunHistoryRowDto } from "@/lib/scout-conditions/types";

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

/** 登録日の表示（期間指定なら「7日以内」、日付入力なら「9/1(月)〜9/7(日)」）。T-213: 実行履歴の行（RunHistoryRowDto）でも使うため Pick にした */
export function registDateLabel(c: Pick<ConditionDto, "registDateMode" | "registDays" | "registDateFrom" | "registDateTo">): string {
  if (c.registDateMode === "PERIOD") return periodDaysLabel(c.registDays);
  const f = c.registDateFrom ? formatYmdWithWeekday(c.registDateFrom) : "";
  const t = c.registDateTo ? formatYmdWithWeekday(c.registDateTo) : "";
  return `${f}〜${t}`;
}

export function isDryRow(c: ConditionDto): boolean {
  return c.status === "DRY" || isDrySentCount(c.latestRun?.sentCount);
}

/**
 * T-216: 一覧の狭い列に出す「姓だけ」。User.name は「大野 将幸」のように姓と名の間が空白（半角・全角）なので先頭の塊を取る。
 * 空白が無い名前はそのまま返す（切り詰めない）。CSV には姓ではなくフルネームを出す。
 */
export function surnameOf(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().split(/[ 　]+/)[0] ?? "";
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
    // T-216: 人が最後に保存した日時・操作者（自動処理・▲▼では動かない edited_at / edited_by。未更新は空）
    "更新日時",
    "更新者",
    "配信日",
    // T-216-fix: ここから2列は値の並びが「配信日曜日 → 作成日」なのに見出しが逆だった（T-194 からの取り違え）。見出しを値に合わせた
    "配信日曜日",
    "作成日",
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
    "結果件数（初回）", // T-213: マイナビの検索結果件数。値を持つ最も古い実行の値（一覧・モーダルと同じ）
    "抽出件数",
    "送信件数",
    "実行日時",
    "実行回数", // T-213
    "枯渇",
  ];
  const lines = rows.map((c) =>
    [
      c.recordNo ?? "",
      `${c.machineNo}号機`,
      conditionStatusLabel(c.status),
      instantToJstDateTime(c.createdAt),
      c.editedAt ? instantToJstDateTime(c.editedAt) : "",
      c.editedByName ?? "",
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
      c.firstSearchResultCount ?? "",
      c.latestRun?.extractedCount ?? "",
      c.latestRun?.sentCount ?? "",
      c.latestRun ? instantToJstDateTime(c.latestRun.executedAt) : "",
      c.runCount,
      isDryRow(c) ? "枯渇" : "",
    ]
      .map(csvCell)
      .join(","),
  );
  // Excel で文字化けしないよう UTF-8 BOM を先頭に付ける
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * T-213: 実行履歴タブの CSV（表示中の行）。列は画面の並び（実行日時／号機・担当者／条件／検索条件の要約／結果／抽出／送信）。
 * 文字コード・改行は buildCsv と同じ（UTF-8 BOM＋CRLF）。
 */
export function buildRunsCsv(rows: RunHistoryRowDto[]): string {
  const header = [
    "実行日時",
    "枯渇",
    "号機",
    "担当者",
    "NO",
    "状態",
    "検索対象",
    "登録日",
    "最終ログイン",
    "卒業年度",
    "経験社数",
    "居住地",
    "希望勤務地",
    "テンプレート種別",
    "テンプレート",
    "結果件数",
    "抽出件数",
    "送信件数",
    "送信率",
  ];
  const lines = rows.map((r) =>
    [
      instantToJstDateTime(r.executedAt),
      r.isDry || isDrySentCount(r.sentCount) ? "枯渇" : "",
      `${r.machineNo}号機`,
      r.recruiterName,
      r.recordNo ?? "",
      conditionStatusLabel(r.status),
      searchTargetLabel(r.searchTarget),
      registDateLabel(r),
      periodDaysLabel(r.lastLoginDays),
      gradYearRangeLabel(r.gradYearFrom, r.gradYearTo),
      companyCountLabel(r.companyCount),
      areaLabel(r.residenceMode, r.residencePrefectures),
      workPrefLabel(r.workPrefMode, r.workPrefectures),
      templateKindLabel(r.templateKind),
      r.templateName ?? "",
      r.searchResultCount ?? "",
      r.extractedCount,
      r.sentCount,
      ratePercentLabel(r.sentCount, r.extractedCount) ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * T-210 / T-211: 「翌朝有効」を出す条件の id（号機ごとに最大1件）。
 * 明日の朝、自動で有効になる予定の予約に印を付けるためのもので、判定そのものは持たない
 * （実際に切り替えるのはサーバー側の activate.ts。こちらは同じ規則〔rollover.ts〕を画面に映すだけ）。
 *
 *   - 今の有効（RUNNING）が明朝の判定で完了になる見込み（配信日が今日以前、または配信日が空で最新実行が今日以前）、
 *     または今の有効が無い
 *   - そのうえで、**配信日が明日ちょうど**の予約のうち ▲▼ の並び順が一番上の1件
 *     （T-211。配信日が空の予約・明後日以降の予約には出さない＝自動では上がらない）
 *
 * 今の有効の配信日が明日以降（人が手で未来日付を有効にした場合）なら、その号機にはバッジを出さない。
 * activeMachineIds には稼働中の号機だけを渡す（停止中の号機は RPA が条件を取りに来ないため上がらない）。
 */
export function nextMorningConditionIds(
  conditions: ConditionDto[],
  tomorrowYmd: string,
  activeMachineIds: string[],
): string[] {
  const active = new Set(activeMachineIds);
  const toRow = (c: ConditionDto) => ({
    id: c.id,
    deliveryYmd: c.deliveryDate,
    queueOrder: c.queueOrder,
    createdAtIso: c.createdAt,
    lastRunYmd: c.latestRun ? instantToJstYmd(c.latestRun.executedAt) : null,
  });

  // 号機ごとに「明朝も有効が残る」＝バッジを出さない号機を先に決める。
  // shouldCompleteRunning に明日を渡すと「配信日が今日以前なら完了」＝仕様どおりの判定になる（今日を別に渡す必要は無い）。
  const staysRunning = new Set<string>();
  for (const c of conditions) {
    if (c.status !== "RUNNING" || !active.has(c.machineId)) continue;
    if (!shouldCompleteRunning(toRow(c), tomorrowYmd)) staysRunning.add(c.machineId);
  }
  const queuedByMachine = new Map<string, ReturnType<typeof toRow>[]>();
  for (const c of conditions) {
    if (c.status !== "QUEUED" || !active.has(c.machineId) || staysRunning.has(c.machineId)) continue;
    const list = queuedByMachine.get(c.machineId) ?? [];
    list.push(toRow(c));
    queuedByMachine.set(c.machineId, list);
  }

  const ids: string[] = [];
  for (const list of queuedByMachine.values()) {
    const next = pickQueuedToActivate(list, tomorrowYmd);
    if (next) ids.push(next.id);
  }
  return ids;
}
