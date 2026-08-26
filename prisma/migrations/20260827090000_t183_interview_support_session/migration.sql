-- T-183 Phase 2: 面談サポート（文字起こし+AI解説）のセッション保存テーブル。
-- additive のみ（既存テーブル・カラムに一切触らない）。

-- CreateTable
CREATE TABLE "interview_support_sessions" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "transcript" JSONB NOT NULL,
    "explanations" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_support_sessions_interview_record_id_idx" ON "interview_support_sessions"("interview_record_id");

-- AddForeignKey
ALTER TABLE "interview_support_sessions" ADD CONSTRAINT "interview_support_sessions_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_support_sessions" ADD CONSTRAINT "interview_support_sessions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
