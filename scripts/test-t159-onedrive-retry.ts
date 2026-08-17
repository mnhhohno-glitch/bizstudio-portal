/**
 * T-159 Phase 2-c: 夜間拾い直し（src/lib/onedrive-sync-retry.ts）と
 * CA 向け表示・通知（onedrive-sync-badge.ts / onedrive-sync-notify.ts）のユニットテスト。
 *
 * scripts/test-t159-onedrive-sync.ts と同じ自己完結アサーションランナー方式
 * （本リポジトリに vitest/jest は入っていない）。
 *
 * 実行:
 *   npx tsx scripts/test-t159-onedrive-retry.ts
 *
 * ネットワーク・DB には一切アクセスしない（すべて純関数のテスト）。
 * 拾う対象の判定は Prisma の where オブジェクトを組み立てる純関数として切り出してあるため、
 * DB を立てずに「何を拾い、何を拾わないか」を式のまま検査できる。
 *
 * 終了コード: 全件パス=0 / 1件でも失敗=1
 */

import { CandidateFileCategory, OneDriveSyncSkipReason, OneDriveSyncStatus } from "@prisma/client";
import {
  ONEDRIVE_CA_ACTION_REASONS,
  ONEDRIVE_RETRYABLE_SKIP_REASONS,
  ONEDRIVE_RETRY_SKIP_COOLDOWN_HOURS,
  buildOneDriveRetryWhere,
  decideRetryBookkeeping,
  type OneDriveSyncRetrySummary,
} from "@/lib/onedrive-sync-retry";
import { ONEDRIVE_SYNC_MAX_ATTEMPTS } from "@/lib/onedrive-sync";
import { oneDriveSyncBadge } from "@/lib/onedrive-sync-badge";
import { buildOneDriveSyncNotification } from "@/lib/onedrive-sync-notify";

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

const NOW = new Date("2026-08-17T17:00:00.000Z"); // JST 2026-08-18 02:00

// ============================================================
// 抽出条件そのものの検査（where オブジェクトの構造）
// ============================================================
console.log("\n[1] 拾い直し対象の抽出条件 buildOneDriveRetryWhere");

{
  const where = buildOneDriveRetryWhere(NOW);

  // ★最重要: 実体を持たない行はクエリの段階で外す（後段で弾く形だと毎晩空回りする）。
  eq(
    "driveFileId が null の行はクエリで除外される",
    JSON.stringify(where.candidateFile),
    JSON.stringify({ driveFileId: { not: null } }),
  );

  const branches = (where.OR ?? []) as Record<string, unknown>[];
  eq("拾う枝は3本（PENDING / FAILED / SKIPPED）", branches.length, 3);

  const pending = branches.find((b) => b.status === OneDriveSyncStatus.PENDING);
  eq("PENDING は無条件で拾う", pending !== undefined, true);
  eq("PENDING の枝に追加条件は無い", Object.keys(pending ?? {}).length, 1);

  const failedBranch = branches.find((b) => b.status === OneDriveSyncStatus.FAILED);
  eq(
    "FAILED は attemptCount < 上限のものだけ",
    JSON.stringify(failedBranch?.attemptCount),
    JSON.stringify({ lt: ONEDRIVE_SYNC_MAX_ATTEMPTS }),
  );
  eq(
    "FAILED は nextRetryAt 未設定 or 経過済みのものだけ",
    JSON.stringify(failedBranch?.OR),
    JSON.stringify([{ nextRetryAt: null }, { nextRetryAt: { lte: NOW } }]),
  );

  const skippedBranch = branches.find((b) => b.status === OneDriveSyncStatus.SKIPPED);
  eq(
    "SKIPPED は状況待ちの理由に限る",
    JSON.stringify(skippedBranch?.skipReason),
    JSON.stringify({ in: ONEDRIVE_RETRYABLE_SKIP_REASONS }),
  );
  const cooldownCutoff = new Date(
    NOW.getTime() - ONEDRIVE_RETRY_SKIP_COOLDOWN_HOURS * 60 * 60 * 1000,
  );
  eq(
    "SKIPPED は lastAttemptedAt から24時間空いているものだけ（毎晩無限に試さない）",
    JSON.stringify(skippedBranch?.OR),
    JSON.stringify([{ lastAttemptedAt: null }, { lastAttemptedAt: { lte: cooldownCutoff } }]),
  );
  eq("クールダウンの起点は24時間前", cooldownCutoff.toISOString(), "2026-08-16T17:00:00.000Z");
}

