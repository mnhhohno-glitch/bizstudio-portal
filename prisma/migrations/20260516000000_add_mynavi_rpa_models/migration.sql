-- T-062: マイナビRPA新フロー Phase 1B

-- CreateTable
CREATE TABLE "rpa_execution_batches" (
    "id" TEXT NOT NULL,
    "machine_number" INTEGER NOT NULL,
    "flow_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "normal_count" INTEGER NOT NULL DEFAULT 0,
    "age_ng_count" INTEGER NOT NULL DEFAULT 0,
    "foreign_ng_count" INTEGER NOT NULL DEFAULT 0,
    "ai_failed_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_skip_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_execution_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mynavi_rpa_processing_logs" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "phone_normalized" TEXT,
    "candidate_name" TEXT,
    "candidate_age" INTEGER,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "can_send_reply" BOOLEAN NOT NULL DEFAULT false,
    "reply_sent_at" TIMESTAMP(3),
    "reply_result" TEXT,
    "pdf_file_name" TEXT,
    "pdf_file_id" TEXT,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mynavi_rpa_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_settings_histories" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "send_type" TEXT NOT NULL,
    "send_result" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_settings_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rpa_execution_batches_started_at_idx" ON "rpa_execution_batches"("started_at");

-- CreateIndex
CREATE INDEX "rpa_execution_batches_machine_number_started_at_idx" ON "rpa_execution_batches"("machine_number", "started_at");

-- CreateIndex
CREATE INDEX "mynavi_rpa_processing_logs_phone_normalized_processed_at_idx" ON "mynavi_rpa_processing_logs"("phone_normalized", "processed_at");

-- CreateIndex
CREATE INDEX "mynavi_rpa_processing_logs_batch_id_idx" ON "mynavi_rpa_processing_logs"("batch_id");

-- CreateIndex
CREATE INDEX "mynavi_rpa_processing_logs_candidate_id_idx" ON "mynavi_rpa_processing_logs"("candidate_id");

-- CreateIndex
CREATE INDEX "candidate_settings_histories_candidate_id_sent_at_idx" ON "candidate_settings_histories"("candidate_id", "sent_at");

-- AddForeignKey
ALTER TABLE "mynavi_rpa_processing_logs" ADD CONSTRAINT "mynavi_rpa_processing_logs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "rpa_execution_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mynavi_rpa_processing_logs" ADD CONSTRAINT "mynavi_rpa_processing_logs_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_settings_histories" ADD CONSTRAINT "candidate_settings_histories_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
