-- T-205 step4: 面談準備の「会社と学校の下調べ」の保存先。nullable 列の追加のみ。
-- prisma migrate diff の出力を IF NOT EXISTS で冪等化したもの。

-- AlterTable
ALTER TABLE "interview_prep_rooms" ADD COLUMN IF NOT EXISTS "research_json" JSONB;
ALTER TABLE "interview_prep_rooms" ADD COLUMN IF NOT EXISTS "researched_at" TIMESTAMP(3);
