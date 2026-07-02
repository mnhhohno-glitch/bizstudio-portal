-- T-128 batch4: お気に入りメモ（求職者本人）・CAアドバイザーコメント用の列を candidate_files に追加。
-- additive のみ（ADD COLUMN IF NOT EXISTS・既存行/既存列 memo に一切触れない）。nullable・DEFAULT なし・backfill なし。
--
-- 安全弁: ALTER TABLE は一瞬の ACCESS EXCLUSIVE を要する。長時間クエリがロックを保持していた場合に
-- ロック待ちキューで後続クエリを詰まらせないよう、5秒で諦めて失敗させる（冪等なので再実行可）。
SET lock_timeout = '5s';

ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "candidate_note" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "ca_comment" TEXT;
