-- T-206 step1: 面接対策ページ（interview_prep_pages）と版（interview_prep_page_versions）。新テーブルの追加のみ・既存テーブルは変更しない。
-- CreateTable
CREATE TABLE "interview_prep_pages" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "interview_date" TIMESTAMP(3),
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "stopped_at" TIMESTAMP(3),
    "stopped_reason" TEXT,
    "use_wrapper" BOOLEAN NOT NULL DEFAULT true,
    "require_birthdate" BOOLEAN NOT NULL DEFAULT true,
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "verify_fail_count" INTEGER NOT NULL DEFAULT 0,
    "verify_fail_window_start" TIMESTAMP(3),
    "verify_locked_until" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interview_prep_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_prep_page_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_prep_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interview_prep_pages_slug_key" ON "interview_prep_pages"("slug");

-- CreateIndex
CREATE INDEX "interview_prep_pages_candidate_id_idx" ON "interview_prep_pages"("candidate_id");

-- CreateIndex
CREATE INDEX "interview_prep_pages_entry_id_idx" ON "interview_prep_pages"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_prep_page_versions_page_id_version_no_key" ON "interview_prep_page_versions"("page_id", "version_no");

-- AddForeignKey
ALTER TABLE "interview_prep_pages" ADD CONSTRAINT "interview_prep_pages_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_prep_pages" ADD CONSTRAINT "interview_prep_pages_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "job_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_prep_pages" ADD CONSTRAINT "interview_prep_pages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_prep_page_versions" ADD CONSTRAINT "interview_prep_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "interview_prep_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_prep_page_versions" ADD CONSTRAINT "interview_prep_page_versions_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

