import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { runResubmitStale } from "@/lib/t131-resubmit-stale";

// T-131 恒久修正-A: 手動アップPDFの job-platform 投入「滞留」拾い直しの定期自動実行エンドポイント。
// GitHub Actions cron（2時間毎）から x-api-key 付きで叩く（.github/workflows/t131-resubmit-stale.yml）。
//
// POST /api/internal/bookmarks/resubmit-stale?dry_run=<true|false>&confirm=<true|false>&batch=<n>&days=<n>&concurrency=<n>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire と同じ内部鍵。
//   - 二段ガード（auto-expire と同一）: 本番再投入は dry_run=false かつ confirm=true の両方が揃った時のみ。
//     それ以外は DRY-RUN（対象一覧の件数のみ・DB/HTTP は触らない）。
//   - 既定 batchCap=10。?batch= で 1..50 に調整可。滞留が batch を超える分は次回の cron（2時間後）で処理。
//     対象0件時は何もしない（正常終了）。
//   - T-XXX: Railway の HTTP プロキシ上限（300秒）内に必ず返すため、並列3・時間の上限150秒（新規着手の打ち切り）
//     で回す。?days= で対象期間（作成から N 日以内・既定 env T131_RESUBMIT_WINDOW_DAYS → 3）を 1..3650 で上書き可
//     （手動で古い分を送るとき用。cron の schedule 実行は既定のまま）。?concurrency= は 1..5。
//   - 本体ロジックは src/lib/t131-resubmit-stale.ts に集約（手動スクリプトと共有）。

// Railway（next start・非サーバレス）は maxDuration を強制しないが、Vercel互換のため明示。
export const maxDuration = 300;

function intParam(v: string | null, min: number, max: number): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get("dry_run") === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;

  const batchCap = intParam(sp.get("batch"), 1, 50) ?? 10;
  const windowDays = intParam(sp.get("days"), 1, 3650); // undefined = env → 既定3日
  const concurrency = intParam(sp.get("concurrency"), 1, 5);

  const logs: string[] = [];
  try {
    const summary = await runResubmitStale({
      execute: willExecute,
      batchCap,
      windowDays,
      concurrency,
      log: (m) => {
        logs.push(m);
        console.log(m);
      },
    });
    // summary は top-level に展開（mode/candidates/stale/processed/ok/ng/skipped/deferred/durationMs 等）。
    // ここでの ok は「投入成功件数」（summary.ok）。リクエスト自体の成否は HTTP 200 で表す。
    return NextResponse.json({ willExecute, ...summary, logs });
  } catch (e) {
    console.error("[t131-resubmit-api] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), logs },
      { status: 500 },
    );
  }
}
