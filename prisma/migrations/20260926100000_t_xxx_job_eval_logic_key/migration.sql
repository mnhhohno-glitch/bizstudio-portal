-- T-XXX step8: 判定の同一性キー（EVAL_LOGIC_VERSION + SKILL 本文）。既存行は null のまま（eval-history.ts で読み替え）
ALTER TABLE "job_eval_records" ADD COLUMN "logic_key" TEXT;
