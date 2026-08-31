-- T-159 Phase 2-a: portal → OneDrive 一方向コピーの記録テーブル。
-- 新規テーブルと enum の追加のみ。既存テーブル・既存カラムには一切触れない（挙動不変）。
-- CreateEnum
CREATE TYPE "OneDriveSyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "OneDriveSyncSkipReason" AS ENUM ('NO_FOLDER_URL', 'NO_SUBFOLDER', 'NAME_ALREADY_EXISTS', 'SYNC_DISABLED', 'UNSUPPORTED_CATEGORY', 'NO_FILE_BODY', 'AUTH_ERROR', 'RATE_LIMITED', 'GRAPH_ERROR');

-- CreateTable
CREATE TABLE "onedrive_sync_logs" (
    "id" TEXT NOT NULL,
    "candidate_file_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" "OneDriveSyncStatus" NOT NULL DEFAULT 'PENDING',
    "skip_reason" "OneDriveSyncSkipReason",
    "target_path" TEXT,
    "target_item_id" TEXT,
    "sibling_folders" TEXT[],
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempted_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onedrive_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onedrive_sync_logs_candidate_file_id_key" ON "onedrive_sync_logs"("candidate_file_id");

-- CreateIndex
CREATE INDEX "onedrive_sync_logs_status_idx" ON "onedrive_sync_logs"("status");

-- CreateIndex
CREATE INDEX "onedrive_sync_logs_candidate_id_idx" ON "onedrive_sync_logs"("candidate_id");

-- AddForeignKey
ALTER TABLE "onedrive_sync_logs" ADD CONSTRAINT "onedrive_sync_logs_candidate_file_id_fkey" FOREIGN KEY ("candidate_file_id") REFERENCES "candidate_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onedrive_sync_logs" ADD CONSTRAINT "onedrive_sync_logs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

