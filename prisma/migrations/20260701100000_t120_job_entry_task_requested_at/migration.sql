-- T-120: job_entries に「タスク依頼中」バッジ用カラム（task_requested_at）を追加（additive・nullable・冪等）。
-- タスク作成（エントリー対応依頼）で対象になった行に now() を記録する。
-- バッジは task_requested_at IS NOT NULL かつ entry_flag = 'エントリー' の間だけ表示し、書類選考以降で自動的に消える。
-- ※ 実テーブル名は @@map により "job_entries"（snake_case）。
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "task_requested_at" TIMESTAMP(3);
