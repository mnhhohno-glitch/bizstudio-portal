-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "support_sub_status" TEXT;
ALTER TABLE "candidates" ADD COLUMN "support_sub_status_manual" BOOLEAN NOT NULL DEFAULT false;

-- Backfill fixed sub statuses for existing candidates
UPDATE "candidates" SET "support_sub_status" = '面談前'  WHERE "support_status" = 'BEFORE';
UPDATE "candidates" SET "support_sub_status" = '当社判断' WHERE "support_status" = 'ENDED';
-- ACTIVE rows left NULL; will be populated by calculateSubStatus() on next trigger or API access.
