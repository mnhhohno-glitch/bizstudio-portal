-- T-189 Phase3-1: 自動配信のLINE案内をCAが送った日時（nullable・既存行は NULL のまま）
ALTER TABLE "candidates" ADD COLUMN     "last_line_sent_at" TIMESTAMP(3);
