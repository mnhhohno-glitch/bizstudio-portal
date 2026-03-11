-- CreateTable
CREATE TABLE "jimu_sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "candidate_name" TEXT,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "jimu_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jimu_sessions_token_key" ON "jimu_sessions"("token");
