// T-194: サーバー側の共通処理（Prisma 行 → DTO、入力の検証）。API ルートから使う。
import type { Prisma } from "@prisma/client";
import {
  ALL_PREFECTURES,
  AREA_MODE_VALUES,
  CONDITION_STATUS_VALUES,
  DEFAULT_WORK_PREFECTURES,
  WORK_PREF_MODE_VALUES,
  PERIOD_DAYS_OPTIONS,
  REGIST_DATE_MODE_VALUES,
  SEARCH_TARGET_VALUES,
  GRAD_YEAR_MIN,
  formatRecordNo,
} from "./constants";
import { dbDateToYmd, isValidYmd, ymdToDbDate } from "./dates";
import type { ConditionDto, ConditionInput, RunDto } from "./types";

// 一覧・詳細で共通の include（実績は新しい順に全件。1条件あたり数件〜数十件を想定）
export const conditionInclude = {
  machine: { select: { id: true, machineNo: true } },
  template: { select: { id: true, kind: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  runs: { orderBy: { executedAt: "desc" as const } },
} satisfies Prisma.ScoutConditionInclude;

type ConditionRow = Prisma.ScoutConditionGetPayload<{ include: typeof conditionInclude }>;

function toRunDto(r: ConditionRow["runs"][number]): RunDto {
  return {
    id: r.id,
    executedAt: r.executedAt.toISOString(),
    extractedCount: r.extractedCount,
    sentCount: r.sentCount,
    isDry: r.isDry,
    rawNotification: r.rawNotification,
  };
}

export function toConditionDto(c: ConditionRow): ConditionDto {
  const runs = c.runs.map(toRunDto);
  return {
    id: c.id,
    machineId: c.machineId,
    machineNo: c.machine.machineNo,
    seqNo: c.seqNo,
    recordNo: formatRecordNo(c.machine.machineNo, c.seqNo),
    status: c.status,
    queueOrder: c.queueOrder,
    searchTarget: c.searchTarget,
    registDateMode: c.registDateMode,
    registDays: c.registDays,
    registDateFrom: dbDateToYmd(c.registDateFrom),
    registDateTo: dbDateToYmd(c.registDateTo),
    lastLoginDays: c.lastLoginDays,
    gradYearFrom: c.gradYearFrom,
    gradYearTo: c.gradYearTo,
    companyCount: c.companyCount,
    residenceMode: c.residenceMode,
    residencePrefectures: c.residencePrefectures,
    workPrefMode: c.workPrefMode ?? "SELECTED",
    workPrefectures: c.workPrefectures,
    templateId: c.templateId,
    templateKind: c.template?.kind ?? null,
    templateName: c.template?.name ?? null,
    plannedCount: c.plannedCount,
    deliveryDate: dbDateToYmd(c.deliveryDate),
    createdById: c.createdById,
    createdByName: c.createdBy?.name ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    latestRun: runs[0] ?? null,
    runs,
  };
}

export type ParsedCondition = {
  machineId: string;
  status: ConditionInput["status"];
  queueOrder: number;
  searchTarget: string;
  registDateMode: string;
  registDays: number | null;
  registDateFrom: Date | null;
  registDateTo: Date | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: string;
  residencePrefectures: string[];
  workPrefMode: string;
  workPrefectures: string[];
  templateId: string | null;
  plannedCount: number | null;
  deliveryDate: Date | null;
};

type ParseResult = { ok: true; data: ParsedCondition } | { ok: false; error: string };

const PREF_SET = new Set(ALL_PREFECTURES);

/** 都道府県配列の検証と定義順への正規化（重複除去）。不正なら null */
function normalizePrefectures(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every((p) => typeof p === "string" && PREF_SET.has(p))) return null;
  const set = new Set(v as string[]);
  return ALL_PREFECTURES.filter((p) => set.has(p));
}

function intOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}

