-- T-190 Step3-1: マイナビ「スカウト履歴一覧」の受け口
-- 新規テーブル追加のみ。既存テーブルのカラム変更・データ書き換えは行わない。
--
-- owner_key / subject_key は冪等 upsert 用の NOT NULL 列。
-- Postgres の UNIQUE は NULL 同士を「別物」と扱うため、nullable な candidate_id / subject を
-- そのまま複合ユニークにすると同じ行が何度でも入ってしまう。そのため
--   owner_key  = candidate_id（無ければ "mn:<会員No>"）
--   subject_key = 件名の空白除去値（件名が無ければ空文字）
-- を別列に持たせ、この3列で一意にしている。

-- CreateTable
CREATE TABLE "mynavi_scout_histories" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "mynavi_member_no" TEXT,
    "scout_date" TIMESTAMP(3) NOT NULL,
    "scout_sent_at" TIMESTAMP(3),
    "subject" TEXT,
    "status_text" TEXT NOT NULL,
    "is_applied" BOOLEAN NOT NULL DEFAULT false,
    "recruiter_name" TEXT,
    "recruiter_normalized" TEXT,
    "owner_key" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mynavi_scout_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mynavi_scout_histories_mynavi_member_no_idx" ON "mynavi_scout_histories"("mynavi_member_no");

-- CreateIndex
CREATE INDEX "mynavi_scout_histories_candidate_id_idx" ON "mynavi_scout_histories"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "mynavi_scout_histories_owner_key_scout_date_subject_key_key" ON "mynavi_scout_histories"("owner_key", "scout_date", "subject_key");

-- AddForeignKey
ALTER TABLE "mynavi_scout_histories" ADD CONSTRAINT "mynavi_scout_histories_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
