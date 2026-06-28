-- T-067 Phase B-1: スカウト配信明細テーブル（会員No・配信日・担当者・号機）。
-- 純粋追加（新規テーブルのみ・既存テーブル/カラム/データ非変更＝非破壊）。

-- CreateTable
CREATE TABLE "scout_send_records" (
    "id" TEXT NOT NULL,
    "member_no" TEXT NOT NULL,
    "delivery_date" DATE NOT NULL,
    "recruiter_name" TEXT,
    "machine_number" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scout_send_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scout_send_records_member_no_idx" ON "scout_send_records"("member_no");

-- CreateIndex
CREATE UNIQUE INDEX "scout_send_records_member_no_delivery_date_machine_number_key" ON "scout_send_records"("member_no", "delivery_date", "machine_number");
