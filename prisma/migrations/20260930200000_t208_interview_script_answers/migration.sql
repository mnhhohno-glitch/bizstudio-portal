-- T-208 step2: 初回面談の台本モードの答え（面談1件に1行）。追加のみ。
-- prisma migrate diff の出力を IF NOT EXISTS で冪等化したもの。

-- CreateTable
CREATE TABLE IF NOT EXISTS "interview_script_answers" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "applied" JSONB NOT NULL,
    "script_version" TEXT NOT NULL,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_script_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "interview_script_answers_interview_record_id_key" ON "interview_script_answers"("interview_record_id");

-- AddForeignKey（既に在れば何もしない）
DO $$ BEGIN
  ALTER TABLE "interview_script_answers" ADD CONSTRAINT "interview_script_answers_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "interview_script_answers" ADD CONSTRAINT "interview_script_answers_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
