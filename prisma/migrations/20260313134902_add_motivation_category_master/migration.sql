-- CreateTable
CREATE TABLE "motivation_category_majors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivation_category_majors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivation_category_middles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "major_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivation_category_middles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivation_category_minors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "middle_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivation_category_minors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "motivation_category_majors_name_key" ON "motivation_category_majors"("name");

-- AddForeignKey
ALTER TABLE "motivation_category_middles" ADD CONSTRAINT "motivation_category_middles_major_id_fkey" FOREIGN KEY ("major_id") REFERENCES "motivation_category_majors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motivation_category_minors" ADD CONSTRAINT "motivation_category_minors_middle_id_fkey" FOREIGN KEY ("middle_id") REFERENCES "motivation_category_middles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
