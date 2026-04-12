-- AlterTable: Add second interview, finance, route, and FM reference columns to job_entries
ALTER TABLE "job_entries" ADD COLUMN "second_interview_date" TIMESTAMP(3);
ALTER TABLE "job_entries" ADD COLUMN "second_interview_time" TEXT;
ALTER TABLE "job_entries" ADD COLUMN "theoretical_income" INTEGER;
ALTER TABLE "job_entries" ADD COLUMN "referral_fee" INTEGER;
ALTER TABLE "job_entries" ADD COLUMN "revenue" INTEGER;
ALTER TABLE "job_entries" ADD COLUMN "gross_profit" INTEGER;
ALTER TABLE "job_entries" ADD COLUMN "route" TEXT;
ALTER TABLE "job_entries" ADD COLUMN "fm_entry_no" TEXT;
