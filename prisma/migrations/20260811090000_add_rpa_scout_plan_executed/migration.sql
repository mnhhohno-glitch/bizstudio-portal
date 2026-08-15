-- 配信計画から実績（RpaScoutLog）を記録したことを表す3列。追加のみ・全てnullable
-- AlterTable
ALTER TABLE "rpa_scout_plans" ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "executedByUserId" TEXT,
ADD COLUMN     "executedLogId" TEXT;
