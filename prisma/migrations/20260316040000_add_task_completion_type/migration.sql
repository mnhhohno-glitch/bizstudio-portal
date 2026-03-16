-- Add completionType to tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "completion_type" TEXT NOT NULL DEFAULT 'any';

-- Create task_assignee_statuses
CREATE TABLE IF NOT EXISTS "task_assignee_statuses" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "is_completed" BOOLEAN NOT NULL DEFAULT false,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignee_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_assignee_statuses_task_id_user_id_key" ON "task_assignee_statuses"("task_id", "user_id");
CREATE INDEX IF NOT EXISTS "task_assignee_statuses_task_id_idx" ON "task_assignee_statuses"("task_id");

DO $$ BEGIN
  ALTER TABLE "task_assignee_statuses" ADD CONSTRAINT "task_assignee_statuses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "task_assignee_statuses" ADD CONSTRAINT "task_assignee_statuses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
