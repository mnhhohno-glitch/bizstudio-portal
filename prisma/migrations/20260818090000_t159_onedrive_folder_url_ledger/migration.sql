-- T-159 Phase 3: oneDriveFolderUrl を自動処理が設定したことの台帳。
-- 新規テーブルの追加のみ。既存テーブル・既存カラムには一切触れない（挙動不変）。
--
-- この表に行が無い求職者の oneDriveFolderUrl は「CA が手で貼った値」として扱い、
-- フォルダ移動追随（機能2）は 404 でも書き換えない。
-- CreateTable
CREATE TABLE "onedrive_folder_url_ledger" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "auto_url" TEXT NOT NULL,
    "drive_path" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "move_count" INTEGER NOT NULL DEFAULT 0,
    "last_moved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onedrive_folder_url_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onedrive_folder_url_ledger_candidate_id_key" ON "onedrive_folder_url_ledger"("candidate_id");

-- AddForeignKey
ALTER TABLE "onedrive_folder_url_ledger" ADD CONSTRAINT "onedrive_folder_url_ledger_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
