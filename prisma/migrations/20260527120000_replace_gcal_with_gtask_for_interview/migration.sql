-- T-066 Phase 4: Google カレンダー連携を Google Tasks 連携に置換
-- JobEntry の *gcal_id 3列を drop し、*gtask_id 3列を追加する。
-- 既存の gcal_id 値（カレンダーイベントID）は破棄される。対応するカレンダーイベントは
-- 運用上手動で削除済み or 削除予定。

ALTER TABLE "job_entries" DROP COLUMN IF EXISTS "first_interview_gcal_id";
ALTER TABLE "job_entries" DROP COLUMN IF EXISTS "second_interview_gcal_id";
ALTER TABLE "job_entries" DROP COLUMN IF EXISTS "final_interview_gcal_id";

ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "first_interview_gtask_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "second_interview_gtask_id" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "final_interview_gtask_id" TEXT;
