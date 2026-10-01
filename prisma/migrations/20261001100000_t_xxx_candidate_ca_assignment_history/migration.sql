-- T-XXX step2: 担当CA変更の記録テーブル（candidate_ca_assignment_histories）。
-- 新規テーブルの追加のみ。既存テーブル・既存レコードは書き換えない。
-- 末尾の INSERT は「記録の起点」として今の担当CAのスナップショットを 1 回だけ入れる
-- （変更前CA = NULL・経路 = initial_snapshot）。マイグレーションは 1 回しか実行されないので二重投入にならない。

-- CreateTable
CREATE TABLE "candidate_ca_assignment_histories" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "from_employee_id" TEXT,
    "to_employee_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" TEXT,
    "route" TEXT NOT NULL,

    CONSTRAINT "candidate_ca_assignment_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_ca_assignment_histories_candidate_id_changed_at_idx" ON "candidate_ca_assignment_histories"("candidate_id", "changed_at");

-- CreateIndex
CREATE INDEX "candidate_ca_assignment_histories_changed_at_idx" ON "candidate_ca_assignment_histories"("changed_at");

-- AddForeignKey
ALTER TABLE "candidate_ca_assignment_histories" ADD CONSTRAINT "candidate_ca_assignment_histories_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 記録の起点: 担当CAが入っている求職者について、今の担当CAを「変更後CA」としてスナップショット（1回だけ）。
-- id は求職者IDから決定的に作る（'snap_' + candidates.id）。candidates は読むだけで書き換えない。
INSERT INTO "candidate_ca_assignment_histories" ("id", "candidate_id", "from_employee_id", "to_employee_id", "changed_at", "changed_by_user_id", "route")
SELECT 'snap_' || c."id", c."id", NULL, c."employee_id", CURRENT_TIMESTAMP, NULL, 'initial_snapshot'
FROM "candidates" c
WHERE c."employee_id" IS NOT NULL;
