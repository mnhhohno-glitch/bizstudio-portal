-- T-100: job_entries に求人DB費カラム（job_db_cost）を追加（additive・nullable・冪等）。
-- 粗利は保存せず revenue - COALESCE(job_db_cost,0) - COALESCE(cost,0) で表示/集計時に計算する。
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "job_db_cost" INTEGER;
