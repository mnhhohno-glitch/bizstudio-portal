-- e897441（スカウト配信枠 14:30 対応）の打ち消し。対象を取り違えた実装のため minute_slot を撤去する。
-- 20260910090000_scout_slot_minute_slot は適用済み履歴として残置し、打ち消しはこの追加分で行う。
--
-- 前提（2026-09-10 本番実測）:
--   - minute_slot <> 0 の行は 0 件（14:30 枠は 1 件も作られていない）
--   - よって DROP COLUMN による配信枠データの欠落は発生しない
-- 冪等（IF EXISTS）。
DROP INDEX IF EXISTS "scout_delivery_slots_delivery_date_hour_slot_minute_slot_idx";
DROP INDEX IF EXISTS "scout_slot_category_minute_idx";
ALTER TABLE "scout_delivery_slots" DROP COLUMN IF EXISTS "minute_slot";