/**
 * 作成（full=true: 必須項目を欠くとエラー）／更新（full=false: 渡された項目だけ検証）の入力検証。
 * 仕様の固定値（学歴・経験職種・0社を除く・除外リスト・自社へ応募）は受け付けない（列が無い）。
 */
export function parseConditionInput(
  body: Record<string, unknown>,
  base: ParsedCondition | null,
): ParseResult {
  const out: ParsedCondition = base
    ? { ...base }
    : {
        machineId: "",
        status: "QUEUED",
        queueOrder: 0,
        searchTarget: "EXCLUDE",
        registDateMode: "PERIOD",
        registDays: 7,
        registDateFrom: null,
        registDateTo: null,
        lastLoginDays: 1,
        gradYearFrom: null,
        gradYearTo: null,
        companyCount: null,
        residenceMode: "NATIONWIDE",
        residencePrefectures: [],
        workPrefMode: "SELECTED",
        workPrefectures: DEFAULT_WORK_PREFECTURES,
        templateId: null,
        plannedCount: null,
        deliveryDate: null,
      };

  if (body.machineId !== undefined) {
    if (typeof body.machineId !== "string" || !body.machineId) return { ok: false, error: "号機を指定してください" };
    out.machineId = body.machineId;
  }
  if (!out.machineId) return { ok: false, error: "号機を指定してください" };

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !CONDITION_STATUS_VALUES.includes(body.status))
      return { ok: false, error: "状態の値が不正です" };
    out.status = body.status;
  }

  if (body.queueOrder !== undefined) {
    const v = intOrNull(body.queueOrder);
    if (v === undefined || v === null || v < 0) return { ok: false, error: "予約の並び順は0以上の整数です" };
    out.queueOrder = v;
  }

  if (body.searchTarget !== undefined) {
    if (typeof body.searchTarget !== "string" || !SEARCH_TARGET_VALUES.includes(body.searchTarget))
      return { ok: false, error: "検索対象の値が不正です" };
    out.searchTarget = body.searchTarget;
  }

  if (body.registDateMode !== undefined) {
    if (typeof body.registDateMode !== "string" || !REGIST_DATE_MODE_VALUES.includes(body.registDateMode))
      return { ok: false, error: "登録日の指定方法が不正です" };
    out.registDateMode = body.registDateMode;
  }
  if (body.registDays !== undefined) {
    const v = intOrNull(body.registDays);
    if (v === undefined) return { ok: false, error: "登録日（期間指定）の値が不正です" };
    if (v !== null && !(PERIOD_DAYS_OPTIONS as readonly number[]).includes(v))
      return { ok: false, error: "登録日（期間指定）は 1/3/7/14/30/60/90/180/360 日以内から選んでください" };
    out.registDays = v;
  }
  for (const key of ["registDateFrom", "registDateTo", "deliveryDate"] as const) {
    if (body[key] === undefined) continue;
    const v = body[key];
    if (v === null || v === "") {
      out[key] = null;
    } else if (isValidYmd(v)) {
      out[key] = ymdToDbDate(v);
    } else {
      return { ok: false, error: `${key} は YYYY-MM-DD 形式で指定してください` };
    }
  }
  if (out.registDateMode === "PERIOD" && out.registDays == null)
    return { ok: false, error: "登録日（期間指定）を選んでください" };
  if (out.registDateMode === "DATE" && out.registDateFrom == null && out.registDateTo == null)
    return { ok: false, error: "登録日（日付入力）の開始または終了を入力してください" };
  if (out.registDateFrom && out.registDateTo && out.registDateFrom > out.registDateTo)
    return { ok: false, error: "登録日の開始が終了より後になっています" };

  if (body.lastLoginDays !== undefined) {
    const v = intOrNull(body.lastLoginDays);
    if (v === undefined || v === null || !(PERIOD_DAYS_OPTIONS as readonly number[]).includes(v))
      return { ok: false, error: "最終ログイン日は 1/3/7/14/30/60/90/180/360 日以内から選んでください" };
    out.lastLoginDays = v;
  }

  for (const key of ["gradYearFrom", "gradYearTo"] as const) {
    if (body[key] === undefined) continue;
    const v = intOrNull(body[key]);
    if (v === undefined) return { ok: false, error: "卒業年度の値が不正です" };
    if (v !== null && (v < GRAD_YEAR_MIN || v > 2100)) return { ok: false, error: "卒業年度は西暦4桁で指定してください" };
    out[key] = v;
  }
  if (out.gradYearFrom != null && out.gradYearTo != null && out.gradYearFrom > out.gradYearTo)
    return { ok: false, error: "卒業年度の開始が終了より後になっています" };

  if (body.companyCount !== undefined) {
    const v = intOrNull(body.companyCount);
    if (v === undefined || (v !== null && (v < 0 || v > 7))) return { ok: false, error: "経験社数の値が不正です" };
    out.companyCount = v;
  }

  if (body.residenceMode !== undefined) {
    if (typeof body.residenceMode !== "string" || !AREA_MODE_VALUES.includes(body.residenceMode))
      return { ok: false, error: "居住地の指定方法が不正です" };
    out.residenceMode = body.residenceMode;
  }
  if (body.residencePrefectures !== undefined) {
    const prefs = normalizePrefectures(body.residencePrefectures);
    if (!prefs) return { ok: false, error: "居住地の都道府県の値が不正です（海外は指定できません）" };
    out.residencePrefectures = prefs;
  }
  if (out.residenceMode === "PREFECTURE" && out.residencePrefectures.length === 0)
    return { ok: false, error: "居住地を都道府県指定にするときは最低1つ選んでください（空欄だと海外が含まれます）" };
  if (out.residenceMode !== "PREFECTURE") out.residencePrefectures = [];

  // T-196: 希望勤務地（ALL=指定しない〔RPA は「全国」を入れる〕 / SELECTED=都道府県指定）
  if (body.workPrefMode !== undefined) {
    if (typeof body.workPrefMode !== "string" || !WORK_PREF_MODE_VALUES.includes(body.workPrefMode))
      return { ok: false, error: "希望勤務地の指定方法が不正です" };
    out.workPrefMode = body.workPrefMode;
  }
  if (body.workPrefectures !== undefined) {
    const prefs = normalizePrefectures(body.workPrefectures);
    if (!prefs) return { ok: false, error: "希望勤務地の都道府県の値が不正です（海外は指定できません）" };
    out.workPrefectures = prefs;
  }
  if (out.workPrefMode === "SELECTED" && out.workPrefectures.length === 0)
    return { ok: false, error: "希望勤務地を都道府県指定にするときは最低1つ選んでください" };
  if (out.workPrefMode !== "SELECTED") out.workPrefectures = [];

  if (body.templateId !== undefined) {
    if (body.templateId === null || body.templateId === "") out.templateId = null;
    else if (typeof body.templateId === "string") out.templateId = body.templateId;
    else return { ok: false, error: "テンプレートの値が不正です" };
  }

  if (body.plannedCount !== undefined) {
    const v = intOrNull(body.plannedCount);
    if (v === undefined || (v !== null && v < 0)) return { ok: false, error: "予定件数は0以上の整数です" };
    out.plannedCount = v;
  }

  return { ok: true, data: out };
}

