-- T-189 修正: 自動配信行の出所（経路・配信条件パターン）を記録する3列。
--   すべて nullable・既存行は NULL のまま（挙動不変）。冪等（IF NOT EXISTS）。
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "auto_source_mode" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "auto_pattern_id" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "auto_pattern_label" TEXT;
