import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

// T-035 step2: 確認画面の部分再生成。candidate-intake の regenerate_questions を呼ぶプロキシ。
// 入力: { previousQuestionsJson, instruction, targets:[{sectionId,itemIndex}] }
// 出力: { questionsJson(改訂版), regenerated }（変更対象 or 空）
// 許可対象は candidate-intake 側で work_content_* / mindset のみに制限される（consent/個人情報/固定dutiesは不変）。
const HARDCODED_INTAKE_URL = "https://candidate-intake-production.up.railway.app";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const t0 = Date.now();
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;
    const body = await req.json().catch(() => null);
    const previousQuestionsJson = body?.previousQuestionsJson;
    const instruction: string | undefined = body?.instruction;
    const targets = Array.isArray(body?.targets) ? body.targets : [];

    if (!previousQuestionsJson || !instruction || !instruction.trim()) {
      return NextResponse.json(
        { error: "previousQuestionsJson と instruction は必須です" },
        { status: 400 },
      );
    }

    const intakeUrl =
      process.env.CANDIDATE_INTAKE_URL ||
      process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
      HARDCODED_INTAKE_URL;
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[google-form/regenerate-questions] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRET が設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    console.log(
      `[google-form/regenerate-questions] start candidateId=${candidateId} targets=${targets.length}`,
    );

    const upstreamUrl = `${intakeUrl}/api/intake/regenerate_questions`;

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-secret": secret,
        },
        body: JSON.stringify({ previousQuestionsJson, instruction: instruction.trim(), targets }),
      });
    } catch (e) {
      console.error("[google-form/regenerate-questions] upstream fetch error:", e);
      return NextResponse.json(
        { error: `candidate-intake への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.json().catch(() => ({ error: upstreamRes.statusText }));
      console.error(
        `[google-form/regenerate-questions] upstream error ${upstreamRes.status}:`,
        JSON.stringify(errBody),
      );
      return NextResponse.json(
        { error: `regenerate_questions failed: ${errBody?.error || upstreamRes.statusText}`, upstream: errBody },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    const latency = Date.now() - t0;
    console.log(
      `[google-form/regenerate-questions] done candidateId=${candidateId} latency_ms=${latency} regenerated=${Array.isArray(data?.regenerated) ? data.regenerated.length : 0}`,
    );

    return NextResponse.json({
      questionsJson: data.questionsJson,
      regenerated: data.regenerated ?? [],
      latency_ms: latency,
    });
  } catch (e) {
    console.error("[google-form/regenerate-questions] unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
