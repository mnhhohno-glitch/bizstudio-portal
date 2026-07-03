import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { buildPreviewUrl, extractTokenFromMypageUrl } from "@/lib/candidate-site/preview-url";

// T-130 Phase2 step1: 求職者サイトの「閲覧専用プレビューURL」発行API（portal 側）。
//
// 責務: 短命（15分）の署名付きプレビューURLを組み立てて返すところまで。
//       検証・入場・ガードは mypage 側 /site/preview の責務。
//
// 認可:
//   - portal の既存ログインセッション必須（getSessionUser）。未ログインは 401。
//   - 追加のロール判定はしない（portal にログインできる社員は全員可）。
//
// トークン取得経路:
//   - kyuujinPDF GET /api/external/mypage/by-job-seeker/{candidateNumber}（x-api-secret）が
//     アクティブな ShareToken の /v/{token} URL を返す。未発行なら url:null。
//   - 未発行（url:null / candidateNumber 未設定）は 409（reason:"no-token"）で「URL未発行」を返す。
//     ＝ プレビューは新規トークンを発行しない（issue は別ボタンの責務）。
//
// 署名仕様は src/lib/candidate-site/preview-url.ts に厳密定義（mypage 検証はそれを正とする）。

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  // 認可: 既存ログインセッションのみ。未ログインは 401。
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "候補者が見つかりません" }, { status: 404 });
  }

  // 署名鍵（mypage との共有シークレット）。未設定は fail-closed で 500。
  const key = process.env.CANDIDATE_SITE_API_KEY;
  if (!key) {
    console.error("[site-preview-url] CANDIDATE_SITE_API_KEY 未設定");
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 });
  }

  // candidateNumber 未設定はトークンを持ち得ない ＝ 未発行扱い（409）。
  if (!candidate.candidateNumber) {
    console.log(
      `[site-preview-url] no-token (no candidateNumber) by user=${user.id} candidateId=${candidate.id}`,
    );
    return NextResponse.json(
      { ok: false, reason: "no-token", error: "URL未発行" },
      { status: 409 },
    );
  }

  // kyuujinPDF から既存アクティブトークンの /v/{token} URL を取得（新規発行はしない）。
  const kyuujinApiUrl = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
  const kyuujinApiSecret = process.env.KYUUJIN_API_SECRET;
  if (!kyuujinApiSecret) {
    console.error("[site-preview-url] KYUUJIN_API_SECRET 未設定");
    return NextResponse.json({ error: "サーバー設定エラー" }, { status: 500 });
  }

  let mypageUrl: string | null = null;
  try {
    const res = await fetch(
      `${kyuujinApiUrl}/api/external/mypage/by-job-seeker/${encodeURIComponent(candidate.candidateNumber)}`,
      { headers: { "x-api-secret": kyuujinApiSecret } },
    );
    if (!res.ok) {
      console.error(`[site-preview-url] kyuujinPDF error status=${res.status}`);
      return NextResponse.json({ error: "トークン取得に失敗しました", status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as { url?: string | null };
    mypageUrl = data.url ?? null;
  } catch (e) {
    console.error("[site-preview-url] kyuujinPDF fetch threw:", e);
    return NextResponse.json({ error: "トークン取得に失敗しました" }, { status: 502 });
  }

  // 未発行（url:null）は 409。
  if (!mypageUrl) {
    console.log(
      `[site-preview-url] no-token by user=${user.id} candidateId=${candidate.id} candidateNumber=${candidate.candidateNumber}`,
    );
    return NextResponse.json(
      { ok: false, reason: "no-token", error: "URL未発行" },
      { status: 409 },
    );
  }

  const token = extractTokenFromMypageUrl(mypageUrl);
  if (!token) {
    console.error(`[site-preview-url] token 抽出失敗 url=${mypageUrl.slice(0, 120)}`);
    return NextResponse.json({ error: "トークン形式が不正です" }, { status: 502 });
  }

  // 署名付きプレビューURLを組み立て（exp = 発行から15分）。
  const mypageBase = process.env.MYPAGE_PREVIEW_BASE_URL || undefined;
  const { url, exp } = buildPreviewUrl(token, key, Date.now(), mypageBase);

  // 発行ログ（誰がどの候補者のプレビューを発行したか）。
  console.log(
    `[site-preview-url] issued by user=${user.id} (${user.email ?? "no-email"}) ` +
      `candidateId=${candidate.id} candidateNumber=${candidate.candidateNumber} exp=${exp}`,
  );

  return NextResponse.json({ ok: true, previewUrl: url, exp });
}
