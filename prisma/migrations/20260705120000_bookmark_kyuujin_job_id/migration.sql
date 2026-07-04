-- 求人ID紐付け step1: CandidateFile に kyuujinPDF の Job 内部ID（jobs.id・Int）を保持する列を追加。
-- 抽出完了通知(extraction-complete webhook)でファイル名突合して書き込む。mypage の「担当CAのおすすめ」が
-- 会社名照合を廃止しこのIDで直接 kyuujinPDF Job を引くための鍵。externalJobRef(job-platform UUID)とは別系統。
-- 非破壊（ADD COLUMN のみ・既存データの UPDATE/backfill なし）。lock_timeout で長時間ロックを回避。
SET lock_timeout = '5s';
ALTER TABLE "candidate_files" ADD COLUMN "kyuujin_job_id" INTEGER;
