-- Add new person flag option: 本人所感回収済
INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT gen_random_uuid()::text, 'person', NULL, '本人所感回収済', 16, true
WHERE NOT EXISTS (SELECT 1 FROM "entry_flag_masters" WHERE "flag_type" = 'person' AND "value" = '本人所感回収済');

-- Also add 本人所感回収中 if missing (was only in PERSON_FLAG_RULES constant, not in master table)
INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT gen_random_uuid()::text, 'person', NULL, '本人所感回収中', 15, true
WHERE NOT EXISTS (SELECT 1 FROM "entry_flag_masters" WHERE "flag_type" = 'person' AND "value" = '本人所感回収中');
