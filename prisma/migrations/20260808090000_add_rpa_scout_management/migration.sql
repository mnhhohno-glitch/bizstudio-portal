-- CreateTable
CREATE TABLE "rpa_scout_machines" (
    "id" TEXT NOT NULL,
    "machineNo" INTEGER NOT NULL,
    "accountName" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "mynaviSaveName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_scout_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_scout_job_categories" (
    "id" SERIAL NOT NULL,
    "large" TEXT NOT NULL,
    "middle" TEXT NOT NULL,
    "small" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "rpa_scout_job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_scout_patterns" (
    "id" TEXT NOT NULL,
    "targetMachineNo" INTEGER,
    "name" TEXT NOT NULL,
    "sendStatus" TEXT,
    "registDays" INTEGER,
    "registDirection" TEXT,
    "lastLoginDays" INTEGER,
    "areaType" TEXT,
    "prefectures" JSONB,
    "education" TEXT,
    "gradYearFrom" INTEGER,
    "gradYearTo" INTEGER,
    "companyCount" INTEGER,
    "jobCategories" JSONB,
    "jobCategoryPriority" TEXT,
    "workLocations" JSONB,
    "workLocationPriority" TEXT,
    "transferTiming" TEXT,
    "rawConditions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isMigrated" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_scout_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_scout_subject_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_scout_subject_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_scout_logs" (
    "id" TEXT NOT NULL,
    "machineNo" INTEGER NOT NULL,
    "patternId" TEXT,
    "patternName" TEXT NOT NULL,
    "subjectTemplateId" TEXT,
    "subjectName" TEXT NOT NULL,
    "searchCount" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpa_scout_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_scout_plans" (
    "id" TEXT NOT NULL,
    "planDate" TIMESTAMP(3) NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "machineNo" INTEGER NOT NULL,
    "patternId" TEXT,
    "patternName" TEXT NOT NULL,
    "subjectTemplateId" TEXT,
    "subjectName" TEXT NOT NULL,
    "memo" TEXT,
    "reflectedAt" TIMESTAMP(3),
    "reflectedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_scout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rpa_scout_machines_machineNo_key" ON "rpa_scout_machines"("machineNo");

-- CreateIndex
CREATE INDEX "rpa_scout_job_categories_large_idx" ON "rpa_scout_job_categories"("large");

-- CreateIndex
CREATE INDEX "rpa_scout_job_categories_middle_idx" ON "rpa_scout_job_categories"("middle");

-- CreateIndex
CREATE UNIQUE INDEX "rpa_scout_job_categories_large_middle_small_key" ON "rpa_scout_job_categories"("large", "middle", "small");

-- CreateIndex
CREATE INDEX "rpa_scout_patterns_targetMachineNo_idx" ON "rpa_scout_patterns"("targetMachineNo");

-- CreateIndex
CREATE INDEX "rpa_scout_logs_machineNo_recordedAt_idx" ON "rpa_scout_logs"("machineNo", "recordedAt");

-- CreateIndex
CREATE INDEX "rpa_scout_logs_recordedAt_idx" ON "rpa_scout_logs"("recordedAt");

-- CreateIndex
CREATE INDEX "rpa_scout_plans_planDate_idx" ON "rpa_scout_plans"("planDate");

-- CreateIndex
CREATE INDEX "rpa_scout_plans_machineNo_planDate_idx" ON "rpa_scout_plans"("machineNo", "planDate");

