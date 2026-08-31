-- T-158: 求職者ごとの OneDrive 資料フォルダURL
-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "onedrive_folder_url" TEXT;
