/**
 * T-146 追加調査(2): 「未分析」と「分析は走ったがスキップされた」の切り分け（読み取り専用）
 *
 * 判定: 同じ求職者で AI分析が実行されており（他のBMに aiAnalyzedAt がある）、
 *       かつ当該ファイルがその分析時点より前から存在し extractedAt もあるのに
 *       コメントが無い → 分析対象に入ったはずなのに保存されなかった＝スキップの疑い。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function normalizeSpaces(s: string) { return s.replace(/　/g, " "); }
function extractSearchNames(fileName: string): string[] {
  const names: string[] = [];
  const name = fileName.replace(/\.pdf$/i, "");
  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/); if (p1) names.push(p1[1]);
  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/); if (p2) names.push(p2[1]);
  const p3 = name.match(/^(.+?)_No\d+$/i); if (p3) names.push(p3[1]);
  const pBee = name.match(/^(.+?)[：:]\d+$/); if (pBee && pBee[1]) names.push(pBee[1].trim());
  const p4 = name.match(/^求人票[_]?(.+)$/); if (p4 && !names.includes(p4[1])) names.push(p4[1]);
  if (names.length === 0) names.push(name);
  for (let i = 0; i < names.length; i++) names[i] = normalizeSpaces(names[i]);
  const expanded = [...names];
  for (const n of names) {
    const stripped = n.replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "").trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) expanded.push(stripped);
  }
  return expanded;
}

const NOISE = /（|）|\(|\)|、|[◆★／|｜▼●〇■□☆※♦♪彡]|【|】|未経験|歓迎|上場|土日|年休|年間休日|月給|年収|正社員|リモート|転勤|完全週休|急募|フレックス|残業|賞与|第二新卒|プライム|OK|可$/;

async function main() {
  const rows = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK" },
    select: { id: true, fileName: true, candidateId: true, origin: true, driveFileId: true,
              extractedAt: true, aiAnalysisComment: true, aiAnalyzedAt: true, createdAt: true },
  });

  // 求職者ごとの「最後にAI分析が走った時刻」
  const lastAnalyzed = new Map<string, Date>();
  for (const r of rows) {
    if (!r.aiAnalyzedAt) continue;
    const cur = lastAnalyzed.get(r.candidateId);
    if (!cur || r.aiAnalyzedAt > cur) lastAnalyzed.set(r.candidateId, r.aiAnalyzedAt);
  }

  const noComment = rows.filter(
    (r) => r.extractedAt && !r.aiAnalysisComment && r.driveFileId // PDF実体あり
  );
  const skipped = noComment.filter((r) => {
    const la = lastAnalyzed.get(r.candidateId);
    return la && r.createdAt < la; // 分析が走った時点で既に存在していた
  });
  const neverRun = noComment.filter((r) => !skipped.includes(r));

  console.log("## 切り分け結果");
  console.log(`コメント無し（PDF有・extractedAt有）: ${noComment.length} 件`);
  console.log(`  ★スキップの疑い（分析実行後も未保存）: ${skipped.length} 件`);
  console.log(`  未分析（その求職者でまだ分析していない/後から追加）: ${neverRun.length} 件`);

  const skipNoisy = skipped.filter((r) => NOISE.test(r.fileName));
  const skipClean = skipped.filter((r) => !NOISE.test(r.fileName));
  console.log(`\n  スキップ疑い のうち ファイル名に不純物あり: ${skipNoisy.length} 件`);
  console.log(`  スキップ疑い のうち 素直な会社名          : ${skipClean.length} 件`);
  console.log(`  影響求職者数（スキップ疑い）              : ${new Set(skipped.map((r) => r.candidateId)).size} 名`);
  console.log(`  影響求職者数（不純物ありのみ）            : ${new Set(skipNoisy.map((r) => r.candidateId)).size} 名`);

  console.log("\n## 不純物ありでスキップされたファイル名（最大30件・切り出し結果つき）");
  skipNoisy.slice(0, 30).forEach((r, i) => {
    const n = extractSearchNames(r.fileName);
    console.log(`\n[${i + 1}] ${r.fileName}`);
    console.log(`    切り出し: ${JSON.stringify(n.slice(0, 2))}`);
  });

  console.log("\n## 素直な会社名なのにスキップされた例（最大10件・別原因の可能性）");
  skipClean.slice(0, 10).forEach((r, i) => console.log(`  [${i + 1}] ${r.fileName}`));

  // 再判定コストの見積り
  console.log("\n## 再判定の対象件数（AI費用の見積り用）");
  console.log(`  スキップ疑い 全件            : ${skipped.length} 件`);
  console.log(`  うち不純物あり（本件の修正で救える見込み）: ${skipNoisy.length} 件`);
  console.log(`  バッチサイズ5 として          : 約 ${Math.ceil(skipNoisy.length / 5)} バッチ`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
