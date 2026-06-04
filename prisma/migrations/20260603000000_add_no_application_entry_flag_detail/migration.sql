-- Add new entry_detail option "未応募" under parent "求人紹介" (T-067)
-- Used by /api/internal/entries/auto-expire when calendar-month-stale entries are auto-deactivated.
-- Idempotent (WHERE NOT EXISTS) so re-applying this migration after the previous T-067 attempt
-- (which already inserted this row in staging) is safe.
INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT gen_random_uuid()::text, 'entry_detail', '求人紹介', '未応募', 3, true
WHERE NOT EXISTS (
  SELECT 1 FROM "entry_flag_masters"
  WHERE "flag_type" = 'entry_detail' AND "parent_flag" = '求人紹介' AND "value" = '未応募'
);
