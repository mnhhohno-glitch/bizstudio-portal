// T-206: 公開サイト向け 本人確認（生年月日の照合）。
//   POST { birthdate } / ヘッダー x-api-secret
//     404 … 存在しない・下書き ／ 410 { reason } … 公開終了（取得 API と同じ）
//     429 { reason: "locked", until } … ロック中（照合しない）
//     200 { token, maxAgeSeconds: 7776000 } … 一致。失敗回数をリセット
//     400 { reason: "mismatch" } … 不一致。回数制限: 連続 5 回で 15 分、24 時間以内に 20 回で 24 時間ロック（ロックに達した回は 429 を返す）
import { NextRequest, NextResponse } from "next/server";
import { VIEWER_TOKEN_MAX_AGE_SECONDS } from "@/lib/mensetsu/constants";
import { birthdateMatches } from "@/lib/mensetsu/birthdate";
import { isValidSlug } from "@/lib/mensetsu/slug";
import { loadPageBySlug, recordVerifyFailure, resetVerifyFailures } from "@/lib/mensetsu/service";
import { resolveDisplayStatus } from "@/lib/mensetsu/state";
import { issueViewerToken } from "@/lib/mensetsu/viewer-token";
import { EXTERNAL_NO_STORE as NO_STORE, checkMensetsuApiSecret as checkApiSecret } from "@/lib/mensetsu/external-api";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!checkApiSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const { slug } = await ctx.params;
  if (!isValidSlug(slug)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const page = await loadPageBySlug(slug);
  if (!page || page.status === "draft") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const now = new Date();
  const state = resolveDisplayStatus(page, now);
  if (state !== "published") return NextResponse.json({ reason: state }, { status: 410, headers: NO_STORE });

  if (page.verifyLockedUntil && page.verifyLockedUntil.getTime() > now.getTime()) {
    return NextResponse.json({ reason: "locked", until: page.verifyLockedUntil.toISOString() }, { status: 429, headers: NO_STORE });
  }

  let birthdate: unknown = null;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    birthdate = body.birthdate;
  } catch {
    birthdate = null;
  }

  if (birthdateMatches(birthdate, page.candidate.birthday)) {
    await resetVerifyFailures(page.id);
    const token = issueViewerToken(page.id, now);
    return NextResponse.json({ token, maxAgeSeconds: VIEWER_TOKEN_MAX_AGE_SECONDS }, { status: 200, headers: NO_STORE });
  }

  const { lockedUntil } = await recordVerifyFailure(page.id, now);
  if (lockedUntil) {
    return NextResponse.json({ reason: "locked", until: lockedUntil.toISOString() }, { status: 429, headers: NO_STORE });
  }
  return NextResponse.json({ reason: "mismatch" }, { status: 400, headers: NO_STORE });
}
