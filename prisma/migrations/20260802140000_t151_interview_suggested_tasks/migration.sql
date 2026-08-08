-- T-151 Phase 2-1: 面談ログ解析から検出したタスク候補の受け皿。
--
-- すべて nullable カラムの純粋追加で、既存レコードの書き換えは行わない（既存面談は NULL のまま）。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
--
-- interview_records.suggested_tasks              : 検出したタスク候補（JSON）。
-- interview_records.suggested_tasks_dismissed_at : 「今回は不要」で破棄した時刻。
--
-- T-150（20260802100000_t150_task_source_and_suggested_tasks）で advisor_chat_messages に
-- 追加した同名2カラムと同型・同用途。起票側の tasks.source / tasks.source_kind と
-- 部分ユニークインデックス（tasks_ai_advisor_one_open_per_kind）は T-150 のものをそのまま共用するため、
-- ここでは一切変更しない。

SET lock_timeout = '5s';

ALTER TABLE "interview_records"
  ADD COLUMN "suggested_tasks" JSONB,
  ADD COLUMN "suggested_tasks_dismissed_at" TIMESTAMP(3);
