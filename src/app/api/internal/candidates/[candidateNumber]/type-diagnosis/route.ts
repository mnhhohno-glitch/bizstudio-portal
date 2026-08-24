import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { isDiagnosisContent } from "@/lib/advisor/diagnosis-extract";

// T-179: タイプ診断の本文フルテキストを返す内部API（読み取り専用）。
//
// GET /api/internal/candidates/{candidateNumber}/type-diagnosis
//   認証: x-api-key（INTERNAL_API_KEY・job-history と同一の内部鍵／同一ヘルパー）。未設定・不一致は 401。
//   用途: job-platform の求人検索「求職者選択モード」に、AIアドバイザーのタイプ診断本文を
//         そのまま表示するパネルを出すため。
//
// 出所（調査結論）:
//   タイプ診断は専用テーブルを持たない。AdvisorFloatingPanel の「🔍 タイプ診断」ボタンが
//   通常のチャットAPI（advisor/sessions/{id}/messages）を定型プロンプトで叩くだけなので、
//   結果は **advisor_chat_messages（role="assistant"）の content** に通常の応答として保存される。
//   専用の種別フラグは無い（kind は "ANALYSIS"＝求人全件分析の産物にのみ付き、診断には付かない）。
//   → 判定は job-history の preference と**完全に同一**の手順（isDiagnosisContent）で行う。
//      これにより「preference の出所になった診断」と「ここで返す本文」が必ず同一レコードになる。
//
//   なお advisor_type_diagnosis テーブルは Gemini で構造化抽出した希望条件（職種・エリア・年収）
//   のみを持ち、本文は保持していないため本APIの出所にはならない。
//
// scope は常に "single"（最新の診断メッセージ1件を丸ごと返す）。
//   診断は1メッセージ＝1診断で完結して保存されており、セッション全文を返すフォールバックは不要。
//
// 読み取りのみ。既存APIのレスポンスには一切触れていない。

export const dynamic = "force-dynamic";

/** 本文の実態に合わせた format。Markdown 記法が1つも無ければ "plain"。 */
function detectFormat(body: string): "markdown" | "plain" {
  if (/^#{1,6}\s/m.test(body)) return "markdown"; // ATX 見出し
  if (/^\s*\|.*\|\s*$/m.test(body)) return "markdown"; // テーブル行
  if (/\*\*[^*\n]+\*\*/.test(body)) return "markdown"; // 太字
  if (/^\s*[-*]\s+\S/m.test(body)) return "markdown"; // 箇条書き
  return "plain";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateNumber: string }> },
) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { candidateNumber } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { candidateNumber },
    select: { id: true },
  });

  // 求職者不在も未診断も、呼び出し側から見れば「本文が無い」で等価。契約どおり 404 not_found に畳む。
  if (!candidate) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Prisma は正規表現フィルタを持たないため、SQL 側は判定条件の**上位集合**で絞り、
  // 最終判定は isDiagnosisContent（判定の正は常にこの1箇所）に委ねる。
  // take:5 も job-history と同値にする（両APIが必ず同じ診断レコードを指すため）。
  const diagnosisCandidates = await prisma.advisorChatMessage.findMany({
    where: {
      role: "assistant",
      session: { candidateId: candidate.id },
      OR: [{ content: { contains: "職種キーワード" } }, { content: { contains: "検索条件" } }],
    },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const latest = diagnosisCandidates.find((m) => isDiagnosisContent(m.content)) ?? null;

  if (!latest) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      diagnosis: {
        body: latest.content,
        format: detectFormat(latest.content),
        // 契約は ISO 8601 の日時。job-history の preference.diagnosedAt は JST の日付文字列（別物）。
        diagnosedAt: latest.createdAt.toISOString(),
        scope: "single" as const,
      },
    },
    // 個人情報を含むため job-history と同じキャッシュ抑止。
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
