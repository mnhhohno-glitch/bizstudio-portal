-- T-189 Phase1: おすすめ求人（自動引き当て・配信）の土台
-- 既存レコードは全て NULL / false のまま（既存データの書き換えは行わない）。

-- AlterTable: 自動引き当て由来の承認管理（却下・期限切れでも archivedAt は使わない）
ALTER TABLE "candidate_files" ADD COLUMN     "auto_sourced_at" TIMESTAMP(3);
ALTER TABLE "candidate_files" ADD COLUMN     "approval_status" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN     "rejected_reason" TEXT;

-- AlterTable: おすすめ配信 ON/OFF（既定OFF）
ALTER TABLE "candidates" ADD COLUMN     "auto_recommend_enabled" BOOLEAN NOT NULL DEFAULT false;
