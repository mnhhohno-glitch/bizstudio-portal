-- T-207: 配信テンプレートに通し番号（表示は「T-001」）を追加する。
--   種別に関係ない1本の連番。一度振った番号は変えない（削除しても後続を詰め直さない）。
--   追加のみ。既存カラムの削除・型変更は行わない。
ALTER TABLE "scout_templates" ADD COLUMN "seq_no" INTEGER;

CREATE UNIQUE INDEX "scout_templates_seq_no_key" ON "scout_templates"("seq_no");

-- 既存行への採番。種別（enum 宣言順 UNSENT→SENT→INDIVIDUAL）、種別内は sort_order、同値なら name の順に 1 から振る。
-- 集計ファイル「テンプレートマスタ」A11:C29 の並びと一致する。
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "kind", "sort_order", "name") AS rn
  FROM "scout_templates"
)
UPDATE "scout_templates" t
SET "seq_no" = n.rn
FROM numbered n
WHERE t."id" = n."id" AND t."seq_no" IS NULL;
