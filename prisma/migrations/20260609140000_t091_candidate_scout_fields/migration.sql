-- T-091: 求職者の配信日・応募日・MAS種別。nullable・後方互換。
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "scout_delivery_date" TIMESTAMP(3);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "application_date" TIMESTAMP(3);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "mas_type" TEXT;
