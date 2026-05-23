-- desired_prefecture を desired_prefecture1 にリネーム
-- 既存データを保持するため RENAME を使用（DO ブロックで既存カラム名を判定）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidates' AND column_name = 'desired_prefecture'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'candidates' AND column_name = 'desired_prefecture1'
  ) THEN
    ALTER TABLE "candidates" RENAME COLUMN "desired_prefecture" TO "desired_prefecture1";
  END IF;
END $$;

-- 新規カラムを追加（既存環境への安全な再適用のため IF NOT EXISTS）
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_prefecture1" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_industry2" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "desired_prefecture2" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "scout_number" TEXT;
