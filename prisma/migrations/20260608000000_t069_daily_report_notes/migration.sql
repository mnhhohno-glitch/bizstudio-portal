-- T-069 日報①：当日スケジュールの気づき・当日数字の振り返りを保存（nullable・冪等）。
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "schedule_note" TEXT;
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "metrics_reflection" TEXT;
