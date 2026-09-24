-- T-196: スカウト配信条件の「エリア」を居住地として扱い直し、希望勤務地を別に持つ。
-- T-194/195 で「希望勤務地」として作った area_mode / prefectures は実際には居住地の条件だったため、
-- データを消さずに RENAME COLUMN で居住地列にし、希望勤務地の列を新たに足す。
-- 既存レコードの希望勤務地は有効エリア8都府県（東京・埼玉・神奈川・千葉・愛知・大阪・兵庫・京都）で埋める。
-- 冪等（再実行しても壊れない）。

-- 1. 居住地へのリネーム（データ保持）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scout_conditions' AND column_name = 'area_mode') THEN
    ALTER TABLE "scout_conditions" RENAME COLUMN "area_mode" TO "residence_mode";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scout_conditions' AND column_name = 'prefectures') THEN
    ALTER TABLE "scout_conditions" RENAME COLUMN "prefectures" TO "residence_prefectures";
  END IF;
END $$;

-- 2. 希望勤務地の指定方法 enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScoutWorkPrefMode') THEN
    CREATE TYPE "ScoutWorkPrefMode" AS ENUM ('ALL', 'SELECTED');
  END IF;
END $$;

-- 3. 希望勤務地の列追加（nullable・既定 SELECTED）
ALTER TABLE "scout_conditions" ADD COLUMN IF NOT EXISTS "work_pref_mode" "ScoutWorkPrefMode" DEFAULT 'SELECTED';
ALTER TABLE "scout_conditions" ADD COLUMN IF NOT EXISTS "work_prefectures" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 4. 既存レコードを有効エリア8都府県で埋める（都道府県名は src/lib/rpa-scout/area.ts の ALL_PREFECTURES と同じ短縮表記・定義順）
UPDATE "scout_conditions"
SET "work_pref_mode" = 'SELECTED',
    "work_prefectures" = ARRAY['埼玉', '千葉', '東京', '神奈川', '愛知', '京都', '大阪', '兵庫']::TEXT[]
WHERE "work_pref_mode" IS NULL OR "work_prefectures" IS NULL OR cardinality("work_prefectures") = 0;
