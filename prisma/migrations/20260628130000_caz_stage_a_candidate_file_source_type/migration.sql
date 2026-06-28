-- 案Z 段階A: CandidateFile に job-platform 求人ブックマーク用の列を追加し、PDF実体列を nullable 化。
-- 非破壊（ADD COLUMN / DROP NOT NULL のみ・既存データの UPDATE/backfill なし）。
ALTER TABLE "candidate_files" ADD COLUMN     "source_type" TEXT,
ADD COLUMN     "external_job_ref" TEXT,
ALTER COLUMN "drive_file_id" DROP NOT NULL,
ALTER COLUMN "drive_view_url" DROP NOT NULL;
