-- T-062: 経路・媒体カラム追加

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "application_route" TEXT;
ALTER TABLE "candidates" ADD COLUMN "media_source" TEXT;
