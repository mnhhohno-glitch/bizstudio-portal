-- T-205 step8: 面談準備の整理を決まった項目で保存する列と、「聞いた」質問の記録。nullable 列の追加のみ。
-- prisma migrate diff の出力を IF NOT EXISTS で冪等化したもの。

-- AlterTable
ALTER TABLE "interview_prep_rooms" ADD COLUMN IF NOT EXISTS "summary_json" JSONB;
ALTER TABLE "interview_prep_rooms" ADD COLUMN IF NOT EXISTS "asked_questions" JSONB;
