/**
 * AI マッチング精度検証スクリプト v4（読み取り専用・4月のみフィルタ版）
 *
 * 変更点 (v3 → v4):
 * - 日付フィルタを 4月のみ に変更: lastExportedAt >= 2026-04-01 AND < 2026-05-01
 * - v2/v3 両方との比較セクション
 *
 * Usage:
 *   npx tsx scripts/skill_update_research.ts
 *
 * Output:
 *   tmp/skill_update_research_result.md
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DATE_FILTER_START = new Date("2026-04-01T00:00:00.000Z");
const DATE_FILTER_END = new Date("2026-05-01T00:00:00.000Z");

type Rating = "A" | "B" | "C" | "D";
type Axis = { wish: Rating | null; pass: Rating | null; overall: Rating | null };

// ========== AI 再評価検出パターン ==========
const RE_EVAL_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "「既に選考落ち」系", re: /既に(?:書類選考|面接選考|面接|選考)?落ち/ },
  { label: "「同社同一求人+不合格」", re: /同(?:社|じ会社)[\s\S]{0,40}(?:不合格|選考落ち)/ },
  { label: "「前回分析済み/判定変更なし」", re: /前回分析済み|判定変更なし/ },
  { label: "「再応募+不可」", re: /再応募[\s\S]{0,30}(?:不可|現実的(?:では|じゃ)ない)/ },
  { label: "「応募履歴+選考落ち」", re: /応募履歴[\s\S]{0,40}(?:選考落ち|不合格)/ },
];

function detectReEval(comment: string): string | null {
  for (const p of RE_EVAL_PATTERNS) {
    if (p.re.test(comment)) return p.label;
  }
  return null;
}

// ========== Interfaces ==========
interface ExportedBookmark {
  id: string;
  candidateId: string;
  fileName: string;
  aiAnalysisComment: string;
  aiMatchRating: string | null;
  axis: Axis;
  normalizedCompany: string;
  jobNo: string | null;
  reEvalLabel: string | null;
  candidate: { candidateNumber: string; name: string; gender: string | null; birthday: Date | null };
}

interface EntryRecord {
  id: string;
  candidateId: string;
  companyName: string;
  normalizedCompany: string;
  externalJobNo: string | null;
  jobTitle: string;
  jobCategory: string | null;
  salary: string | null;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  isActive: boolean;
  personFlag: string | null;
  companyFlag: string | null;
}

// ========== Helpers ==========
const FLAG_ORDER: Record<string, number> = {
  "求人紹介": 0, "エントリー": 1, "書類選考": 2, "面接": 3, "内定": 4, "入社済": 5,
};

function parse3Axis(comment: string | null): Axis {
  if (!comment) return { wish: null, pass: null, overall: null };
  const w = comment.match(/■\s*本人希望[：:]\s*([ABCD])/);
  const p = comment.match(/■\s*通過率[：:]\s*([ABCD])/);
  const o = comment.match(/■\s*総合[：:]\s*([ABCD])/);
  return { wish: (w?.[1] as Rating) || null, pass: (p?.[1] as Rating) || null, overall: (o?.[1] as Rating) || null };
}

function normalizeCompany(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人/g, "")
    .replace(/[\s　]+/g, "")
    .trim()
    .toLowerCase();
}

function extractCompanyFromFileName(fileName: string): string {
  let name = fileName.replace(/\.pdf$/i, "");
  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/);
  if (p1) name = p1[1];
  else {
    const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
    if (p2) name = p2[1];
    else {
      const p3 = name.match(/^(.+?)[：:]\d+$/);
      if (p3) name = p3[1].trim();
      else { const p4 = name.match(/^求人票[_]?(.+)$/); if (p4) name = p4[1]; }
    }
  }
  name = name.replace(/_No\d+$/i, "");
  return normalizeCompany(name);
}

function extractJobNo(fileName: string): string | null {
  const m = fileName.match(/_No(\d+)/i);
  return m ? m[1] : null;
}

function stageReached(flag: string | null): number {
  if (!flag) return -1;
  return FLAG_ORDER[flag] ?? -1;
}

function calcAge(birthday: Date | null): number | null {
  if (!birthday) return null;
  const now = new Date();
  let a = now.getFullYear() - birthday.getFullYear();
  const m = now.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthday.getDate())) a--;
  return a;
}

function genderLabel(g: string | null): string {
  return g === "male" ? "男性" : g === "female" ? "女性" : "";
}

const pct = (n: number, d: number) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : "—";

// ========== Anomaly sampling ==========
type AnomalyItem = { bk: ExportedBookmark; entry: EntryRecord | null };

function sampleAnomalies(items: AnomalyItem[], relaxLimits: boolean): AnomalyItem[] {
  if (items.length === 0) return [];
  const byCandidate = new Map<string, AnomalyItem[]>();
  for (const item of items) {
    const cid = item.bk.candidateId;
    if (!byCandidate.has(cid)) byCandidate.set(cid, []);
    byCandidate.get(cid)!.push(item);
  }
  const sorted = [...byCandidate.entries()].sort((a, b) => b[1].length - a[1].length);

  if (relaxLimits && items.length <= 100) {
    return items.sort((a, b) => {
      const ac = byCandidate.get(a.bk.candidateId)!.length;
      const bc = byCandidate.get(b.bk.candidateId)!.length;
      return bc - ac || a.bk.candidate.candidateNumber.localeCompare(b.bk.candidate.candidateNumber);
    });
  }

  const maxCandidates = relaxLimits ? sorted.length : 20;
  const maxPer = relaxLimits ? Infinity : 5;
  const result: AnomalyItem[] = [];
  for (let i = 0; i < Math.min(maxCandidates, sorted.length); i++) {
    const cItems = sorted[i][1];
    cItems.sort((a, b) => (b.bk.aiAnalysisComment ? 1 : 0) - (a.bk.aiAnalysisComment ? 1 : 0));
    for (let j = 0; j < Math.min(maxPer, cItems.length) && result.length < 100; j++) {
      result.push(cItems[j]);
    }
  }
  return result;
}

// ========== Main ==========
async function main() {
  // ================================================================
  // Phase 0: Data Overview
  // ================================================================
  console.log("[Phase 0] Fetching data...");

  const totalBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK" } });
  const nonArchivedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", archivedAt: null } });
  const archivedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", archivedAt: { not: null } } });
  const exportedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", lastExportedAt: { not: null } } });
  const exportedAnalyzedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", lastExportedAt: { not: null }, aiAnalysisComment: { not: null } } });
  const filteredExportedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", lastExportedAt: { gte: DATE_FILTER_START, lt: DATE_FILTER_END } } });
  const filteredExportedAnalyzedBk = await prisma.candidateFile.count({ where: { category: "BOOKMARK", lastExportedAt: { gte: DATE_FILTER_START, lt: DATE_FILTER_END }, aiAnalysisComment: { not: null } } });
  const totalEntries = await prisma.jobEntry.count();

  const entryFlagDist = await prisma.jobEntry.groupBy({ by: ["entryFlag"], _count: true, orderBy: { _count: { entryFlag: "desc" } } });
  const entryFlagDetailDist = await prisma.jobEntry.groupBy({ by: ["entryFlagDetail"], _count: true, orderBy: { _count: { entryFlagDetail: "desc" } } });

  console.log(`  BK total=${totalBk} nonArch=${nonArchivedBk} arch=${archivedBk} exported=${exportedBk} exp+analyzed=${exportedAnalyzedBk}`);
  console.log(`  Filtered(>=5/1): exported=${filteredExportedBk} exp+analyzed=${filteredExportedAnalyzedBk}`);
  console.log(`  Entries total=${totalEntries}`);

  // Fetch exported + analyzed bookmarks with date filter (the correct denominator)
  const rawBk = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", lastExportedAt: { gte: DATE_FILTER_START, lt: DATE_FILTER_END }, aiAnalysisComment: { not: null } },
    select: {
      id: true, candidateId: true, fileName: true,
      aiAnalysisComment: true, aiMatchRating: true,
      candidate: { select: { candidateNumber: true, name: true, gender: true, birthday: true } },
    },
  });

  const allBk: ExportedBookmark[] = [];
  const reEvalCounts = new Map<string, number>();
  let noAxisCount = 0;

  for (const b of rawBk) {
    const axis = parse3Axis(b.aiAnalysisComment);
    if (!axis.wish && !axis.pass && !axis.overall) { noAxisCount++; continue; }
    const reEval = b.aiAnalysisComment ? detectReEval(b.aiAnalysisComment) : null;
    if (reEval) reEvalCounts.set(reEval, (reEvalCounts.get(reEval) || 0) + 1);
    allBk.push({
      id: b.id, candidateId: b.candidateId, fileName: b.fileName,
      aiAnalysisComment: b.aiAnalysisComment!, aiMatchRating: b.aiMatchRating,
      axis, normalizedCompany: extractCompanyFromFileName(b.fileName),
      jobNo: extractJobNo(b.fileName), reEvalLabel: reEval,
      candidate: b.candidate,
    });
  }

  const cleanBk = allBk.filter(b => !b.reEvalLabel);
  const totalReEval = allBk.length - cleanBk.length;

  console.log(`  3-axis valid=${allBk.length} noAxis=${noAxisCount} reEval=${totalReEval} clean=${cleanBk.length}`);

  // Fetch entries for relevant candidates
  const candidateIds = [...new Set(cleanBk.map(b => b.candidateId))];
  const rawEntries = await prisma.jobEntry.findMany({
    where: { candidateId: { in: candidateIds } },
    select: {
      id: true, candidateId: true, companyName: true, externalJobNo: true,
      jobTitle: true, jobCategory: true, salary: true,
      entryFlag: true, entryFlagDetail: true, isActive: true, personFlag: true, companyFlag: true,
    },
  });
  const entries: EntryRecord[] = rawEntries.map(e => ({
    ...e, normalizedCompany: normalizeCompany(e.companyName),
    externalJobNo: e.externalJobNo || null, jobTitle: e.jobTitle || "",
    jobCategory: e.jobCategory || null, salary: e.salary || null,
    personFlag: e.personFlag || null, companyFlag: e.companyFlag || null,
  }));

  console.log(`  Entries for clean candidates: ${entries.length}`);

  // Entry lookup by candidate
  const entryByCandidate = new Map<string, EntryRecord[]>();
  for (const e of entries) {
    if (!entryByCandidate.has(e.candidateId)) entryByCandidate.set(e.candidateId, []);
    entryByCandidate.get(e.candidateId)!.push(e);
  }

  // Match bookmarks → entries (jobNo first, then company name)
  const matchedMap = new Map<string, EntryRecord>();
  let jobNoMatchN = 0;
  let companyMatchN = 0;

  for (const bk of cleanBk) {
    const ces = entryByCandidate.get(bk.candidateId) || [];
    let best: EntryRecord | null = null;

    if (bk.jobNo) {
      for (const ce of ces) {
        if (ce.externalJobNo === bk.jobNo) {
          if (!best || stageReached(ce.entryFlag) > stageReached(best.entryFlag)) best = ce;
        }
      }
      if (best) { jobNoMatchN++; matchedMap.set(bk.id, best); continue; }
    }

    for (const ce of ces) {
      if (ce.normalizedCompany === bk.normalizedCompany)
        if (!best || stageReached(ce.entryFlag) > stageReached(best.entryFlag)) best = ce;
    }
    if (!best && bk.normalizedCompany.length >= 2) {
      for (const ce of ces) {
        if (ce.normalizedCompany.length >= 2 &&
          (ce.normalizedCompany.includes(bk.normalizedCompany) || bk.normalizedCompany.includes(ce.normalizedCompany)))
          if (!best || stageReached(ce.entryFlag) > stageReached(best.entryFlag)) best = ce;
      }
    }

    if (best) { companyMatchN++; matchedMap.set(bk.id, best); }
  }

  const matchedN = matchedMap.size;
  const unmatchedN = cleanBk.length - matchedN;
  console.log(`  Matched=${matchedN} (jobNo=${jobNoMatchN} company=${companyMatchN}) Unmatched=${unmatchedN}`);

  // Validation: 3 candidates with most entries among exported bookmarks
  const valCands = await prisma.candidate.findMany({
    take: 3,
    where: { files: { some: { category: "BOOKMARK", lastExportedAt: { not: null } } }, jobEntries: { some: {} } },
    orderBy: { jobEntries: { _count: "desc" } },
    select: { id: true, candidateNumber: true, name: true },
  });

  // Phase 0-D: keyword sample excerpts
  const kwSamples: { label: string; count: number; excerpts: string[] }[] = [];
  for (const p of RE_EVAL_PATTERNS) {
    const hits = allBk.filter(b => b.reEvalLabel === p.label);
    kwSamples.push({
      label: p.label,
      count: hits.length,
      excerpts: hits.slice(0, 3).map(b => {
        const m = b.aiAnalysisComment.match(p.re);
        const s = m?.index ? Math.max(0, m.index - 15) : 0;
        const e = m?.index ? Math.min(b.aiAnalysisComment.length, m.index + (m[0]?.length || 0) + 25) : 80;
        return `[${b.candidate.candidateNumber}] …${b.aiAnalysisComment.slice(s, e).replace(/\n/g, " ")}…`;
      }),
    });
  }

  // ================================================================
  // Phase 1: Aggregate Tables
  // ================================================================
  console.log("[Phase 1] Aggregating...");
  const RATINGS: Rating[] = ["A", "B", "C", "D"];

  // 1-A: 本人希望 × エントリー移行率
  const wishStats = Object.fromEntries(RATINGS.map(r => [r, {
    total: 0, entryMoved: 0, shoryoPlus: 0, mensetsuPlus: 0, naiteiPlus: 0, joined: 0,
  }]));

  for (const bk of cleanBk) {
    if (!bk.axis.wish) continue;
    const s = wishStats[bk.axis.wish];
    s.total++;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    const st = stageReached(entry.entryFlag);
    if (st >= 1) s.entryMoved++;
    if (st >= 2) s.shoryoPlus++;
    if (st >= 3) s.mensetsuPlus++;
    if (st >= 4) s.naiteiPlus++;
    if (st >= 5) s.joined++;
  }

  // 1-B: 通過率 × 選考通過率 (母数: entryFlag >= "エントリー")
  const passStats = Object.fromEntries(RATINGS.map(r => [r, {
    entryN: 0, shoryoReached: 0, mensetsuReached: 0, naiteiReached: 0, accepted: 0,
  }]));

  for (const bk of cleanBk) {
    if (!bk.axis.pass) continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    const st = stageReached(entry.entryFlag);
    if (st < 1) continue;
    const s = passStats[bk.axis.pass];
    s.entryN++;
    if (st >= 2) s.shoryoReached++;
    if (st >= 3) s.mensetsuReached++;
    if (st >= 4) s.naiteiReached++;
    if (st >= 5 || entry.companyFlag === "承諾返答済" || entry.personFlag === "入社済") s.accepted++;
  }

  // 1-C: 総合ランク
  const overallStats = Object.fromEntries(RATINGS.map(r => [r, {
    total: 0, entryMoved: 0, naiteiReached: 0,
  }]));

  for (const bk of cleanBk) {
    if (!bk.axis.overall) continue;
    const s = overallStats[bk.axis.overall];
    s.total++;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    const st = stageReached(entry.entryFlag);
    if (st >= 1) s.entryMoved++;
    if (st >= 4) s.naiteiReached++;
  }

  // ================================================================
  // Phase 2: Anomaly Sampling
  // ================================================================
  console.log("[Phase 2] Anomalies...");

  // Cat 1: 本人希望A空振り (最重要)
  const cat1: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.wish !== "A") continue;
    const entry = matchedMap.get(bk.id) || null;
    if (!entry || stageReached(entry.entryFlag) < 1) cat1.push({ bk, entry });
  }

  // Cat 2: 通過率A書類落ち (最重要)
  const cat2: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.pass !== "A") continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    const st = stageReached(entry.entryFlag);
    if (st >= 1 && st <= 2) cat2.push({ bk, entry });
  }

  // Cat 3: 通過率A内定到達せず
  const cat3: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.pass !== "A") continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    const st = stageReached(entry.entryFlag);
    if (st >= 1 && st < 4) cat3.push({ bk, entry });
  }

  // Cat 4: 本人希望Cで移行
  const cat4: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.wish !== "C") continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    if (stageReached(entry.entryFlag) >= 1) cat4.push({ bk, entry });
  }

  // Cat 5: 通過率Cで書類通過
  const cat5: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.pass !== "C") continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    if (stageReached(entry.entryFlag) >= 3) cat5.push({ bk, entry });
  }

  // Cat 6: 通過率Cで内定到達
  const cat6: AnomalyItem[] = [];
  for (const bk of cleanBk) {
    if (bk.axis.pass !== "C") continue;
    const entry = matchedMap.get(bk.id);
    if (!entry) continue;
    if (stageReached(entry.entryFlag) >= 4) cat6.push({ bk, entry });
  }

  console.log(`  cat1=${cat1.length} cat2=${cat2.length} cat3=${cat3.length} cat4=${cat4.length} cat5=${cat5.length} cat6=${cat6.length}`);

  // ================================================================
  // Phase 3: Output
  // ================================================================
  console.log("[Phase 3] Generating output...");

  const flagLabel = (e: EntryRecord | null) =>
    e ? `${e.entryFlag || "?"}${e.entryFlagDetail ? `(${e.entryFlagDetail})` : ""}` : "エントリー未移行";

  const formatItem = (item: AnomalyItem): string => {
    const { bk, entry } = item;
    const a = calcAge(bk.candidate.birthday);
    const g = genderLabel(bk.candidate.gender);
    const attr = `${a ?? "?"}歳${g}`;
    const jobInfo = entry
      ? `${entry.companyName}${entry.jobCategory ? "・" + entry.jobCategory : ""}${entry.jobTitle ? "・" + entry.jobTitle : ""}${entry.salary ? "・" + entry.salary : ""}`
      : bk.fileName.replace(/\.pdf$/i, "").slice(0, 40);
    const ratings = `希望:${bk.axis.wish || "—"} 通過:${bk.axis.pass || "—"} 総合:${bk.axis.overall || "—"}`;
    const result = flagLabel(entry);
    const excerpt = bk.aiAnalysisComment.replace(/\n/g, " ").slice(0, 30);
    return `[${bk.candidate.candidateNumber}-${bk.candidate.name}] | ${attr} | ${jobInfo} | ${ratings} | ${result} | 「${excerpt}…」`;
  };

  let md = `# AIマッチング判定精度 実績検証結果（4月のみフィルタ版）\n\n`;
  md += `## 適用フィルタ\n- 求人解析実施日: 2026-04-01 〜 2026-04-30（4月のみ）\n- 集計時点: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n\n`;

  // ----- Phase 0 section -----
  md += `## Phase 0: 運用フローのDB実装確認結果\n\n`;
  md += `### 各タブの判定条件\n`;
  md += `- **ブックマーク**: \`CandidateFile.category='BOOKMARK' AND archivedAt IS NULL\`\n`;
  md += `- **求人紹介**: kyuujin-pdf-tool API（portal 側は \`CandidateFile.lastExportedAt IS NOT NULL\` で判定）\n`;
  md += `- **紹介保留**: \`CandidateFile.category='BOOKMARK' AND archivedAt IS NOT NULL\`\n`;
  md += `- **エントリー**: \`JobEntry\` テーブル（\`candidateId\` で紐づけ、\`entryFlag\` で段階管理）\n\n`;

  md += `### CandidateFile ↔ JobEntry 紐付けロジック\n`;
  md += `直接FKなし。以下の順で突合:\n`;
  md += `1. **求人番号マッチ**: fileName の \`_NoXXX\` → \`JobEntry.externalJobNo\`\n`;
  md += `2. **会社名完全マッチ**: 正規化した会社名の完全一致\n`;
  md += `3. **会社名部分マッチ**: 2文字以上の部分一致\n\n`;
  md += `突合結果: 求人番号一致 ${jobNoMatchN}件 / 会社名一致 ${companyMatchN}件 / 突合失敗 ${unmatchedN}件\n\n`;

  md += `### AI再評価ケース除外キーワード\n\n`;
  md += `| キーワードパターン | 該当件数 |\n|---|---:|\n`;
  for (const ks of kwSamples) md += `| ${ks.label} | ${ks.count} |\n`;
  md += `| **除外合計** | **${totalReEval}** |\n\n`;
  for (const ks of kwSamples) {
    if (ks.excerpts.length === 0) continue;
    md += `**${ks.label}** サンプル:\n`;
    for (const ex of ks.excerpts) md += `- ${ex}\n`;
    md += `\n`;
  }

  md += `### 母数の件数（全候補者合計）\n\n`;
  md += `| 項目 | 全期間 | 5月以降のみ |\n|---|---:|---:|\n`;
  md += `| ブックマーク総数 | ${totalBk} | — |\n`;
  md += `| うち未アーカイブ | ${nonArchivedBk} | — |\n`;
  md += `| うちアーカイブ済（紹介保留） | ${archivedBk} | — |\n`;
  md += `| うち求人出力済 | ${exportedBk} | ${filteredExportedBk} |\n`;
  md += `| うち求人出力済 + AI分析済 | ${exportedAnalyzedBk} | ${filteredExportedAnalyzedBk} |\n`;
  md += `| うち3軸マーカー有効 | — | ${allBk.length} |\n`;
  md += `| 3軸マーカー欠落 | — | ${noAxisCount} |\n`;
  md += `| AI再評価で除外 | — | ${totalReEval} |\n`;
  md += `| **求人紹介された求人（本人希望の母数）** | **529** | **${cleanBk.length}** |\n`;
  md += `| 対象候補者数 | 39 | ${candidateIds.length} |\n`;
  md += `| JobEntry 総数 | ${totalEntries} | — |\n`;
  md += `| 対象候補者の Entry 数 | — | ${entries.length} |\n`;
  md += `| BK↔Entry 突合成功 | 36 | ${matchedN} |\n`;
  md += `| 突合失敗 | 493 | ${unmatchedN} |\n\n`;

  // Validation candidates
  md += `### 検証候補者（UI突合用）\n\n`;
  md += `| ID | 氏名 | BK(非保留) | 紹介保留 | 出力済 | Entry数 |\n|---|---|---:|---:|---:|---:|\n`;
  for (const vc of valCands) {
    const bkN = await prisma.candidateFile.count({ where: { candidateId: vc.id, category: "BOOKMARK", archivedAt: null } });
    const archN = await prisma.candidateFile.count({ where: { candidateId: vc.id, category: "BOOKMARK", archivedAt: { not: null } } });
    const expN = await prisma.candidateFile.count({ where: { candidateId: vc.id, category: "BOOKMARK", lastExportedAt: { not: null } } });
    const entN = await prisma.jobEntry.count({ where: { candidateId: vc.id } });
    md += `| ${vc.candidateNumber} | ${vc.name} | ${bkN} | ${archN} | ${expN} | ${entN} |\n`;
  }
  md += `\n`;

  md += `### entryFlag 分布\n\n`;
  md += `| entryFlag | 件数 |\n|---|---:|\n`;
  for (const row of entryFlagDist) md += `| ${row.entryFlag || "(null)"} | ${row._count} |\n`;
  md += `\n`;

  md += `### entryFlagDetail 分布（上位20）\n\n`;
  md += `| entryFlagDetail | 件数 |\n|---|---:|\n`;
  for (const row of entryFlagDetailDist.slice(0, 20)) md += `| ${row.entryFlagDetail || "(null)"} | ${row._count} |\n`;
  md += `\n`;

  // ----- Phase 1 section -----
  md += `## Phase 1: 集計表\n\n`;

  md += `### 1-A. 本人希望軸\n\n`;
  md += `母数: 求人紹介された求人（求人出力済 + AI分析済 + 再評価除外後）\n`;
  md += `成功判定: エントリータブに移行（entryFlag >= "エントリー"）\n\n`;
  md += `| 本人希望ランク | 求人紹介数（母数） | エントリー移行数 | 移行率 | 書類選考↑ | 面接↑ | 内定↑ | 入社 |\n`;
  md += `|:---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = wishStats[r];
    md += `| ${r} | ${s.total} | ${s.entryMoved} | ${pct(s.entryMoved, s.total)} | ${s.shoryoPlus} | ${s.mensetsuPlus} | ${s.naiteiPlus} | ${s.joined} |\n`;
  }
  md += `\n`;

  md += `### 1-B. 通過率軸\n\n`;
  md += `母数: エントリーに進んだ求人（entryFlag >= "エントリー"）\n\n`;
  md += `| 通過率ランク | エントリー数（母数） | 書類選考到達 | 書類通過率 | 面接到達 | 面接通過率 | 内定到達 | 内定到達率 | 承諾 | 承諾率 |\n`;
  md += `|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = passStats[r];
    md += `| ${r} | ${s.entryN} | ${s.shoryoReached} | ${pct(s.shoryoReached, s.entryN)} | ${s.mensetsuReached} | ${pct(s.mensetsuReached, s.entryN)} | ${s.naiteiReached} | ${pct(s.naiteiReached, s.entryN)} | ${s.accepted} | ${pct(s.accepted, s.entryN)} |\n`;
  }
  md += `\n`;

  md += `### 1-C. 総合ランク（参考）\n\n`;
  md += `| 総合ランク | 求人紹介数 | エントリー移行率 | 内定到達率（エントリー数比） |\n`;
  md += `|:---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = overallStats[r];
    md += `| ${r} | ${s.total} | ${pct(s.entryMoved, s.total)} | ${s.entryMoved > 0 ? pct(s.naiteiReached, s.entryMoved) : "—"} |\n`;
  }
  md += `\n`;

  md += `### 1-D. クレンジング除外内訳\n\n`;
  md += `| 除外理由のキーワード | 除外件数 |\n|---|---:|\n`;
  for (const ks of kwSamples) md += `| ${ks.label} | ${ks.count}件 |\n`;
  md += `| **除外合計** | **${totalReEval}件** |\n\n`;

  // ----- Phase 2 section -----
  md += `## Phase 2: 想定外ケース\n\n`;

  const cats: [string, string, AnomalyItem[], boolean][] = [
    ["カテゴリ1", "本人希望A空振り（最重要）", cat1, true],
    ["カテゴリ2", "通過率A書類落ち（最重要）", cat2, true],
    ["カテゴリ3", "通過率A内定到達せず", cat3, false],
    ["カテゴリ4", "本人希望Cで移行", cat4, false],
    ["カテゴリ5", "通過率Cで書類通過", cat5, false],
    ["カテゴリ6", "通過率Cで内定到達", cat6, false],
  ];

  for (const [num, label, items, isImportant] of cats) {
    const sampled = sampleAnomalies(items, isImportant);
    md += `### ${num}: ${label}\n`;
    md += `件数: ${items.length}件${sampled.length < items.length ? `（${sampled.length}件抽出）` : ""}\n\n`;
    if (sampled.length === 0) { md += `（該当なし）\n\n`; continue; }
    for (let i = 0; i < sampled.length; i++) {
      md += `${i + 1}. ${formatItem(sampled[i])}\n`;
    }
    md += `\n`;
  }

  // ----- Observations -----
  md += `## 観察された明らかな傾向\n\n`;
  const wA = wishStats["A"], wD = wishStats["D"];
  const pA = passStats["A"];
  md += `- 本人希望A のエントリー移行率: ${pct(wA.entryMoved, wA.total)}（${wA.entryMoved}/${wA.total}）\n`;
  md += `- 本人希望D のエントリー移行率: ${pct(wD.entryMoved, wD.total)}（${wD.entryMoved}/${wD.total}）\n`;
  md += `- 通過率A のエントリーからの内定到達率: ${pct(pA.naiteiReached, pA.entryN)}（${pA.naiteiReached}/${pA.entryN}）\n`;
  md += `- 本人希望A空振り: ${cat1.length}件 / 求人紹介A: ${wA.total}件\n`;
  md += `- 通過率A書類落ち: ${cat2.length}件 / 通過率Aエントリー: ${pA.entryN}件\n`;

  // ----- Comparison with v2 and v3 -----
  const wB = wishStats["B"];
  const curWishA = wA.total > 0 ? (wA.entryMoved / wA.total * 100) : 0;
  const curWishB = wB.total > 0 ? (wB.entryMoved / wB.total * 100) : 0;
  md += `\n## 前回比較\n\n`;
  md += `| 指標 | v2 全期間 | v3 5月以降 | v4 4月のみ |\n`;
  md += `|--|--:|--:|--:|\n`;
  md += `| 求人紹介母数 | 529 | 275 | ${cleanBk.length} |\n`;
  md += `| 本人希望A 母数 | 162 | 91 | ${wA.total} |\n`;
  md += `| 本人希望A 移行率 | 8.6% | 2.2% | ${curWishA.toFixed(1)}% |\n`;
  md += `| 本人希望B 移行率 | 5.8% | 4.0% | ${curWishB.toFixed(1)}% |\n`;
  md += `| 通過率A エントリー数 | 13 | 2 | ${pA.entryN} |\n`;
  md += `| 通過率A 内定到達数 | 0 | 0 | ${pA.naiteiReached} |\n`;

  // Write output
  const outDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "skill_update_research_result.md");
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`\n[Done] ${outPath} (${md.split("\n").length} lines)`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
