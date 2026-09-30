-- T-208 step4: 面談スクリプトの答えを入れるのをサーバー側に移した。すでに値がある欄への提案（欄のパス → 値）を
-- applied とは別の列に保存する。nullable 列の追加のみ（IF NOT EXISTS で冪等）。
ALTER TABLE "interview_script_answers" ADD COLUMN IF NOT EXISTS "proposals" JSONB;
