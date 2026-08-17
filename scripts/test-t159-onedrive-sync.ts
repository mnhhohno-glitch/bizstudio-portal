/**
 * T-159 Phase 2-a: 書き込み先ガード（src/lib/microsoft-graph.ts）と
 * 同期ヘルパー（src/lib/onedrive-sync.ts）のユニットテスト。
 *
 * 本リポジトリにはテストフレームワーク（vitest/jest）が導入されていないため、
 * scripts/ 配下の tsx 実行スクリプトとして自己完結のアサーションランナーで実装している
 * （既存の scripts/test-t150-jst-utils.ts と同じ方式）。
 *
 * 実行:
 *   npx tsx scripts/test-t159-onedrive-sync.ts
 *
 * ネットワーク・DB には一切アクセスしない（すべて純関数のテスト）。
 *
 * 終了コード: 全件パス=0 / 1件でも失敗=1
 */

import { CandidateFileCategory, OneDriveSyncSkipReason } from "@prisma/client";
import {
  ONEDRIVE_WRITE_ROOT,
  assertOneDriveWritePath,
  drivePathFromParentReference,
} from "@/lib/microsoft-graph";
import {
  buildOneDriveTargetPath,
  isOneDriveSyncEnabled,
  oneDriveSubfolderForCategory,
  restoreDrivePathFromFolderUrl,
  truncateErrorMessage,
} from "@/lib/onedrive-sync";

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  const e = typeof expected === "string" ? expected : JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}  → ${a}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}\n      実際: ${a}\n      期待: ${e}`);
  }
}

/** fn が例外を投げること（＝ガードが効くこと）を確かめる。 */
function throws(label: string, fn: () => unknown) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${label}  → 例外が投げられませんでした（ガードが効いていない）`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("書き込み先ガード")) {
      failed++;
      console.error(`  ✗ ${label}  → 例外は出たがガード由来ではない: ${msg}`);
      return;
    }
    passed++;
    console.log(`  ✓ ${label}  → 拒否: ${msg.slice(0, 90)}…`);
  }
}

