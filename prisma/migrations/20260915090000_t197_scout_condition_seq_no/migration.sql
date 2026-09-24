-- T-197: スカウト配信条件に号機ごとの通し番号（seq_no）を持たせる。表示は「1-001」（号機番号-3桁ゼロ埋め）。
-- 既存レコードは号機ごとに created_at の古い順（同時刻は id 順）で 1 から採番する。
-- 一度振った番号は変更しない（削除しても欠番のまま）。同一号機内の重複はユニーク制約で防ぐ。
-- 列は nullable（旧コードが動いている数分間の INSERT を壊さないため。null 行はアプリ側が一覧取得時に補う）。
-- 冪等（再実行しても壊れない）。

ALTER TABLE "scout_conditions" ADD COLUMN IF NOT EXISTS "seq_no" INTEGER;

-- 既存レコードの採番（seq_no が未設定の行だけ。既に番号を持つ行の後ろに続ける）
WITH numbered AS (
  SELECT c.id,
         COALESCE((SELECT MAX(x.seq_no) FROM "scout_conditions" x WHERE x.machine_id = c.machine_id), 0)
           + ROW_NUMBER() OVER (PARTITION BY c.machine_id ORDER BY c.created_at ASC, c.id ASC) AS seq
  FROM "scout_conditions" c
  WHERE c.seq_no IS NULL
)
UPDATE "scout_conditions" s
SET "seq_no" = n.seq
FROM numbered n
WHERE s.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS "scout_conditions_machine_id_seq_no_key" ON "scout_conditions"("machine_id", "seq_no");