console.log("\n[2] 拾う skipReason / 拾わない skipReason の分類");
{
  const retryable = new Set<string>(ONEDRIVE_RETRYABLE_SKIP_REASONS);
  // 拾う: 後から CA が状況を変えうるもの
  eq("NO_FOLDER_URL は拾う（後からURLを登録しうる）", retryable.has("NO_FOLDER_URL"), true);
  eq("BAD_FOLDER_URL は拾う（後から貼り直しうる）", retryable.has("BAD_FOLDER_URL"), true);
  eq("NO_SUBFOLDER は拾う（後からフォルダを作りうる）", retryable.has("NO_SUBFOLDER"), true);
  eq("NO_FILE_BODY は拾う（後からPDFが付きうる）", retryable.has("NO_FILE_BODY"), true);
  // 拾わない: 何度試しても結果が変わらないもの
  eq(
    "NAME_ALREADY_EXISTS は拾わない（既にOneDriveにある・上書きしない）",
    retryable.has("NAME_ALREADY_EXISTS"),
    false,
  );
  eq("UNSUPPORTED_CATEGORY は拾わない", retryable.has("UNSUPPORTED_CATEGORY"), false);
  eq("GRAPH_ERROR は拾わない（恒久失敗）", retryable.has("GRAPH_ERROR"), false);
  eq("SYNC_DISABLED は拾わない（停止中は PENDING 据え置き）", retryable.has("SYNC_DISABLED"), false);
  eq("AUTH_ERROR は SKIPPED としては拾わない（FAILED 側で拾う）", retryable.has("AUTH_ERROR"), false);
  eq("RATE_LIMITED は SKIPPED としては拾わない（FAILED 側で拾う）", retryable.has("RATE_LIMITED"), false);

  // 全 skipReason を列挙して、拾う4つ以外が漏れなく除外されていることを確かめる
  const all = Object.values(OneDriveSyncSkipReason) as string[];
  eq(
    "拾うのは全10種のうち4つだけ",
    `${all.filter((r) => retryable.has(r)).length}/${all.length}`,
    "4/10",
  );
}

