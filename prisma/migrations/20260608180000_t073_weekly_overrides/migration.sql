-- T-073 PhaseC：週按分の手動調整値（初回/既存面談の週値）を保存（JSONB・nullable・冪等）。
ALTER TABLE "performance_targets" ADD COLUMN IF NOT EXISTS "weekly_overrides" JSONB;
