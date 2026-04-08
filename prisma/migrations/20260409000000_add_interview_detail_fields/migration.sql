-- 左カラム
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "career_summary" TEXT;

-- 初期条件タブ: 登録時条件
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_industry_1" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_industry_2" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_industry_3" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_job_type_1" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_job_type_2" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_job_type_3" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_area_prefecture" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_area_city" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_employment_type" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_salary_min" INTEGER;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_salary_max" INTEGER;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_holidays" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_overtime" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_job_features" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_company_features" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_free_memo" TEXT;

-- アクションタブ追加
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "contact_method" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "contact_memo" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "job_send_deadline" TIMESTAMP(3);
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "next_action" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "gpt_memo" TEXT;

-- 働き方チェックボックス
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "work_style_preferences" TEXT;

-- テキストメモタブ
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "existing_interview_memo" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "interview_prep_memo" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "referral_history" TEXT;
