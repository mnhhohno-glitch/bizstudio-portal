// T-147: Supabase 非公開バケット "secure-transfers" の作成スクリプト（冪等）。
//
// 実行方法:
//   ローカル .env には SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が無いため、
//   Railway コンテナ上で実行する（ref: 本番DBへの読み書き手順と同じ経路）。
//     MSYS_NO_PATHCONV=1 railway ssh --service bizstudio-portal -- node /tmp/create-secure-transfers-bucket.js
//   ※ コンテナには tsx が無いため、実行時はこのファイルの型注釈を落としたJS版を
//     base64 で /tmp に転送して node で実行する（内容は本ファイルと同一ロジック）。
//
// - public = false（非公開）。閲覧はサーバー発行の署名付きURL経由のみ。
// - 既にバケットが存在する場合は何もしない（冪等）。ただし public=true で存在していた場合は
//   エラーで落とす（手で直すべき設定齟齬を黙って通さない）。

import { createClient } from "@supabase/supabase-js";

const BUCKET = "secure-transfers";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  const supabase = createClient(url, key);

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  const existing = (buckets ?? []).find((b) => b.name === BUCKET);
  if (existing) {
    if (existing.public) {
      throw new Error(
        `bucket "${BUCKET}" exists but is PUBLIC. Fix it manually (must be private).`
      );
    }
    console.log(`bucket already exists (private): ${BUCKET} — skip`);
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  });
  if (createError) throw createError;
  console.log(`created private bucket: ${BUCKET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
