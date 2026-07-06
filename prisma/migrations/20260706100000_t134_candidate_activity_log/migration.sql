-- T-134 Phase A: 求職者サイト（/site/）の行動ログ受け皿。
-- additive のみ（新テーブル1本のみ・既存テーブル/カラムに一切触らない・冪等）。
-- fire-and-forget 受信の消失許容・enum非採用（将来種別はアプリ側で追加・migration不要）。
CREATE TABLE IF NOT EXISTS "candidate_activity_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "search_id" TEXT,
    "job_ref" TEXT,
    "nav_source" TEXT,
    "detail" JSONB,
    "page_path" TEXT,
    CONSTRAINT "candidate_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "candidate_activity_logs_created_at_idx" ON "candidate_activity_logs"("created_at");
CREATE INDEX IF NOT EXISTS "candidate_activity_logs_candidate_id_created_at_idx" ON "candidate_activity_logs"("candidate_id", "created_at");
CREATE INDEX IF NOT EXISTS "candidate_activity_logs_candidate_id_event_type_idx" ON "candidate_activity_logs"("candidate_id", "event_type");
CREATE INDEX IF NOT EXISTS "candidate_activity_logs_event_type_created_at_idx" ON "candidate_activity_logs"("event_type", "created_at");
