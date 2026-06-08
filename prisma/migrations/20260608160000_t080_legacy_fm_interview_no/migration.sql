-- T-080: FileMaker 過去面談履歴の取り込み追跡・冪等判定用カラム（nullable・追加のみ・冪等）。
-- 既存データへの影響なし。portal 上の新規面談は常に NULL。取り込みレコードのみ FM 面談NO を保持。
ALTER TABLE "interview_records" ADD COLUMN IF NOT EXISTS "legacy_fm_interview_no" TEXT;
CREATE INDEX IF NOT EXISTS "interview_records_legacy_fm_interview_no_idx" ON "interview_records"("legacy_fm_interview_no");