// ---- T-201: 実績のある条件の固定 ----
// 一度でも配信された条件（scout_runs が1件以上）は、状態以外を後から変えられないようにする。
// 配信日や検索条件を上書きされると、その実績がどの条件によるものか分からなくなり記録として使えないため。
// 状態（status）だけは「その条件をこれから使うかどうか」を表すもので過去の実績そのものではなく、
// 固定すると実績のある条件を手で「完了」にできず運用が詰まるため対象から外している。
const LOCKED_FIELDS: { key: Exclude<keyof ParsedCondition, "status">; label: string }[] = [
  { key: "machineId", label: "号機" },
  { key: "queueOrder", label: "予約の並び順" },
  { key: "deliveryDate", label: "配信日" },
  { key: "plannedCount", label: "予定件数" },
  { key: "searchTarget", label: "検索対象" },
  { key: "registDateMode", label: "登録日の指定方法" },
  { key: "registDays", label: "登録日（期間指定）" },
  { key: "registDateFrom", label: "登録日（開始）" },
  { key: "registDateTo", label: "登録日（終了）" },
  { key: "lastLoginDays", label: "最終ログイン日" },
  { key: "gradYearFrom", label: "卒業年度（開始）" },
  { key: "gradYearTo", label: "卒業年度（終了）" },
  { key: "companyCount", label: "経験社数" },
  { key: "residenceMode", label: "居住地" },
  { key: "residencePrefectures", label: "居住地の都道府県" },
  { key: "workPrefMode", label: "希望勤務地" },
  { key: "workPrefectures", label: "希望勤務地の都道府県" },
  { key: "templateId", label: "配信文" },
];

