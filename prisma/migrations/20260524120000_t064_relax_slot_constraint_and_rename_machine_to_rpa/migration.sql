-- T-064 一斉配信入力UI対応:
--   1) 既存ユニーク制約を緩和（大中フラグの組み合わせで複数レコード可）
--   2) 既存データ "機械" → "RPA" に書き換え

-- Step 1: 既存のユニーク INDEX を削除
DROP INDEX IF EXISTS "scout_delivery_slots_delivery_date_hour_slot_machine_id_key";

-- Step 2: 新しいユニーク INDEX を作成
CREATE UNIQUE INDEX IF NOT EXISTS "scout_slot_unique_per_category"
  ON "scout_delivery_slots"(
    "delivery_date",
    "hour_slot",
    "machine_id",
    "delivery_category_large",
    "delivery_category_medium"
  );

-- Step 3: 既存データの大フラグ書き換え "機械" → "RPA"
UPDATE "scout_delivery_slots"
SET "delivery_category_large" = 'RPA'
WHERE "delivery_category_large" = '機械';
