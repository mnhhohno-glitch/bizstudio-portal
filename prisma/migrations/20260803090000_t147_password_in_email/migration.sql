-- T-147 Phase 3: パスワード送付方式の選択制（メール記載 / 別途連絡）
-- 既存列の変更・削除なし。既定値付きの新規列追加のみ。
ALTER TABLE "secure_transfers" ADD COLUMN "password_in_email" BOOLEAN NOT NULL DEFAULT true;
