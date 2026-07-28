/** T-146 追加調査(4): 素直な会社名なのにスキップされた行の性質（読み取り専用） */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const NOISE = /（|）|\(|\)|、|[◆★／|｜▼●〇■□☆※♦彡]|【|】|未経験|歓迎|上場|土日|年休|年間休日|月給|年収|正社員|リモート|転勤|完全週休|急募|フレックス|残業|賞与|第二新卒|プライム/;

async function main() {
  const rows = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK" },
    select: { candidateId: true, fileName: true, driveFileId: true, extractedAt: true,
              aiAnalysisComment: true, aiAnalyzedAt: true, createdAt: true },
  });
  const last = new Map<string, Date>();
  for (const r of rows) {
    if (!r.aiAnalyzedAt) continue;
    const c = last.get(r.candidateId);
    if (!c || r.aiAnalyzedAt > c) last.set(r.candidateId, r.aiAnalyzedAt);
  }
  const skipped = rows.filter((r) => {
    if (!r.extractedAt || r.aiAnalysisComment || !r.driveFileId) return false;
    const la = last.get(r.candidateId);
    return !!la && r.createdAt < la;
  });
  const clean = skipped.filter((r) => !NOISE.test(r.fileName));

  // 求職者ごとの「その求職者のスキップ件数 / 全BM件数」
  const byCand = new Map<string, { skip: number; total: number; ok: number }>();
  for (const r of rows) {
    const e = byCand.get(r.candidateId) ?? { skip: 0, total: 0, ok: 0 };
    e.total++;
    if (r.aiAnalysisComment) e.ok++;
    byCand.set(r.candidateId, e);
  }
  for (const r of clean) byCand.get(r.candidateId)!.skip++;

  const affected = [...byCand.entries()].filter(([, v]) => v.skip > 0).sort((a, b) => b[1].skip - a[1].skip);
  console.log(`素直な会社名のスキップ: ${clean.length} 件 / 求職者 ${affected.length} 名`);
  console.log("\n上位（1名でまとまってスキップ＝バッチ単位の失敗の疑い）:");
  affected.slice(0, 15).forEach(([id, v]) =>
    console.log(`  ${id}  スキップ${String(v.skip).padStart(3)} / BM${String(v.total).padStart(3)} / 成功${String(v.ok).padStart(3)}`)
  );
  const bulk = affected.filter(([, v]) => v.skip >= 5).reduce((s, [, v]) => s + v.skip, 0);
  const single = clean.length - bulk;
  console.log(`\n1名あたり5件以上まとまってスキップ: ${bulk} 件（バッチ失敗の疑い）`);
  console.log(`散発（1名あたり4件以下）          : ${single} 件`);
  const zeroOk = affected.filter(([, v]) => v.ok === 0).reduce((s, [, v]) => s + v.skip, 0);
  console.log(`その求職者の成功が0件（＝一度も保存できていない）: ${zeroOk} 件`);
}
main().catch(console.error).finally(async () => { await prisma.$disconnect(); await pool.end(); });
