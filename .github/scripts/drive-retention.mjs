// T-XXX step3: Google ドライブの専用フォルダの世代整理。
//
// 残すもの:
//   - 直近 35 日分（日付はファイル名の JST 日付で判定）
//   - 毎月 1 日分を 12 か月分（= 366 日以内の 1 日付き）
// 消すもの:
//   - 上記以外で、かつ「このワークフローが作ったファイル」（appProperties の目印あり・名前が規約どおり）だけ。
//     目印の無いファイル・名前が規約外のファイルは、専用フォルダの中にあっても絶対に触らない。
//
// 環境変数: GOOGLE_SERVICE_ACCOUNT_KEY, BACKUP_DRIVE_FOLDER_ID
// DRY_RUN=1 なら消さずに対象を表示するだけ。

import { deleteFile, jstParts, listBackupFiles, parseBackupName, requireFolderId } from "./drive-lib.mjs";

const KEEP_DAILY_DAYS = 35;
const KEEP_MONTHLY_DAYS = 366;

const folderId = requireFolderId();
const dryRun = process.env.DRY_RUN === "1";
const today = jstParts().date;

function daysBetween(fromDate, toDate) {
  const a = Date.UTC(...fromDate.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  const b = Date.UTC(...toDate.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v)));
  return Math.round((b - a) / 86_400_000);
}

const files = await listBackupFiles(folderId);
let kept = 0;
let removed = 0;
let skipped = 0;
for (const f of files) {
  const parsed = parseBackupName(f.name);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  const age = daysBetween(parsed.date, today);
  const keep = age <= KEEP_DAILY_DAYS || (parsed.day === 1 && age <= KEEP_MONTHLY_DAYS);
  if (keep) {
    kept += 1;
    continue;
  }
  if (dryRun) {
    console.log(`[drive-retention] (dry-run) 削除対象: ${f.name} (${age}日前)`);
    removed += 1;
    continue;
  }
  const how = await deleteFile(f.id);
  console.log(`[drive-retention] ${how}: ${f.name} (${age}日前)`);
  removed += 1;
}
console.log(`[drive-retention] today(JST)=${today} 保持=${kept} 削除=${removed} 対象外=${skipped}`);
