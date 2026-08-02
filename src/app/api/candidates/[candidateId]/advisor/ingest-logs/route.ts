// T-155: AIアドバイザーの「未読ログを読み込む」エンドポイント。
//
// POST … 未読の MEETING txt を全件まとめて取り込み、ダイジェストを統合保存する。
//        本体は src/lib/advisor/log-ingest.ts（fail-closed / contextCache 破棄込み）。
//
// ★チャットへの定型文投稿方式（タイプ診断と同型）は採らない。
//   コンテキスト20,000字制限に噛まれるうえ、ログ全文が会話履歴に残って毎ターン送られ続けるため。

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ingestUnreadLogs } from "@/lib/advisor/log-ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const result = await ingestUnreadLogs({ candidateId });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.ingested === 0) {
    return NextResponse.json({ ok: true, ingested: 0, message: "未読のログはありません" });
  }
  return NextResponse.json({
    ok: true,
    ingested: result.ingested,
    digestChars: result.digestChars,
    fileNames: result.fileNames,
    truncated: result.truncated,
  });
}
