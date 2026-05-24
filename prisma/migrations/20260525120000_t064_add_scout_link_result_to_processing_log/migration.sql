-- T-064: PDF取り込み時の自動紐付け結果を MynaviRpaProcessingLog に記録

ALTER TABLE "mynavi_rpa_processing_logs"
  ADD COLUMN IF NOT EXISTS "scout_link_result" TEXT,
  ADD COLUMN IF NOT EXISTS "scout_linked_slot_id" TEXT;
