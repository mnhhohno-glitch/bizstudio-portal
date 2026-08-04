-- T-147 改修: 複数宛先対応（batch_id）と期限切れ予告通知（expiry_notified_at）
-- 既存列の変更・削除なし。nullable な新規列の追加とインデックス追加のみ。
ALTER TABLE "secure_transfers" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "secure_transfers" ADD COLUMN "expiry_notified_at" TIMESTAMP(3);

CREATE INDEX "secure_transfers_batch_id_idx" ON "secure_transfers"("batch_id");
