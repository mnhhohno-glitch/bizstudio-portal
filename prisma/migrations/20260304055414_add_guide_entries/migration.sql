-- CreateEnum
CREATE TYPE "GuideType" AS ENUM ('INTERVIEW');

-- CreateTable
CREATE TABLE "guide_entries" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "guide_type" "GuideType" NOT NULL,
    "token" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guide_entries_token_key" ON "guide_entries"("token");

-- CreateIndex
CREATE UNIQUE INDEX "guide_entries_candidate_id_guide_type_key" ON "guide_entries"("candidate_id", "guide_type");

-- AddForeignKey
ALTER TABLE "guide_entries" ADD CONSTRAINT "guide_entries_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
