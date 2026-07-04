-- T-135 step6: 配信枠のファイルメーカー全量入替に伴う制約緩和。
-- FM は「1スカウトNO = 1行（1配信イベント）」構造で、同一の 配信日×時×担当×配信種別×配信手法 に
-- 複数行が普通に存在する（7,882組・25,476行）。現行の複合ユニーク制約のままでは全量取込不可のため、
-- 複合ユニーク index を DROP し、同一列の非ユニーク index に張り替える（一覧・集計の検索性能を維持）。
-- scoutNumber の @unique（scout_delivery_slots_scout_number_key）は維持（紐付けの一次キー）。
-- 非破壊: 既存データの UPDATE/backfill なし。制約の緩和のみで後方互換。lock_timeout で長時間ロック回避。
SET lock_timeout = '5s';
DROP INDEX "scout_slot_unique_per_category";
CREATE INDEX "scout_slot_category_idx" ON "scout_delivery_slots"("delivery_date", "hour_slot", "machine_id", "delivery_category_large", "delivery_category_medium");
