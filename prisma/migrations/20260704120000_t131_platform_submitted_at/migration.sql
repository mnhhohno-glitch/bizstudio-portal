-- T-131 step2: 手動アップPDFの job-platform 自動投入（フルデータ化）用のカラム追加。
-- CandidateFile.platform_submitted_at（投入試行時刻・nullable）。
-- 紐付け先は既存 external_job_ref（未使用0件・job-platform の sourceJobId を格納）を流用するため列追加は本1本のみ。
-- 非破壊（ADD COLUMN のみ・既存データの UPDATE/backfill なし）。lock_timeout で長時間ロックを回避。
SET lock_timeout = '5s';
ALTER TABLE "candidate_files" ADD COLUMN "platform_submitted_at" TIMESTAMP(3);