/** 日付は instant、都道府県は配列なので値で比べる（参照比較では常に「変更あり」になる） */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const t = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? null : NaN);
    return t(a) === t(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}

/**
 * T-201: 実績のある条件への更新で、状態以外の項目が動いていないかを調べる。
 * 戻り値は変更されている項目の表示名（空配列なら状態だけの更新なので通してよい）。
 * before は parseConditionInput を通した正規化済みの値を渡すこと（正規化前と比べると誤検知する）。
 */
export function changedLockedFields(before: ParsedCondition, after: ParsedCondition): string[] {
  return LOCKED_FIELDS.filter((f) => !sameFieldValue(before[f.key], after[f.key])).map((f) => f.label);
}

export function rowToParsed(c: ConditionRow): ParsedCondition {
  return {
    machineId: c.machineId,
    status: c.status,
    queueOrder: c.queueOrder,
    searchTarget: c.searchTarget,
    registDateMode: c.registDateMode,
    registDays: c.registDays,
    registDateFrom: c.registDateFrom,
    registDateTo: c.registDateTo,
    lastLoginDays: c.lastLoginDays,
    gradYearFrom: c.gradYearFrom,
    gradYearTo: c.gradYearTo,
    companyCount: c.companyCount,
    residenceMode: c.residenceMode,
    residencePrefectures: c.residencePrefectures,
    workPrefMode: c.workPrefMode ?? "SELECTED",
    workPrefectures: c.workPrefectures,
    templateId: c.templateId,
    plannedCount: c.plannedCount,
    deliveryDate: c.deliveryDate,
  };
}

/** ParsedCondition → Prisma の unchecked 入力（enum は文字列のまま渡す。検証済みなのでキャスト） */
export function toPrismaData(p: ParsedCondition, createdById: string | null) {
  return {
    machineId: p.machineId,
    status: p.status as Prisma.ScoutConditionUncheckedCreateInput["status"],
    queueOrder: p.queueOrder,
    searchTarget: p.searchTarget as Prisma.ScoutConditionUncheckedCreateInput["searchTarget"],
    registDateMode: p.registDateMode as Prisma.ScoutConditionUncheckedCreateInput["registDateMode"],
    registDays: p.registDays,
    registDateFrom: p.registDateFrom,
    registDateTo: p.registDateTo,
    lastLoginDays: p.lastLoginDays,
    gradYearFrom: p.gradYearFrom,
    gradYearTo: p.gradYearTo,
    companyCount: p.companyCount,
    residenceMode: p.residenceMode as Prisma.ScoutConditionUncheckedCreateInput["residenceMode"],
    residencePrefectures: p.residencePrefectures,
    workPrefMode: p.workPrefMode as Prisma.ScoutConditionUncheckedCreateInput["workPrefMode"],
    workPrefectures: p.workPrefectures,
    templateId: p.templateId,
    plannedCount: p.plannedCount,
    deliveryDate: p.deliveryDate,
    createdById,
  } satisfies Prisma.ScoutConditionUncheckedCreateInput;
}
