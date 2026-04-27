-- Add new company flag options: 所感報告前, 所感報告済
INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT gen_random_uuid()::text, 'company', NULL, '所感報告前', 7, true
WHERE NOT EXISTS (SELECT 1 FROM "entry_flag_masters" WHERE "flag_type" = 'company' AND "value" = '所感報告前');

INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT gen_random_uuid()::text, 'company', NULL, '所感報告済', 8, true
WHERE NOT EXISTS (SELECT 1 FROM "entry_flag_masters" WHERE "flag_type" = 'company' AND "value" = '所感報告済');
