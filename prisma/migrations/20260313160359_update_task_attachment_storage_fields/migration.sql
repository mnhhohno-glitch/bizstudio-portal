/*
  Warnings:

  - You are about to drop the column `file_url` on the `task_attachments` table. All the data in the column will be lost.
  - Added the required column `public_url` to the `task_attachments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storage_path` to the `task_attachments` table without a default value. This is not possible if the table is not empty.
  - Made the column `file_size` on table `task_attachments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mime_type` on table `task_attachments` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "task_attachments" DROP COLUMN "file_url",
ADD COLUMN     "public_url" TEXT NOT NULL,
ADD COLUMN     "storage_path" TEXT NOT NULL,
ALTER COLUMN "file_size" SET NOT NULL,
ALTER COLUMN "mime_type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "task_attachments_task_id_idx" ON "task_attachments"("task_id");

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
