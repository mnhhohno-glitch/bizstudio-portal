-- T-096: 社員詳細管理（FileMaker 相当）。additive・冪等。DROP / NOT NULL 追加 / 型変更は一切含まない。

-- 1) employees へ基本情報カラム追加（全て nullable）
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "furigana" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "birthday" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "hire_date" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "resign_date" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "emergency_contact_name" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "emergency_contact_relation" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "emergency_contact_phone" TEXT;

-- 2) 口座情報（1:1）
CREATE TABLE IF NOT EXISTS "employee_bank_accounts" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "bank_code" TEXT,
  "bank_name" TEXT,
  "branch_code" TEXT,
  "branch_name" TEXT,
  "account_type" TEXT,
  "account_number" TEXT,
  "account_holder_kana" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_bank_accounts_employee_id_key" ON "employee_bank_accounts"("employee_id");

-- 3) 社会保険・雇用保険・扶養（1:1）
CREATE TABLE IF NOT EXISTS "employee_insurances" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "employment_insurance_status" TEXT,
  "employment_insurance_acquired_date" DATE,
  "employment_insurance_lost_date" DATE,
  "employment_insurance_area" TEXT,
  "employment_insurance_number" TEXT,
  "separation_notice_request_date" DATE,
  "social_insurance_status" TEXT,
  "social_insurance_acquired_date" DATE,
  "social_insurance_lost_date" DATE,
  "pension_number" TEXT,
  "social_insurance_note" TEXT,
  "dependent_acquired_date" DATE,
  "dependent_lost_date" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_insurances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_insurances_employee_id_key" ON "employee_insurances"("employee_id");

-- 4) 給与手当（1:1）。支給総額カラムは持たない（表示時計算）
CREATE TABLE IF NOT EXISTS "employee_salaries" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "base_salary" INTEGER,
  "rank_allowance" INTEGER,
  "communication_allowance" INTEGER,
  "special_allowance" INTEGER,
  "commute_allowance" INTEGER,
  "commute_route" TEXT,
  "commute_from" TEXT,
  "commute_to" TEXT,
  "commute_fare_one_way" INTEGER,
  "commute_fare_round_trip" INTEGER,
  "memo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_salaries_employee_id_key" ON "employee_salaries"("employee_id");

-- 5) 貸与物（1:1）。〜_encrypted は AES-256-GCM 暗号化済み文字列
CREATE TABLE IF NOT EXISTS "employee_equipments" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "pc_lent_date" DATE,
  "pc_number" TEXT,
  "pc_type" TEXT,
  "device_number" TEXT,
  "pc_initial_password_encrypted" TEXT,
  "lineworks_password_encrypted" TEXT,
  "mobile_number" TEXT,
  "mobile_serial_number" TEXT,
  "apple_id" TEXT,
  "apple_id_password_encrypted" TEXT,
  "google_account" TEXT,
  "google_password_encrypted" TEXT,
  "office365_password_encrypted" TEXT,
  "mobile_management_no" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_equipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "employee_equipments_employee_id_key" ON "employee_equipments"("employee_id");

-- 6) 扶養家族（1:N）
CREATE TABLE IF NOT EXISTS "employee_dependents" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "name" TEXT,
  "kana" TEXT,
  "gender" TEXT,
  "relation" TEXT,
  "birthday" DATE,
  "annual_income" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_dependents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "employee_dependents_employee_id_idx" ON "employee_dependents"("employee_id");

-- FK（既存なら追加しない・冪等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_bank_accounts_employee_id_fkey') THEN
    ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_insurances_employee_id_fkey') THEN
    ALTER TABLE "employee_insurances" ADD CONSTRAINT "employee_insurances_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_salaries_employee_id_fkey') THEN
    ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_equipments_employee_id_fkey') THEN
    ALTER TABLE "employee_equipments" ADD CONSTRAINT "employee_equipments_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_dependents_employee_id_fkey') THEN
    ALTER TABLE "employee_dependents" ADD CONSTRAINT "employee_dependents_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
