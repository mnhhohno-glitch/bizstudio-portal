// T-213: 実行履歴タブ（/scout/conditions?view=runs）のサーバー側処理。
//
// 1行＝scout_runs 1件。条件（scout_conditions）→ テンプレート・号機（RpaScoutMachine）を結合し、
// 期間（実行日時の JST 日付）・号機・枯渇のみを DB で絞ったうえで、文字検索とページングはこちらで行う。
// 文字検索の対象（レコード番号／検索条件の要約／テンプレート名／担当者名）はどれも表示用に組み立てた文字列で、
// DB の列にそのまま無いため（担当者名は RC_ROSTER 由来・要約は複数列の合成）、期間で絞った後に在庫で照合する。
// 既定の期間が直近7日なので在庫は数百件で足りる。「すべて」にしても全実行が数千件の規模なので問題ない。
//
// 条件側の表示項目は「その条件に現在設定されているもの」。実行時の検索条件・テンプレートは RPA から届かないため、
// 実績のある条件は状態以外を編集できない（T-201）ことで実行時の値と一致する（テンプレート名の改名だけは追随する）。
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { splitRecruiterDisplay } from "@/lib/recruiterDisplay";
import {
  areaLabel,
  companyCountLabel,
  formatRecordNo,
  gradYearRangeLabel,
  periodDaysLabel,
  searchTargetLabel,
  workPrefLabel,
} from "./constants";
import { dbDateToYmd, isValidYmd } from "./dates";
import type { RunHistoryQuery, RunHistoryResponse, RunHistoryRowDto } from "./types";

export const RUN_HISTORY_PAGE_SIZE = 100;

const runInclude = {
  machine: { select: { id: true, machineNo: true } },
  condition: {
    select: {
      id: true,
      seqNo: true,
      status: true,
      searchTarget: true,
      registDateMode: true,
      registDays: true,
      registDateFrom: true,
      registDateTo: true,
      lastLoginDays: true,
      gradYearFrom: true,
      gradYearTo: true,
      companyCount: true,
      residenceMode: true,
      residencePrefectures: true,
      workPrefMode: true,
      workPrefectures: true,
      template: { select: { kind: true, name: true } },
    },
  },
} satisfies Prisma.ScoutRunInclude;

type RunRow = Prisma.ScoutRunGetPayload<{ include: typeof runInclude }>;

/** 号機番号 → 担当者名（MachineLabel.tsx の machineRecruiterName と同じ導出。"use client" のファイルをサーバーから import しないためここに持つ） */
export function recruiterNameOfMachine(machineNo: number): string {
  const d = splitRecruiterDisplay(`${machineNo}号機`);
  return d.unit ? d.name : "";
}

export function toRunHistoryRow(r: RunRow): RunHistoryRowDto {
  const c = r.condition;
  return {
    id: r.id,
    executedAt: r.executedAt.toISOString(),
    extractedCount: r.extractedCount,
    sentCount: r.sentCount,
    searchResultCount: r.searchResultCount,
    isDry: r.isDry,
    machineId: r.machine.id,
    machineNo: r.machine.machineNo,
    recruiterName: recruiterNameOfMachine(r.machine.machineNo),
    conditionId: c.id,
    recordNo: formatRecordNo(r.machine.machineNo, c.seqNo),
    status: c.status,
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
    templateKind: c.template?.kind ?? null,
    templateName: c.template?.name ?? null,
  };
}

/** 文字検索の照合対象（画面に出る文字列を空白区切りでつないだもの。小文字化して部分一致） */
export function runSearchText(r: RunHistoryRowDto): string {
  const regist =
    r.registDateMode === "PERIOD" ? periodDaysLabel(r.registDays) : `${r.registDateFrom ?? ""}〜${r.registDateTo ?? ""}`;
  return [
    r.recordNo ?? "",
    `${r.machineNo}号機`,
    r.recruiterName,
    searchTargetLabel(r.searchTarget),
    regist,
    periodDaysLabel(r.lastLoginDays),
    gradYearRangeLabel(r.gradYearFrom, r.gradYearTo),
    companyCountLabel(r.companyCount),
    areaLabel(r.residenceMode, r.residencePrefectures),
    r.residencePrefectures.join("/"),
    workPrefLabel(r.workPrefMode, r.workPrefectures),
    r.workPrefectures.join("/"),
    r.templateName ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** "YYYY-MM-DD"（JST の日付）を、その日の 00:00 / 翌日 00:00（JST）の instant に直す */
function jstDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}
function jstNextDayStart(ymd: string): Date {
  return new Date(jstDayStart(ymd).getTime() + 24 * 60 * 60 * 1000);
}

/** URLSearchParams → RunHistoryQuery（不正な値は無視して既定に落とす） */
export function parseRunHistoryQuery(sp: URLSearchParams): RunHistoryQuery {
  const from = sp.get("from");
  const to = sp.get("to");
  const machineNos = (sp.get("machines") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const page = Number(sp.get("page") ?? "1");
  return {
    from: isValidYmd(from) ? from : null,
    to: isValidYmd(to) ? to : null,
    machineNos,
    dryOnly: sp.get("dry") === "1" || sp.get("dry") === "true",
    q: (sp.get("q") ?? "").trim(),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export async function fetchRunHistory(query: RunHistoryQuery): Promise<RunHistoryResponse> {
  const where: Prisma.ScoutRunWhereInput = {};
  if (query.from || query.to) {
    where.executedAt = {
      ...(query.from ? { gte: jstDayStart(query.from) } : {}),
      ...(query.to ? { lt: jstNextDayStart(query.to) } : {}),
    };
  }
  if (query.machineNos.length > 0) where.machine = { machineNo: { in: query.machineNos } };
  if (query.dryOnly) where.isDry = true;

  const runs = await prisma.scoutRun.findMany({
    where,
    include: runInclude,
    orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
  });

  let rows = runs.map(toRunHistoryRow);
  if (query.q) {
    const needle = query.q.toLowerCase();
    rows = rows.filter((r) => runSearchText(r).includes(needle));
  }

  const total = rows.length;
  const start = (query.page - 1) * RUN_HISTORY_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + RUN_HISTORY_PAGE_SIZE),
    total,
    page: query.page,
    pageSize: RUN_HISTORY_PAGE_SIZE,
  };
}
