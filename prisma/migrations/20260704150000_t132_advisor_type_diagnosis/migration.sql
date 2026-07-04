-- T-132: タイプ診断の希望条件を構造化保存するテーブル（純追加・既存データ非破壊）
SET lock_timeout = '5s';

CREATE TABLE "advisor_type_diagnosis" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "diagnosis_type" TEXT,
    "desired_job_types" TEXT[],
    "desired_prefectures" TEXT[],
    "desired_salary_min" INTEGER,
    "desired_salary_max" INTEGER,
    "ideal_salary_min" INTEGER,
    "ideal_salary_max" INTEGER,
    "source_message_id" TEXT NOT NULL,
    "source_session_id" TEXT,
    "extraction_model" TEXT,
    "raw_json" JSONB,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advisor_type_diagnosis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advisor_type_diagnosis_candidate_id_key" ON "advisor_type_diagnosis"("candidate_id");
CREATE INDEX "advisor_type_diagnosis_source_message_id_idx" ON "advisor_type_diagnosis"("source_message_id");