/** fn が例外を投げないこと。 */
function noThrow(label: string, fn: () => unknown) {
  try {
    const v = fn();
    passed++;
    console.log(`  ✓ ${label}  → ${typeof v === "string" ? v : "OK"}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${label}  → 通るべきパスが拒否された: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** ドライブ相対パスから SharePoint の my?id=... 形式のURLを組み立てる（テストデータ生成用）。 */
function toFolderUrl(drivePath: string, owner = "masayuki_oono_bizstudio_co_jp"): string {
  const id = `/personal/${owner}/Documents${drivePath}`;
  return `https://bizstudio-my.sharepoint.com/my?id=${encodeURIComponent(id)}`;
}

// ============================================================
console.log("\n[1] 書き込み先ガード assertOneDriveWritePath — 許可プレフィックス配下");
console.log(`    許可プレフィックス: ${ONEDRIVE_WRITE_ROOT}`);
// ============================================================

noThrow(
  "求職者フォルダ配下のファイル",
  () => assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連/1.大野/2026/202607/5008266_吉川 祐樹/2.求人/求人票.pdf"),
);
noThrow(
  "先頭スラッシュ無しでも同じ場所として通る",
  () => assertOneDriveWritePath("ビズスタジオ/6.求職者書類関連/4.安藤/2024～/x.pdf"),
);
noThrow("プレフィックス直下のファイル", () => assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連/a.pdf"));
eq(
  "戻り値は先頭スラッシュ補完のみで内容は不変",
  assertOneDriveWritePath("ビズスタジオ/6.求職者書類関連/4.安藤/2024～/5001272末富温/2.求人/a.pdf"),
  "/ビズスタジオ/6.求職者書類関連/4.安藤/2024～/5001272末富温/2.求人/a.pdf",
);

console.log("\n[2] 書き込み先ガード — 配下でないパスは拒否");
throws("ドライブのルート直下", () => assertOneDriveWritePath("/a.pdf"));
throws("別部署のフォルダ", () => assertOneDriveWritePath("/ビズスタジオ/1.経理/請求書.pdf"));
throws("ビズスタジオ配下だが別フォルダ", () => assertOneDriveWritePath("/ビズスタジオ/7.応募書類テンプレ/a.pdf"));
throws("プレフィックスそのもの（配下ではない）", () => assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連"));
throws("プレフィックスに似た別名（前方一致すり抜けの確認）", () =>
  assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連_旧/1.大野/a.pdf"),
);
throws("空パス", () => assertOneDriveWritePath(""));

console.log("\n[3] 書き込み先ガード — .. を含むパスは拒否");
throws("配下から上位へ抜ける", () =>
  assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連/../1.経理/請求書.pdf"),
);
throws("配下の深い位置に .. がある", () =>
  assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連/1.大野/2026/../../../a.pdf"),
);
throws("プレフィックスの手前に .. がある", () => assertOneDriveWritePath("/../ビズスタジオ/6.求職者書類関連/a.pdf"));
throws("ファイル名に連続ドット", () => assertOneDriveWritePath("/ビズスタジオ/6.求職者書類関連/1.大野/求人..pdf"));

console.log("\n[4] drivePathFromParentReference — ID指定削除の親パス復元");
eq(
  "/drive/root: 形式",
  drivePathFromParentReference("/drive/root:/ビズスタジオ/6.求職者書類関連/1.大野"),
  "/ビズスタジオ/6.求職者書類関連/1.大野",
);
eq(
  "percent-encode されて返ってきた場合",
  drivePathFromParentReference("/drives/abc/root:/%E3%83%93%E3%82%BA%E3%82%B9%E3%82%BF%E3%82%B8%E3%82%AA/6.%E6%B1%82%E8%81%B7%E8%80%85%E6%9B%B8%E9%A1%9E%E9%96%A2%E9%80%A3"),
  "/ビズスタジオ/6.求職者書類関連",
);
eq("ルート直下", drivePathFromParentReference("/drive/root:"), "/");
eq("undefined", drivePathFromParentReference(undefined), null);

// ============================================================
console.log("\n[5] パス復元 restoreDrivePathFromFolderUrl — 本番実データ（求職者番号 5008266）");
// ============================================================

// 本番 candidates.onedrive_folder_url の実値（Phase 2-0 で Graph 疎通確認に使ったのと同一の求職者）
const URL_5008266 =
  "https://bizstudio-my.sharepoint.com/my?id=%2Fpersonal%2Fmasayuki%5Foono%5Fbizstudio%5Fco%5Fjp%2FDocuments%2F%E3%83%93%E3%82%BA%E3%82%B9%E3%82%BF%E3%82%B8%E3%82%AA%2F6%2E%E6%B1%82%E8%81%B7%E8%80%85%E6%9B%B8%E9%A1%9E%E9%96%A2%E9%80%A3%2F1%2E%E5%A4%A7%E9%87%8E%2F2026%2F202607%2F5008266%5F%E5%90%89%E5%B7%9D%20%E7%A5%90%E6%A8%B9";
const FOLDER_5008266 = "/ビズスタジオ/6.求職者書類関連/1.大野/2026/202607/5008266_吉川 祐樹";

const restored5008266 = restoreDrivePathFromFolderUrl(URL_5008266);
eq("復元成功", restored5008266.ok, true);
eq("所有者セグメント", restored5008266.ok && restored5008266.ownerSegment, "masayuki_oono_bizstudio_co_jp");
eq("求職者フォルダのドライブ相対パス", restored5008266.ok && restored5008266.folderPath, FOLDER_5008266);
eq(
  "%2E → '.' / %5F → '_' / %20 → 半角スペース がすべて戻る",
  restored5008266.ok && restored5008266.folderPath.includes("6.求職者書類関連") &&
    restored5008266.ok && restored5008266.folderPath.includes("5008266_吉川") &&
    restored5008266.ok && restored5008266.folderPath.includes("吉川 祐樹"),
  true,
);

console.log("\n[6] パス復元 — 復元できない URL はフェイルクローズ");
eq("null", restoreDrivePathFromFolderUrl(null), { ok: false, reason: "EMPTY" });
eq("空文字", restoreDrivePathFromFolderUrl(""), { ok: false, reason: "EMPTY" });
eq("URL でない", restoreDrivePathFromFolderUrl("これはURLではない"), { ok: false, reason: "NOT_A_URL" });
eq("id= が無い", restoreDrivePathFromFolderUrl("https://bizstudio-my.sharepoint.com/my"), {
  ok: false,
  reason: "NO_ID_PARAM",
});
eq(
  "/personal/{owner}/Documents/ の形でない",
  restoreDrivePathFromFolderUrl("https://bizstudio-my.sharepoint.com/my?id=%2Fsites%2Fteam%2FShared"),
  { ok: false, reason: "UNEXPECTED_ID_FORMAT" },
);
eq(
  "求職者書類関連の外を指す URL（誤って貼られた場合）",
  restoreDrivePathFromFolderUrl(toFolderUrl("/ビズスタジオ/1.経理")),
  { ok: false, reason: "OUTSIDE_WRITE_ROOT" },
);

console.log("\n[7] パス復元 — 特殊文字を正規化で壊していないこと（罠の再発防止）");
const TILDE_PATH = "/ビズスタジオ/6.求職者書類関連/4.安藤/2024～/2024年/5001272末富温"; // ～ = U+FF5E
const tilde = restoreDrivePathFromFolderUrl(toFolderUrl(TILDE_PATH));
eq("全角チルダ U+FF5E がそのまま残る", tilde.ok && tilde.folderPath, TILDE_PATH);
eq(
  "U+FF5E のまま（NFKC なら U+007E に化ける）",
  tilde.ok && tilde.folderPath.includes("～") && !tilde.folderPath.includes("2024~"),
  true,
);
const IDEO_PATH = "/ビズスタジオ/6.求職者書類関連/1.大野/2024/202409/5001072_松﨑 優真"; // 﨑 = U+FA11
const ideo = restoreDrivePathFromFolderUrl(toFolderUrl(IDEO_PATH));
eq("異体字 U+FA11 がそのまま残る", ideo.ok && ideo.folderPath, IDEO_PATH);
eq("U+FA11 のまま", ideo.ok && ideo.folderPath.includes("﨑"), true);
const WIDE_SPACE_PATH = "/ビズスタジオ/6.求職者書類関連/1.大野/2024/202409/5001073_山田　太郎"; // U+3000
const wide = restoreDrivePathFromFolderUrl(toFolderUrl(WIDE_SPACE_PATH));
eq("全角スペース U+3000 がそのまま残る", wide.ok && wide.folderPath, WIDE_SPACE_PATH);

// ============================================================
console.log("\n[8] カテゴリ → サブフォルダ名");
// ============================================================
eq("BOOKMARK", oneDriveSubfolderForCategory(CandidateFileCategory.BOOKMARK), "2.求人");
eq("BS_DOCUMENT", oneDriveSubfolderForCategory(CandidateFileCategory.BS_DOCUMENT), "3.BS作成書類");
eq("MEETING は対象外", oneDriveSubfolderForCategory(CandidateFileCategory.MEETING), null);
eq("ORIGINAL は対象外", oneDriveSubfolderForCategory(CandidateFileCategory.ORIGINAL), null);
eq("APPLICATION は対象外", oneDriveSubfolderForCategory(CandidateFileCategory.APPLICATION), null);

// ============================================================
console.log("\n[9] 書き込み先パスの組み立て buildOneDriveTargetPath（5008266 で期待値固定）");
// ============================================================

const bookmarkTarget = buildOneDriveTargetPath({
  oneDriveFolderUrl: URL_5008266,
  category: CandidateFileCategory.BOOKMARK,
  fileName: "求人票_株式会社テスト.pdf",
});
eq("BOOKMARK 組み立て成功", bookmarkTarget.ok, true);
eq(
  "BOOKMARK 投入先フォルダ",
  bookmarkTarget.ok && bookmarkTarget.folderPath,
  `${FOLDER_5008266}/2.求人`,
);
eq(
  "BOOKMARK targetPath",
  bookmarkTarget.ok && bookmarkTarget.targetPath,
  `${FOLDER_5008266}/2.求人/求人票_株式会社テスト.pdf`,
);
eq("BOOKMARK 求職者フォルダ本体", bookmarkTarget.ok && bookmarkTarget.candidateFolderPath, FOLDER_5008266);

const docTarget = buildOneDriveTargetPath({
  oneDriveFolderUrl: URL_5008266,
  category: CandidateFileCategory.BS_DOCUMENT,
  fileName: "職務経歴書_吉川 祐樹.docx",
});
eq(
  "BS_DOCUMENT targetPath",
  docTarget.ok && docTarget.targetPath,
  `${FOLDER_5008266}/3.BS作成書類/職務経歴書_吉川 祐樹.docx`,
);

console.log("\n[10] 書き込み先パスの組み立て — スキップ理由");
eq(
  "対象外カテゴリ",
  buildOneDriveTargetPath({
    oneDriveFolderUrl: URL_5008266,
    category: CandidateFileCategory.MEETING,
    fileName: "面談ログ.txt",
  }),
  {
    ok: false,
    skipReason: OneDriveSyncSkipReason.UNSUPPORTED_CATEGORY,
    detail: "対象外カテゴリ: MEETING",
  },
);
const noUrl = buildOneDriveTargetPath({
  oneDriveFolderUrl: null,
  category: CandidateFileCategory.BOOKMARK,
  fileName: "a.pdf",
});
eq("URL 未登録 → NO_FOLDER_URL", !noUrl.ok && noUrl.skipReason, OneDriveSyncSkipReason.NO_FOLDER_URL);
const badUrl = buildOneDriveTargetPath({
  oneDriveFolderUrl: "https://bizstudio-my.sharepoint.com/my?id=%2Fsites%2Fteam",
  category: CandidateFileCategory.BOOKMARK,
  fileName: "a.pdf",
});
eq("URL 形式不正 → NO_FOLDER_URL", !badUrl.ok && badUrl.skipReason, OneDriveSyncSkipReason.NO_FOLDER_URL);
const outside = buildOneDriveTargetPath({
  oneDriveFolderUrl: toFolderUrl("/ビズスタジオ/1.経理"),
  category: CandidateFileCategory.BOOKMARK,
  fileName: "a.pdf",
});
eq("許可プレフィックス外 → NO_FOLDER_URL", !outside.ok && outside.skipReason, OneDriveSyncSkipReason.NO_FOLDER_URL);

// ============================================================
console.log("\n[11] キルスイッチ isOneDriveSyncEnabled");
// ============================================================
const savedEnv = process.env.ONEDRIVE_SYNC_ENABLED;
for (const [value, expected] of [
  ["true", true],
  ["TRUE", true],
  ["1", true],
  ["false", false],
  ["", false],
  ["yes", false],
  ["0", false],
] as const) {
  process.env.ONEDRIVE_SYNC_ENABLED = value;
  eq(`ONEDRIVE_SYNC_ENABLED="${value}"`, isOneDriveSyncEnabled(), expected);
}
delete process.env.ONEDRIVE_SYNC_ENABLED;
eq("未設定はフェイルクローズで false", isOneDriveSyncEnabled(), false);
if (savedEnv !== undefined) process.env.ONEDRIVE_SYNC_ENABLED = savedEnv;

// ============================================================
console.log("\n[12] errorMessage の切り詰め");
// ============================================================
eq("null", truncateErrorMessage(null), null);
eq("短い本文はそのまま", truncateErrorMessage("itemNotFound: not found"), "itemNotFound: not found");
eq("1000文字ちょうどはそのまま", truncateErrorMessage("あ".repeat(1000))?.length, 1000);
eq("1001文字は1000文字に切る", truncateErrorMessage("あ".repeat(1001))?.length, 1000);

// ============================================================
console.log(`\n===== 結果: ${passed} passed / ${failed} failed =====\n`);
process.exit(failed === 0 ? 0 : 1);