// ============================================================
// 後始末（attemptCount / nextRetryAt / GIVEN_UP）
// ============================================================
console.log("\n[3] SKIPPED からの拾い直しは attemptCount を増やさない");
{
  const r = decideRetryBookkeeping({
    fromSkipped: true,
    previousAttemptCount: 2,
    outcomeStatus: OneDriveSyncStatus.SKIPPED,
    graphAttempted: true, // NO_SUBFOLDER の確認で Graph へは行っている
    now: NOW,
  });
  eq("Graph へ行っても据え置き", r.attemptCount, 2);
  eq("バックオフは付かない", r.nextRetryAt, null);
  eq("GIVEN_UP にもしない", r.statusOverride, null);
}
{
  // 状況待ちが成功に転じたケース
  const r = decideRetryBookkeeping({
    fromSkipped: true,
    previousAttemptCount: 0,
    outcomeStatus: OneDriveSyncStatus.SUCCESS,
    graphAttempted: true,
    now: NOW,
  });
  eq("SKIPPED → SUCCESS でも attemptCount は据え置き", r.attemptCount, 0);
  eq("SUCCESS はバックオフを持たない", r.nextRetryAt, null);
}
{
  // 状況待ちが一時失敗に転じたケース。ここから先は FAILED として数え始める。
  const r = decideRetryBookkeeping({
    fromSkipped: true,
    previousAttemptCount: 0,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("SKIPPED → FAILED でも今回は数えない", r.attemptCount, 0);
  eq("FAILED にはバックオフが付く（5分後）", r.nextRetryAt?.toISOString(), "2026-08-17T17:05:00.000Z");
  eq("上限未満なので GIVEN_UP にしない", r.statusOverride, null);
}

console.log("\n[4] PENDING / FAILED からの拾い直しは attemptCount を増やす");
console.log("    バックオフは「n回目の失敗の後に待つ時間」= 5分 / 15分 / 1時間 / 6時間。");
console.log("    5回の試行の間に置ける待ちは4つなので、表の最後（24時間）は上限到達で使われない。");
{
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 0,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("1回目の失敗で attemptCount=1", r.attemptCount, 1);
  eq("1回目の失敗 → 5分後", r.nextRetryAt?.toISOString(), "2026-08-17T17:05:00.000Z");
}
{
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 1,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("2回目の失敗 → 15分後", r.attemptCount + "@" + r.nextRetryAt?.toISOString(), "2@2026-08-17T17:15:00.000Z");
}
{
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 2,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("3回目の失敗 → 1時間後", r.attemptCount + "@" + r.nextRetryAt?.toISOString(), "3@2026-08-17T18:00:00.000Z");
}
{
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 3,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("4回目の失敗 → 6時間後", r.attemptCount + "@" + r.nextRetryAt?.toISOString(), "4@2026-08-17T23:00:00.000Z");
  eq("まだ GIVEN_UP ではない", r.statusOverride, null);
}
{
  // ★上限到達。attemptCount が 5 になった時点で GIVEN_UP。
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: ONEDRIVE_SYNC_MAX_ATTEMPTS - 1,
    outcomeStatus: OneDriveSyncStatus.FAILED,
    graphAttempted: true,
    now: NOW,
  });
  eq("5回目の失敗で attemptCount=5", r.attemptCount, ONEDRIVE_SYNC_MAX_ATTEMPTS);
  eq("上限到達で GIVEN_UP", r.statusOverride, OneDriveSyncStatus.GIVEN_UP);
  eq("GIVEN_UP はバックオフを持たない（以後拾わない）", r.nextRetryAt, null);
}
{
  // Graph へ届かなかった回（URL未登録など）は試行として数えない
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 1,
    outcomeStatus: OneDriveSyncStatus.SKIPPED,
    graphAttempted: false,
    now: NOW,
  });
  eq("通信していない回は数えない", r.attemptCount, 1);
}
{
  // キルスイッチ停止中に拾ったケース（PENDING のまま返る）
  const r = decideRetryBookkeeping({
    fromSkipped: false,
    previousAttemptCount: 0,
    outcomeStatus: OneDriveSyncStatus.PENDING,
    graphAttempted: false,
    now: NOW,
  });
  eq("停止中は PENDING 据え置き・数えない", r.attemptCount, 0);
  eq("停止中は GIVEN_UP にしない", r.statusOverride, null);
}

// ============================================================
// 画面バッジ
// ============================================================
console.log("\n[5] 画面バッジ — 正常時は視覚的に無音");
eq("ログ行なし → 何も出さない", oneDriveSyncBadge(null), null);
eq("undefined → 何も出さない", oneDriveSyncBadge(undefined), null);
eq("SUCCESS → 何も出さない", oneDriveSyncBadge({ status: "SUCCESS" }), null);
eq(
  "SKIPPED/NAME_ALREADY_EXISTS → 何も出さない（既にOneDriveにある）",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NAME_ALREADY_EXISTS" }),
  null,
);
eq(
  "SKIPPED/UNSUPPORTED_CATEGORY → 何も出さない",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "UNSUPPORTED_CATEGORY" }),
  null,
);
eq(
  "SKIPPED/GRAPH_ERROR → 何も出さない（CAに打つ手が無い）",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "GRAPH_ERROR" }),
  null,
);

