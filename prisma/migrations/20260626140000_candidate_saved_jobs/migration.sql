-- 求職者ブックマーク連携 段階1: job-platform 保存求人テーブル。
-- 純粋追加（新規テーブルのみ・既存テーブル/カラム/データ非変更＝非破壊）。

-- CreateTable
CREATE TABLE "candidate_saved_jobs" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'job-platform',
    "external_job_ref" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "company_name" TEXT,
    "job_url" TEXT,
    "salary_text" TEXT,
    "note" TEXT,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_saved_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_saved_jobs_candidate_id_idx" ON "candidate_saved_jobs"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_saved_jobs_candidate_id_source_external_job_ref_key" ON "candidate_saved_jobs"("candidate_id", "source", "external_job_ref");

-- AddForeignKey
ALTER TABLE "candidate_saved_jobs" ADD CONSTRAINT "candidate_saved_jobs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
