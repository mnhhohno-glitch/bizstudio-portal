-- Drop old attendance tables (no data yet)
DROP TABLE IF EXISTS "leave_balances" CASCADE;
DROP TABLE IF EXISTS "leave_requests" CASCADE;
DROP TABLE IF EXISTS "attendance_mod_requests" CASCADE;
DROP TABLE IF EXISTS "attendance_punches" CASCADE;
DROP TABLE IF EXISTS "attendance_records" CASCADE;

-- Drop old enums that are no longer needed
DROP TYPE IF EXISTS "ModRequestStatus" CASCADE;
DROP TYPE IF EXISTS "LeaveRequestStatus" CASCADE;

-- Add new enum values to AttendanceStatus
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'FINISHED';

-- Add new enum values to PunchType
ALTER TYPE "PunchType" ADD VALUE IF NOT EXISTS 'INTERRUPT_START';
ALTER TYPE "PunchType" ADD VALUE IF NOT EXISTS 'INTERRUPT_END';

-- Create new enums (IF NOT EXISTS)
DO $$ BEGIN CREATE TYPE "ModReqType" AS ENUM ('CLOCK_IN_EDIT', 'CLOCK_OUT_EDIT', 'BREAK_START_EDIT', 'BREAK_END_EDIT', 'INTERRUPT_START_EDIT', 'INTERRUPT_END_EDIT', 'ADD_BREAK', 'ADD_INTERRUPT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "HalfDayType" AS ENUM ('AM', 'PM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Update LeaveType enum
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'PAID_FULL';
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'PAID_HALF';

-- Add columns to employees
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "paid_leave" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Add unique constraint on employees.user_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_user_id_key') THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_key" UNIQUE ("user_id");
  END IF;
END $$;

-- Add FK from employees to users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_user_id_fkey') THEN
    ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Create daily_attendances
CREATE TABLE IF NOT EXISTS "daily_attendances" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "clock_in" TIMESTAMP(3),
  "clock_out" TIMESTAMP(3),
  "total_break" INTEGER NOT NULL DEFAULT 0,
  "total_interrupt" INTEGER NOT NULL DEFAULT 0,
  "total_work" INTEGER NOT NULL DEFAULT 0,
  "overtime" INTEGER NOT NULL DEFAULT 0,
  "overtime_rounded" INTEGER NOT NULL DEFAULT 0,
  "night_time" INTEGER NOT NULL DEFAULT 0,
  "is_finalized" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_attendances_pkey" PRIMARY KEY ("id")
);

-- Create punch_events
CREATE TABLE IF NOT EXISTS "punch_events" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "daily_attendance_id" TEXT NOT NULL,
  "type" "PunchType" NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "is_manual_edit" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "punch_events_pkey" PRIMARY KEY ("id")
);

-- Create modification_requests
CREATE TABLE IF NOT EXISTS "modification_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "target_date" DATE NOT NULL,
  "request_type" "ModReqType" NOT NULL,
  "before_value" TIMESTAMP(3),
  "after_value" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "approval_token" TEXT NOT NULL,
  "approved_by" TEXT,
  "rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modification_requests_pkey" PRIMARY KEY ("id")
);

-- Create leave_requests
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "target_date" DATE NOT NULL,
  "leave_type" "LeaveType" NOT NULL,
  "half_day" "HalfDayType",
  "reason" TEXT,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "approval_token" TEXT NOT NULL,
  "approved_by" TEXT,
  "rejection_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "daily_attendances_employee_id_date_key" ON "daily_attendances"("employee_id", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "modification_requests_approval_token_key" ON "modification_requests"("approval_token");
CREATE UNIQUE INDEX IF NOT EXISTS "leave_requests_approval_token_key" ON "leave_requests"("approval_token");

-- Indexes
CREATE INDEX IF NOT EXISTS "daily_attendances_employee_id_date_idx" ON "daily_attendances"("employee_id", "date");
CREATE INDEX IF NOT EXISTS "punch_events_employee_id_daily_attendance_id_idx" ON "punch_events"("employee_id", "daily_attendance_id");
CREATE INDEX IF NOT EXISTS "modification_requests_status_idx" ON "modification_requests"("status");
CREATE INDEX IF NOT EXISTS "leave_requests_status_idx" ON "leave_requests"("status");

-- Foreign keys (idempotent)
DO $$ BEGIN ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_daily_attendance_id_fkey" FOREIGN KEY ("daily_attendance_id") REFERENCES "daily_attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "modification_requests" ADD CONSTRAINT "modification_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
