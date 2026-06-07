-- T-069②：日報コメントを統合本文＋確定フラグに（nullable・冪等）。
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "report_body" TEXT;
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "comment_confirmed_at" TIMESTAMP(3);
