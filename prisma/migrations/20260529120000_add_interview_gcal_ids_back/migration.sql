-- T-066 Phase 5: Google カレンダー予定（イベント）連携を復活。
-- ToDo（Tasks）連携は廃止せず、カレンダー予定とタスクを同時生成する。
-- JobEntry に *gcal_id 3列を再追加（nullable・非破壊）。*gtask_id 3列は維持する。
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "first_interview_gcal_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "second_interview_gcal_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "final_interview_gcal_id" TEXT;
