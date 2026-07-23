-- T-135 実装1: Gemini thinking tokens（thoughtsTokenCount）を記録する列を追加。
-- 追加のみ・nullable。既存レコードは記録経路が無く NULL（＝過去分の記録不可＝バックフィル対象外）。
-- thinking tokens は Gemini 公式で「出力トークンと同一単価」として課金される
-- （2026-07-23 https://ai.google.dev/gemini-api/docs/pricing で "Output price (including thinking tokens)" と明記を確認）。
-- src/lib/ai-pricing.ts で estimatedCostJpy に output 単価で加算する。

ALTER TABLE "ai_usage_logs" ADD COLUMN "thinking_tokens" INTEGER;
