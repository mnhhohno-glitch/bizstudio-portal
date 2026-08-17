import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import {
  ONEDRIVE_RETRY_DEFAULT_BUDGET_MS,
  ONEDRIVE_RETRY_DEFAULT_LIMIT,
  runOneDriveSyncRetry,
} from "@/lib/onedrive-sync-retry";
import {
  type OneDriveFolderUrlSyncSummary,
  runOneDriveFolderUrlSync,
} from "@/lib/onedrive-folder-url-sync";
import { evaluateGraphSecretExpiry } from "@/lib/onedrive-graph-secret";
import { notifyOneDriveNightlyResult } from "@/lib/onedrive-sync-notify";

// T-159 Phase 2-c / Phase 3: OneDrive 連携の夜間処理エンドポイント。
// GitHub Actions cron（JST 02:00 = 17:00 UTC）から x-api-key 付きで叩く
// （.github/workflows/t159-onedrive-retry.yml）。
//
// POST /api/internal/onedrive-sync/retry
//        ?dry_run=<true|false>&confirm=<true|false>&limit=<n>&notify=<true|false>&folder_url=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire / t131-resubmit-stale と同じ内部鍵。
//     ★独自方式を新設していない。既存の内部APIはすべて validateInternalApiKey の1本。
//   - 二段ガード（t131-resubmit-stale と同一）: 実際に書き込むのは dry_run=false かつ confirm=true の時のみ。
//     それ以外は DRY-RUN。Phase 3 の DRY-RUN は Graph の**読み取り**は行い（フォルダの有無を確かめるため）、
//     DB には1バイトも書かない。
//   - ?folder_url=false で Phase 3（機能1・機能2）を丸ごと飛ばせる。既存の拾い直しだけ動かしたい時用。
//
// ★処理順序（この順番に意味がある）:
//   1. URL未登録の求職者を探して登録（機能1）
//   2. フォルダ移動への追随（機能2）
//   3. 既存の拾い直し
//   4. 鍵の期限確認（機能3）
//   5. LINE WORKS 通知（まとめて1通）
//   1 を先に置くことで、その夜のうちに機能1で登録された求職者のファイルが 3 でコピーされる。
//   1 を後ろに置くと、URLが付くのは今夜・コピーされるのは翌夜になり、丸1日遅れる。
//
// ★ワークフローは1本のまま（実行順序を保証するため別エンドポイントに分けていない）。

// Railway（next start・非サーバレス）は maxDuration を強制しないが、Vercel互換のため明示。
// 実時間の打ち切りは runOneDriveSyncRetry 側の budgetMs が担う。
export const maxDuration = 600;

/**
 * 拾い直しに残す実時間の下限（ミリ秒）。
 * 機能1・機能2 が長引いても、既存の拾い直しが1件も進まない晩を作らないための床。
 */
const RETRY_MIN_BUDGET_MS = 90_000;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get("dry_run") === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;
  const notify = sp.get("notify") !== "false";
  const runFolderUrl = sp.get("folder_url") !== "false";

  const limitParam = Number(sp.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 1000
      ? limitParam
      : ONEDRIVE_RETRY_DEFAULT_LIMIT;

  const startedAt = Date.now();
  const logs: string[] = [];
  const log = (m: string) => {
    logs.push(m);
    console.log(m);
  };

  try {
    // ---------- 1・2: フォルダURLの自動登録と移動追随 ----------
    // ★ここで例外が出ても既存の拾い直し（3）は必ず走らせる。Phase 3 は追加機能であり、
    //   その不調で「毎晩動いていたコピー」を止めてはならない。
    let folderUrl: OneDriveFolderUrlSyncSummary | null = null;
    let folderUrlError: string | null = null;
    if (runFolderUrl) {
      try {
        folderUrl = await runOneDriveFolderUrlSync({ execute: willExecute, log });
      } catch (e) {
        folderUrlError = e instanceof Error ? e.message : String(e);
        console.error("[onedrive-sync-retry-api] 機能1・2 で失敗（拾い直しは続行）:", e);
        log(`[onedrive-folder-url] 失敗（拾い直しは続行）: ${folderUrlError}`);
      }
    }

    // ---------- 3: 既存の拾い直し ----------
    const retryBudgetMs = Math.max(
      RETRY_MIN_BUDGET_MS,
      ONEDRIVE_RETRY_DEFAULT_BUDGET_MS - (Date.now() - startedAt),
    );
    const summary = await runOneDriveSyncRetry({
      execute: willExecute,
      limit,
      budgetMs: retryBudgetMs,
      log,
    });

    // ---------- 4: 鍵の期限確認 ----------
    const secret = evaluateGraphSecretExpiry();
    log(
      `[onedrive-secret] 期限: ${secret.expiresAt ?? "(未設定)"} ` +
        `残り ${secret.daysLeft ?? "-"}日 state=${secret.state} notify=${secret.notify}`,
    );

    // ---------- 5: 通知（1通にまとめる） ----------
    const notification =
      willExecute && notify
        ? await notifyOneDriveNightlyResult({ retry: summary, folderUrl, secret })
        : { result: "SKIPPED_DRY_RUN" as const, message: null };

    return NextResponse.json({
      willExecute,
      folderUrl,
      folderUrlError,
      ...summary,
      retryBudgetMs,
      secret,
      notification: notification.result,
      notificationMessage: notification.message,
      totalDurationMs: Date.now() - startedAt,
      logs,
    });
  } catch (e) {
    console.error("[onedrive-sync-retry-api] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), logs },
      { status: 500 },
    );
  }
}
