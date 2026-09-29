-- T-205: 面談準備チャット（マイナビレジュメの整理＋会話の蓄積）。追加のみ・既存テーブルは変更しない。
-- prisma migrate diff の出力を IF NOT EXISTS で冪等化したもの。

-- CreateTable
CREATE TABLE IF NOT EXISTS "interview_prep_rooms" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "resume_file_id" TEXT,
    "resume_text" TEXT,
    "resume_imported_at" TIMESTAMP(3),
    "resume_extracted_at" TIMESTAMP(3),
    "career_type" TEXT,
    "summary_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_prep_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "interview_prep_messages" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "user_id" TEXT,
    "content" TEXT NOT NULL,
    "kind" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_prep_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "interview_prep_rooms_candidate_id_archived_at_idx" ON "interview_prep_rooms"("candidate_id", "archived_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "interview_prep_messages_room_id_created_at_idx" ON "interview_prep_messages"("room_id", "created_at");

-- AddForeignKey（制約は IF NOT EXISTS が使えないため DO ブロックで存在確認）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_prep_rooms_candidate_id_fkey') THEN
    ALTER TABLE "interview_prep_rooms" ADD CONSTRAINT "interview_prep_rooms_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_prep_rooms_created_by_user_id_fkey') THEN
    ALTER TABLE "interview_prep_rooms" ADD CONSTRAINT "interview_prep_rooms_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_prep_rooms_resume_file_id_fkey') THEN
    ALTER TABLE "interview_prep_rooms" ADD CONSTRAINT "interview_prep_rooms_resume_file_id_fkey" FOREIGN KEY ("resume_file_id") REFERENCES "candidate_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_prep_messages_room_id_fkey') THEN
    ALTER TABLE "interview_prep_messages" ADD CONSTRAINT "interview_prep_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "interview_prep_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interview_prep_messages_user_id_fkey') THEN
    ALTER TABLE "interview_prep_messages" ADD CONSTRAINT "interview_prep_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
