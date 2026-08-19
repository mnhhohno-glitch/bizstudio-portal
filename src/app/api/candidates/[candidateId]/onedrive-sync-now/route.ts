import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  runOneDriveSyncNow,
  tryAcquireSyncNowSlot,
} from "@/lib/onedrive-sync-now";

// T-159 Phase 4: 求職者1人分の OneDrive 即時同期。求職者画面の「同期」ボタンの受け口。
//
// POST /api/candidates/[candidateId]/onedrive-sync-now
//   - 認証: getSessionUser()（ログイン済み CA なら実行可）。
//     ★内部APIキー方式ではない。CA が画面から押すものであり、
//     　同ディレクトリの bs-folders / site-guide-draft と同じ既存の求職者API方式に倣う。
//   - 連打防止: 同一求職者につき60秒に1回。超過は 429。
//   - 処理そのものは src/lib/onedrive-sync-now.ts。ここは認証・連打防止・受け渡しだけ。
//
// レスポンス（200）: { ok: true, message: "<画面にそのまま出す日本語>", result: {...} }
// 連打（429）:      { ok: false, message: "しばらく待ってからお試しください。", retryAfterSeconds }

// 走査 + コピーで30秒近くかかりうる（Vercel互換のため明示。Railway は maxDuration を強制しない）。
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const slot = tryAcquireSyncNowSlot(candidateId);
  if (!slot.allowed) {
    return NextResponse.json(
      {
        ok: false,
        message: "しばらく待ってからお試しください。",
        retryAfterSeconds: slot.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(slot.retryAfterSeconds) },
      },
    );
  }

  try {
    const result = await runOneDriveSyncNow({ candidateId, log: (m) => console.log(m) });
    if (!result) {
      return NextResponse.json({ ok: false, message: "求職者が見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, message: result.message, result });
  } catch (e) {
    // ★ここで 500 を返しても求職者画面の他の機能には影響しない（ボタン単体の失敗）。
    console.error("[onedrive-sync-now] 失敗:", e);
    return NextResponse.json(
      {
        ok: false,
        message: "同期に失敗しました。時間をおいてお試しください。",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

