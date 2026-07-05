-- T-133 P1: 箱A（CandidateFile BOOKMARK）単一台帳化の受け皿。
-- 純粋追加（nullable列・新テーブル・一意制約のみ。既存データの UPDATE/backfill なし）。
-- 一意制約の前提: アクティブ重複11ペアは 案A dedup（scripts/dedup-bookmark-kyuujin-t133.ts）で解消済み。
-- PostgreSQL 17 の一意制約は NULLS DISTINCT が既定のため kyuujin_job_id NULL 多数行は衝突しない。
SET lock_timeout = '5s';

-- AlterTable: 7段階仕分け・CA手動◎○△・紹介日時・送信管理・対象外メタ（すべて nullable）
ALTER TABLE "candidate_files"
  ADD COLUMN "response_status" TEXT,
  ADD COLUMN "response_status_updated_at" TIMESTAMP(3),
  ADD COLUMN "response_submitted_at" TIMESTAMP(3),
  ADD COLUMN "ca_match_label" TEXT,
  ADD COLUMN "introduced_at" TIMESTAMP(3),
  ADD COLUMN "excluded_by" TEXT,
  ADD COLUMN "excluded_at" TIMESTAMP(3);

-- CreateIndex: 同一候補者×同一 kyuujin Job の重複行防止
CREATE UNIQUE INDEX "candidate_files_candidate_id_kyuujin_job_id_key" ON "candidate_files"("candidate_id", "kyuujin_job_id");

-- CreateTable: まとめ送信バッチ（箱B FeedbackSubmission 相当）
CREATE TABLE "candidate_response_submissions" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interested_count" INTEGER NOT NULL DEFAULT 0,
    "apply_count" INTEGER NOT NULL DEFAULT 0,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_response_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 送信バッチ×求人行の中間テーブル（送信時点の仕分けスナップショット付き）
CREATE TABLE "candidate_response_submission_items" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "candidate_file_id" TEXT NOT NULL,
    "response_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_response_submission_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_response_submissions_candidate_id_submitted_at_idx" ON "candidate_response_submissions"("candidate_id", "submitted_at");

-- CreateIndex
CREATE INDEX "candidate_response_submission_items_submission_id_idx" ON "candidate_response_submission_items"("submission_id");

-- CreateIndex
CREATE INDEX "candidate_response_submission_items_candidate_file_id_idx" ON "candidate_response_submission_items"("candidate_file_id");

-- AddForeignKey
ALTER TABLE "candidate_response_submissions" ADD CONSTRAINT "candidate_response_submissions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_response_submission_items" ADD CONSTRAINT "candidate_response_submission_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "candidate_response_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_response_submission_items" ADD CONSTRAINT "candidate_response_submission_items_candidate_file_id_fkey" FOREIGN KEY ("candidate_file_id") REFERENCES "candidate_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
