ALTER TABLE "training_work_items" ADD COLUMN IF NOT EXISTS "modelAnswer" TEXT;
ALTER TABLE "training_work_items" ADD COLUMN IF NOT EXISTS "gradingPoints" TEXT;
