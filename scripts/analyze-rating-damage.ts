/**
 * ブックマーク評価消失の影響範囲調査スクリプト（読み取り専用）
 *
 * 目的:
 *   CandidateFile.aiAnalysisComment から 3軸マーカー
 *   （■ 本人希望 / ■ 通過率 / ■ 総合）が欠落したレコードを集計し、
 *   影響を受けた候補者を一覧化する。
 *
 * 使い方:
 *   # ローカル(.envのDATABASE_URL)
 *   npx tsx scripts/analyze-rating-damage.ts
 *
 *   # 本番/stagingを明示
 *   DATABASE_URL=$PROD_DB_URL npx tsx scripts/analyze-rating-damage.ts
 *   DATABASE_URL=$STAGING_DB_URL npx tsx scripts/analyze-rating-damage.ts
 *
 * 注意:
 *   DB更新・削除は一切行わない。select のみ。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// HistoryTab.tsx の parse3AxisRatings と同じ正規表現
function hasValidRatings(comment: string | null): boolean {
  if (!comment) return false;
  const hasDesire = /■\s*本人希望[：:]\s*[ABCD]/.test(comment);
  const hasPass = /■\s*通過率[：:]\s*[ABCD]/.test(comment);
  const hasOverall = /■\s*総合[：:]\s*[ABCD]/.test(comment);
  return hasDesire && hasPass && hasOverall;
}

function classify(comment: string | null): "null_or_empty" | "missing_markers" | "valid" {
  if (!comment || comment.trim() === "") return "null_or_empty";
  if (!hasValidRatings(comment)) return "missing_markers";
  return "valid";
}

function fmtJst(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(/\//g, "-");
}

async function main() {
  const now = new Date();
  const dbUrl = process.env.DATABASE_URL || "(未設定)";
  const dbHost = dbUrl.match(/@([^/:]+)/)?.[1] ?? "(unknown)";

  console.log("=== ブックマーク評価消失の影響範囲調査 ===");
  console.log(`実行日時: ${fmtJst(now)} (JST)`);
  console.log(`DB host: ${dbHost}`);
  console.log("");

  // --- A. 全体集計 ---
  const bookmarks = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK" },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      aiAnalysisComment: true,
      aiMatchRating: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  const total = bookmarks.length;
  let nullOrEmpty = 0;
  let missingMarkers = 0;
  let valid = 0;
  let ratingNull = 0;
  let ratingNotNull = 0;

  for (const f of bookmarks) {
    const c = classify(f.aiAnalysisComment);
    if (c === "null_or_empty") nullOrEmpty++;
    else if (c === "missing_markers") missingMarkers++;
    else valid++;

    if (f.aiMatchRating) ratingNotNull++;
    else ratingNull++;
  }

  console.log("【全体集計】");
  console.log(`ブックマーク総数: ${total} 件`);
  console.log(`  - aiAnalysisComment NULL/空: ${nullOrEmpty} 件`);
  console.log(`  - aiAnalysisComment 3軸マーカー欠落: ${missingMarkers} 件 (★問題対象)`);
  console.log(`  - aiAnalysisComment 正常: ${valid} 件`);
  console.log(`aiMatchRating NULL: ${ratingNull} 件`);
  console.log(`aiMatchRating 非NULL: ${ratingNotNull} 件`);
  console.log("");

  // --- B. 本日(2026-04-17 JST) 更新分 ---
  const todayStart = new Date("2026-04-17T00:00:00+09:00");
  const todayEnd = new Date("2026-04-18T00:00:00+09:00");

  const todayBroken = bookmarks.filter(
    (f) =>
      f.updatedAt >= todayStart &&
      f.updatedAt < todayEnd &&
      classify(f.aiAnalysisComment) === "missing_markers"
  );

  const todayAffectedCandidateIds = new Set(todayBroken.map((f) => f.candidateId));

  console.log("【本日(2026-04-17 JST)更新分】");
  console.log(`本日更新された壊れた評価: ${todayBroken.length} 件`);
  console.log(`影響を受けた候補者: ${todayAffectedCandidateIds.size} 名`);
  console.log("");

  // --- C. 候補者別の影響（本日壊れた候補者を対象、全体の壊れた/正常件数も表示） ---
  if (todayAffectedCandidateIds.size === 0) {
    console.log("【候補者別】 本日影響を受けた候補者はいません");
  } else {
    const candidates = await prisma.candidate.findMany({
      where: { id: { in: Array.from(todayAffectedCandidateIds) } },
      select: { id: true, candidateNumber: true, name: true },
    });
    const nameMap = new Map(candidates.map((c) => [c.id, c]));

    type Row = {
      id: string;
      candidateNumber: string;
      name: string;
      brokenToday: number;
      brokenTotal: number;
      validTotal: number;
      nullTotal: number;
    };
    const rows: Row[] = [];

    for (const cid of todayAffectedCandidateIds) {
      const cand = nameMap.get(cid);
      const filesForCand = bookmarks.filter((f) => f.candidateId === cid);
      let brokenToday = 0;
      let brokenTotal = 0;
      let validTotal = 0;
      let nullTotal = 0;
      for (const f of filesForCand) {
        const cls = classify(f.aiAnalysisComment);
        if (cls === "missing_markers") {
          brokenTotal++;
          if (f.updatedAt >= todayStart && f.updatedAt < todayEnd) brokenToday++;
        } else if (cls === "valid") {
          validTotal++;
        } else {
          nullTotal++;
        }
      }
      rows.push({
        id: cid,
        candidateNumber: cand?.candidateNumber ?? "(不明)",
        name: cand?.name ?? "(不明)",
        brokenToday,
        brokenTotal,
        validTotal,
        nullTotal,
      });
    }

    rows.sort((a, b) => b.brokenToday - a.brokenToday || b.brokenTotal - a.brokenTotal);

    console.log("【候補者別（本日影響分）】");
    rows.forEach((r, i) => {
      console.log(
        `${i + 1}. ${r.name} (${r.candidateNumber}) - 本日壊れた: ${r.brokenToday}件 / 壊れた合計: ${r.brokenTotal}件 / 健全: ${r.validTotal}件 / NULL空: ${r.nullTotal}件`
      );
    });
  }

  console.log("");
  console.log("【参考: 全体の壊れたレコード（本日以外も含む）】");
  const allBroken = bookmarks.filter(
    (f) => classify(f.aiAnalysisComment) === "missing_markers"
  );
  const allBrokenCandidateIds = new Set(allBroken.map((f) => f.candidateId));
  console.log(`壊れた評価: ${allBroken.length} 件`);
  console.log(`影響を受けた候補者: ${allBrokenCandidateIds.size} 名`);

  console.log("");
  console.log("=== 完了 ===");
}

main()
  .catch((e) => {
    console.error("エラー:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
