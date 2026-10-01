import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { savePipelineSnapshot } from "@/lib/pipeline-snapshot";

// T-XXX step5B: 進行中案件の日次スナップショットを保存する定期実行エンドポイント。
// GitHub Actions cron（JST 23:50 = UTC 14:50）から x-api-key 付きで叩く（.github/workflows/t-xxx-pipeline-snapshot.yml）。
//
// POST /api/internal/pipeline-snapshot?dry_run=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire / due-reminder と同じ内部鍵。
//   - dry_run=true（既定）は保存せず、今の集計値（CA別の件数のみ）を返す。保存は dry_run=false のときだけ。
//   - 日付は常に「今日（JST）」。同じ日に 2 回呼んでも行は増えず上書き（run_count +1）。
//   - 返すのは集計値だけ（求職者の個人情報は含まない）。

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  let dryRunParam = sp.get("dry_run");
  if (dryRunParam === null) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "dry_run" in body) {
      dryRunParam = String((body as Record<string, unknown>).dry_run);
    }
  }
  const dryRun = dryRunParam !== "false";

  try {
    const startedAt = Date.now();
    const result = await savePipelineSnapshot({ execute: !dryRun });
    console.log(
      `[pipeline-snapshot] date=${result.snapshotDate} dry_run=${dryRun} rows=${result.rows} created=${result.created} updated=${result.updated} ms=${Date.now() - startedAt}`,
    );
    return NextResponse.json({ dry_run: dryRun, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[pipeline-snapshot] fatal:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