console.log("\n[6] 画面バッジ — 文言と色");
eq(
  "PENDING → 反映待ち（灰）",
  oneDriveSyncBadge({ status: "PENDING" })?.label,
  "OneDrive反映待ち",
);
eq(
  "FAILED も同じ扱い（CAから見れば待つだけ）",
  oneDriveSyncBadge({ status: "FAILED" })?.label,
  "OneDrive反映待ち",
);
eq("PENDING は灰", oneDriveSyncBadge({ status: "PENDING" })?.cls.includes("gray"), true);
eq("GIVEN_UP → 反映失敗", oneDriveSyncBadge({ status: "GIVEN_UP" })?.label, "OneDrive反映失敗");
eq("GIVEN_UP は赤", oneDriveSyncBadge({ status: "GIVEN_UP" })?.cls.includes("red"), true);
eq(
  "NO_SUBFOLDER → フォルダなし",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_SUBFOLDER" })?.label,
  "OneDriveにフォルダなし",
);
eq(
  "NO_SUBFOLDER は黄",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_SUBFOLDER" })?.cls.includes("yellow"),
  true,
);
eq(
  "NO_FOLDER_URL → 未設定（灰）",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_FOLDER_URL" })?.label,
  "OneDrive未設定",
);
eq(
  "NO_FOLDER_URL は灰",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_FOLDER_URL" })?.cls.includes("gray"),
  true,
);
eq(
  "BAD_FOLDER_URL → URL不正（黄）",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "BAD_FOLDER_URL" })?.label,
  "OneDrive URL不正",
);
eq(
  "BAD_FOLDER_URL は黄",
  oneDriveSyncBadge({ status: "SKIPPED", skipReason: "BAD_FOLDER_URL" })?.cls.includes("yellow"),
  true,
);

console.log("\n[7] 画面バッジ — NO_SUBFOLDER の hover に代わりのフォルダを出す");
{
  const b = oneDriveSyncBadge({
    status: "SKIPPED",
    skipReason: "NO_SUBFOLDER",
    siblingFolders: ["1.提案求人", "4.その他"],
  });
  eq("hover に代わりのフォルダが載る", b?.title.includes("代わりにあるフォルダ: 1.提案求人 / 4.その他"), true);
}
{
  const b = oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_SUBFOLDER", siblingFolders: [] });
  eq("兄弟フォルダが空でも hover は壊れない", b?.title.includes("代わりにあるフォルダ: （なし）"), true);
}
{
  const b = oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_SUBFOLDER" });
  eq("siblingFolders 未指定でも hover は壊れない", typeof b?.title, "string");
}
{
  const b = oneDriveSyncBadge({ status: "SKIPPED", skipReason: "NO_SUBFOLDER" });
  eq("バッジ文言に技術用語（status/skipReason）を出さない", /SKIPPED|NO_SUBFOLDER/.test(b?.label ?? ""), false);
}

// ============================================================
// LINE WORKS 通知
// ============================================================
console.log("\n[8] LINE WORKS 通知 — 対応が必要なものが無ければ送らない");

function summary(over: Partial<OneDriveSyncRetrySummary> = {}): OneDriveSyncRetrySummary {
  return {
    mode: "execute",
    syncEnabled: true,
    eligible: 0,
    picked: 0,
    processed: 0,
    deferred: 0,
    success: 0,
    givenUp: 0,
    byStatus: {},
    bySkipReason: {},
    needsAttention: [],
    missingSubfolders: [],
    durationMs: 1,
    ...over,
  };
}

const AT = new Date("2026-08-17T17:05:00.000Z"); // JST 8/18 02:05

eq("0件（全部成功）→ 送らない", buildOneDriveSyncNotification(summary({ success: 42 }), AT), null);
eq("何も処理していない晩 → 送らない", buildOneDriveSyncNotification(summary(), AT), null);
eq(
  "対応が必要な理由があるが人数0 → 送らない",
  buildOneDriveSyncNotification(
    summary({
      needsAttention: [{ reason: OneDriveSyncSkipReason.NO_SUBFOLDER, files: 0, candidates: 0 }],
    }),
    AT,
  ),
  null,
);

