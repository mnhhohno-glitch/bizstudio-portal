-- 改修③（途中保存）: 面談前フォーム質問の下書きテーブル。純粋追加（既存データ非破壊）。
-- CreateTable
CREATE TABLE "form_drafts" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "questions_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_drafts_candidate_id_key" ON "form_drafts"("candidate_id");
