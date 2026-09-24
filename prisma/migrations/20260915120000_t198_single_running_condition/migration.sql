-- T-198: 実行中（RUNNING）の配信条件を号機ごとに1件へ寄せる既存データの是正。
--
-- 背景: 配信日を過ぎた条件が「実行中」のまま残り、翌日に作った条件と合わせて号機に実行中が2件並んだ。
--   RPA は実行中の条件を1件しか取らないため、意図と違う条件・テンプレートで配信されても「成功」で終わる。
--   以後の作成・編集・枯渇切替はアプリ側（create.ts の demoteOtherRunning）が1件に保つ。ここは過去分の掃除。
--
-- 残すのは配信日が最も新しいもの（配信日が空の行は最後）。同日なら更新日時が新しいもの、それも同じなら id 順。
-- 残さない行は DONE（完了）にする。冪等（再実行しても実行中が1件の号機には何もしない）。

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY machine_id
           ORDER BY delivery_date DESC NULLS LAST, updated_at DESC, id DESC
         ) AS rn
  FROM "scout_conditions"
  WHERE status = 'RUNNING'
)
UPDATE "scout_conditions" s
SET status = 'DONE', updated_at = NOW()
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;
