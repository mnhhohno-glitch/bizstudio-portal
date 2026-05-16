-- T-062: 担当RC（スカウト配信者名）カラム追加

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "recruiter_name" TEXT;
