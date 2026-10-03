// T-206: 公開サイト（bizstudio-mensetsu）向け 中身の取得。
//   認証: ヘッダー x-api-secret が MENSETSU_API_SECRET と一致（不一致 401）。ログイン確認の対象外。
//   応答:
//     404 … 存在しない・下書き
//     410 { reason: "expired" | "stopped" | "closed" } … 期限切れ／公開停止／選考終了
//     403 { reason: "verify" } … 本人確認が必要で x-viewer-token が無い・不正・期限切れ（中身・氏名は返さない）
//     200 { html, expiresAt } … html は共通ヘッダー・フッター・検索除け入りの最終形（useWrapper=false はそのまま）
//   閲覧の記録（200 のときだけ）:
//     requireBirthdate=true  … 正しいトークンがあり、かつ x-viewer-ua がロボットでなければ数える
//     requireBirthdate=false … x-viewer-ua がロボットでなければ数える（x-viewer-ua が無ければ数えない）
import { NextRequest, NextResponse } from "next/server";
import { EXTERNAL_NO_STORE as NO_STORE, checkMensetsuApiSecret as checkApiSecret } from "@/lib/mensetsu/external-api";
import { isValidSlug } from "@/lib/mensetsu/slug";
import { loadCurrentHtml, loadPageBySlug, recordView } from "@/lib/mensetsu/service";
import { resolveDisplayStatus } from "@/lib/mensetsu/state";
import { verifyViewerToken } from "@/lib/mensetsu/viewer-token";
import { isCountableUserAgent } from "@/lib/mensetsu/robot";
import { wrapMensetsuHtml } from "@/lib/mensetsu/wrapper";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!checkApiSecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const { slug } = await ctx.params;
  if (!isValidSlug(slug)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const page = await loadPageBySlug(slug);
  if (!page || page.status === "draft") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const now = new Date();
  const state = resolveDisplayStatus(page, now);
  if (state !== "published") {
    return NextResponse.json({ reason: state }, { status: 410, headers: NO_STORE });
  }

  const tokenOk = verifyViewerToken(req.headers.get("x-viewer-token"), page.id, now);
  if (page.requireBirthdate && !tokenOk) {
    return NextResponse.json({ reason: "verify" }, { status: 403, headers: NO_STORE });
  }

  const current = await loadCurrentHtml(page.id);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const html = page.useWrapper ? wrapMensetsuHtml(current.html, { candidateName: page.candidate.name }) : current.html;

  // 閲覧の記録
  const ua = req.headers.get("x-viewer-ua");
  const countable = isCountableUserAgent(ua) && (page.requireBirthdate ? tokenOk : true);
  if (countable) {
    try {
      await recordView(page.id, now);
    } catch (e) {
      console.error("[mensetsu] recordView failed", e);
    }
  }

  return NextResponse.json({ html, expiresAt: page.expiresAt?.toISOString() ?? null }, { status: 200, headers: NO_STORE });
}
