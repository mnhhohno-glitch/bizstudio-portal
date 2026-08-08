-- T-150 Phase 2-1: AIアドバイザー会話からのタスク自動起票の受け皿。
--
-- すべて nullable カラムの純粋追加で、既存レコードの書き換えは行わない（既存タスクは source=NULL のまま）。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
--
-- tasks.source      : 起票元。AI起票時のみ "AI_ADVISOR"。手動・既存タスクは NULL。
-- tasks.source_kind : 種別。"JOB_SEARCH_SEND"（求人検索して送付）/ "FORM_SURVEY"（フォーム送付・回答確認）。
--   ★種別をタイトル前方一致で表現しないためのカラム。既存の createOrUpdateResponseTask
--     （src/lib/mypage-response-sync.ts）は title の startsWith で既存タスクを掴んで update するため、
--     CA が同じ書式で手動作成したタスクを上書きしうる。T-150 は同じ轍を踏まない。
--
-- advisor_chat_messages.suggested_tasks              : 検出したタスク候補（JSON）。
-- advisor_chat_messages.suggested_tasks_dismissed_at : 「今回は不要」で破棄した時刻。

SET lock_timeout = '5s';

ALTER TABLE "tasks"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "source_kind" TEXT;

ALTER TABLE "advisor_chat_messages"
  ADD COLUMN "suggested_tasks" JSONB,
  ADD COLUMN "suggested_tasks_dismissed_at" TIMESTAMP(3);

-- AI起票タスクは「1求職者 × 1種別」で未完了1件まで（確定仕様）。
-- 完了（COMPLETED）すると部分インデックスの対象から外れるため、同じ種別を再起票できる。
-- TaskStatus enum の実値は NOT_STARTED / IN_PROGRESS / COMPLETED（DB の pg_enum で確認済み）。
-- source が NULL の手動タスクは WHERE 句に一致しないため、この制約の影響を一切受けない。
-- ※ Prisma スキーマでは部分ユニークインデックスを表現できないため手書きで追加している。
--    `prisma db pull` を実行してもこの定義は schema.prisma に取り込まれない点に注意。
CREATE UNIQUE INDEX "tasks_ai_advisor_one_open_per_kind"
  ON "tasks" ("candidate_id", "source_kind")
  WHERE "source" = 'AI_ADVISOR' AND "status" <> 'COMPLETED';
