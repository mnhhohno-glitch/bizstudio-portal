-- T-206: スカウト実績にマイナビの検索結果件数（「検索結果：全1299件」の数字＝母数）を持たせる。
-- RPA（PAD）側はまだこの項目を送っていないため nullable（送られてこない実行は null のまま）。
-- 数値に直せなかった文字列も null で保存する（結果送信そのものを失敗させないため）。
-- 追加のみ。冪等（再実行しても壊れない）。

ALTER TABLE "scout_runs" ADD COLUMN IF NOT EXISTS "search_result_count" INTEGER;
