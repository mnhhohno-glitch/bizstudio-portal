-- T-194: スカウト配信条件コンソール（号機ごとの検索条件6軸・配信テンプレート・実行実績・祝日）
-- 追加系のみ・冪等（IF NOT EXISTS）。既存レコードの書き換えは一切しない。
-- 既存テーブルへの変更は rpa_scout_machines への nullable 列追加（default_template_id）のみ。
-- 号機マスタは既存 rpa_scout_machines を流用する（machine_no 一意・is_active あり）。
-- staging/production は同一 Postgres のため、破壊的変更は禁止。

-- CreateEnum（既存なら何もしない）
DO $$ BEGIN
  CREATE TYPE "ScoutTemplateKind" AS ENUM ('UNSENT', 'SENT', 'INDIVIDUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScoutConditionStatus" AS ENUM ('RUNNING', 'QUEUED', 'DRY', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScoutSearchTarget" AS ENUM ('EXCLUDE', 'ONLY', 'INCLUDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScoutRegistDateMode" AS ENUM ('PERIOD', 'DATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScoutAreaMode" AS ENUM ('NATIONWIDE', 'EAST', 'WEST', 'PREFECTURE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable（nullable 列追加のみ）
ALTER TABLE "rpa_scout_machines" ADD COLUMN IF NOT EXISTS "default_template_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "scout_templates" (
    "id" TEXT NOT NULL,
    "kind" "ScoutTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- 固定値（学歴=不問 / 経験職種=指定なし / 居住地=指定なし / 0社を除く=なし /
-- 除外リスト=含まない / 自社へ応募=含まない）は列を持たない。RPA 側で常に固定入力する。
CREATE TABLE IF NOT EXISTS "scout_conditions" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "status" "ScoutConditionStatus" NOT NULL DEFAULT 'QUEUED',
    "queue_order" INTEGER NOT NULL DEFAULT 0,
    "search_target" "ScoutSearchTarget" NOT NULL DEFAULT 'EXCLUDE',
    "regist_date_mode" "ScoutRegistDateMode" NOT NULL DEFAULT 'PERIOD',
    "regist_days" INTEGER,
    "regist_date_from" DATE,
    "regist_date_to" DATE,
    "last_login_days" INTEGER NOT NULL DEFAULT 1,
    "grad_year_from" INTEGER,
    "grad_year_to" INTEGER,
    "company_count" INTEGER,
    "area_mode" "ScoutAreaMode" NOT NULL DEFAULT 'NATIONWIDE',
    "prefectures" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "template_id" TEXT,
    "planned_count" INTEGER,
    "delivery_date" DATE,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scout_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scout_runs" (
    "id" TEXT NOT NULL,
    "condition_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL,
    "extracted_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "is_dry" BOOLEAN NOT NULL DEFAULT false,
    "raw_notification" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scout_templates_kind_sort_order_idx" ON "scout_templates"("kind", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "scout_templates_kind_name_key" ON "scout_templates"("kind", "name");
CREATE INDEX IF NOT EXISTS "scout_conditions_machine_id_status_queue_order_idx" ON "scout_conditions"("machine_id", "status", "queue_order");
CREATE INDEX IF NOT EXISTS "scout_conditions_delivery_date_idx" ON "scout_conditions"("delivery_date");
CREATE INDEX IF NOT EXISTS "scout_conditions_status_idx" ON "scout_conditions"("status");
CREATE INDEX IF NOT EXISTS "scout_runs_condition_id_executed_at_idx" ON "scout_runs"("condition_id", "executed_at");
CREATE INDEX IF NOT EXISTS "scout_runs_machine_id_executed_at_idx" ON "scout_runs"("machine_id", "executed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "holidays_date_key" ON "holidays"("date");

-- AddForeignKey（既存なら何もしない）
DO $$ BEGIN
  ALTER TABLE "rpa_scout_machines" ADD CONSTRAINT "rpa_scout_machines_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES "scout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scout_conditions" ADD CONSTRAINT "scout_conditions_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "rpa_scout_machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scout_conditions" ADD CONSTRAINT "scout_conditions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "scout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scout_conditions" ADD CONSTRAINT "scout_conditions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scout_runs" ADD CONSTRAINT "scout_runs_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "scout_conditions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scout_runs" ADD CONSTRAINT "scout_runs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "rpa_scout_machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
