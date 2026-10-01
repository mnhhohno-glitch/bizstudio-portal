-- T-XXX step5B: 選考ステータス・支援状況・希望条件の変更記録と、進行中案件の日次スナップショット。追加のみ・既存レコードは変更しない。
-- CreateTable
CREATE TABLE "job_entry_status_histories" (
    "id" TEXT NOT NULL,
    "job_entry_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "from_entry_flag" TEXT,
    "to_entry_flag" TEXT,
    "from_entry_flag_detail" TEXT,
    "to_entry_flag_detail" TEXT,
    "from_company_flag" TEXT,
    "to_company_flag" TEXT,
    "from_person_flag" TEXT,
    "to_person_flag" TEXT,
    "from_is_active" BOOLEAN,
    "to_is_active" BOOLEAN,
    "from_archived" BOOLEAN,
    "to_archived" BOOLEAN,
    "changed_fields" TEXT[],
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" TEXT,
    "route" TEXT NOT NULL,

    CONSTRAINT "job_entry_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_support_status_histories" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "from_support_status" TEXT,
    "to_support_status" TEXT,
    "from_support_sub_status" TEXT,
    "to_support_sub_status" TEXT,
    "from_support_end_reason" TEXT,
    "to_support_end_reason" TEXT,
    "from_support_end_date" TIMESTAMP(3),
    "to_support_end_date" TIMESTAMP(3),
    "changed_fields" TEXT[],
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" TEXT,
    "route" TEXT NOT NULL,

    CONSTRAINT "candidate_support_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_preference_histories" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interview_record_id" TEXT,
    "field" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" TEXT,
    "route" TEXT NOT NULL,

    CONSTRAINT "candidate_preference_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ca_pipeline_daily_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "ca_key" TEXT NOT NULL,
    "employee_number" TEXT,
    "active_candidates" INTEGER NOT NULL,
    "active_status_active" INTEGER NOT NULL,
    "active_status_waiting" INTEGER NOT NULL,
    "entered" INTEGER NOT NULL,
    "document_screening" INTEGER NOT NULL,
    "first_interview" INTEGER NOT NULL,
    "second_interview" INTEGER NOT NULL,
    "final_interview" INTEGER NOT NULL,
    "interview_other" INTEGER NOT NULL,
    "offered" INTEGER NOT NULL,
    "in_selection_records" INTEGER NOT NULL,
    "in_selection_candidates" INTEGER NOT NULL,
    "accepted_not_joined" INTEGER NOT NULL,
    "upcoming_interviews_first" INTEGER NOT NULL,
    "upcoming_interviews_existing" INTEGER NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ca_pipeline_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_entry_status_histories_job_entry_id_changed_at_idx" ON "job_entry_status_histories"("job_entry_id", "changed_at");

-- CreateIndex
CREATE INDEX "job_entry_status_histories_candidate_id_changed_at_idx" ON "job_entry_status_histories"("candidate_id", "changed_at");

-- CreateIndex
CREATE INDEX "job_entry_status_histories_changed_at_idx" ON "job_entry_status_histories"("changed_at");

-- CreateIndex
CREATE INDEX "candidate_support_status_histories_candidate_id_changed_at_idx" ON "candidate_support_status_histories"("candidate_id", "changed_at");

-- CreateIndex
CREATE INDEX "candidate_support_status_histories_changed_at_idx" ON "candidate_support_status_histories"("changed_at");

-- CreateIndex
CREATE INDEX "candidate_preference_histories_candidate_id_changed_at_idx" ON "candidate_preference_histories"("candidate_id", "changed_at");

-- CreateIndex
CREATE INDEX "candidate_preference_histories_field_changed_at_idx" ON "candidate_preference_histories"("field", "changed_at");

-- CreateIndex
CREATE INDEX "candidate_preference_histories_changed_at_idx" ON "candidate_preference_histories"("changed_at");

-- CreateIndex
CREATE INDEX "ca_pipeline_daily_snapshots_snapshot_date_idx" ON "ca_pipeline_daily_snapshots"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "ca_pipeline_daily_snapshots_snapshot_date_ca_key_key" ON "ca_pipeline_daily_snapshots"("snapshot_date", "ca_key");

-- AddForeignKey
ALTER TABLE "candidate_support_status_histories" ADD CONSTRAINT "candidate_support_status_histories_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_preference_histories" ADD CONSTRAINT "candidate_preference_histories_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

