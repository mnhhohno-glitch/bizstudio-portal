-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "employee_id" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "name_kana" TEXT;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
