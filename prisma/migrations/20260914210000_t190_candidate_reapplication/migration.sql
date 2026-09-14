-- T-190: 再応募の記録（1人1レコード運用）
-- 同一人物の再応募を検知したとき、新規レコードを作らず既存レコードに回数と最終日時を残す。
-- 既存行は書き換えない（NOT NULL DEFAULT 0 / nullable のカラム追加のみ）。
ALTER TABLE "candidates" ADD COLUMN "reapplication_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "candidates" ADD COLUMN "last_reapplication_at" TIMESTAMP(3);
