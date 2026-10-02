-- T-XXX step6: 社員の稼働しない期間（期間だけ・理由は保存しない）。追加のみ・既存レコードは変更しない。
-- CreateTable
CREATE TABLE "employee_inactive_periods" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_inactive_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_inactive_periods_employee_id_start_date_idx" ON "employee_inactive_periods"("employee_id", "start_date");

-- AddForeignKey
ALTER TABLE "employee_inactive_periods" ADD CONSTRAINT "employee_inactive_periods_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
