import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { runDueReminder } from "@/lib/t150-due-reminder";

// T-150 Phase 2-4: AI起票タスクの期日リマインド（期日当日の朝／超過中は毎朝）の定期実行エンドポイント。
// GitHub Actions cron（JST 07:00 = UTC 22:00）から x-api-key 付きで叩く
// （.github/workflows/t150-task-due-reminder.yml）。
//
// POST /api/internal/tasks/due-reminder?dry_run=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。auto-expire / resubmit-stale と同じ内部鍵。
//   - dry_run=true（既定）は送信せず対象件数と内訳だけ返す。実送信は dry_run=false のときのみ。
//   - auto-expire / resubmit-stale の confirm による二段ガードは設けない。あちらは
//     「DB書き換え・外部への再投入」という取り返しのつかない副作用への保険で、通知送信は
//     DB を変更しないため同格ではない。ただし送信済みメッセージは取り消せないので dry_run は残す。
//   - 対象は source="AI_ADVISOR" のみ（src/lib/t150-due-reminder.ts の buildDueReminderWhere に集約）。
//     手動タスク（source=NULL）は対象外。全タスク対象にすると実測60件が毎朝飛ぶ。

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  let dryRunParam = sp.get("dry_run");
  if (dryRunParam === null) {
    // クエリに無ければボディも見る（手動実行のしやすさのため）
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "dry_run" in body) {
      dryRunParam = String((body as Record<string, unknown>).dry_run);
    }
  }
  // 既定は DRY-RUN（明示的に false を渡したときだけ送信する）
  const dryRun = dryRunParam !== "false";

  const logs: string[] = [];
  try {
    const summary = await runDueReminder({
      execute: !dryRun,
      log: (m) => {
        logs.push(m);
        console.log(m);
      },
    });
    return NextResponse.json({ ...summary, logs });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[t150-due-reminder] fatal:", message);
    return NextResponse.json({ error: message, logs }, { status: 500 });
  }
}
