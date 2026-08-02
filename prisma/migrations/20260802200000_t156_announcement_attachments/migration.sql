-- T-156: お知らせの添付資料（操作ガイドPDF等）の受け皿。
--
-- 新規テーブル追加のみ（DDLのみ・DMLなし）。既存テーブル・カラムへの変更は一切行わない。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
-- 適用は Railway build の `prisma migrate deploy` に任せる（手動実行しない・二重適用しない）。
--
-- announcement_attachments.file_name     : 表示名（アップロード時の元ファイル名）。
-- announcement_attachments.drive_file_id : Google Drive のファイルID。公開権限は付与しない。
--   閲覧は /api/announcements/[id]/attachments/[attachmentId]/view のセッション認証付き
--   ストリーミング経由のみ（driveViewUrl は保持しない設計）。
-- announcement_attachments.sort_order    : 同一お知らせ内の表示順（既存最大値+1で採番）。

SET lock_timeout = '5s';

CREATE TABLE "announcement_attachments" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "drive_file_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_attachments_announcement_id_idx"
    ON "announcement_attachments"("announcement_id");

ALTER TABLE "announcement_attachments"
    ADD CONSTRAINT "announcement_attachments_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_attachments"
    ADD CONSTRAINT "announcement_attachments_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
