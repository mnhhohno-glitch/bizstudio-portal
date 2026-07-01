-- T-126 Phase1: AIアドバイザー系 API の usage/コストを永続化する新規テーブル。
-- additive のみ（既存テーブル・カラムに一切触らない・冪等）。
-- Railway ログはデプロイ単位で消えるため、長期コスト追跡と無駄コール可視化の唯一の記録。
CREATE TABLE IF NOT EXISTS "advisor_usage_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT NOT NULL,
    "candidate_id" TEXT,
    "batch_index" INTEGER,
    "batch_total" INTEGER,
    "file_count" INTEGER,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "is_retry" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    CONSTRAINT "advisor_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "advisor_usage_logs_created_at_idx" ON "advisor_usage_logs"("created_at");
CREATE INDEX IF NOT EXISTS "advisor_usage_logs_endpoint_idx" ON "advisor_usage_logs"("endpoint");
CREATE INDEX IF NOT EXISTS "advisor_usage_logs_candidate_id_idx" ON "advisor_usage_logs"("candidate_id");
