-- CreateTable
CREATE TABLE "interview_records" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "interview_date" TIMESTAMP(3) NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "duration" INTEGER,
    "interview_tool" TEXT NOT NULL,
    "interviewer_user_id" TEXT NOT NULL,
    "interview_type" TEXT NOT NULL,
    "interview_count" INTEGER,
    "result_flag" TEXT,
    "interview_memo" TEXT,
    "previous_memo" TEXT,
    "summary_text" TEXT,
    "raw_transcript" TEXT,
    "resume_pdf_file_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_details" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "agent_usage_flag" TEXT,
    "agent_usage_memo" TEXT,
    "employment_status" TEXT,
    "resignation_date" TIMESTAMP(3),
    "job_change_timeline" TEXT,
    "job_change_timeline_memo" TEXT,
    "activity_period" TEXT,
    "activity_period_memo" TEXT,
    "current_application_count" INTEGER,
    "application_type_flag" TEXT,
    "application_memo" TEXT,
    "education_flag" TEXT,
    "education_memo" TEXT,
    "graduation_date" TEXT,
    "company_name" TEXT,
    "business_content" TEXT,
    "tenure" TEXT,
    "job_type_flag" TEXT,
    "job_type_memo" TEXT,
    "resign_reason_large" TEXT,
    "resign_reason_medium" TEXT,
    "resign_reason_small" TEXT,
    "job_change_reason_memo" TEXT,
    "job_change_axis_flag" TEXT,
    "job_change_axis_memo" TEXT,
    "desired_job_type_1" TEXT,
    "desired_job_type_1_memo" TEXT,
    "desired_job_type_2" TEXT,
    "desired_industry_1" TEXT,
    "desired_industry_1_memo" TEXT,
    "desired_area" TEXT,
    "desired_prefecture" TEXT,
    "desired_city" TEXT,
    "desired_area_memo" TEXT,
    "current_salary" INTEGER,
    "current_salary_memo" TEXT,
    "desired_salary_min" INTEGER,
    "desired_salary_min_memo" TEXT,
    "desired_salary_max" INTEGER,
    "desired_salary_max_memo" TEXT,
    "desired_day_off" TEXT,
    "desired_day_off_memo" TEXT,
    "desired_holiday_count" TEXT,
    "desired_overtime_max" TEXT,
    "desired_overtime_memo" TEXT,
    "desired_transfer" TEXT,
    "desired_transfer_memo" TEXT,
    "work_style_flags" TEXT,
    "company_feature_flags" TEXT,
    "priority_condition_1" TEXT,
    "priority_condition_2" TEXT,
    "priority_condition_3" TEXT,
    "priority_condition_memo" TEXT,
    "driver_license_flag" TEXT,
    "driver_license_memo" TEXT,
    "language_skill_flag" TEXT,
    "language_skill_memo" TEXT,
    "chinese_skill_memo" TEXT,
    "japanese_skill_flag" TEXT,
    "japanese_skill_memo" TEXT,
    "typing_flag" TEXT,
    "typing_memo" TEXT,
    "excel_flag" TEXT,
    "excel_memo" TEXT,
    "word_flag" TEXT,
    "word_memo" TEXT,
    "ppt_flag" TEXT,
    "ppt_memo" TEXT,
    "document_status_flag" TEXT,
    "document_status_memo" TEXT,
    "document_support_flag" TEXT,
    "document_support_memo" TEXT,
    "job_referral_flag" TEXT,
    "job_referral_timeline" TEXT,
    "job_referral_memo" TEXT,
    "line_setup_flag" TEXT,
    "line_setup_memo" TEXT,
    "next_interview_flag" TEXT,
    "next_interview_date" TIMESTAMP(3),
    "next_interview_time" TEXT,
    "next_interview_memo" TEXT,
    "free_memo" TEXT,
    "initial_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_ratings" (
    "id" TEXT NOT NULL,
    "interview_record_id" TEXT NOT NULL,
    "personality_motivation" INTEGER,
    "personality_motivation_memo" TEXT,
    "personality_communication" INTEGER,
    "personality_communication_memo" TEXT,
    "personality_manner" INTEGER,
    "personality_manner_memo" TEXT,
    "personality_intelligence" INTEGER,
    "personality_intelligence_memo" TEXT,
    "personality_humanity" INTEGER,
    "personality_humanity_memo" TEXT,
    "personality_total" INTEGER,
    "personality_total_memo" TEXT,
    "career_job_type" INTEGER,
    "career_job_type_memo" TEXT,
    "career_experience" INTEGER,
    "career_experience_memo" TEXT,
    "career_job_change_count" INTEGER,
    "career_job_change_count_memo" TEXT,
    "career_achievement" INTEGER,
    "career_achievement_memo" TEXT,
    "career_qualification" INTEGER,
    "career_qualification_memo" TEXT,
    "career_total" INTEGER,
    "career_total_memo" TEXT,
    "condition_job_type" INTEGER,
    "condition_job_type_memo" TEXT,
    "condition_salary" INTEGER,
    "condition_salary_memo" TEXT,
    "condition_holiday" INTEGER,
    "condition_holiday_memo" TEXT,
    "condition_area" INTEGER,
    "condition_area_memo" TEXT,
    "condition_flexibility" INTEGER,
    "condition_flexibility_memo" TEXT,
    "condition_total" INTEGER,
    "condition_total_memo" TEXT,
    "grand_total" INTEGER,
    "grand_total_memo" TEXT,
    "overall_rank" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_records_candidate_id_idx" ON "interview_records"("candidate_id");
CREATE INDEX "interview_records_interview_date_idx" ON "interview_records"("interview_date");

-- CreateIndex
CREATE UNIQUE INDEX "interview_details_interview_record_id_key" ON "interview_details"("interview_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_ratings_interview_record_id_key" ON "interview_ratings"("interview_record_id");

-- AddForeignKey
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_interviewer_user_id_fkey" FOREIGN KEY ("interviewer_user_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interview_records" ADD CONSTRAINT "interview_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_details" ADD CONSTRAINT "interview_details_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_ratings" ADD CONSTRAINT "interview_ratings_interview_record_id_fkey" FOREIGN KEY ("interview_record_id") REFERENCES "interview_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
