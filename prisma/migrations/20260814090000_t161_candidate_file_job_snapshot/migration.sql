-- T-161: サイト経由ブックマークの求人スナップショット（求人タイトル・職種）。
-- 既存行は NULL（挙動不変）。nullable 追加のみ。
ALTER TABLE "candidate_files" ADD COLUMN "job_title" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN "job_category" TEXT;
