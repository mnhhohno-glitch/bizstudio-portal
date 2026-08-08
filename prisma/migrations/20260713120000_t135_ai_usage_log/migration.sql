-- T-135: 全システム共通の AI 費用帳簿（portal / kyuujin / job-platform の全AI呼び出しを記録）
-- 追加のみ。既存テーブルへの変更なし。

CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "system" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "estimated_cost_jpy" DECIMAL(12,6),
    "meta" JSONB,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");
CREATE INDEX "ai_usage_logs_system_created_at_idx" ON "ai_usage_logs"("system", "created_at");
CREATE INDEX "ai_usage_logs_system_endpoint_created_at_idx" ON "ai_usage_logs"("system", "endpoint", "created_at");
