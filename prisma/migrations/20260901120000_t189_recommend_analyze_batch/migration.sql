-- CreateTable
CREATE TABLE "recommend_analyze_batches" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "file_ids" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "recommend_analyze_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommend_analyze_batches_status_idx" ON "recommend_analyze_batches"("status");

-- CreateIndex
CREATE INDEX "recommend_analyze_batches_batch_id_idx" ON "recommend_analyze_batches"("batch_id");
