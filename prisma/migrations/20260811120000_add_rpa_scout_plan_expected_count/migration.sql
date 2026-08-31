-- 配信計画の想定検索件数（予実管理用）。追加のみ・nullable
-- AlterTable
ALTER TABLE "rpa_scout_plans" ADD COLUMN     "expectedCount" INTEGER;
