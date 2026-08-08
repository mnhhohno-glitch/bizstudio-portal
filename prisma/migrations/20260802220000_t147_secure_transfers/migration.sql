-- T-147: セキュアファイル送信（ZIPパスワード運用の置き換え）の受け皿。
--
-- 新規テーブル追加のみ（DDLのみ・DMLなし）。既存テーブル・カラムへの変更は一切行わない。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
-- 適用は Railway build の `prisma migrate deploy` に任せる（手動実行しない・二重適用しない）。
--
-- secure_transfers.password_hash   : bcrypt。平文パスワードはDBに持たない（発行時に一度だけ画面表示）。
-- secure_transfers.failed_attempts : パスワード照合失敗回数。10回で revoked_at を自動セット＋送信者へ通知。
-- secure_transfers.candidate_id    : 第1弾では常に NULL。FKは張らない（将来の求職者詳細導線用の受け皿のみ）。
-- secure_transfer_files.storage_path : Supabase 非公開バケット secure-transfers 内のパス
--   （transfers/<uuid>.<ext>・元ファイル名はパスに入れない）。UNIQUE で他送信との実体共有を防ぐ。
-- secure_transfer_files.deleted_at : cleanup cron が Storage 実体を消した時刻。行は証跡として残す。
-- secure_transfer_downloads       : ダウンロード履歴（日時・IP・UserAgent）。file_id NULL は一括DL用の予約。

SET lock_timeout = '5s';

CREATE TABLE "secure_transfers" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT,
    "password_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "candidate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secure_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "secure_transfers_token_key" ON "secure_transfers"("token");

CREATE INDEX "secure_transfers_sender_id_created_at_idx"
    ON "secure_transfers"("sender_id", "created_at");

CREATE INDEX "secure_transfers_expires_at_idx" ON "secure_transfers"("expires_at");

ALTER TABLE "secure_transfers"
    ADD CONSTRAINT "secure_transfers_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "secure_transfer_files" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secure_transfer_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "secure_transfer_files_storage_path_key"
    ON "secure_transfer_files"("storage_path");

CREATE INDEX "secure_transfer_files_transfer_id_idx"
    ON "secure_transfer_files"("transfer_id");

ALTER TABLE "secure_transfer_files"
    ADD CONSTRAINT "secure_transfer_files_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "secure_transfers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "secure_transfer_downloads" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "file_id" TEXT,
    "downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "secure_transfer_downloads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "secure_transfer_downloads_transfer_id_downloaded_at_idx"
    ON "secure_transfer_downloads"("transfer_id", "downloaded_at");

ALTER TABLE "secure_transfer_downloads"
    ADD CONSTRAINT "secure_transfer_downloads_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "secure_transfers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "secure_transfer_downloads"
    ADD CONSTRAINT "secure_transfer_downloads_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "secure_transfer_files"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
