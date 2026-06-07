-- T-073：合計面談に占める初回面談の割合（手入力・nullable・冪等）。
ALTER TABLE "performance_targets" ADD COLUMN IF NOT EXISTS "first_interview_ratio" DOUBLE PRECISION;
