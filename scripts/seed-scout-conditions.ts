// T-194: スカウト配信条件コンソールのシード（祝日 / 号機の稼働フラグ / テンプレート / 初期条件）。
// 再実行しても重複しない（upsert・存在チェック）。
//
//   npx tsx --env-file=<master worktree の .env> scripts/seed-scout-conditions.ts
//
// - 祝日:        prisma/seed/holidays-2026.json を upsert（date ユニーク）
// - 号機:        既存 RpaScoutMachine の isActive を仕様どおりに更新するのみ（1〜4 稼働 / 5〜6 停止）。行は作らない
// - テンプレート: prisma/seed/scout-templates.json を (kind, name) で upsert。JSON が無ければ飛ばす
// - 初期条件:    scout_conditions が空のときだけ、稼働中号機の「現在の設定」（RpaScoutLog 最新→RpaScoutPattern）から
//               RUNNING の条件を1件ずつ作る（テンプレートはログの件名テンプレ名で照合）。既に行があれば何もしない
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { addDaysYmd, jstTodayYmd, ymdToDbDate } from "@/lib/scout-conditions/dates";
import { ALL_PREFECTURES, DEFAULT_WORK_PREFECTURES } from "@/lib/scout-conditions/constants";
import { createScoutCondition } from "@/lib/scout-conditions/create";

type MappedCondition = {
  searchTarget: "EXCLUDE" | "ONLY" | "INCLUDE";
  registDateMode: "PERIOD" | "DATE";
  registDays: number | null;
  registDateFrom: Date | null;
  registDateTo: Date | null;
  lastLoginDays: number;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  residenceMode: "NATIONWIDE" | "EAST" | "WEST" | "PREFECTURE";
  residencePrefectures: string[];
  workPrefMode: "ALL" | "SELECTED";
  workPrefectures: string[];
};

const ACTIVE_MACHINE_NOS = [1, 2, 3, 4];
const INACTIVE_MACHINE_NOS = [5, 6];

type HolidayJson = { date: string; name: string }[];
type TemplatesJson = {
  templates: { kind: "UNSENT" | "SENT" | "INDIVIDUAL"; name: string; subject: string; body: string; sortOrder: number }[];
  defaultAssignments: { machineNo: number; templateName: string }[];
};

async function seedHolidays(): Promise<number> {
  const path = join(process.cwd(), "prisma", "seed", "holidays-2026.json");
  const list = JSON.parse(readFileSync(path, "utf8")) as HolidayJson;
  let n = 0;
  for (const h of list) {
    await prisma.holiday.upsert({
      where: { date: ymdToDbDate(h.date) },
      update: { name: h.name },
      create: { date: ymdToDbDate(h.date), name: h.name },
    });
    n++;
  }
  return n;
}

async function seedMachines(): Promise<{ updated: number; missing: number[] }> {
  const rows = await prisma.rpaScoutMachine.findMany({ select: { machineNo: true, isActive: true } });
  const have = new Set(rows.map((r) => r.machineNo));
  const missing = [...ACTIVE_MACHINE_NOS, ...INACTIVE_MACHINE_NOS].filter((n) => !have.has(n));
  const a = await prisma.rpaScoutMachine.updateMany({
    where: { machineNo: { in: ACTIVE_MACHINE_NOS }, isActive: false },
    data: { isActive: true },
  });
  const b = await prisma.rpaScoutMachine.updateMany({
    where: { machineNo: { in: INACTIVE_MACHINE_NOS }, isActive: true },
    data: { isActive: false },
  });
  return { updated: a.count + b.count, missing };
}

async function seedTemplates(): Promise<{ upserted: number; defaults: number } | null> {
  const path = join(process.cwd(), "prisma", "seed", "scout-templates.json");
  if (!existsSync(path)) return null;
  const json = JSON.parse(readFileSync(path, "utf8")) as TemplatesJson;
  let upserted = 0;
  for (const t of json.templates) {
    await prisma.scoutTemplate.upsert({
      where: { kind_name: { kind: t.kind, name: t.name } },
      update: { subject: t.subject, body: t.body, sortOrder: t.sortOrder, isActive: true },
      create: { kind: t.kind, name: t.name, subject: t.subject, body: t.body, sortOrder: t.sortOrder },
    });
    upserted++;
  }
  let defaults = 0;
  for (const d of json.defaultAssignments ?? []) {
    const t = await prisma.scoutTemplate.findFirst({ where: { name: d.templateName } });
    if (!t) continue;
    const r = await prisma.rpaScoutMachine.updateMany({ where: { machineNo: d.machineNo }, data: { defaultTemplateId: t.id } });
    defaults += r.count;
  }
  return { upserted, defaults };
}

