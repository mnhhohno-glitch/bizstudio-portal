-- T-193: マイナビ一次返信メール（portal 送信）の送信済み記録を Candidate に追加。
-- 追加系のみ・冪等（IF NOT EXISTS）。既存レコードの書き換えは一切しない。
-- staging/production は同一 Postgres のため、破壊的変更は禁止。
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "mynavi_first_reply_mail_sent_at" TIMESTAMP(3);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "mynavi_first_reply_mail_message_id" TEXT;
