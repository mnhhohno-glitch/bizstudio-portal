/**
 * T-159 Phase 4: 求職者1人分の即時同期（「同期」ボタン）のユニットテスト。
 *
 * scripts/test-t159-folder-url.ts と同じ自己完結アサーションランナー方式
 * （本リポジトリに vitest/jest は入っていない）。
 *
 * 実行:
 *   npx tsx scripts/test-t159-sync-now.ts
 *
 * ★ネットワーク・DB には一切アクセスしない（すべて純関数のテスト）。
 *   Graph 走査だけは listChildrenByPath を差し替えた偽ドライブで検査する。
 *
 * 終了コード: 全件パス=0 / 1件でも失敗=1
 */

import { OneDriveSyncSkipReason, OneDriveSyncStatus } from "@prisma/client";
import type { DriveItem } from "@/lib/microsoft-graph";
import {
  ONEDRIVE_SCAN_ROOT,
  buildOneDriveFolderUrl,
  caFolderLabel,
  caFolderMatchesEmployee,
  isScopedScanTrustworthy,
  matchCandidateFolder,
  scanOneDriveCandidateFolders,
  selectCaFoldersForEmployee,
} from "@/lib/onedrive-folder-scan";
import { isAutoManagedFolderUrl } from "@/lib/onedrive-folder-url-sync";
import { ONEDRIVE_SYNC_MAX_ATTEMPTS } from "@/lib/onedrive-sync";
import {
  ONEDRIVE_RETRYABLE_SKIP_REASONS,
  buildOneDriveRetryWhere,
} from "@/lib/onedrive-sync-retry";
import {
  ONEDRIVE_SYNC_NOW_COOLDOWN_MS,
  type SyncNowMessageInput,
  buildOneDriveSyncNowWhere,
  buildSyncNowMessage,
  decideSyncNowCooldown,
} from "@/lib/onedrive-sync-now";

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

const OWNER = "masayuki_oono_bizstudio_co_jp";
const R = ONEDRIVE_SCAN_ROOT;

/** パス → 子フォルダ名 の対応から listChildrenByPath を作る（既存テストと同型）。 */
function fakeDrive(tree: Record<string, string[]>) {
  const calls: string[] = [];
  const fn = async (_upn: string, p: string): Promise<DriveItem[] | null> => {
    calls.push(p);
    const kids = tree[p];
    if (!kids) return null; // 404 相当
    return kids.map((name, i) => ({ id: `${p}/${name}#${i}`, name, folder: { childCount: 0 } }));
  };
  return { fn, calls };
}

// 実構造を模した偽ドライブ（T-158 実測: 大野=年/年月、小野=直下、安藤=年月）。
const TREE: Record<string, string[]> = {
  [R]: ["1.大野", "2.小野", "4.安藤", "9.資料"],
  [`${R}/1.大野`]: ["2026", "GPTメモ"],
  [`${R}/1.大野/2026`]: ["202608"],
  [`${R}/1.大野/2026/202608`]: ["5008391_三原 優香", "5008408_前川 駿介", "【原本】番号氏名"],
  [`${R}/2.小野`]: ["5001111_小野太郎"],
  [`${R}/4.安藤`]: ["202607"],
  [`${R}/4.安藤/202607`]: ["5002222_安藤花子", "5008391_別人 太郎"],
  [`${R}/9.資料`]: ["テンプレ"],
};

