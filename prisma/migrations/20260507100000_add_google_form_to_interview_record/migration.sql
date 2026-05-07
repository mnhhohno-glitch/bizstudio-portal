-- AlterTable: T-029 Phase D-2: Google Form 自動生成カラム追加
ALTER TABLE "interview_records" ADD COLUMN "google_form_id" TEXT;
ALTER TABLE "interview_records" ADD COLUMN "google_form_edit_url" TEXT;
ALTER TABLE "interview_records" ADD COLUMN "google_form_view_url" TEXT;
ALTER TABLE "interview_records" ADD COLUMN "google_form_created_at" TIMESTAMP(3);
ALTER TABLE "interview_records" ADD COLUMN "google_form_status" TEXT;
ALTER TABLE "interview_records" ADD COLUMN "google_form_error" TEXT;
