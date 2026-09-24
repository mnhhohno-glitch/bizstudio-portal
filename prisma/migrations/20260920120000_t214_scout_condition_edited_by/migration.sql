-- T-214: 配信条件に「人が最後に保存した日時・操作者」を持たせる（更新者/更新日時）。
--   updated_at（@updatedAt）は日付切替・枯渇切替・RPA の結果受信など自動処理でも動くため別列にする。
--   書くのは人の保存操作（編集モーダルの保存・手動の状態変更）だけ。▲▼の並び替え・自動処理では書かない。
-- nullable の追加のみ。既存行は null のまま（画面は "-"）。冪等（再実行しても壊れない）。

ALTER TABLE "scout_conditions" ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMP(3);
ALTER TABLE "scout_conditions" ADD COLUMN IF NOT EXISTS "edited_by_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scout_conditions_edited_by_id_fkey'
  ) THEN
    ALTER TABLE "scout_conditions"
      ADD CONSTRAINT "scout_conditions_edited_by_id_fkey"
      FOREIGN KEY ("edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