async function main() {
  // ============================================================
  // [1] 担当CA姓 → 走査対象の CA フォルダ
  // ============================================================
  console.log("\n[1] 担当CA姓 → CA フォルダの対応づけ");
  {
    eq("CA フォルダ名から姓を取り出す", caFolderLabel("4.安藤"), "安藤");
    eq("連番が2桁でも取り出せる", caFolderLabel("12.奥村"), "奥村");
    eq("CA フォルダでなければ null", caFolderLabel("テンプレート"), null);
    eq("番号だけのフォルダも CA フォルダ扱いしない", caFolderLabel("5."), null);

    eq("姓で一致する", caFolderMatchesEmployee("安藤 嘉富", "4.安藤"), true);
    eq("全角空白の氏名でも一致する", caFolderMatchesEmployee("安藤　嘉富", "4.安藤"), true);
    eq(
      "フォルダ側がフルネームでも一致する",
      caFolderMatchesEmployee("大野 将幸", "1.大野将幸"),
      true,
    );
    eq("別のCAとは一致しない", caFolderMatchesEmployee("安藤 嘉富", "1.大野"), false);
    eq("担当CA未設定なら一致しない", caFolderMatchesEmployee(null, "4.安藤"), false);

    const all = ["1.大野", "2.小野", "4.安藤"];
    eq("★担当CAのフォルダだけに絞る", selectCaFoldersForEmployee("安藤 嘉富", all), ["4.安藤"]);
    eq("★担当CA未設定なら全CAフォルダにフォールバック", selectCaFoldersForEmployee(null, all), all);
    eq(
      "★姓が一致するCAフォルダが無ければ全CAフォルダにフォールバック",
      selectCaFoldersForEmployee("鈴木 一郎", all),
      all,
    );
  }

  // ============================================================
  // [2] 絞り込み走査（Graph の往復が実際に減ること）
  // ============================================================
  console.log("\n[2] 絞り込み走査 scanOneDriveCandidateFolders(selectCaFolders)");
  let scopedScan: Awaited<ReturnType<typeof scanOneDriveCandidateFolders>>;
  {
    const full = fakeDrive(TREE);
    const fullScan = await scanOneDriveCandidateFolders("upn", { listChildrenByPath: full.fn });
    eq("絞り込みなしは全CAフォルダを降りる", fullScan.caFolders, ["1.大野", "2.小野", "4.安藤"]);
    eq("絞り込みなしの求職者フォルダ件数", fullScan.folders.length, 5);

    const scoped = fakeDrive(TREE);
    scopedScan = await scanOneDriveCandidateFolders(
      "upn",
      { listChildrenByPath: scoped.fn },
      { selectCaFolders: (all) => selectCaFoldersForEmployee("安藤 嘉富", all) },
    );
    eq("★担当CAのフォルダだけを降りる", scopedScan.caFolders, ["4.安藤"]);
    eq("ルート直下の CA フォルダ一覧は全部保持する", scopedScan.allCaFolders, [
      "1.大野",
      "2.小野",
      "4.安藤",
    ]);
    eq("★拾えるのは担当CA配下だけ", scopedScan.folders.length, 2);
    eq(
      "★listChildren の回数が全走査より減る",
      scopedScan.listCalls < fullScan.listCalls,
      true,
    );

    // 並行に降りても拾う集合は変わらないこと（順序は変わりうるので番号の集合で比べる）。
    const parallelScan = await scanOneDriveCandidateFolders(
      "upn",
      { listChildrenByPath: fakeDrive(TREE).fn },
      {
        selectCaFolders: (all) => selectCaFoldersForEmployee("安藤 嘉富", all),
        walkConcurrency: 6,
      },
    );
    eq(
      "★中を並行に降りても拾う求職者番号は同じ",
      [...parallelScan.byNumber.keys()].sort(),
      [...scopedScan.byNumber.keys()].sort(),
    );
    eq("並行でも listChildren の回数は同じ", parallelScan.listCalls, scopedScan.listCalls);

    eq("完走していれば絞り込み走査は信用してよい", isScopedScanTrustworthy(scopedScan), true);
    const broken = async (): Promise<DriveItem[] | null> => {
      throw new Error("Graph 500");
    };
    const brokenScan = await scanOneDriveCandidateFolders("upn", { listChildrenByPath: broken });
    eq(
      "★listChildren が例外なら絞り込み走査でも信用しない",
      isScopedScanTrustworthy(brokenScan),
      false,
    );
  }

  // ============================================================
  // [3] 突合ルールは夜間処理と同一（緩めていないこと）
  // ============================================================
  console.log("\n[3] 突合ルール matchCandidateFolder（Phase 4 でも同一）");
  {
    const ok = matchCandidateFolder({
      candidateNumber: "5002222",
      candidateName: "安藤花子",
      ownerSegment: OWNER,
      scan: scopedScan,
    });
    eq("番号一致 + 氏名一致なら登録してよい", ok.ok, true);
    eq(
      "組み立てるURLは既存形式と同じ",
      ok.ok ? ok.url : "",
      buildOneDriveFolderUrl(OWNER, `${R}/4.安藤/202607/5002222_安藤花子`),
    );

    eq(
      "★氏名が食い違えば登録しない",
      matchCandidateFolder({
        candidateNumber: "5008391",
        candidateName: "三原 優香",
        ownerSegment: OWNER,
        scan: scopedScan,
      }),
      { ok: false, reason: "NAME_MISMATCH", detail: "portal氏名=三原 優香 / フォルダ氏名=別人 太郎" },
    );

    // 同じ番号のフォルダが2つ見える走査を作る（束ねフォルダ配下に重複）
    const dupTree: Record<string, string[]> = {
      ...TREE,
      [`${R}/4.安藤/202607`]: ["5002222_安藤花子", "旧"],
      [`${R}/4.安藤/202607/旧`]: ["5002222_安藤花子"],
    };
    const dupScan = await scanOneDriveCandidateFolders(
      "upn",
      { listChildrenByPath: fakeDrive(dupTree).fn },
      { selectCaFolders: (all) => selectCaFoldersForEmployee("安藤 嘉富", all) },
    );
    const dup = matchCandidateFolder({
      candidateNumber: "5002222",
      candidateName: "安藤花子",
      ownerSegment: OWNER,
      scan: dupScan,
    });
    eq("★候補フォルダが複数なら登録しない", dup.ok === false ? dup.reason : "", "DUPLICATE_FOLDER");

    eq(
      "★氏名だけでは突合しない（番号が無ければ登録しない）",
      matchCandidateFolder({
        candidateNumber: "",
        candidateName: "安藤花子",
        ownerSegment: OWNER,
        scan: scopedScan,
      }),
      { ok: false, reason: "NO_CANDIDATE_NUMBER", detail: "求職者番号が未設定" },
    );
  }

  // ============================================================
  // [4] 手貼りURLの保護（Phase 4 も同じ判定を使う）
  // ============================================================
  console.log("\n[4] 手貼りURLの保護 isAutoManagedFolderUrl");
  {
    const auto = buildOneDriveFolderUrl(OWNER, `${R}/4.安藤/202607/5002222_安藤花子`);
    eq("自動登録した値のままなら自動管理下", isAutoManagedFolderUrl(auto, { autoUrl: auto }), true);
    eq(
      "★台帳が無い（手貼り）URLは書き換えない",
      isAutoManagedFolderUrl("https://example.com/manual", null),
      false,
    );
    eq(
      "★自動登録後に貼り替えられた URL も書き換えない",
      isAutoManagedFolderUrl("https://example.com/manual", { autoUrl: auto }),
      false,
    );
  }

  // ============================================================
  // [5] 抽出条件: クールダウンを飛ばし、attemptCount の上限は維持
  // ============================================================
  console.log("\n[5] 抽出条件 buildOneDriveSyncNowWhere");
  {
    const where = buildOneDriveSyncNowWhere("cand-1");
    eq("対象は1人分に絞る", where.candidateId, "cand-1");
    eq("実体を持たない行は対象外（夜間と同じ）", where.candidateFile, {
      driveFileId: { not: null },
    });

    const branches = (where.OR ?? []) as Array<Record<string, unknown>>;
    const failedBranch = branches.find((b) => b.status === OneDriveSyncStatus.FAILED)!;
    const skippedBranch = branches.find((b) => b.status === OneDriveSyncStatus.SKIPPED)!;

    eq(
      "★attemptCount の上限判定は維持する",
      failedBranch.attemptCount,
      { lt: ONEDRIVE_SYNC_MAX_ATTEMPTS },
    );
    eq(
      "★FAILED のバックオフ待ち（nextRetryAt）は見ない",
      Object.prototype.hasOwnProperty.call(failedBranch, "nextRetryAt") ||
        Object.prototype.hasOwnProperty.call(failedBranch, "OR"),
      false,
    );
    eq(
      "★SKIPPED の24時間クールダウン（lastAttemptedAt）は見ない",
      Object.prototype.hasOwnProperty.call(skippedBranch, "lastAttemptedAt") ||
        Object.prototype.hasOwnProperty.call(skippedBranch, "OR"),
      false,
    );
    eq("拾い直してよい skipReason は夜間と同じ集合", skippedBranch.skipReason, {
      in: ONEDRIVE_RETRYABLE_SKIP_REASONS,
    });
    eq(
      "PENDING も拾う",
      branches.some((b) => b.status === OneDriveSyncStatus.PENDING),
      true,
    );

    // 夜間処理の条件は変わっていないこと（Phase 4 は別経路であるという確認）。
    const nightly = buildOneDriveRetryWhere(new Date("2026-08-19T00:00:00.000Z"));
    const nightlyBranches = (nightly.OR ?? []) as Array<Record<string, unknown>>;
    const nightlySkipped = nightlyBranches.find(
      (b) => b.status === OneDriveSyncStatus.SKIPPED,
    )!;
    eq(
      "★夜間処理は24時間クールダウンを見たまま（変えていない）",
      Object.prototype.hasOwnProperty.call(nightlySkipped, "OR"),
      true,
    );
    eq(
      "★夜間処理は求職者で絞らないまま（変えていない）",
      Object.prototype.hasOwnProperty.call(nightly, "candidateId"),
      false,
    );
  }

  // ============================================================
  // [6] 連打防止
  // ============================================================
  console.log("\n[6] 連打防止 decideSyncNowCooldown");
  {
    eq("初回は通す", decideSyncNowCooldown({ lastAcceptedAt: undefined, now: 1_000 }), {
      allowed: true,
      retryAfterSeconds: 0,
    });
    eq(
      "★60秒以内の2回目は弾く",
      decideSyncNowCooldown({ lastAcceptedAt: 1_000, now: 1_000 + 5_000 }),
      { allowed: false, retryAfterSeconds: 55 },
    );
    eq(
      "60秒経てば通す",
      decideSyncNowCooldown({
        lastAcceptedAt: 1_000,
        now: 1_000 + ONEDRIVE_SYNC_NOW_COOLDOWN_MS,
      }),
      { allowed: true, retryAfterSeconds: 0 },
    );
  }

  // ============================================================
  // [7] 画面に出す日本語メッセージ
  // ============================================================
  console.log("\n[7] メッセージ buildSyncNowMessage");
  {
    const base: SyncNowMessageInput = {
      candidateId: "c1",
      candidateNumber: "5008266",
      folderState: "ALREADY_LINKED",
      folderUrl: "https://example.com/x",
      scannedCaFolders: ["4.安藤"],
      scannedAllCaFolders: false,
      eligibleFiles: 0,
      processedFiles: 0,
      copied: 0,
      nameConflicts: 0,
      missingSubfolder: 0,
      missingSubfolderNames: [],
      noFileBody: 0,
      failed: 0,
      deferred: 0,
      timedOut: false,
      syncEnabled: true,
      durationMs: 100,
    };
    const m = (over: Partial<SyncNowMessageInput>) => buildSyncNowMessage({ ...base, ...over });

    eq(
      "URLが新たに登録され、書類もコピーされた",
      m({ folderState: "REGISTERED", copied: 3, processedFiles: 3 }),
      "OneDriveとつながりました。書類3件をコピーしました。",
    );
    eq("すでにつながっており、書類をコピーした", m({ copied: 3 }), "書類3件をコピーしました。");
    eq("すでにつながっており、コピーするものが無かった", m({}), "すべて反映済みです。");
    eq(
      "フォルダが見つからなかった",
      m({ folderState: "NOT_FOUND", folderUrl: null }),
      "OneDriveにこの求職者のフォルダが見つかりませんでした。フォルダ名の先頭に求職者番号が付いているかご確認ください。",
    );
    eq(
      "求職者フォルダはあるがサブフォルダが無い",
      m({ missingSubfolder: 2, missingSubfolderNames: ["2.求人", "3.BS作成書類"] }),
      "「2.求人」「3.BS作成書類」フォルダが見つかりませんでした。OneDriveで作成してください。",
    );
    eq(
      "同名ファイルがありスキップした",
      m({ nameConflicts: 2 }),
      "同じ名前のファイルが既にあるため、2件はコピーしていません。",
    );
    eq(
      "時間内に完了しなかった",
      m({ timedOut: true, deferred: 40 }),
      "処理に時間がかかっています。残りは翌朝の自動処理で反映されます。",
    );
    eq(
      "★件数と理由が複数あれば組み合わせて返す",
      m({
        folderState: "REGISTERED",
        copied: 3,
        nameConflicts: 1,
        missingSubfolder: 2,
        missingSubfolderNames: ["2.求人"],
      }),
      "OneDriveとつながりました。書類3件をコピーしました。" +
        "「2.求人」フォルダが見つかりませんでした。OneDriveで作成してください。" +
        "同じ名前のファイルが既にあるため、1件はコピーしていません。",
    );
    eq(
      "重複フォルダはつなげないと伝える",
      m({ folderState: "DUPLICATE", folderUrl: null }),
      "OneDriveに同じ求職者番号のフォルダが複数見つかったため、つなげませんでした。重複していないかご確認ください。",
    );
    eq(
      "氏名の食い違いもつなげないと伝える",
      m({ folderState: "NAME_MISMATCH", folderUrl: null }),
      "OneDriveのフォルダ名と求職者の氏名が食い違うため、つなげませんでした。フォルダ名をご確認ください。",
    );
    eq(
      "求職者番号が無ければ探せないと伝える",
      m({ folderState: "NO_CANDIDATE_NUMBER", folderUrl: null }),
      "求職者番号が未設定のため、OneDriveのフォルダを探せませんでした。",
    );
    eq(
      "キルスイッチ停止中はその旨を出す",
      m({ syncEnabled: false }),
      "現在OneDriveへのコピーは停止中です。管理者にお知らせください。",
    );
    eq(
      "失敗は翌朝の再試行に回すと伝える",
      m({ failed: 2 }),
      "2件はコピーできませんでした。翌朝の自動処理で再試行します。",
    );
    eq(
      "実体の無い行はその旨を出す",
      m({ noFileBody: 1 }),
      "ファイルの実体が無いため、1件はコピーしていません。",
    );
    eq(
      "技術用語（skipReason 等）を画面に出さない",
      /SKIPPED|NO_SUBFOLDER|Graph|attemptCount/.test(
        m({ missingSubfolder: 1, missingSubfolderNames: ["2.求人"], failed: 1 }),
      ),
      false,
    );
  }

  // 参照しているだけの import を型検査に載せるための保険（未使用警告回避）。
  void OneDriveSyncSkipReason;

  console.log(`\n===== 結果: ${passed} passed / ${failed} failed =====\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();

export {};