// RpaScoutPattern → ScoutCondition の写像（現行パターンの構造化列から6軸へ）
function mapPattern(p: {
  sendStatus: string | null;
  registDays: number | null;
  registDirection: string | null;
  lastLoginDays: number | null;
  areaType: string | null;
  prefectures: unknown;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
  rawConditions: unknown;
}, today: string): MappedCondition {
  const searchTarget: MappedCondition["searchTarget"] = p.sendStatus === "SENT" ? "ONLY" : p.sendStatus === "UNSENT" ? "EXCLUDE" : "INCLUDE";

  // 登録日: WITHIN=期間指定（N日以内）。AFTER（N日以降＝既登録）は日付入力で「終了=today-N」として表す。
  // 原文が「2日前」のような日指定なら from=to=today-2。
  let registDateMode: "PERIOD" | "DATE" = "PERIOD";
  let registDays: number | null = 7;
  let registDateFrom: string | null = null;
  let registDateTo: string | null = null;
  const raw = (p.rawConditions ?? {}) as Record<string, string>;
  const rawRegist = typeof raw.regist_date === "string" ? raw.regist_date : "";
  const dayAgo = rawRegist.match(/(\d+)日前/);
  if (p.registDays != null && p.registDirection === "WITHIN" && [1, 3, 7, 14, 30, 60, 90, 180, 360].includes(p.registDays)) {
    registDays = p.registDays;
  } else if (p.registDays != null && p.registDirection === "AFTER") {
    registDateMode = "DATE";
    registDays = null;
    registDateTo = addDaysYmd(today, -p.registDays);
  } else if (dayAgo) {
    registDateMode = "DATE";
    registDays = null;
    registDateFrom = addDaysYmd(today, -Number(dayAgo[1]));
    registDateTo = registDateFrom;
  }

  let residenceMode: "NATIONWIDE" | "EAST" | "WEST" | "PREFECTURE" = "NATIONWIDE";
  let prefectures: string[] = [];
  if (p.areaType === "EAST" || p.areaType === "WEST") residenceMode = p.areaType;
  else if (p.areaType === "PREFECTURES" && Array.isArray(p.prefectures)) {
    const set = new Set(p.prefectures.filter((x): x is string => typeof x === "string"));
    prefectures = ALL_PREFECTURES.filter((x) => set.has(x));
    if (prefectures.length > 0) residenceMode = "PREFECTURE";
  }

  return {
    searchTarget,
    registDateMode,
    registDays,
    registDateFrom: registDateFrom ? ymdToDbDate(registDateFrom) : null,
    registDateTo: registDateTo ? ymdToDbDate(registDateTo) : null,
    lastLoginDays: p.lastLoginDays ?? 1,
    gradYearFrom: p.gradYearFrom,
    gradYearTo: p.gradYearTo,
    companyCount: p.companyCount != null && p.companyCount >= 0 && p.companyCount <= 7 ? p.companyCount : null,
    residenceMode,
    residencePrefectures: prefectures,
    workPrefMode: "SELECTED",
    workPrefectures: DEFAULT_WORK_PREFECTURES,
  };
}

async function seedInitialConditions(): Promise<{ created: number; skipped: string }> {
  const existing = await prisma.scoutCondition.count();
  if (existing > 0) return { created: 0, skipped: `既に ${existing} 件あるため初期条件は作らない` };

  const today = jstTodayYmd();
  const machines = await prisma.rpaScoutMachine.findMany({ where: { isActive: true }, orderBy: { machineNo: "asc" } });
  let created = 0;
  for (const m of machines) {
    const log = await prisma.rpaScoutLog.findFirst({ where: { machineNo: m.machineNo }, orderBy: { recordedAt: "desc" } });
    const pattern = log?.patternId ? await prisma.rpaScoutPattern.findUnique({ where: { id: log.patternId } }) : null;
    const mapped = pattern
      ? mapPattern(pattern, today)
      : ({
          searchTarget: m.machineNo === 1 ? "EXCLUDE" : "ONLY",
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
        } satisfies MappedCondition);
    const template = log?.subjectName ? await prisma.scoutTemplate.findFirst({ where: { name: log.subjectName } }) : null;
    // T-197: 状態・並び順・レコード番号は createScoutCondition が決める（空の号機なので RUNNING になる）
    await createScoutCondition({
      machineId: m.id,
      ...mapped,
      templateId: template?.id ?? m.defaultTemplateId ?? null,
      plannedCount: log?.searchCount ?? null,
      deliveryDate: ymdToDbDate(today),
      createdById: null,
    });
    created++;
  }
  return { created, skipped: "" };
}

async function main() {
  const holidays = await seedHolidays();
  console.log(`holidays: ${holidays} 件 upsert`);
  const machines = await seedMachines();
  console.log(`machines: isActive 更新 ${machines.updated} 件${machines.missing.length ? ` / 行が無い号機: ${machines.missing.join(",")}` : ""}`);
  const templates = await seedTemplates();
  console.log(templates ? `templates: ${templates.upserted} 件 upsert / デフォルト割当 ${templates.defaults} 件` : "templates: scout-templates.json が無いため飛ばした");
  const initial = await seedInitialConditions();
  console.log(`conditions: ${initial.created} 件作成${initial.skipped ? `（${initial.skipped}）` : ""}`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

export {};
