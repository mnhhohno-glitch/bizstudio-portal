-- T-196: ブックマーク一覧の「エリア」「職種」列。
--   値は job-platform（求人プラットフォーム）が取り込み時に自社マスタの対応表で確定した値のコピー。
--   job_category は T-161/T-185 で既に存在するため実質 no-op（列を新設せず流用する）。冪等・非破壊。
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "job_area" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "job_category" TEXT;
ALTER TABLE "candidate_files" ADD COLUMN IF NOT EXISTS "job_category_path" TEXT;
