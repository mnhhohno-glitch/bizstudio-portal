/**
 * AI マッチング精度検証スクリプト（読み取り専用）
 *
 * CandidateFile (BOOKMARK) の AI 3軸評価 (本人希望/通過率/総合) と
 * JobEntry の選考結果を突合し、AI 判定の精度を検証する。
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

type Rating = "A" | "B" | "C" | "D";
type Axis = { wish: Rating | null; pass: Rating | null; overall: Rating | null };

interface BookmarkWithRating {
  id: string;
  candidateId: string;
  candidateNumber: string;
  candidateName: string;
  fileName: string;
  aiAnalysisComment: string;
  aiMatchRating: string | null;
  axis: Axis;
  normalizedCompany: string;
}

interface EntryOutcome {
  id: string;
  candidateId: string;
  companyName: string;
  normalizedCompany: string;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  isActive: boolean;
  personFlag: string | null;
}

interface MatchedPair {
  bookmark: BookmarkWithRating;
  entry: EntryOutcome;
}

const FLAG_ORDER: Record<string, number> = {
  "求人紹介": 0, "エントリー": 1, "書類選考": 2, "面接": 3, "内定": 4, "入社済": 5,
};
const FLAG_LABELS = ["求人紹介", "エントリー", "書類選考", "面接", "内定", "入社済"];

function parse3Axis(comment: string | null): Axis {
  if (!comment) return { wish: null, pass: null, overall: null };
  const w = comment.match(/■\s*本人希望[：:]\s*([ABCD])/);
  const p = comment.match(/■\s*通過率[：:]\s*([ABCD])/);
  const o = comment.match(/■\s*総合[：:]\s*([ABCD])/);
  return {
    wish: (w?.[1] as Rating) || null,
    pass: (p?.[1] as Rating) || null,
    overall: (o?.[1] as Rating) || null,
  };
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
  if (p1) { name = p1[1]; }
  else {
    const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
    if (p2) { name = p2[1]; }
    else {
      const p3 = name.match(/^(.+?)[：:]\d+$/);
      if (p3) { name = p3[1].trim(); }
      else {
        const p4 = name.match(/^求人票[_]?(.+)$/);
        if (p4) name = p4[1];
      }
    }
  }
  name = name.replace(/_No\d+$/i, "");
  return normalizeCompany(name);
}

function stageReached(entryFlag: string | null): number {
  if (!entryFlag) return -1;
  return FLAG_ORDER[entryFlag] ?? -1;
}

function isSelectionEnded(detail: string | null): boolean {
  return !!detail && ["選考落ち", "本人辞退", "本人辞退_他社決", "本人辞退_自社他", "クローズ"].includes(detail);
}

const pct = (n: number, d: number) => d > 0 ? `${(n / d * 100).toFixed(1)}%` : "—";

async function main() {
  console.log("[Research] Phase 0: Fetching data...");

  // --- Phase 0: DB distribution ---
  const totalBookmarks = await prisma.candidateFile.count({ where: { category: "BOOKMARK", archivedAt: null } });
  const analyzedBookmarks = await prisma.candidateFile.count({ where: { category: "BOOKMARK", archivedAt: null, aiAnalysisComment: { not: null } } });
  const totalEntries = await prisma.jobEntry.count();
  const activeEntries = await prisma.jobEntry.count({ where: { isActive: true } });

  const entryFlagDist = await prisma.jobEntry.groupBy({ by: ["entryFlag"], _count: true, orderBy: { _count: { entryFlag: "desc" } } });
  const entryFlagDetailDist = await prisma.jobEntry.groupBy({ by: ["entryFlagDetail"], _count: true, orderBy: { _count: { entryFlagDetail: "desc" } } });

  console.log(`  Total bookmarks: ${totalBookmarks}, analyzed: ${analyzedBookmarks}`);
  console.log(`  Total entries: ${totalEntries}, active: ${activeEntries}`);

  // Fetch all rated bookmarks
  const bookmarks = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", aiAnalysisComment: { not: null }, archivedAt: null },
    select: {
      id: true, candidateId: true, fileName: true,
      aiAnalysisComment: true, aiMatchRating: true,
      candidate: { select: { candidateNumber: true, name: true } },
    },
  });

  const ratedBookmarks: BookmarkWithRating[] = [];
  let noAxisCount = 0;
  for (const b of bookmarks) {
    const axis = parse3Axis(b.aiAnalysisComment);
    if (!axis.wish && !axis.pass && !axis.overall) { noAxisCount++; continue; }
    ratedBookmarks.push({
      id: b.id, candidateId: b.candidateId,
      candidateNumber: b.candidate.candidateNumber, candidateName: b.candidate.name,
      fileName: b.fileName, aiAnalysisComment: b.aiAnalysisComment!,
      aiMatchRating: b.aiMatchRating, axis,
      normalizedCompany: extractCompanyFromFileName(b.fileName),
    });
  }

  console.log(`  Rated bookmarks (3-axis): ${ratedBookmarks.length} (no axis: ${noAxisCount})`);

  const candidateIds = [...new Set(ratedBookmarks.map(b => b.candidateId))];
  console.log(`  Unique candidates: ${candidateIds.length}`);

  const entries = await prisma.jobEntry.findMany({
    where: { candidateId: { in: candidateIds } },
    select: {
      id: true, candidateId: true, companyName: true,
      entryFlag: true, entryFlagDetail: true, isActive: true, personFlag: true,
    },
  });
  console.log(`  Entries for those candidates: ${entries.length}`);

  // Build entry lookup
  const entryByCandiate = new Map<string, EntryOutcome[]>();
  for (const e of entries) {
    const o: EntryOutcome = { ...e, normalizedCompany: normalizeCompany(e.companyName) };
    if (!entryByCandiate.has(e.candidateId)) entryByCandiate.set(e.candidateId, []);
    entryByCandiate.get(e.candidateId)!.push(o);
  }

  // Match bookmarks → entries
  const matched: MatchedPair[] = [];
  const unmatched: BookmarkWithRating[] = [];
  const matchedById = new Map<string, EntryOutcome>(); // bookmarkId → entry

  for (const bk of ratedBookmarks) {
    const ces = entryByCandiate.get(bk.candidateId) || [];
    let best: EntryOutcome | null = null;

    for (const ce of ces) {
      if (ce.normalizedCompany === bk.normalizedCompany) {
        if (!best || stageReached(ce.entryFlag) > stageReached(best.entryFlag)) best = ce;
      }
    }
    if (!best && bk.normalizedCompany.length >= 2) {
      for (const ce of ces) {
        if (ce.normalizedCompany.length >= 2 &&
          (ce.normalizedCompany.includes(bk.normalizedCompany) || bk.normalizedCompany.includes(ce.normalizedCompany))) {
          if (!best || stageReached(ce.entryFlag) > stageReached(best.entryFlag)) best = ce;
        }
      }
    }

    if (best) {
      matched.push({ bookmark: bk, entry: best });
      matchedById.set(bk.id, best);
    } else {
      unmatched.push(bk);
    }
  }

  console.log(`  Matched: ${matched.length}, Unmatched: ${unmatched.length}`);

  // ============================================================
  // Phase 1: Aggregate Tables
  // ============================================================
  console.log("\n[Research] Phase 1: Aggregate tables...");

  const RATINGS: Rating[] = ["A", "B", "C", "D"];

  // Table 1: 本人希望 × エントリー移行率
  const wishStats = Object.fromEntries(RATINGS.map(r => [r, {
    total: 0, hasEntry: 0, entryPlus: 0, shoryoPlus: 0, mensetsuPlus: 0, naiteiPlus: 0, joined: 0, ended: 0,
  }]));

  for (const bk of ratedBookmarks) {
    if (!bk.axis.wish) continue;
    const s = wishStats[bk.axis.wish];
    s.total++;
    const entry = matchedById.get(bk.id);
    if (!entry) continue;
    s.hasEntry++;
    const st = stageReached(entry.entryFlag);
    if (st >= 1) s.entryPlus++;
    if (st >= 2) s.shoryoPlus++;
    if (st >= 3) s.mensetsuPlus++;
    if (st >= 4) s.naiteiPlus++;
    if (st >= 5) s.joined++;
    if (isSelectionEnded(entry.entryFlagDetail)) s.ended++;
  }

  // Table 2: 通過率 × 選考通過率
  const passStats = Object.fromEntries(RATINGS.map(r => [r, {
    total: 0, hasEntry: 0, shoryoIn: 0, shoryoPass: 0, mensetsuIn: 0, mensetsuPass: 0, naitei: 0, senkoOchi: 0,
  }]));

  for (const bk of ratedBookmarks) {
    if (!bk.axis.pass) continue;
    const s = passStats[bk.axis.pass];
    s.total++;
    const entry = matchedById.get(bk.id);
    if (!entry) continue;
    s.hasEntry++;
    const st = stageReached(entry.entryFlag);
    if (st >= 2) { s.shoryoIn++; if (st >= 3) s.shoryoPass++; }
    if (st >= 3) { s.mensetsuIn++; if (st >= 4) s.mensetsuPass++; }
    if (st >= 4) s.naitei++;
    if (entry.entryFlagDetail === "選考落ち") s.senkoOchi++;
  }

  // Table 3: 総合 × 複合指標
  const overallStats = Object.fromEntries(RATINGS.map(r => [r, {
    total: 0, matchCount: 0, stageSum: 0, stageN: 0, naiteiPlus: 0, ended: 0, unmatchCount: 0,
  }]));

  for (const bk of ratedBookmarks) {
    if (!bk.axis.overall) continue;
    const s = overallStats[bk.axis.overall];
    s.total++;
    const entry = matchedById.get(bk.id);
    if (entry) {
      s.matchCount++;
      const st = stageReached(entry.entryFlag);
      if (st >= 0) { s.stageSum += st; s.stageN++; }
      if (st >= 4) s.naiteiPlus++;
      if (isSelectionEnded(entry.entryFlagDetail)) s.ended++;
    } else {
      s.unmatchCount++;
    }
  }

  // ============================================================
  // Phase 2: Anomaly Sampling
  // ============================================================
  console.log("[Research] Phase 2: Anomaly sampling...");
  const MAX = 100;
  type AnomalyItem = { bk: BookmarkWithRating; entry: EntryOutcome | null };

  // Count anomalies per candidate for priority sorting
  const candidateAnomalyCount = new Map<string, number>();
  const bumpAnomaly = (cid: string) => candidateAnomalyCount.set(cid, (candidateAnomalyCount.get(cid) || 0) + 1);

  // 4-1: 本人希望A空振り
  const cat1: AnomalyItem[] = [];
  for (const bk of ratedBookmarks) {
    if (bk.axis.wish !== "A") continue;
    const entry = matchedById.get(bk.id) || null;
    if (!entry || stageReached(entry.entryFlag) <= 0) {
      cat1.push({ bk, entry });
      bumpAnomaly(bk.candidateId);
    }
  }

  // 4-2: 通過率A書類落ち
  const cat2: AnomalyItem[] = [];
  for (const pair of matched) {
    if (pair.bookmark.axis.pass !== "A") continue;
    if (pair.entry.entryFlagDetail === "選考落ち" && stageReached(pair.entry.entryFlag) <= 2) {
      cat2.push({ bk: pair.bookmark, entry: pair.entry });
      bumpAnomaly(pair.bookmark.candidateId);
    }
  }

  // 4-3: 本人希望D成功
  const cat3: AnomalyItem[] = [];
  for (const pair of matched) {
    if (pair.bookmark.axis.wish !== "D") continue;
    if (stageReached(pair.entry.entryFlag) >= 3) {
      cat3.push({ bk: pair.bookmark, entry: pair.entry });
      bumpAnomaly(pair.bookmark.candidateId);
    }
  }

  // 4-4: 通過率D面接通過
  const cat4: AnomalyItem[] = [];
  for (const pair of matched) {
    if (pair.bookmark.axis.pass !== "D") continue;
    if (stageReached(pair.entry.entryFlag) >= 3) {
      cat4.push({ bk: pair.bookmark, entry: pair.entry });
      bumpAnomaly(pair.bookmark.candidateId);
    }
  }

  // 4-5: 総合A未エントリー
  const cat5: AnomalyItem[] = [];
  for (const bk of unmatched) {
    if (bk.axis.overall === "A") {
      cat5.push({ bk, entry: null });
      bumpAnomaly(bk.candidateId);
    }
  }

  // 4-6: 総合D内定
  const cat6: AnomalyItem[] = [];
  for (const pair of matched) {
    if (pair.bookmark.axis.overall !== "D") continue;
    if (stageReached(pair.entry.entryFlag) >= 4) {
      cat6.push({ bk: pair.bookmark, entry: pair.entry });
      bumpAnomaly(pair.bookmark.candidateId);
    }
  }

  // Sort each category: candidates with most anomalies first, then by candidateNumber
  const sortAnomaly = (items: AnomalyItem[]) =>
    [...items].sort((a, b) => {
      const ca = candidateAnomalyCount.get(a.bk.candidateId) || 0;
      const cb = candidateAnomalyCount.get(b.bk.candidateId) || 0;
      if (cb !== ca) return cb - ca;
      return a.bk.candidateNumber.localeCompare(b.bk.candidateNumber);
    });

  // ============================================================
  // Phase 3: Output
  // ============================================================
  console.log("[Research] Phase 3: Generating output...");

  const flagLabel = (e: EntryOutcome | null) =>
    e ? `${e.entryFlag || "?"}${e.entryFlagDetail ? `(${e.entryFlagDetail})` : ""}` : "(エントリーなし)";

  const formatTable = (items: AnomalyItem[], limit: number) => {
    const sorted = sortAnomaly(items).slice(0, limit);
    let out = `| # | 候補者 | ファイル名 | 希望 | 通過 | 総合 | エントリー状態 |\n`;
    out += `|---:|---|---|:---:|:---:|:---:|---|\n`;
    for (let i = 0; i < sorted.length; i++) {
      const { bk, entry } = sorted[i];
      const fn = bk.fileName.length > 35 ? bk.fileName.slice(0, 32) + "..." : bk.fileName;
      out += `| ${i + 1} | ${bk.candidateNumber} ${bk.candidateName} | ${fn} | ${bk.axis.wish || "—"} | ${bk.axis.pass || "—"} | ${bk.axis.overall || "—"} | ${flagLabel(entry)} |\n`;
    }
    return out;
  };

  let md = `# AI マッチング精度検証レポート\n\n`;
  md += `生成日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n\n`;

  // --- Phase 0 stats ---
  md += `## 0. データ概要\n\n`;
  md += `| 項目 | 件数 |\n|---|---:|\n`;
  md += `| ブックマーク総数（未アーカイブ） | ${totalBookmarks} |\n`;
  md += `| うち AI 分析済 | ${analyzedBookmarks} |\n`;
  md += `| うち 3軸マーカー有効 | ${ratedBookmarks.length} |\n`;
  md += `| 3軸マーカー欠落 | ${noAxisCount} |\n`;
  md += `| 対象候補者数 | ${candidateIds.length} |\n`;
  md += `| JobEntry 総数 | ${totalEntries} |\n`;
  md += `| うち isActive=true | ${activeEntries} |\n`;
  md += `| 候補者の Entry 数 | ${entries.length} |\n`;
  md += `| ブックマーク↔エントリー突合成功 | ${matched.length} |\n`;
  md += `| 突合失敗（エントリーなし） | ${unmatched.length} |\n`;
  md += `| 突合率 | ${pct(matched.length, ratedBookmarks.length)} |\n\n`;

  md += `### entryFlag 分布\n\n`;
  md += `| entryFlag | 件数 |\n|---|---:|\n`;
  for (const row of entryFlagDist) {
    md += `| ${row.entryFlag || "(null)"} | ${row._count} |\n`;
  }
  md += `\n`;

  md += `### entryFlagDetail 分布（上位20）\n\n`;
  md += `| entryFlagDetail | 件数 |\n|---|---:|\n`;
  for (const row of entryFlagDetailDist.slice(0, 20)) {
    md += `| ${row.entryFlagDetail || "(null)"} | ${row._count} |\n`;
  }
  md += `\n`;

  // --- Phase 1 tables ---
  md += `## 1. 本人希望 × エントリー移行率\n\n`;
  md += `| 本人希望 | BK数 | Entry有 | Entry率 | エントリー↑ | 書類↑ | 面接↑ | 内定↑ | 入社 | 選考終了 |\n`;
  md += `|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = wishStats[r];
    md += `| ${r} | ${s.total} | ${s.hasEntry} | ${pct(s.hasEntry, s.total)} | ${s.entryPlus} | ${s.shoryoPlus} | ${s.mensetsuPlus} | ${s.naiteiPlus} | ${s.joined} | ${s.ended} |\n`;
  }
  md += `\n`;

  md += `## 2. 通過率 × 選考通過率\n\n`;
  md += `| 通過率 | BK数 | Entry有 | 書類提出 | 書類通過 | 書類通過率 | 面接実施 | 面接通過 | 面接通過率 | 内定 | 選考落ち |\n`;
  md += `|:---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = passStats[r];
    md += `| ${r} | ${s.total} | ${s.hasEntry} | ${s.shoryoIn} | ${s.shoryoPass} | ${pct(s.shoryoPass, s.shoryoIn)} | ${s.mensetsuIn} | ${s.mensetsuPass} | ${pct(s.mensetsuPass, s.mensetsuIn)} | ${s.naitei} | ${s.senkoOchi} |\n`;
  }
  md += `\n`;

  md += `## 3. 総合 × 複合指標\n\n`;
  md += `| 総合 | BK数 | 突合済 | エントリー率 | 平均到達ステージ | 内定↑ | 選考終了 | 未突合 |\n`;
  md += `|:---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of RATINGS) {
    const s = overallStats[r];
    const avg = s.stageN > 0 ? s.stageSum / s.stageN : -1;
    const avgLabel = avg >= 0 ? `${avg.toFixed(2)} (${FLAG_LABELS[Math.round(avg)] || "?"})` : "—";
    md += `| ${r} | ${s.total} | ${s.matchCount} | ${pct(s.matchCount, s.total)} | ${avgLabel} | ${s.naiteiPlus} | ${s.ended} | ${s.unmatchCount} |\n`;
  }
  md += `\n`;

  // --- Phase 2 anomaly tables ---
  md += `## 4. 異常ケース分析\n\n`;

  const categories: [string, string, AnomalyItem[]][] = [
    ["4-1", "本人希望A空振り（wish=A だがエントリーなし/求人紹介止まり）", cat1],
    ["4-2", "通過率A書類落ち（pass=A だが選考落ち）", cat2],
    ["4-3", "本人希望D成功（wish=D だが面接以上に到達）", cat3],
    ["4-4", "通過率D面接通過（pass=D だが面接以上に到達）", cat4],
    ["4-5", "総合A未エントリー（overall=A だがエントリーなし）", cat5],
    ["4-6", "総合D内定（overall=D だが内定以上に到達）", cat6],
  ];

  for (const [num, label, items] of categories) {
    md += `### ${num}. ${label}\n\n`;
    md += `該当: ${items.length}件\n\n`;
    if (items.length > 0) md += formatTable(items, MAX) + "\n";
  }

  // AI Comment excerpts
  md += `## 5. 代表的な異常ケースの AI コメント抜粋\n\n`;

  const commentCats: [string, AnomalyItem[]][] = [
    ["本人希望A空振り", cat1],
    ["通過率A書類落ち", cat2],
    ["本人希望D成功", cat3],
    ["通過率D面接通過", cat4],
  ];

  for (const [label, items] of commentCats) {
    const samples = sortAnomaly(items).slice(0, 3);
    if (samples.length === 0) continue;
    md += `### ${label}\n\n`;
    for (const { bk, entry } of samples) {
      md += `**${bk.candidateNumber} ${bk.candidateName} / ${bk.fileName}**\n`;
      md += `エントリー状態: ${flagLabel(entry)}\n\n`;
      const comment = bk.aiAnalysisComment.length > 500
        ? bk.aiAnalysisComment.slice(0, 500) + "\n...(省略)"
        : bk.aiAnalysisComment;
      md += `\`\`\`\n${comment}\n\`\`\`\n\n`;
    }
  }

  // Write
  const outDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "skill_update_research_result.md");
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`\n[Research] Done. Output: ${outPath} (${md.split("\n").length} lines)`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
