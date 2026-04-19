-- AlterTable: InterviewRecord に Phase 3 フィールド追加
ALTER TABLE "interview_records" ADD COLUMN     "ai_analysis_at" TIMESTAMP(3),
ADD COLUMN     "ai_analysis_result" JSONB,
ADD COLUMN     "autosave_token" TEXT,
ADD COLUMN     "is_latest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_edited_by" TEXT,
ADD COLUMN     "last_saved_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE "interview_memos" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_attachments" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT,
    "analysis_status" TEXT NOT NULL DEFAULT 'pending',
    "analysis_result" JSONB,
    "analysis_error" TEXT,
    "analyzed_at" TIMESTAMP(3),
    "memo" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,

    CONSTRAINT "interview_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_memos" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_memos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_memos_interview_record_id_idx" ON "interview_memos"("interview_record_id");

-- CreateIndex
CREATE INDEX "interview_attachments_interview_record_id_idx" ON "interview_attachments"("interview_record_id");

-- CreateIndex
CREATE INDEX "interview_attachments_analysis_status_idx" ON "interview_attachments"("analysis_status");

-- CreateIndex
CREATE INDEX "candidate_memos_candidate_id_idx" ON "candidate_memos"("candidate_id");

-- CreateIndex
CREATE INDEX "interview_records_is_latest_idx" ON "interview_records"("is_latest");

-- AddForeignKey
ALTER TABLE "interview_memos" ADD CONSTRAINT "interview_memos_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_attachments" ADD CONSTRAINT "interview_attachments_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_memos" ADD CONSTRAINT "candidate_memos_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
