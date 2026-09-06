// T-191: 求職者向けガイド API（/api/guides/*）のアクセス制御。
//
// 求職者は未ログインで /g/[token] を使うため session は掛けられない。
// 代わりにガイドの token を必須にし、token が有効なときだけ処理を通す。
// portal 内の CA 用画面（/candidates/[id]/guides/interview）は token を持たないので、
// ログイン済みユーザーもフォールバックとして許可する。
//
// token 無し／不一致／無効はいずれも /api/guides/[token] と同じ 404「無効なトークンです」を返す
// （存在判定を漏らさないため、理由は区別しない）。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

/** ガイドの token から GuideEntry を引く。/api/guides/[token] と同じ検索条件。 */
export async function findGuideEntryByToken(token: string | null | undefined) {
  if (!token) return null;
  return prisma.guideEntry.findUnique({ where: { token } });
}

/** /api/guides/[token] と同じ「無効なトークンです」404。 */
export function guideTokenInvalidResponse() {
  return NextResponse.json({ error: "無効なトークンです" }, { status: 404 });
}

/**
 * NG なら Response（404）を返し、OK なら null を返す。
 * 呼び出し側は `const deny = await assertGuideAccess(req); if (deny) return deny;` の形で使う。
 *
 * token は `x-guide-token` ヘッダ、または（JSON body を先に読んだ場合は）bodyToken で渡す。
 */
export async function assertGuideAccess(
  request: Request,
  bodyToken?: unknown
): Promise<NextResponse | null> {
  const headerToken = request.headers.get("x-guide-token");
  const token =
    headerToken || (typeof bodyToken === "string" ? bodyToken : null);

  if (token) {
    const guideEntry = await findGuideEntryByToken(token);
    return guideEntry ? null : guideTokenInvalidResponse();
  }

  // token 無し: portal にログイン済みの社員（CA 画面）だけ通す。
  const user = await getSessionUser();
  return user ? null : guideTokenInvalidResponse();
}
