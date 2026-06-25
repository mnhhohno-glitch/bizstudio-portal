-- T-111: 次回連絡予定（Candidate 直持ち）＋ 連絡記録（ContactLog）。純粋追加。

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('TEL', 'MESSAGE');

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "next_contact_at" TIMESTAMP(3),
ADD COLUMN     "next_contact_purpose" TEXT,
ADD COLUMN     "next_contact_note" TEXT;

-- CreateTable
CREATE TABLE "contact_logs" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "method" "ContactMethod" NOT NULL,
    "content" TEXT NOT NULL,
    "contacted_at" TIMESTAMP(3) NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_logs_candidate_id_idx" ON "contact_logs"("candidate_id");

-- CreateIndex
CREATE INDEX "contact_logs_contacted_at_idx" ON "contact_logs"("contacted_at");

-- AddForeignKey
ALTER TABLE "contact_logs" ADD CONSTRAINT "contact_logs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_logs" ADD CONSTRAINT "contact_logs_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
