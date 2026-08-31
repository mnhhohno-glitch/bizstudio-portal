-- T-159 Phase 2-b: コピー処理の差し込みに伴う enum 追加と再試行制御列。
-- enum への値追加と nullable 列の追加のみ。既存行の書き換え・既存列の型変更は一切ない（挙動不変）。
--
--   BAD_FOLDER_URL : oneDriveFolderUrl はあるが復元不能／許可プレフィックス外。
--                    NO_FOLDER_URL（未登録）と分けるのは、CAに求める行動が「登録」と「貼り直し」で違うため。
--   GIVEN_UP       : 再試行上限に達して諦めた状態。使うのは Phase 2-c の夜間処理。
--   next_retry_at  : 次に再試行してよい日時（指数バックオフ）。同上。
--                    後追いマイグレーションを避けるため、使う前に列だけ置く。

-- AlterEnum
ALTER TYPE "OneDriveSyncSkipReason" ADD VALUE 'BAD_FOLDER_URL';

-- AlterEnum
ALTER TYPE "OneDriveSyncStatus" ADD VALUE 'GIVEN_UP';

-- AlterTable
ALTER TABLE "onedrive_sync_logs" ADD COLUMN     "next_retry_at" TIMESTAMP(3);
