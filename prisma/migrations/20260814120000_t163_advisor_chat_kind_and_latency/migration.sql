-- T-163: AIアドバイザーチャットの重量化解消
-- 1) advisor_chat_messages.kind: "ANALYSIS"=求人全件分析の産物（チャットAPIの送信窓から除外）。null=通常チャット。
-- 2) advisor_usage_logs.latency_ms / context_build_ms: 所要時間の実測（従来は未計測）。
-- staging と本番が同一 PostgreSQL を共有するため、すべて冪等（IF NOT EXISTS）にする。

ALTER TABLE "advisor_chat_messages" ADD COLUMN IF NOT EXISTS "kind" TEXT;

ALTER TABLE "advisor_usage_logs" ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER;

ALTER TABLE "advisor_usage_logs" ADD COLUMN IF NOT EXISTS "context_build_ms" INTEGER;
