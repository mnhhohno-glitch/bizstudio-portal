-- T-155: AIアドバイザーの「未読ログ取り込み」の受け皿。
--
-- すべて nullable カラムの純粋追加で、既存レコードの書き換えは行わない（DDLのみ・DMLなし）。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
--
-- candidate_files.advisor_ingested_at    : 取り込み日時。NULL=未読（タイムスタンプが既読フラグを兼ねる）。
-- candidates.advisor_log_digest          : 面談ログの累積ダイジェスト（取り込みのたびに統合して上書き）。
-- candidates.advisor_log_digest_updated_at : ダイジェスト更新日時。
--
-- ★advisor_ingested_at に単独インデックスは張らない。未読の絞り込みは常に candidateId 起点で、
--   既存の @@index([candidateId, category, archivedAt]) で候補行が数十件まで絞れるため不要。

SET lock_timeout = '5s';

ALTER TABLE "candidate_files"
  ADD COLUMN "advisor_ingested_at" TIMESTAMP(3);

ALTER TABLE "candidates"
  ADD COLUMN "advisor_log_digest" TEXT,
  ADD COLUMN "advisor_log_digest_updated_at" TIMESTAMP(3);
