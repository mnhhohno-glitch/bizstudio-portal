-- T-099: job_entries に仕入れ値カラム（cost）を追加（additive・nullable・冪等）。
-- 粗利は保存せず revenue - COALESCE(cost,0) で表示/集計時に計算する。
-- ※ 実テーブル名は @@map により "job_entries"（snake_case）。
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "cost" INTEGER;
