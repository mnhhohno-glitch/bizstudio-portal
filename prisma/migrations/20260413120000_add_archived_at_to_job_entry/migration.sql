-- AlterTable
ALTER TABLE "job_entries" ADD COLUMN "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "job_entries_archived_at_idx" ON "job_entries"("archived_at");
