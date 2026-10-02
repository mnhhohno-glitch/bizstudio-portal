// T-XXX step3: 復元テスト用。Google ドライブの専用フォルダから最新のバックアップ一式を取り出す。
//
// 一式 = 同じ日時スタンプの
//   portal-db_<stamp>.dump.gpg / portal-db_<stamp>.counts.json / railway-vars_<stamp>.json.gpg
// 最新の DB コピーを基準に 3 つ揃っているものを選ぶ。揃っていなければ失敗。
//
// 使い方: node drive-fetch-latest.mjs <outDir> [maxAgeHours]
//   最新コピーが maxAgeHours（既定 36 時間）より古ければ失敗にする。
//   「夜間バックアップが黙って止まっている」状態を、週次の復元テストで拾うため。
// 環境変数: GOOGLE_SERVICE_ACCOUNT_KEY, BACKUP_DRIVE_FOLDER_ID
// GITHUB_OUTPUT に stamp / age_hours / dump_name を書く。

import fs from "node:fs";
import path from "node:path";
import { downloadFile, listBackupFiles, parseBackupName, requireFolderId } from "./drive-lib.mjs";

const outDir = process.argv[2];
const maxAgeHours = Number(process.argv[3] ?? "36");
if (!outDir) throw new Error("出力ディレクトリを第1引数に指定してください");
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

const folderId = requireFolderId();
const files = await listBackupFiles(folderId);
const dumps = files
  .map((f) => ({ f, p: parseBackupName(f.name) }))
  .filter((x) => x.p && x.p.kind === "portal-db" && x.p.ext === "dump.gpg")
  .sort((a, b) => (a.p.stamp < b.p.stamp ? 1 : -1));

if (dumps.length === 0) throw new Error("専用フォルダに DB コピー（portal-db_*.dump.gpg）がありません");
const latest = dumps[0];
const stamp = latest.p.stamp;

const counts = files.find((f) => f.name === `portal-db_${stamp}.counts.json`);
const vars = files.find((f) => f.name === `railway-vars_${stamp}.json.gpg`);
if (!counts || !vars) {
  throw new Error(`最新コピー ${stamp} に件数表または変数JSONが揃っていません（counts=${!!counts}, vars=${!!vars}）`);
}

// スタンプは JST。経過時間は UTC の作成時刻（Drive の createdTime）から計算する方が確実。
const createdAt = new Date(latest.f.createdTime).getTime();
const ageHours = (Date.now() - createdAt) / 3_600_000;
console.log(`[drive-fetch-latest] 最新コピー: ${stamp}（Drive 作成から ${ageHours.toFixed(1)} 時間）`);
if (ageHours > maxAgeHours) {
  throw new Error(`最新コピーが ${maxAgeHours} 時間より古い（${ageHours.toFixed(1)} 時間）。夜間バックアップが止まっている可能性があります`);
}

for (const f of [latest.f, counts, vars]) {
  const size = await downloadFile(f.id, path.join(outDir, f.name));
  console.log(`[drive-fetch-latest] 取得: ${f.name} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `stamp=${stamp}\nage_hours=${ageHours.toFixed(1)}\ndump_name=${latest.f.name}\ndump_mb=${(Number(latest.f.size) / 1024 / 1024).toFixed(1)}\n`,
  );
}
