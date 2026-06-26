-- オファー面談 / 面接対策 の Google カレンダー・ToDo 同期用 追跡カラム（純粋追加・nullable）。
ALTER TABLE "job_entries" ADD COLUMN     "offer_meeting_gtask_id" TEXT,
ADD COLUMN     "offer_meeting_gcal_id" TEXT,
ADD COLUMN     "interview_prep_gtask_id" TEXT,
ADD COLUMN     "interview_prep_gcal_id" TEXT;
