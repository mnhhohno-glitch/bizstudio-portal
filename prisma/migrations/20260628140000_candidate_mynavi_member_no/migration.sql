-- T-067 Phase B-3: Candidate にマイナビ会員No列を追加（ScoutSendRecord 照合キー）。
-- 純粋追加（nullable・既存行は null・既存カラム/データ非変更＝非破壊）。

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "mynavi_member_no" TEXT;

-- CreateIndex
CREATE INDEX "candidates_mynavi_member_no_idx" ON "candidates"("mynavi_member_no");