console.log("\n[9] LINE WORKS 通知 — 文面");
{
  const text = buildOneDriveSyncNotification(
    summary({
      success: 42,
      missingSubfolders: ["2.求人"],
      needsAttention: [
        { reason: OneDriveSyncSkipReason.NO_SUBFOLDER, files: 5, candidates: 3 },
        { reason: OneDriveSyncSkipReason.NO_FOLDER_URL, files: 1, candidates: 1 },
      ],
    }),
    AT,
  );
  eq(
    "文面（コピー完了 + 理由別の人数）",
    text,
    [
      "OneDriveへの書類コピー（8/18 深夜分）",
      "",
      "コピー完了: 42件",
      "",
      "以下は対応が必要です",
      "・OneDriveに「2.求人」フォルダが無い: 3名",
      "・OneDriveフォルダのURLが未登録: 1名",
      "詳細はポータルの求職者画面をご確認ください",
    ].join("\n"),
  );
  eq("★件数ではなく人数（重複した求職者は1名）", text?.includes("3名"), true);
  eq("★氏名・求職者番号を載せない", /[0-9]{7}|様|さん/.test(text ?? ""), false);
  eq(
    "★技術用語を載せない",
    /NO_SUBFOLDER|NO_FOLDER_URL|SKIPPED|status|OneDriveSync/.test(text ?? ""),
    false,
  );
  eq("★日付は JST（17:05 UTC は JST では翌日 8/18）", text?.includes("8/18 深夜分"), true);
}
{
  const text = buildOneDriveSyncNotification(
    summary({
      success: 0,
      givenUp: 2,
      missingSubfolders: ["2.求人", "3.BS作成書類"],
      needsAttention: [
        { reason: OneDriveSyncSkipReason.NO_SUBFOLDER, files: 4, candidates: 2 },
        { reason: OneDriveSyncSkipReason.BAD_FOLDER_URL, files: 1, candidates: 1 },
      ],
    }),
    AT,
  );
  eq(
    "不足フォルダが複数なら両方書く",
    text?.includes("・OneDriveに「2.求人」・「3.BS作成書類」フォルダが無い: 2名"),
    true,
  );
  eq("URL不正の行が出る", text?.includes("・OneDriveフォルダのURLが正しくない: 1名"), true);
  eq("諦めた件数が出る", text?.includes("・何度試してもコピーできなかった書類: 2件"), true);
  eq("コピー完了0件でも対応が必要なら送る", text !== null, true);
}
{
  // GIVEN_UP だけの晩も通知する（自動では入らないと確定したので誰かが手で入れる必要がある）
  const text = buildOneDriveSyncNotification(summary({ success: 10, givenUp: 1 }), AT);
  eq("GIVEN_UP だけでも送る", text?.includes("何度試してもコピーできなかった書類: 1件"), true);
}

console.log("\n[10] CA の対応が必要と扱う理由の範囲");
{
  const reasons = ONEDRIVE_CA_ACTION_REASONS as string[];
  eq("フォルダが無い", reasons.includes("NO_SUBFOLDER"), true);
  eq("URL未登録", reasons.includes("NO_FOLDER_URL"), true);
  eq("URL不正", reasons.includes("BAD_FOLDER_URL"), true);
  eq(
    "PDF実体が無いのは CA 対応に数えない（サイト経由求人など打つ手が無い）",
    reasons.includes("NO_FILE_BODY"),
    false,
  );
  eq("対応が必要な理由は3つだけ", reasons.length, 3);
}

console.log("\n[11] 対象カテゴリの前提（BOOKMARK / BS_DOCUMENT のみ）");
{
  // 夜間処理は onedrive_sync_logs に行があるものだけを扱う。行が作られるのはこの2カテゴリのみ。
  const cats = Object.values(CandidateFileCategory) as string[];
  eq("BOOKMARK は存在する", cats.includes("BOOKMARK"), true);
  eq("BS_DOCUMENT は存在する", cats.includes("BS_DOCUMENT"), true);
}

console.log(`\n===== 結果: ${passed} passed / ${failed} failed =====\n`);
process.exit(failed === 0 ? 0 : 1);
