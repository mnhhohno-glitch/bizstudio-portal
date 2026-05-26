-- T-066: JobEntry に Google カレンダーイベントID 3列追加（一次/二次/最終面接）
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "first_interview_gcal_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "second_interview_gcal_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "final_interview_gcal_id" TEXT;
