-- T-128 Phase2-1: job-platform 経由求人の元媒体（"hito_link" 等）を保持するカラムを追加。
-- HistoryTab のエントリー化で jobDb/externalJobNo を正値化するために使用。
-- 非破壊（ADD COLUMN nullable のみ・既存データの UPDATE/backfill なし）。
-- 既存レコードへの sourceMedia 投入は本マイグレーション適用後に別途スクリプトで実施する。
SET lock_timeout = '5s';
ALTER TABLE "candidate_files" ADD COLUMN "source_media" TEXT;
