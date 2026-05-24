-- T-064 Phase A: スカウト運用集計機能
-- 新規テーブル5つ + Candidate 拡張

-- ScoutMachineMaster
CREATE TABLE IF NOT EXISTS "scout_machine_masters" (
  "id" TEXT NOT NULL,
  "recruiter_name" TEXT NOT NULL,
  "machine_number" INTEGER,
  "machine_label" TEXT NOT NULL,
  "is_machine" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_to" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scout_machine_masters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scout_machine_masters_recruiter_name_valid_from_key"
  ON "scout_machine_masters"("recruiter_name", "valid_from");
CREATE INDEX IF NOT EXISTS "scout_machine_masters_machine_number_idx"
  ON "scout_machine_masters"("machine_number");
CREATE INDEX IF NOT EXISTS "scout_machine_masters_is_active_idx"
  ON "scout_machine_masters"("is_active");

-- ScoutMediaMaster
CREATE TABLE IF NOT EXISTS "scout_media_masters" (
  "id" TEXT NOT NULL,
  "media_name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scout_media_masters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scout_media_masters_media_name_key"
  ON "scout_media_masters"("media_name");
CREATE INDEX IF NOT EXISTS "scout_media_masters_display_order_idx"
  ON "scout_media_masters"("display_order");
CREATE INDEX IF NOT EXISTS "scout_media_masters_is_active_idx"
  ON "scout_media_masters"("is_active");

-- ScoutDeliverySlot
CREATE TABLE IF NOT EXISTS "scout_delivery_slots" (
  "id" TEXT NOT NULL,
  "scout_number" TEXT NOT NULL,
  "delivery_date" DATE NOT NULL,
  "hour_slot" INTEGER NOT NULL,
  "machine_id" TEXT,
  "is_machine" BOOLEAN NOT NULL DEFAULT true,
  "is_staff" BOOLEAN NOT NULL DEFAULT false,
  "delivery_category_large" TEXT NOT NULL,
  "delivery_category_medium" TEXT,
  "delivery_category_small" TEXT,
  "media_source" TEXT NOT NULL DEFAULT 'マイナビ転職',
  "search_condition_name" TEXT,
  "delivery_count" INTEGER NOT NULL DEFAULT 0,
  "open_count" INTEGER NOT NULL DEFAULT 0,
  "is_aggregation_target" BOOLEAN NOT NULL DEFAULT true,
  "memo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  CONSTRAINT "scout_delivery_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scout_delivery_slots_scout_number_key"
  ON "scout_delivery_slots"("scout_number");
CREATE UNIQUE INDEX IF NOT EXISTS "scout_delivery_slots_delivery_date_hour_slot_machine_id_key"
  ON "scout_delivery_slots"("delivery_date", "hour_slot", "machine_id");
CREATE INDEX IF NOT EXISTS "scout_delivery_slots_delivery_date_idx"
  ON "scout_delivery_slots"("delivery_date");
CREATE INDEX IF NOT EXISTS "scout_delivery_slots_delivery_date_hour_slot_idx"
  ON "scout_delivery_slots"("delivery_date", "hour_slot");
CREATE INDEX IF NOT EXISTS "scout_delivery_slots_machine_id_idx"
  ON "scout_delivery_slots"("machine_id");
CREATE INDEX IF NOT EXISTS "scout_delivery_slots_media_source_idx"
  ON "scout_delivery_slots"("media_source");

-- FK: ScoutDeliverySlot -> ScoutMachineMaster
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scout_delivery_slots_machine_id_fkey'
  ) THEN
    ALTER TABLE "scout_delivery_slots"
      ADD CONSTRAINT "scout_delivery_slots_machine_id_fkey"
      FOREIGN KEY ("machine_id") REFERENCES "scout_machine_masters"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ScoutImportLog
CREATE TABLE IF NOT EXISTS "scout_import_logs" (
  "id" TEXT NOT NULL,
  "import_type" TEXT NOT NULL,
  "file_name" TEXT,
  "target_date" DATE,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "scout_import_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "scout_import_logs_target_date_idx"
  ON "scout_import_logs"("target_date");
CREATE INDEX IF NOT EXISTS "scout_import_logs_import_type_started_at_idx"
  ON "scout_import_logs"("import_type", "started_at");

-- ScoutSequence
CREATE TABLE IF NOT EXISTS "scout_sequences" (
  "id" TEXT NOT NULL,
  "last_number" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scout_sequences_pkey" PRIMARY KEY ("id")
);

-- Candidate に スカウト紐付け列を追加
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "scout_delivery_slot_id" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "scout_linked_at" TIMESTAMP(3);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "scout_linked_by_id" TEXT;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "mynavi_scout_sent_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "candidates_scout_delivery_slot_id_idx"
  ON "candidates"("scout_delivery_slot_id");

-- FK: Candidate -> ScoutDeliverySlot
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'candidates_scout_delivery_slot_id_fkey'
  ) THEN
    ALTER TABLE "candidates"
      ADD CONSTRAINT "candidates_scout_delivery_slot_id_fkey"
      FOREIGN KEY ("scout_delivery_slot_id") REFERENCES "scout_delivery_slots"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
