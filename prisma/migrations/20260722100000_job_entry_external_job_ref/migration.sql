-- サイト経由(route="site-apply")エントリー用: 応募元求人の識別子 externalJobRef を保持し、
-- 企業名クリックから自社求人サイト(bizstudio-job-platform)詳細ページを SSO で開けるようにする。
-- 純粋追加(nullable TEXT 1列。既存 JobEntry は NULL のまま挙動不変。求人紹介経由の originalUrl 経路は不変)。
SET lock_timeout = '5s';

ALTER TABLE "job_entries"
  ADD COLUMN "external_job_ref" TEXT;
