-- CreateTable
CREATE TABLE "training_work_items" (
    "id" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "jobContent" TEXT NOT NULL,
    "hintNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_work_answers" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "answerCompany" TEXT NOT NULL,
    "answerHelp" TEXT NOT NULL,
    "answerDay" TEXT NOT NULL,
    "answerUnknown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_work_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_work_items_workKey_sortOrder_idx" ON "training_work_items"("workKey", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "training_work_items_workKey_itemCode_key" ON "training_work_items"("workKey", "itemCode");

-- CreateIndex
CREATE INDEX "training_work_answers_workKey_idx" ON "training_work_answers"("workKey");

-- CreateIndex
CREATE INDEX "training_work_answers_employeeId_idx" ON "training_work_answers"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "training_work_answers_employeeId_workKey_itemCode_key" ON "training_work_answers"("employeeId", "workKey", "itemCode");
