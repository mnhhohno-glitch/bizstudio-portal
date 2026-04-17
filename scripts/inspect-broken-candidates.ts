/**
 * 「aiMatchRating あり/aiAnalysisComment NULL or 空」の候補者一覧（読み取り専用）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // rating あり AND comment NULL or empty
  const rows = await prisma.candidateFile.findMany({
    where: {
      category: "BOOKMARK",
      aiMatchRating: { not: null },
      OR: [{ aiAnalysisComment: null }, { aiAnalysisComment: "" }],
    },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      aiMatchRating: true,
      aiAnalysisComment: true,
      aiAnalyzedAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`=== rating あり / comment NULL or空 のブックマーク ===`);
  console.log(`総件数: ${rows.length}`);

  const byCand = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byCand.get(r.candidateId) ?? [];
    arr.push(r);
    byCand.set(r.candidateId, arr);
  }

  const candIds = Array.from(byCand.keys());
  const cands = await prisma.candidate.findMany({
    where: { id: { in: candIds } },
    select: { id: true, candidateNumber: true, name: true },
  });
  const nameMap = new Map(cands.map((c) => [c.id, c]));

  const candList = candIds
    .map((id) => ({
      id,
      name: nameMap.get(id)?.name ?? "(不明)",
      candidateNumber: nameMap.get(id)?.candidateNumber ?? "(不明)",
      broken: byCand.get(id)?.length ?? 0,
    }))
    .sort((a, b) => b.broken - a.broken);

  console.log(`影響候補者: ${candList.length} 名`);
  console.log("");
  candList.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name} (No.${c.candidateNumber} / ${c.id}) - ${c.broken}件`);
  });

  console.log("");
  console.log("=== 各候補者の壊れたレコード内訳（最新5件まで） ===");
  for (const c of candList) {
    console.log("");
    console.log(`## ${c.name} (No.${c.candidateNumber})`);
    const files = byCand.get(c.id) ?? [];
    files.slice(0, 5).forEach((f, i) => {
      const updatedJst = new Date(f.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      const analyzedJst = f.aiAnalyzedAt
        ? new Date(f.aiAnalyzedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
        : "(NULL)";
      console.log(`  [${i + 1}] ${f.fileName}`);
      console.log(`      rating=${f.aiMatchRating}  commentNull=${f.aiAnalysisComment == null}  commentEmpty=${f.aiAnalysisComment === ""}`);
      console.log(`      updatedAt=${updatedJst}  aiAnalyzedAt=${analyzedJst}`);
    });
    if (files.length > 5) console.log(`      ...他 ${files.length - 5}件`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
