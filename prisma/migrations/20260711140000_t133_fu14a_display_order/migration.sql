-- T-133 FU-14a: CAによる求人カードの手動並び順（displayOrder）。
-- 純粋追加（nullable INTEGER 1列のみ。既存行は NULL＝手動順なし・挙動不変）。
-- 候補者×求人行ごとに保持するため、他の求職者の並びには波及しない。
-- 並びは displayOrder ASC（NULL は後続）→ 既存ソート。全行NULLなら従来と完全同一の並び。
SET lock_timeout = '5s';

ALTER TABLE "candidate_files"
  ADD COLUMN "display_order" INTEGER;
