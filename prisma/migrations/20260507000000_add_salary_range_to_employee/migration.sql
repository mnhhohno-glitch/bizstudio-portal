-- CreateEnum
CREATE TYPE "SalaryRange" AS ENUM ('SALES', 'OFFICE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "salary_range" "SalaryRange" NOT NULL DEFAULT 'SALES';
