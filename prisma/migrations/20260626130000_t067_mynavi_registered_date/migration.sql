-- T-067: マイナビ登録日カラム追加（masType判定の入力）。純粋追加・nullable・既存行はnull（非破壊）。

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "mynavi_registered_date" TIMESTAMP(3);
