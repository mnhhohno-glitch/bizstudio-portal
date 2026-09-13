// T-194: サーバー側の共通処理（Prisma 行 → DTO、入力の検証）。API ルートから使う。
import type { Prisma } from "@prisma/client";
import {
  ALL_PREFECTURES,
  AREA_MODE_VALUES,
  CONDITION_STATUS_VALUES,
  PERIOD_DAYS_OPTIONS,
  REGIST_DATE_MODE_VALUES,
  SEARCH_TARGET_VALUES,
  GRAD_YEAR_MIN,
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
    areaMode: c.areaMode,
    prefectures: c.prefectures,
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
  areaMode: string;
  prefectures: string[];
  templateId: string | null;
  plannedCount: number | null;
  deliveryDate: Date | null;
};

type ParseResult = { ok: true; data: ParsedCondition } | { ok: false; error: string };

const PREF_SET = new Set(ALL_PREFECTURES);

function intOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return parseInt(v, 10);
  return undefined;
}

/**
 * 作成（full=true: 必須項目を欠くとエラー）／更新（full=false: 渡された項目だけ検証）の入力検証。
 * 仕様の固定値（学歴・経験職種・居住地・0社を除く・除外リスト・自社へ応募）は受け付けない（列が無い）。
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
        areaMode: "NATIONWIDE",
        prefectures: [],
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

  if (body.areaMode !== undefined) {
    if (typeof body.areaMode !== "string" || !AREA_MODE_VALUES.includes(body.areaMode))
      return { ok: false, error: "希望勤務地の指定方法が不正です" };
    out.areaMode = body.areaMode;
  }
  if (body.prefectures !== undefined) {
    if (!Array.isArray(body.prefectures) || !body.prefectures.every((p) => typeof p === "string" && PREF_SET.has(p)))
      return { ok: false, error: "都道府県の値が不正です（海外は指定できません）" };
    // 定義順に正規化・重複除去
    const set = new Set(body.prefectures as string[]);
    out.prefectures = ALL_PREFECTURES.filter((p) => set.has(p));
  }
  if (out.areaMode === "PREFECTURE" && out.prefectures.length === 0)
    return { ok: false, error: "都道府県指定のときは最低1つ選んでください（空欄だと海外が含まれます）" };
  if (out.areaMode !== "PREFECTURE") out.prefectures = [];

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
    areaMode: c.areaMode,
    prefectures: c.prefectures,
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
    areaMode: p.areaMode as Prisma.ScoutConditionUncheckedCreateInput["areaMode"],
    prefectures: p.prefectures,
    templateId: p.templateId,
    plannedCount: p.plannedCount,
    deliveryDate: p.deliveryDate,
    createdById,
  } satisfies Prisma.ScoutConditionUncheckedCreateInput;
}
