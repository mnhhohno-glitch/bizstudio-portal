import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import {
  ONEDRIVE_RETRY_DEFAULT_LIMIT,
  runOneDriveSyncRetry,
} from "@/lib/onedrive-sync-retry";
import { notifyOneDriveSyncResult } from "@/lib/onedrive-sync-notify";

// T-159 Phase 2-c: OneDrive コピーの夜間拾い直しエンドポイント。
// GitHub Actions cron（JST 02:00 = 17:00 UTC）から x-api-key 付きで叩く
// （.github/workflows/t159-onedrive-retry.yml）。
//
// POST /api/internal/onedrive-sync/retry?dry_run=<true|false>&confirm=<true|false>&limit=<n>&notify=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire / t131-resubmit-stale と同じ内部鍵。
//     ★独自方式を新設していない。既存の内部APIはすべて validateInternalApiKey の1本。
//   - 二段ガード（t131-resubmit-stale と同一）: 実際に Graph へ送るのは dry_run=false かつ confirm=true の時のみ。
//     それ以外は DRY-RUN（拾う対象の件数と内訳のみ・DB も Graph も触らない）。
//   - 通知は execute かつ「CA の対応が必要なものがある」時だけ送る（0件の晩は送らない）。
//     ?notify=false で抑止できる（手動確認で CA チャンネルを鳴らしたくない場合）。
//   - 上限を超えた分は翌日に回す。状態はすべて onedrive_sync_logs にあるので取りこぼさない。

// Railway（next start・非サーバレス）は maxDuration を強制しないが、Vercel互換のため明示。
// 実時間の打ち切りは runOneDriveSyncRetry 側の budgetMs（既定480秒）が担う。
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get("dry_run") === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;
  const notify = sp.get("notify") !== "false";

  const limitParam = Number(sp.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 1000
      ? limitParam
      : ONEDRIVE_RETRY_DEFAULT_LIMIT;

  const logs: string[] = [];
  try {
    const summary = await runOneDriveSyncRetry({
      execute: willExecute,
      limit,
      log: (m) => {
        logs.push(m);
        console.log(m);
      },
    });

    const notification =
      willExecute && notify
        ? await notifyOneDriveSyncResult(summary)
        : { result: "SKIPPED_DRY_RUN" as const, message: null };

    return NextResponse.json({
      willExecute,
      ...summary,
      notification: notification.result,
      notificationMessage: notification.message,
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
