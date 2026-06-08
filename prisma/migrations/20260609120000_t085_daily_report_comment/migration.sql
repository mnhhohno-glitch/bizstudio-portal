-- T-085：日報コメント（他人の日報への上司/同僚コメント）。additive・冪等。
CREATE TABLE IF NOT EXISTS "daily_report_comments" (
  "id" TEXT NOT NULL,
  "daily_report_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_report_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "daily_report_comments_daily_report_id_idx" ON "daily_report_comments"("daily_report_id");
CREATE INDEX IF NOT EXISTS "daily_report_comments_user_id_idx" ON "daily_report_comments"("user_id");

-- FK（既存なら追加しない・冪等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_report_comments_daily_report_id_fkey') THEN
    ALTER TABLE "daily_report_comments" ADD CONSTRAINT "daily_report_comments_daily_report_id_fkey"
      FOREIGN KEY ("daily_report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_report_comments_user_id_fkey') THEN
    ALTER TABLE "daily_report_comments" ADD CONSTRAINT "daily_report_comments_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
