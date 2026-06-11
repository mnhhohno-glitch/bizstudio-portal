import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

// T-097: 銀行・支店・郵便番号マスタ投入。
// TSV（prisma/seeds/data/）を読み、2,000件チャンクで createMany（$transaction で全件包まない）。
// 投入順は FK 順: BankMaster → BranchMaster → PostalCodeMaster。
//
// 冪等性:
//  - BankMaster.code は PK、BranchMaster は (bankCode, branchCode) UNIQUE → skipDuplicates で再実行安全。
//  - PostalCodeMaster は cuid PK のため skipDuplicates が効かない → 既存件数 > 0 なら投入をスキップ（二重投入防止）。
//
// モード: --dry-run（件数集計のみ・既定） / --execute（本投入）。

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DATA_DIR = join(process.cwd(), "prisma", "seeds", "data");
const CHUNK = 2000;

/** TSV を読み込み、ヘッダ1行を除いた各行をタブ分割（先頭 n-1 列＋残りを最終列にまとめる）。 */
function parseTsv(file: string, columns: number): string[][] {
  const text = readFileSync(join(DATA_DIR, file), "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  // 1行目はヘッダ
  return lines.slice(1).map((line) => {
    const parts = line.split("\t");
    if (parts.length <= columns) return parts;
    // 最終列に余分なタブが含まれる場合は結合（住所等の保険）
    return [...parts.slice(0, columns - 1), parts.slice(columns - 1).join("\t")];
  });
}

async function insertChunked<T>(
  label: string,
  items: T[],
  insert: (batch: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK);
    const res = await insert(batch);
    inserted += res.count;
    console.log(`  [${label}] ${Math.min(i + CHUNK, items.length)}/${items.length} 処理（累計 created=${inserted}）`);
  }
  return inserted;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`=== T-097 マスタ投入（${mode}）===`);

  // --- パース ---
  const bankRows = parseTsv("banks.tsv", 2).map(([code, name]) => ({ code, name }));
  const branchRows = parseTsv("branches.tsv", 3).map(([bankCode, branchCode, name]) => ({
    bankCode,
    branchCode,
    name,
  }));
  // 郵便番号: 同一番号内の出現順を sortOrder に保持
  const postalSeq = new Map<string, number>();
  const postalRows = parseTsv("postal_codes.tsv", 2).map(([postalCode, address]) => {
    const n = postalSeq.get(postalCode) ?? 0;
    postalSeq.set(postalCode, n + 1);
    return { postalCode, address, sortOrder: n };
  });

  console.log(`TSV件数: banks=${bankRows.length} / branches=${branchRows.length} / postal=${postalRows.length}`);

  // 既存件数
  const [bankCount, branchCount, postalCount] = await Promise.all([
    prisma.bankMaster.count(),
    prisma.branchMaster.count(),
    prisma.postalCodeMaster.count(),
  ]);
  console.log(`既存DB件数: banks=${bankCount} / branches=${branchCount} / postal=${postalCount}`);

  if (!execute) {
    console.log("DRY-RUN のため書き込みはしません。--execute で本投入します。");
    return;
  }

  // --- 投入 ---
  console.log("[1/3] BankMaster 投入...");
  await insertChunked("bank", bankRows, (batch) =>
    prisma.bankMaster.createMany({ data: batch, skipDuplicates: true }),
  );

  console.log("[2/3] BranchMaster 投入...");
  await insertChunked("branch", branchRows, (batch) =>
    prisma.branchMaster.createMany({ data: batch, skipDuplicates: true }),
  );

  console.log("[3/3] PostalCodeMaster 投入...");
  if (postalCount > 0) {
    console.log(`  既に ${postalCount} 件存在するためスキップ（二重投入防止）。再投入する場合は事前に手動削除してください。`);
  } else {
    await insertChunked("postal", postalRows, (batch) =>
      prisma.postalCodeMaster.createMany({ data: batch, skipDuplicates: true }),
    );
  }

  // --- 最終件数 ---
  const [b2, br2, p2] = await Promise.all([
    prisma.bankMaster.count(),
    prisma.branchMaster.count(),
    prisma.postalCodeMaster.count(),
  ]);
  console.log(`=== 完了。最終DB件数: banks=${b2} / branches=${br2} / postal=${p2} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
