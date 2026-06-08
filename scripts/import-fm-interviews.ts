/**
 * T-080: FileMaker 過去面談履歴の portal 取り込みスクリプト
 *
 * 実行:
 *   # テスト1名のみ（本プロンプトのスコープ）
 *   DATABASE_URL=<prod> npx tsx scripts/import-fm-interviews.ts --only 5000074
 *   # 全件（※将幸さんの画面確認後に別途実行。本タスクでは実行しない）
 *   DATABASE_URL=<prod> npx tsx scripts/import-fm-interviews.ts
 *   # ドライラン（DB書き込みなし・件数とログのみ）
 *   DATABASE_URL=<prod> npx tsx scripts/import-fm-interviews.ts --only 5000074 --dry-run
 *
 * オプション:
 *   --only <求職者NO>   指定1名のみ取り込み
 *   --file <path>       入力xlsx（既定: C:/Users/mnhho/Downloads/interview_history_cleaned.xlsx）
 *   --dry-run           DB書き込みをせず、解決・正規化・件数のみ出力
 *   --no-recalc         取り込み後の interviewCount / isLatest 再計算をスキップ
 *
 * 方針（T-080 確定仕様）:
 *   - Candidate 本体は一切更新しない（面談レコードのみ作成）。
 *   - 紐付けは candidateNumber（7桁・無変換一致）。未発見はスキップ＋ログ。
 *   - 職歴(WorkHistory)・1:N InterviewMemo は作らない。面談メモは InterviewRecord.interviewMemo。
 *   - resultFlag は取り込み時に現行9選択肢へ正規化（未マップ値は null・生値はログ）。
 *   - 社員NO は "BS" を除去して Employee.employeeNumber に一致。未解決は fallback ユーザー。
 *   - 冪等: 同一 legacyFmInterviewNo が既存ならスキップ。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ---- CLI ----
const argv = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const ONLY = argVal("--only");
const FILE = argVal("--file") ?? "C:/Users/mnhho/Downloads/interview_history_cleaned.xlsx";
const DRY_RUN = argv.includes("--dry-run");
const NO_RECALC = argv.includes("--no-recalc");

const DATA_SHEET = "面談履歴_整形済";
const MAP_SHEET = "列マッピング";

// ---- resultFlag 正規化（現行9選択肢へ。未マップは null・生値はログ） ----
const RESULT_NORMALIZE: Record<string, string | null> = {
  "求人紹介_送付前": "求人紹介 送付前",
  "求人紹介_送付済": "求人紹介 送付済",
  "支援終了_本人都合": "支援終了_本人希望",
  "連絡なし辞退": "連絡なし辞退",
  "連絡あり辞退": "連絡あり辞退",
  "支援終了_当社判断": "支援終了_当社判断",
  "面談前": "面談前",
  "継続": "継続",
  "保留": "保留",
  // 9選択肢に該当なし → null（生値はログ）
  "本人エントリー_履歴書取得": null,
  "本人エントリー_履歴書待ち": null,
  "求人紹介_検討": null,
  "待機": null,
  "日程変更": null,
};

// ---- 型コアース ----
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}
function toStr(v: unknown): string | null {
  if (isEmpty(v)) return null;
  return String(v).trim() === "" ? null : String(v);
}
function toInt(v: unknown): number | null {
  if (isEmpty(v)) return null;
  if (typeof v === "number") return Math.trunc(v);
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
function ymd(v: unknown): { y: number; m: number; d: number } | null {
  if (isEmpty(v)) return null;
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const m = String(v).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
/** 日付のみ → UTC 0:00（portal API の `new Date("YYYY-MM-DD")` と同一規約。罠#17回避: 文字列から直接構築） */
function dateOnly(v: unknown): Date | null {
  const p = ymd(v);
  if (!p) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}
