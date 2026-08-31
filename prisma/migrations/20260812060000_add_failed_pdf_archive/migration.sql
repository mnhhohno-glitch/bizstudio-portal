-- AI解析失敗時に退避したPDFの Drive ファイルID / 閲覧URL を保持する。
-- 失敗したPDFが現存しないと原因の再現ができないため追加（2026-08-12）。
-- 既存行は NULL。nullable カラム追加のみでデータ書き換えは無い。
ALTER TABLE "mynavi_rpa_processing_logs" ADD COLUMN     "failed_pdf_file_id" TEXT,
ADD COLUMN     "failed_pdf_url" TEXT;
