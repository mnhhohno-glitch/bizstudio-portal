-- スカウト配信枠 14:30 対応: minute_slot を純追加（A案）
-- 既存 67,169 行は DEFAULT 0（= 従来の「N時00分」）のまま。UPDATE / DELETE は一切行わない。
-- 追加系のみ・冪等（IF NOT EXISTS）。staging/production は同一 Postgres のため即本番反映。
ALTER TABLE "scout_delivery_slots" ADD COLUMN IF NOT EXISTS "minute_slot" INTEGER NOT NULL DEFAULT 0;

-- 枠照合が (delivery_date, hour_slot) だけで当たらないよう minute_slot 込みの index を追加。
-- 既存の scout_slot_category_idx / scout_delivery_slots_delivery_date_hour_slot_idx は追加系の原則で残置（後続の整理で drop 可）。
CREATE INDEX IF NOT EXISTS "scout_delivery_slots_delivery_date_hour_slot_minute_slot_idx"
  ON "scout_delivery_slots"("delivery_date", "hour_slot", "minute_slot");

CREATE INDEX IF NOT EXISTS "scout_slot_category_minute_idx"
  ON "scout_delivery_slots"("delivery_date", "hour_slot", "minute_slot", "machine_id", "delivery_category_large", "delivery_category_medium");
