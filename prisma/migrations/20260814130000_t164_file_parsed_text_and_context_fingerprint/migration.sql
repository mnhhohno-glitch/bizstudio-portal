-- T-164: AIアドバイザーの待ち時間解消＋評価の鮮度確保
-- 1) candidate_files.parsed_text / parsed_at / parse_failed_at:
--    ファイル本体から抽出したテキストの永続キャッシュ（advisor-context 用・extractedText とは別系統）。
--    parse_failed_at は「失敗を永久キャッシュしない」ための記録（parsed_text が無ければ次回再試行）。
-- 2) advisor_chat_sessions.context_fingerprint:
--    context の材料が変わったかを判定する指紋（時間TTLから中身判定への変更）。
-- staging と本番が同一 PostgreSQL を共有するため、すべて冪等（IF NOT EXISTS）にする。

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parsed_text" TEXT;

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parsed_at" TIMESTAMP(3);

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "parse_failed_at" TIMESTAMP(3);

ALTER TABLE "advisor_chat_sessions" ADD COLUMN IF NOT EXISTS "context_fingerprint" TEXT;
