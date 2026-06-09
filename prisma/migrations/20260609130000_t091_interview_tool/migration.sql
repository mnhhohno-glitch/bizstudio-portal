-- T-091: 段階別の面接方法（オンライン/対面/電話）。nullable・後方互換。
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "first_interview_tool" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "second_interview_tool" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "final_interview_tool" TEXT;