/** タイムスタンプ "YYYY-MM-DD HH:MM:SS"（FMはJST壁時計）→ 正しい instant */
function jstTimestamp(v: unknown): Date | null {
  if (isEmpty(v)) return null;
  if (v instanceof Date) return v; // cellDates 経由はローカル(JST)壁時計の Date
  const m = String(v).match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return dateOnly(v);
  const pad = (s: string | number, n = 2) => String(s).padStart(n, "0");
  return new Date(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${pad(m[6] ?? "00")}+09:00`);
}

/** ヘッダの （…） 注記を除いた portal フィールド名 */
function cleanField(header: string): string {
  return header.replace(/（[^）]*）\s*$/, "").trim();
}

// Detail の Int / Date フィールド（それ以外の Detail は String）
const DETAIL_INT = new Set(["currentApplicationCount", "currentSalary", "desiredSalaryMin", "desiredSalaryMax"]);
const DETAIL_DATE = new Set(["nextInterviewDate", "resignationDate"]);

type LogStats = {
  totalRows: number;
  created: number;
  skippedExisting: number;
  skippedNoCandidate: number;
  detailCreated: number;
  ratingCreated: number;
  empUnresolved: Map<string, number>; // FM社員NO → 件数
  empFallbackUsed: number;
  resultRaw: Map<string, number>; // 生値 → 件数
  resultNormalized: Map<string, number>; // 正規化後(null含む) → 件数
  resultUnknown: Map<string, number>; // マップに無い生値 → 件数
  noCandidateNumbers: string[];
};

async function main() {
  console.log(`[T-080 import] file=${FILE} only=${ONLY ?? "(ALL)"} dryRun=${DRY_RUN}`);

  // fallback ユーザー（社員NO 未解決・空のとき createdBy/interviewer に当てる）= 大野 将幸
  const fallbackEmp = await prisma.employee.findFirst({
    where: { name: { contains: "大野 将幸" } },
    select: { id: true, name: true, employeeNumber: true },
  });
  if (!fallbackEmp) throw new Error("fallback ユーザー（大野 将幸）が見つかりません");
  console.log(`[fallback] ${fallbackEmp.name} (${fallbackEmp.employeeNumber}) id=${fallbackEmp.id}`);

  // Employee 解決マップ（BS除去 → employeeNumber）
  const allEmps = await prisma.employee.findMany({ select: { id: true, employeeNumber: true } });
  const empByNumber = new Map(allEmps.map((e) => [e.employeeNumber, e.id]));
  const resolveEmp = (fmNo: unknown, stats: LogStats): string => {
    const raw = toStr(fmNo);
    if (!raw) {
      stats.empFallbackUsed++;
      return fallbackEmp.id;
    }
    const key = raw.replace(/^BS/i, "");
    const id = empByNumber.get(key);
    if (id) return id;
    stats.empUnresolved.set(raw, (stats.empUnresolved.get(raw) ?? 0) + 1);
    stats.empFallbackUsed++;
    return fallbackEmp.id;
  };

  // xlsx 読み込み
  const wb = XLSX.readFile(FILE, { cellDates: true });
  const dataRows = XLSX.utils.sheet_to_json(wb.Sheets[DATA_SHEET], { defval: null }) as Record<string, unknown>[];
  const mapRows = XLSX.utils.sheet_to_json(wb.Sheets[MAP_SHEET], { header: 1, defval: null }) as unknown[][];

  // 列マッピング: header(=portalフィールド) → モデル
  const headerModel = new Map<string, string>(); // dataヘッダ → KEY/Record/Detail/Rating
  for (const r of mapRows.slice(1)) {
    const model = toStr(r[0]);
    const header = toStr(r[1]);
    if (model && header) headerModel.set(header, model);
  }
  const detailHeaders = [...headerModel.entries()].filter(([, m]) => m === "Detail").map(([h]) => h);
  const ratingHeaders = [...headerModel.entries()].filter(([, m]) => m === "Rating").map(([h]) => h);

  const HDR = {
    candidateNumber: "candidateNumber（紐付けキー）",
    fmInterviewNo: "面談NO（照合用・DB保存しない）",
    createdAt: "createdAt",
    createdBy: "createdByUserId（社員NO）",
    interviewDate: "interviewDate",
    startTime: "startTime",
    endTime: "endTime",
    duration: "duration（分）",
    interviewer: "interviewerUserId（社員NO）",
    interviewTool: "interviewTool",
    resultFlag: "resultFlag（原文）",
    interviewMemo: "interviewMemo",
    previousMemo: "previousMemo",
    interviewType: "interviewType",
  };

  const stats: LogStats = {
    totalRows: 0, created: 0, skippedExisting: 0, skippedNoCandidate: 0,
    detailCreated: 0, ratingCreated: 0,
    empUnresolved: new Map(), empFallbackUsed: 0,
    resultRaw: new Map(), resultNormalized: new Map(), resultUnknown: new Map(),
    noCandidateNumbers: [],
  };

  // candidate 解決（必要分だけ）
  const targetNumbers = ONLY
    ? new Set([ONLY])
    : new Set(dataRows.map((r) => toStr(r[HDR.candidateNumber])).filter(Boolean) as string[]);
  const candidates = await prisma.candidate.findMany({
    where: { candidateNumber: { in: [...targetNumbers] } },
    select: { id: true, candidateNumber: true },
  });
  const candByNumber = new Map(candidates.map((c) => [c.candidateNumber, c.id]));

  const affectedCandidateIds = new Set<string>();

  for (const row of dataRows) {
    const cnum = toStr(row[HDR.candidateNumber]);
    if (!cnum) continue;
    if (ONLY && cnum !== ONLY) continue;
    stats.totalRows++;

    const candidateId = candByNumber.get(cnum);
    if (!candidateId) {
      stats.skippedNoCandidate++;
      if (!stats.noCandidateNumbers.includes(cnum)) stats.noCandidateNumbers.push(cnum);
      continue;
    }

    const legacyFmInterviewNo = toStr(row[HDR.fmInterviewNo]);

    // 冪等
    if (legacyFmInterviewNo) {
      const exists = await prisma.interviewRecord.findFirst({
        where: { legacyFmInterviewNo },
        select: { id: true },
      });
      if (exists) { stats.skippedExisting++; affectedCandidateIds.add(candidateId); continue; }
    }

    // resultFlag 正規化
    const rawResult = toStr(row[HDR.resultFlag]);
    let resultFlag: string | null = null;
    if (rawResult) {
      stats.resultRaw.set(rawResult, (stats.resultRaw.get(rawResult) ?? 0) + 1);
      if (rawResult in RESULT_NORMALIZE) {
        resultFlag = RESULT_NORMALIZE[rawResult];
      } else {
        resultFlag = null;
        stats.resultUnknown.set(rawResult, (stats.resultUnknown.get(rawResult) ?? 0) + 1);
      }
    }
    const normKey = resultFlag ?? "(null)";
    stats.resultNormalized.set(normKey, (stats.resultNormalized.get(normKey) ?? 0) + 1);

    const interviewDate = dateOnly(row[HDR.interviewDate]);
    if (!interviewDate) {
      console.warn(`[skip] interviewDate 不正: candidate=${cnum} fmNo=${legacyFmInterviewNo}`);
      continue;
    }

    // Detail 構築
    const detailData: Record<string, unknown> = {};
    for (const h of detailHeaders) {
      const field = cleanField(h);
      const raw = row[h];
      if (isEmpty(raw)) continue;
      if (DETAIL_INT.has(field)) detailData[field] = toInt(raw);
      else if (DETAIL_DATE.has(field)) detailData[field] = dateOnly(raw);
      else detailData[field] = toStr(raw);
    }
    const hasDetail = Object.values(detailData).some((v) => v !== null && v !== undefined);

    // Rating 構築（*Memo / overallRank は String、他は Int）
    const ratingData: Record<string, unknown> = {};
    for (const h of ratingHeaders) {
      const field = cleanField(h);
      const raw = row[h];
      if (isEmpty(raw)) continue;
      if (field.endsWith("Memo") || field === "overallRank") ratingData[field] = toStr(raw);
      else ratingData[field] = toInt(raw);
    }
    const hasRating = Object.values(ratingData).some((v) => v !== null && v !== undefined);

    const recordData = {
      candidateId,
      legacyFmInterviewNo,
      interviewDate,
      createdAt: jstTimestamp(row[HDR.createdAt]) ?? undefined,
      startTime: toStr(row[HDR.startTime]) ?? "",
      endTime: toStr(row[HDR.endTime]) ?? "",
      duration: toInt(row[HDR.duration]),
      interviewTool: toStr(row[HDR.interviewTool]) ?? "",
      interviewType: toStr(row[HDR.interviewType]) ?? "",
      interviewerUserId: resolveEmp(row[HDR.interviewer], stats),
      createdByUserId: resolveEmp(row[HDR.createdBy], stats),
      resultFlag,
      interviewMemo: toStr(row[HDR.interviewMemo]),
      previousMemo: toStr(row[HDR.previousMemo]),
      status: "complete",
      isLatest: false, // 再計算で確定
      interviewCount: null as number | null, // 再計算で確定
      ...(hasDetail ? { detail: { create: detailData } } : {}),
      ...(hasRating ? { rating: { create: ratingData } } : {}),
    };

    if (DRY_RUN) {
      stats.created++;
      if (hasDetail) stats.detailCreated++;
      if (hasRating) stats.ratingCreated++;
      affectedCandidateIds.add(candidateId);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.interviewRecord.create({ data: recordData as any });
    stats.created++;
    if (hasDetail) stats.detailCreated++;
    if (hasRating) stats.ratingCreated++;
    affectedCandidateIds.add(candidateId);
  }

  // ---- 再計算（interviewCount / isLatest）----
  if (!NO_RECALC && !DRY_RUN) {
    for (const cid of affectedCandidateIds) {
      await recalcCandidate(cid);
    }
    console.log(`[recalc] ${affectedCandidateIds.size} 名の interviewCount/isLatest を再計算`);
  }

  // ---- ログ出力 ----
  console.log("\n========== 取り込み結果 ==========");
  console.log(`対象行: ${stats.totalRows}`);
  console.log(`作成 InterviewRecord: ${stats.created}`);
  console.log(`  └ Detail: ${stats.detailCreated} / Rating: ${stats.ratingCreated}`);
  console.log(`スキップ（既存・冪等）: ${stats.skippedExisting}`);
  console.log(`スキップ（candidate未発見）: ${stats.skippedNoCandidate}`);
  if (stats.noCandidateNumbers.length) {
    console.log(`  未発見 求職者NO(${stats.noCandidateNumbers.length}): ${stats.noCandidateNumbers.slice(0, 50).join(", ")}${stats.noCandidateNumbers.length > 50 ? " …" : ""}`);
  }
  console.log(`社員NO fallback 適用: ${stats.empFallbackUsed} 件`);
  if (stats.empUnresolved.size) {
    console.log("  未解決 社員NO:");
    for (const [no, n] of stats.empUnresolved) console.log(`    ${no}: ${n} 件 → fallback`);
  }
  console.log("resultFlag 正規化（生値 → 件数）:");
  for (const [raw, n] of [...stats.resultRaw.entries()].sort((a, b) => b[1] - a[1])) {
    const mapped = raw in RESULT_NORMALIZE ? RESULT_NORMALIZE[raw] : "(未知→null)";
    console.log(`    "${raw}" (${n}) → ${mapped === null ? "null" : `"${mapped}"`}`);
  }
  if (stats.resultUnknown.size) {
    console.log("  ※マップ外で null にした生値:");
    for (const [raw, n] of stats.resultUnknown) console.log(`    "${raw}": ${n}`);
  }
  console.log("==================================\n");

  await prisma.$disconnect();
  await pool.end();
}

/** 対象求職者の全 InterviewRecord を interviewDate 昇順（同日 startTime 昇順）で並べ、count を 1..N、isLatest を最後の1件のみ true に振り直す */
async function recalcCandidate(candidateId: string): Promise<void> {
  const recs = await prisma.interviewRecord.findMany({
    where: { candidateId },
    orderBy: [{ interviewDate: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  for (let i = 0; i < recs.length; i++) {
    await prisma.interviewRecord.update({
      where: { id: recs[i].id },
      data: { interviewCount: i + 1, isLatest: i === recs.length - 1 },
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
