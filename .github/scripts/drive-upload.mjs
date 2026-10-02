// T-XXX step3: 暗号化済みバックアップを Google ドライブの専用フォルダに置く。
//
// 使い方: node drive-upload.mjs <localPath>:<driveName> [<localPath>:<driveName> ...]
// 環境変数: GOOGLE_SERVICE_ACCOUNT_KEY, BACKUP_DRIVE_FOLDER_ID
// 出力: 置いたファイルの名前・サイズ・ID だけ（中身や鍵は出さない）。
//
// 暗号化していないファイル（.dump / .json）を置こうとしたら拒否する。
// 例外は件数表 *.counts.json（件数だけで個人情報を含まないので平文のまま）。

import { requireFolderId, uploadFile } from "./drive-lib.mjs";

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("アップロード対象を <localPath>:<driveName> で指定してください");

const folderId = requireFolderId();
const results = [];
for (const arg of args) {
  const idx = arg.lastIndexOf(":");
  if (idx <= 0) throw new Error(`引数の形式が不正です: ${arg}`);
  const localPath = arg.slice(0, idx);
  const name = arg.slice(idx + 1);
  const encrypted = name.endsWith(".gpg");
  const countsTable = name.endsWith(".counts.json");
  if (!encrypted && !countsTable) {
    throw new Error(`暗号化されていないファイルは置けません: ${name}`);
  }
  const mime = encrypted ? "application/pgp-encrypted" : "application/json";
  const r = await uploadFile(folderId, localPath, name, mime);
  results.push(r);
  console.log(`[drive-upload] ${r.name} (${(r.size / 1024 / 1024).toFixed(1)} MB) id=${r.id}`);
}

if (process.env.GITHUB_OUTPUT) {
  const fs = await import("node:fs");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `uploaded=${results.map((r) => r.name).join(",")}\n`);
}
