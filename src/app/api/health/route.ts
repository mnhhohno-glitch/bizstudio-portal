// T-160: 死活監視用ヘルスチェック。GitHub Actions（.github/workflows/uptime-monitor.yml）から
// 5分ごとに叩かれる。2026-08-10 の Railway ホスト機 I/O 飽和による全面停止（約半日）を
// 社員からの報告でしか気づけなかったため追加した。
//
// 設計上の約束:
//  - 認証不要。middleware.ts では "/api/" が公開パス扱いなのでそのまま素通りする。
//    ログイン画面より手前で「DBが死んでいるか」を判定できる必要があるため。
//  - DB へのクエリは SELECT 1 のみ。テーブルスキャンや件数集計は絶対に足さないこと
//    （5分ごとに叩かれるので、重いクエリを置くと監視自体が負荷源になる）。
//  - 5秒でタイムアウトさせる。今回の障害では Prisma が30秒待たされて Railway の
//    プロキシタイムアウトに巻き込まれ、ヘルスチェックごと道連れになる形だった。
//    「DBが遅い」も「DBが死んでいる」と同じく異常として 503 で返す。
//  - レスポンスに接続文字列・環境変数・スタックトレースを含めない（公開エンドポイントのため）。
//    エラー詳細はサーバログにだけ出す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 監視用途なのでキャッシュさせない。ビルド時の静的化も禁止。
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** DB 応答をこの時間まで待つ。超えたら「異常」と判定する。 */
const DB_TIMEOUT_MS = 5000;

export async function GET() {
  const startedAt = Date.now();

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS);
      }),
    ]);

    return NextResponse.json(
      { status: "ok", db: "ok", latencyMs: Date.now() - startedAt },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // 詳細はログにだけ残す。レスポンスには出さない。
    console.error("[health] db check failed:", e);

    return NextResponse.json(
      { status: "degraded", db: "ng", latencyMs: Date.now() - startedAt },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
