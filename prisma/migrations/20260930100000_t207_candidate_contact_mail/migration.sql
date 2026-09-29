-- T-207: 求職者向け案内メール（LINE登録案内・あいさつメール）。追加のみ。
-- prisma migrate diff の出力を IF NOT EXISTS で冪等化したもの（既存の scout_* の DROP DEFAULT 差分は無関係のため含めない）。

-- CreateEnum（既に在れば何もしない）
DO $$ BEGIN
  CREATE TYPE "CandidateContactMailType" AS ENUM ('LINE_GUIDE', 'GREETING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: 社員の LINE WORKS 友だち追加URL（nullable）
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "line_works_url" TEXT;

-- CreateTable: 送信記録
CREATE TABLE IF NOT EXISTS "candidate_contact_mail_logs" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "type" "CandidateContactMailType" NOT NULL,
    "sent_by_user_id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_contact_mail_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "candidate_contact_mail_logs_candidate_id_type_sent_at_idx" ON "candidate_contact_mail_logs"("candidate_id", "type", "sent_at");

-- AddForeignKey（既に在れば何もしない）
DO $$ BEGIN
  ALTER TABLE "candidate_contact_mail_logs" ADD CONSTRAINT "candidate_contact_mail_logs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "candidate_contact_mail_logs" ADD CONSTRAINT "candidate_contact_mail_logs_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
