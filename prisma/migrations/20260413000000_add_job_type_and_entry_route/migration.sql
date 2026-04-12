-- AlterTable: Add jobType, entryRoute, entryJobId columns to job_entries.
-- NOTE: job_type may already exist from prior schema drift; use IF NOT EXISTS to be safe.
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "job_type" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "entry_route" TEXT;
ALTER TABLE "job_entries" ADD COLUMN IF NOT EXISTS "entry_job_id" TEXT;

-- Seed: Add 入社済 to entry flag master so it appears in the dropdown.
-- Idempotent via NOT EXISTS check; sort_order 7 places it after 内定.
INSERT INTO "entry_flag_masters" ("id", "flag_type", "parent_flag", "value", "sort_order", "is_active")
SELECT 'entry_flag_nyushazumi_seed', 'entry', NULL, '入社済', 7, true
WHERE NOT EXISTS (
  SELECT 1 FROM "entry_flag_masters" WHERE "flag_type" = 'entry' AND "value" = '入社済'
);
