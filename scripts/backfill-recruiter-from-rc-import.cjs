/**
 * T-103 Phase2: RC_import.csv で 4/13前(FileMakerインポート分)の担当RC(Candidate.recruiterName)
 * 空欄を埋める投入スクリプト。
 *
 * 実行はコンテナ上(railway ssh)で Node + PrismaPg アダプタ(src/lib/prisma.ts と同構成)。
 *   dry-run: node backfill-recruiter-from-rc-import.cjs <csvPath>
 *   apply  : node backfill-recruiter-from-rc-import.cjs <csvPath> --apply
 *
 * 安全機構:
 *  - recruiterName が空(NULL/空文字)のレコードだけ更新。既存の非空は絶対に上書きしない
 *    (updateMany の WHERE に OR[null,''] を必須条件として残す)。
 *  - --apply 時は更新対象 (candidateNumber, 旧値) を stdout に @@ROLLBACK@@ マーカー付きで出力
 *    (呼び出し側が verify/recruiter-backfill-rollback-YYYY-MM-DD.csv に保存する)。
 *  - 1トランザクションで実行し、更新件数が dry-run の更新予定件数と一致しなければ throw でロールバック。
 *
 * 突合キーは candidate_number = Candidate.candidateNumber のみ。SC+8桁のスカウトNOは使わない。
 * 投入値: unit_no あり → "RPA {unit_no}号機"(現役フォーマット, 半角スペース)。name_value あり → その実名。
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

function parseCsv(path) {
  let txt = fs.readFileSync(path, "utf8");
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  const lines = txt.split(/\r?\n/).filter((l) => l.length > 0);
  const rows = lines.slice(1); // skip header
  const intended = [];
  for (const line of rows) {
    const parts = line.split(",");
    const cn = (parts[0] || "").trim();
    const unit = (parts[1] || "").trim();
    const name = (parts[2] || "").trim();
    if (!/^\d+$/.test(cn)) continue;
    let val = null;
    if (unit) val = `RPA ${unit}号機`;
    else if (name) val = name;
    if (val) intended.push({ cn, val });
  }
  return intended;
}

(async () => {
  const csvPath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!csvPath) { console.error("usage: node backfill-recruiter-from-rc-import.cjs <csvPath> [--apply]"); process.exit(1); }

  const intended = parseCsv(csvPath);
  const cns = intended.map((x) => x.cn);
  const minCN = cns.reduce((a, b) => (a < b ? a : b));
  const maxCN = cns.reduce((a, b) => (a > b ? a : b));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const p = new PrismaClient({ adapter: new PrismaPg(pool) });

  const dbRows = await p.candidate.findMany({
    where: { candidateNumber: { gte: minCN, lte: maxCN } },
    select: { candidateNumber: true, recruiterName: true },
  });
  const dbMap = new Map(dbRows.map((r) => [r.candidateNumber, r.recruiterName]));

  let matchable = 0, skipNonEmpty = 0, notFound = 0;
  const updates = []; // {cn, old, new}
  for (const { cn, val } of intended) {
    if (!dbMap.has(cn)) { notFound++; continue; }
    matchable++;
    const cur = dbMap.get(cn);
    if (cur == null || cur === "") updates.push({ cn, old: cur, new: val });
    else skipNonEmpty++;
  }

  console.log("=== T-103 backfill", apply ? "APPLY" : "DRY-RUN", "===");
  console.log("CSV intended rows:", intended.length);
  console.log("突合可能(DB存在):", matchable);
  console.log("空欄該当=更新予定:", updates.length);
  console.log("非空スキップ:", skipNonEmpty);
  console.log("candidateNumber不在:", notFound);

  if (!apply) {
    console.log("--- 更新サンプル20件 ---");
    for (const u of updates.slice(0, 20)) console.log(`${u.cn} | ${JSON.stringify(u.old)} -> ${JSON.stringify(u.new)}`);
    await p.$disconnect(); await pool.end();
    return;
  }

  // --- APPLY ---
  // ロールバック退避(stdout)。呼び出し側が verify/ に保存する。
  console.log("@@ROLLBACK_BEGIN@@");
  console.log("candidate_number,old_recruiter_name");
  for (const u of updates) console.log(`${u.cn},${u.old == null ? "" : JSON.stringify(u.old)}`);
  console.log("@@ROLLBACK_END@@");

  // 値ごとにグルーピングして updateMany(空欄ガードを必須条件として残す)
  const byVal = new Map();
  for (const u of updates) {
    if (!byVal.has(u.new)) byVal.set(u.new, []);
    byVal.get(u.new).push(u.cn);
  }
  const affected = await p.$transaction(async (tx) => {
    let total = 0;
    for (const [val, list] of byVal) {
      const r = await tx.candidate.updateMany({
        where: { candidateNumber: { in: list }, OR: [{ recruiterName: null }, { recruiterName: "" }] },
        data: { recruiterName: val },
      });
      total += r.count;
    }
    if (total !== updates.length) throw new Error(`count mismatch: updated ${total} != expected ${updates.length} (rolled back)`);
    return total;
  });
  console.log("@@RESULT@@ updated:", affected, "expected:", updates.length, "match:", affected === updates.length);
  await p.$disconnect(); await pool.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
