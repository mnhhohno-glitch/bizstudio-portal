-- 研修メニュー第4弾: 振り返り日報の詳細版（理解度評価・ワーク別記録）
-- 追加系のみ（既存 training_reflections への nullable/default 付き ADD COLUMN + 新規テーブル2つ）。
-- 既存カラム・既存レコードへの破壊的変更なし。

-- AlterTable
ALTER TABLE "training_reflections" ADD COLUMN     "dayLabel" TEXT,
ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "observeHard" TEXT,
ADD COLUMN     "observeScene" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "workCorrectCount" INTEGER,
ADD COLUMN     "workJobCount" INTEGER,
ADD COLUMN     "workMistake" TEXT,
ADD COLUMN     "workNextTime" TEXT,
ADD COLUMN     "workTarget" TEXT;

-- CreateTable
CREATE TABLE "training_check_items" (
    "id" TEXT NOT NULL,
    "dayLabel" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_check_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_check_answers" (
    "id" TEXT NOT NULL,
    "reflectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_check_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_check_items_dayLabel_sortOrder_idx" ON "training_check_items"("dayLabel", "sortOrder");

-- CreateIndex
CREATE INDEX "training_check_answers_itemId_rating_idx" ON "training_check_answers"("itemId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "training_check_answers_reflectionId_itemId_key" ON "training_check_answers"("reflectionId", "itemId");
