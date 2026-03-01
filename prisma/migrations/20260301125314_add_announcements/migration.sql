-- CreateEnum
CREATE TYPE "AnnouncementCategory" AS ENUM ('IMPORTANT', 'FEATURE', 'FIX', 'MAINTENANCE', 'RELEASE');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('PUBLISHED', 'DRAFT');

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'ANNOUNCEMENT';

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "AnnouncementCategory" NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "author_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
