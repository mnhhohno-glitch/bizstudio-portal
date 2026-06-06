-- T-073: 目標登録に「紹介の1人あたり件数」係数を追加（nullable・冪等）。
-- 既存行は NULL（未設定）。紹介件数＝introduction_count × proposal_per_person で算出。
ALTER TABLE "performance_targets" ADD COLUMN IF NOT EXISTS "proposal_per_person" DOUBLE PRECISION;
