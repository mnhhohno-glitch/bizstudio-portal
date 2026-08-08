-- T-152: 面談ログ（CandidateFile category=MEETING）を「どの面談のものか」記録する紐付けカラム。
--
-- 背景: 解析（analyze-with-intake）は求職者の最新 MEETING txt を無条件に使っており、
-- txt を2件以上持つ求職者では 191/245件（78%）が別面談のログを読んでいた（Phase 1 実測）。
-- 詳細: docs/survey_T-152_T-153_analyze_with_intake.md
--
-- nullable カラムの純粋追加のみ。既存レコードの書き換えは行わない（既存行は NULL のまま＝
-- 従来どおり最新 txt へのフォールバックで解析される）。
-- staging と production は同一 Postgres を共有しているため、staging への適用時点で本番スキーマが変わる。
--
-- 面談が削除されてもファイルは残す（ON DELETE SET NULL）。

SET lock_timeout = '5s';

ALTER TABLE "candidate_files"
  ADD COLUMN "interview_id" TEXT;

ALTER TABLE "candidate_files"
  ADD CONSTRAINT "candidate_files_interview_id_fkey"
  FOREIGN KEY ("interview_id") REFERENCES "interview_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "candidate_files_interview_id_idx" ON "candidate_files"("interview_id");
