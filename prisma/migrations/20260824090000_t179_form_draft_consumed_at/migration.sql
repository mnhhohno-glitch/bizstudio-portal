-- T-179: 面談前フォームの下書きに「使用済み」の印を持たせる。
-- null = 作りかけ（未使用）、値あり = その内容でフォームを作成済み。
-- 既存レコードは全て NULL のまま（既存データの書き換えは行わない）。

-- AlterTable
ALTER TABLE "form_drafts" ADD COLUMN     "consumed_at" TIMESTAMP(3);
