-- AlterTable
ALTER TABLE "jimu_sessions" ADD COLUMN     "candidate_id" TEXT;

-- AddForeignKey
ALTER TABLE "jimu_sessions" ADD CONSTRAINT "jimu_sessions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
