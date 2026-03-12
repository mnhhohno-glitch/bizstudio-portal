-- CreateTable
CREATE TABLE "schedule_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "candidate_name" TEXT NOT NULL,
    "advisor_name" TEXT NOT NULL,
    "interview_method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedule_links_token_key" ON "schedule_links"("token");
