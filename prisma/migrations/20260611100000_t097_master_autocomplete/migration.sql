-- T-097: 銀行・支店・郵便番号マスタ＋郵便番号自動補完。additive・冪等。
-- DROP / NOT NULL 追加（既存列）/ 型変更は一切含まない。

-- 1) employees へ郵便番号カラム追加（nullable）
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "postal_code" TEXT;

-- 2) 金融機関マスタ（コード→銀行名）
CREATE TABLE IF NOT EXISTS "bank_masters" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_masters_pkey" PRIMARY KEY ("code")
);

-- 3) 支店マスタ（金融機関コード+支店コード→支店名）
CREATE TABLE IF NOT EXISTS "branch_masters" (
  "id" TEXT NOT NULL,
  "bank_code" TEXT NOT NULL,
  "branch_code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branch_masters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "branch_masters_bank_code_branch_code_key" ON "branch_masters"("bank_code", "branch_code");
CREATE INDEX IF NOT EXISTS "branch_masters_bank_code_idx" ON "branch_masters"("bank_code");

-- 4) 郵便番号マスタ（郵便番号→住所。同一番号に複数候補あり）
CREATE TABLE IF NOT EXISTS "postal_code_masters" (
  "id" TEXT NOT NULL,
  "postal_code" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "postal_code_masters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "postal_code_masters_postal_code_idx" ON "postal_code_masters"("postal_code");

-- 5) FK: branch_masters.bank_code → bank_masters.code（既存なら追加しない・冪等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branch_masters_bank_code_fkey') THEN
    ALTER TABLE "branch_masters" ADD CONSTRAINT "branch_masters_bank_code_fkey"
      FOREIGN KEY ("bank_code") REFERENCES "bank_masters"("code") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
