-- 研修メニュー（社内研修）: 研修教材テーブルの新規追加
-- 追加系のみ。既存テーブル・既存レコードへの変更なし。

-- CreateTable
CREATE TABLE "training_materials" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tag" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_materials_category_sortOrder_idx" ON "training_materials"("category", "sortOrder");
