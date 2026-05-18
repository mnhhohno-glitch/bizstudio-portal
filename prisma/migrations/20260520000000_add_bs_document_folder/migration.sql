-- CreateTable
CREATE TABLE "bs_document_folders" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bs_document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bs_document_folders_candidate_id_idx" ON "bs_document_folders"("candidate_id");

-- AddForeignKey
ALTER TABLE "bs_document_folders"
    ADD CONSTRAINT "bs_document_folders_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "candidate_files" ADD COLUMN "folder_id" TEXT;

-- CreateIndex
CREATE INDEX "candidate_files_folder_id_idx" ON "candidate_files"("folder_id");

-- AddForeignKey
ALTER TABLE "candidate_files"
    ADD CONSTRAINT "candidate_files_folder_id_fkey"
    FOREIGN KEY ("folder_id") REFERENCES "bs_document_folders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
