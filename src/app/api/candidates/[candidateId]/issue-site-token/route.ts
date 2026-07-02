import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// T-128 公開準備②: 求人サイトURL発行ボタンのバックエンド。
// portal（セッション認証）→ kyuujinPDF POST /api/external/tokens/issue（x-api-secret）を代理呼び出し。
// kyuujinPDF 側は冪等（同一 candidateNumber は既存トークンの siteUrl を返す）。
//
// - 誕生日未登録の候補者は発行しない（{ ok:false, reason:"no-birthday" }）。
// - siteUrl / issued(新規=true) / warning(誕生日不一致・期限切れ等) をそのまま返す。
// - secret はサーバー側に隠蔽（クライアントへ渡さない）。

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  // 誕生日は TO_CHAR で純粋な日付文字列として取得（@db.Date の JS Date 変換による JST ズレを回避）。
  const rows = await prisma.$queryRaw<{ candidateNumber: string | null; birthdayStr: string | null }[]>`
    SELECT candidate_number AS "candidateNumber", TO_CHAR(birthday, 'YYYY-MM-DD') AS "birthdayStr"
    FROM candidates WHERE id = ${candidateId} LIMIT 1
  `;
  const candidate = rows[0];
  if (!candidate) {
    return NextResponse.json({ error: "候補者が見つかりません" }, { status: 404 });
  }
  if (!candidate.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が未設定です" }, { status: 400 });
  }

  // 誕生日未登録は発行不可（推測補完しない）。
  if (!candidate.birthdayStr) {
    return NextResponse.json({ ok: false, reason: "no-birthday" });
  }

  const kyuujinApiUrl = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
  const kyuujinApiSecret = process.env.KYUUJIN_API_SECRET;
  if (!kyuujinApiSecret) {
    return NextResponse.json({ error: "KYUUJIN_API_SECRET が未設定です" }, { status: 500 });
  }

  // 誕生日は YYYY-MM-DD で送る（kyuujinPDF 側で正規化・ハッシュ化される）。
  const birthDate = candidate.birthdayStr;

  try {
    const res = await fetch(`${kyuujinApiUrl}/api/external/tokens/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": kyuujinApiSecret,
      },
      body: JSON.stringify({
        candidateNumber: candidate.candidateNumber,
        birthDate,
        createdBy: user.name || user.email || "portal",
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error(`[issue-site-token] kyuujinPDF error status=${res.status} body=${raw.slice(0, 300)}`);
      return NextResponse.json(
        { error: "URL発行に失敗しました", status: res.status },
        { status: 502 }
      );
    }

    let data: { token?: string; siteUrl?: string; issued?: boolean; warning?: string | null } = {};
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "発行APIの応答を解釈できませんでした" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      siteUrl: data.siteUrl ?? null,
      issued: data.issued ?? false,
      warning: data.warning ?? null,
    });
  } catch (e) {
    console.error("[issue-site-token] fetch threw:", e);
    return NextResponse.json({ error: "URL発行に失敗しました" }, { status: 502 });
  }
}
