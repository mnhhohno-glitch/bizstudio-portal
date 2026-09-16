// T-195: RPA（PAD）向け外部 API の契約形。docs/rpa/scout-conditions-api.md と 1:1 に対応する。
// ★PAD はレスポンスのキー欠落で例外停止するため、全レスポンスで同じキー集合を返す（値が無ければ null）。
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_AREA_GROUPS, EAST_AREA_GROUPS, WEST_AREA_GROUPS, companyCountLabel, formatTemplateNo } from "./constants";
import { activateDueCondition } from "./activate";
import { dbDateToYmd } from "./dates";

/** 固定値（スキーマに列を持たない。RPA は常にこの値でフォームに入力する） */
export const EXTERNAL_FIXED_VALUES = {
  education: "指定なし（チェックしない）",
  jobCategory: "指定なし",
  excludeZeroCompany: false,
  excludeList: "含まない",
  appliedToUs: "含まない",
} as const;

export type ExternalConditionPayload = {
  conditionId: string;
  searchTarget: string; // EXCLUDE / ONLY / INCLUDE
  registDate: { mode: "PERIOD" | "DATE" | "NONE"; days: number | null; from: string | null; to: string | null };
  lastLoginDays: number | null;
  gradYear: { from: number | null; to: number | null };
  companyCount: string | null; // マイナビのプルダウン表示そのまま（0社 / ～1社 … / 7社以上）。指定なしは null
  /** 居住地（T-196 で area から改名。規約は同じ） */
  residence: { mode: string; regions: string[]; prefectures: string[] };
  /** 希望勤務地（T-196）。mode=ALL のときは prefectures=[]（RPA は「全国」を入れる） */
  workLocation: { mode: "ALL" | "SELECTED"; prefectures: string[] };
  /**
   * 配信文。T-207 で templateNo（「T-001」形式のテンプレート番号）を追加した。
   * 既存キー（templateId / name / subject / body）は従来どおり返す（RPA が読まなくても動く追加のみ）。
   * 未採番の窓では templateNo が null になり得る。
   */
  template: { templateId: string; templateNo: string | null; name: string; subject: string; body: string } | null;
  plannedCount: number | null;
};

export type ExternalCurrentResponse = {
  ok: boolean;
  machineNo: number | null;
  condition: ExternalConditionPayload | null;
  fixed: typeof EXTERNAL_FIXED_VALUES;
  message: string | null;
};

export const externalConditionInclude = {
  template: { select: { id: true, seqNo: true, name: true, subject: true, body: true } },
} satisfies Prisma.ScoutConditionInclude;

type ExternalConditionRow = Prisma.ScoutConditionGetPayload<{ include: typeof externalConditionInclude }>;

/**
 * 居住地を RPA がチェックする単位に変換する。
 *  NATIONWIDE → regions=["全国"] / EAST → 東日本4地域 / WEST → 西日本6地域。
 *  PREFECTURE → 全都道府県が選ばれている地域は regions に、それ以外の個別都道府県は prefectures に（RPA はその順にチェックする）。
 */
export function toExternalResidence(mode: string, prefectures: string[]): ExternalConditionPayload["residence"] {
  if (mode === "NATIONWIDE") return { mode, regions: ["全国"], prefectures: [] };
  if (mode === "EAST") return { mode, regions: EAST_AREA_GROUPS.map((g) => g.region), prefectures: [] };
  if (mode === "WEST") return { mode, regions: WEST_AREA_GROUPS.map((g) => g.region), prefectures: [] };
  const set = new Set(prefectures);
  const regions: string[] = [];
  const rest: string[] = [];
  for (const g of ALL_AREA_GROUPS) {
    const picked = g.prefectures.filter((p) => set.has(p));
    if (picked.length === 0) continue;
    if (picked.length === g.prefectures.length) regions.push(g.region);
    else rest.push(...picked);
  }
  return { mode, regions, prefectures: rest };
}

/** 希望勤務地。ALL は「指定しない」＝ RPA が「全国」を入れるので prefectures は空で返す */
export function toExternalWorkLocation(mode: string | null, prefectures: string[]): ExternalConditionPayload["workLocation"] {
  if (mode === "ALL") return { mode: "ALL", prefectures: [] };
  return { mode: "SELECTED", prefectures };
}

export function toExternalCondition(c: ExternalConditionRow): ExternalConditionPayload {
  const registDate: ExternalConditionPayload["registDate"] =
    c.registDateMode === "PERIOD"
      ? { mode: "PERIOD", days: c.registDays, from: null, to: null }
      : { mode: "DATE", days: null, from: dbDateToYmd(c.registDateFrom), to: dbDateToYmd(c.registDateTo) };
  return {
    conditionId: c.id,
    searchTarget: c.searchTarget,
    registDate,
    lastLoginDays: c.lastLoginDays,
    gradYear: { from: c.gradYearFrom, to: c.gradYearTo },
    companyCount: c.companyCount == null ? null : companyCountLabel(c.companyCount),
    residence: toExternalResidence(c.residenceMode, c.residencePrefectures),
    workLocation: toExternalWorkLocation(c.workPrefMode, c.workPrefectures),
    // 差し込み記号（[担当者] 等）は展開せず原文のまま返す（展開は RPA 側の既存処理）
    template: c.template
      ? {
          templateId: c.template.id,
          // T-207: 実績とテンプレートを後から突き合わせるための番号（「T-001」）
          templateNo: formatTemplateNo(c.template.seqNo),
          name: c.template.name,
          subject: c.template.subject,
          body: c.template.body,
        }
      : null,
    plannedCount: c.plannedCount,
  };
}

/** その号機で RUNNING の条件（複数あれば queueOrder 昇順 → 更新が新しい順で先頭）。 */
export async function findRunningCondition(machineId: string) {
  return prisma.scoutCondition.findFirst({
    where: { machineId, status: "RUNNING" },
    include: externalConditionInclude,
    orderBy: [{ queueOrder: "asc" }, { updatedAt: "desc" }],
  });
}

/** GET /api/external/scout-conditions/current の本体。HTTP は常に 200（認証以外）。 */
export async function buildCurrentResponse(machineNoRaw: string | null): Promise<ExternalCurrentResponse> {
  const base = { condition: null, fixed: EXTERNAL_FIXED_VALUES };
  const n = machineNoRaw == null || machineNoRaw.trim() === "" ? NaN : Number(machineNoRaw);
  if (!Number.isInteger(n)) {
    return { ok: false, machineNo: null, ...base, message: "machineNo を整数で指定してください" };
  }
  const machine = await prisma.rpaScoutMachine.findUnique({ where: { machineNo: n } });
  if (!machine) return { ok: false, machineNo: n, ...base, message: `${n}号機は存在しません` };
  if (!machine.isActive) return { ok: false, machineNo: n, ...base, message: `${n}号機は停止中です` };

  let running = await findRunningCondition(machine.id);
  // T-209: 有効が無いときは、配信日が当日（JST）以前の予約を1件だけ有効に上げてから返す（activate.ts）。
  //   レスポンスの形は変えない（RPA は従来どおり condition を読むだけ）。上げられる予約が無ければ従来どおり null。
  if (!running) {
    const activatedId = await activateDueCondition(machine.id);
    if (activatedId) running = await findRunningCondition(machine.id);
  }
  if (!running) return { ok: true, machineNo: n, ...base, message: "RUNNING の条件がありません" };
  return { ok: true, machineNo: n, condition: toExternalCondition(running), fixed: EXTERNAL_FIXED_VALUES, message: null };
}
