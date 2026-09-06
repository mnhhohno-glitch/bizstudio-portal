-- T-189 Phase3-2a: 求職者本人が「対象外」を選んだ理由（nullable・既存行は NULL のまま）
ALTER TABLE "candidate_files" ADD COLUMN     "candidate_exclude_reason" TEXT;
