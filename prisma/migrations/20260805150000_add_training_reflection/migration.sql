-- 研修メニュー第3弾: 研修振り返り（日報）
-- 追加系のみ（新規テーブル1つ）。既存テーブル・既存レコードへの変更なし。

-- CreateTable
CREATE TABLE "training_reflections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "learned" TEXT NOT NULL,
    "confused" TEXT NOT NULL,
    "questions" TEXT NOT NULL,
    "freeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_reflections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_reflections_reportDate_idx" ON "training_reflections"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "training_reflections_userId_reportDate_key" ON "training_reflections"("userId", "reportDate");
