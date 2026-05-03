-- AlterTable
ALTER TABLE "candidate_files" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "candidate_files" ADD COLUMN "archived_reason" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN "archived_note" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN "archived_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "candidate_files" ADD CONSTRAINT "candidate_files_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "candidate_files_candidate_id_category_archived_at_idx" ON "candidate_files"("candidate_id", "category", "archived_at");
