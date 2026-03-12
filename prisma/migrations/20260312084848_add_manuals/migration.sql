-- CreateEnum
CREATE TYPE "ManualCategory" AS ENUM ('INTERNAL', 'CANDIDATE', 'CLIENT');

-- CreateEnum
CREATE TYPE "ManualContentType" AS ENUM ('VIDEO', 'PDF', 'URL', 'MARKDOWN');

-- CreateTable
CREATE TABLE "manuals" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ManualCategory" NOT NULL,
    "content_type" "ManualContentType" NOT NULL,
    "video_url" TEXT,
    "pdf_path" TEXT,
    "external_url" TEXT,
    "markdown_content" TEXT,
    "description" TEXT,
    "author_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manuals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "manuals" ADD CONSTRAINT "manuals_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
