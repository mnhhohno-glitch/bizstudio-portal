-- T-133 FU-13a: CAによる求職者向け表示の上書き（displayOverrides）。
-- 純粋追加（nullable JSONB 1列のみ。既存行は NULL＝上書きなし・挙動不変）。
-- 反映先は「この求職者に見せる表示」だけ。元求人データ（job-platform / kyuujin Job）は非破壊。
-- キー=表示項目名（旧EditJobModal準拠の13項目）、値=上書き文字列。caComment は既存 ca_comment 列で別管理。
SET lock_timeout = '5s';

ALTER TABLE "candidate_files"
  ADD COLUMN "display_overrides" JSONB;
