-- T-147 改修: 宛先ごとの個別送信をやめ、TO/CC を含む1通送信へ変更する。
-- recipient_email には TO のアドレスをカンマ区切りで格納し、CC は新規列 cc_emails に入れる。
-- 既存列の型・NOT NULL 制約は変更しない（過去レコードは recipient_email に単一アドレス・cc_emails は NULL のまま）。
ALTER TABLE "secure_transfers" ADD COLUMN "cc_emails" TEXT;
