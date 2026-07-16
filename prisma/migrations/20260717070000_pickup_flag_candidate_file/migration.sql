-- ピックアップ機能: CAがマイページプレビューで求人を「先頭固定」する旗。
-- 純粋追加（nullable TIMESTAMP 1列のみ。既存行は NULL＝非ピックアップ・挙動不変）。
-- 上限3件／求職者は API 層で判定（partial unique index では 3件上限を表現不能）。
-- 順序保持のため boolean でなく timestamp（先に選んだ順で先頭側に並べる）。
SET lock_timeout = '5s';

ALTER TABLE "candidate_files"
  ADD COLUMN "picked_up_at" TIMESTAMP(3);
