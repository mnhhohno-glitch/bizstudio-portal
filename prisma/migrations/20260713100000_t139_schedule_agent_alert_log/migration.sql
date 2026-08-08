-- T-139 step5: カレンダー連携切れ通知の重複抑止ログ。純粋追加（新規テーブル1つのみ）。
SET lock_timeout = '5s';

CREATE TABLE "schedule_agent_alert_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_agent_alert_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schedule_agent_alert_logs_user_id_date_key"
  ON "schedule_agent_alert_logs"("user_id", "date");

CREATE INDEX "schedule_agent_alert_logs_date_idx"
  ON "schedule_agent_alert_logs"("date");
