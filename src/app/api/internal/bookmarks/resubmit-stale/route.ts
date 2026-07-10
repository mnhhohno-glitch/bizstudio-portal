import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { runResubmitStale } from "@/lib/t131-resubmit-stale";

// T-131 恒久修正-A: 手動アップPDFの job-platform 投入「滞留」拾い直しの定期自動実行エンドポイント。
// GitHub Actions cron（2時間毎）から x-api-key 付きで叩く（.github/workflows/t131-resubmit-stale.yml）。
//
// POST /api/internal/bookmarks/resubmit-stale?dry_run=<true|false>&confirm=<true|false>&batch=<n>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire と同じ内部鍵。
//   - 二段ガード（auto-expire と同一）: 本番再投入は dry_run=false かつ confirm=true の両方が揃った時のみ。
//     それ以外は DRY-RUN（対象一覧の件数のみ・DB/HTTP は触らない）。
//   - HTTPリクエスト境界に収めるため既定 batchCap=10（~41秒/件）。?batch= で 1..50 に調整可。
//     滞留が batch を超える分は次回の cron（2時間後）で処理。対象0件時は何もしない。
//   - 本体ロジックは src/lib/t131-resubmit-stale.ts に集約（手動スクリプトと共有）。

// Railway（next start・非サーバレス）は maxDuration を強制しないが、Vercel互換のため明示。
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get("dry_run") === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;

  const batchParam = Number(sp.get("batch"));
  const batchCap =
    Number.isInteger(batchParam) && batchParam > 0 && batchParam <= 50 ? batchParam : 10;

  const logs: string[] = [];
  try {
    const summary = await runResubmitStale({
      execute: willExecute,
      batchCap,
      log: (m) => {
        logs.push(m);
        console.log(m);
      },
    });
    // summary は top-level に展開（mode/candidates/stale/processed/ok/ng/skipped/durationMs）。
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
