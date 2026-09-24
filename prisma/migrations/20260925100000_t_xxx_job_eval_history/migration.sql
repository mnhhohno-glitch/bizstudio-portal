-- T-XXX: 求人評価の入力の部品（job_eval_parts）と評価履歴（job_eval_records）を新設。
--   評価のたびに AI に送った中身（ハッシュで重複排除）と結果を残し、中身が変わらない求人の再評価を止める。
-- 新しい表の追加のみ。既存の表の列・行は変えない。冪等（再実行しても壊れない）。

-- CreateTable
CREATE TABLE IF NOT EXISTS "job_eval_parts" (
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chars" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_eval_parts_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "job_eval_records" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidate_id" TEXT NOT NULL,
    "candidate_file_id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "effort" TEXT,
    "evaluated_at" TIMESTAMP(3),
    "desire_rating" TEXT,
    "pass_rating" TEXT,
    "overall_rating" TEXT,
    "comment" TEXT,
    "cost_usd" DOUBLE PRECISION,
    "usage_log_id" TEXT,
    "request_key" TEXT NOT NULL,
    "ledger_id" TEXT,
    "reused_from_id" TEXT,
    "fixed_hash" TEXT NOT NULL,
    "instruction_hash" TEXT NOT NULL,
    "instruction_template_hash" TEXT NOT NULL,
    "context_core_hash" TEXT NOT NULL,
    "context_files_hash" TEXT,
    "job_hash" TEXT NOT NULL,

    CONSTRAINT "job_eval_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_parts_kind_idx" ON "job_eval_parts"("kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_records_candidate_file_id_created_at_idx" ON "job_eval_records"("candidate_file_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_records_candidate_id_created_at_idx" ON "job_eval_records"("candidate_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_records_created_at_idx" ON "job_eval_records"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_records_status_idx" ON "job_eval_records"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "job_eval_records_ledger_id_idx" ON "job_eval_records"("ledger_id");
