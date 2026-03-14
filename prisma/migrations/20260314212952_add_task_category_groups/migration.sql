-- AlterTable
ALTER TABLE "task_categories" ADD COLUMN     "group_id" TEXT;

-- CreateTable
CREATE TABLE "task_category_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_category_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_category_groups_name_key" ON "task_category_groups"("name");

-- AddForeignKey
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "task_category_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
