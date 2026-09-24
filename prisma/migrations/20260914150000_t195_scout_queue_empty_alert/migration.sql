-- T-195: スカウト配信条件 RPA連携（予約切れタスクの重複防止・通知抑止）
-- 追加系のみ・冪等。rpa_scout_machines に nullable 列を2つ足すだけで既存レコードは書き換えない。
ALTER TABLE "rpa_scout_machines" ADD COLUMN IF NOT EXISTS "queue_empty_task_id" TEXT;
ALTER TABLE "rpa_scout_machines" ADD COLUMN IF NOT EXISTS "queue_empty_notified_at" TIMESTAMP(3);
