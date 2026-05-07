import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const resumeData = body?.resumeData;
    const interviewLog: string | undefined = body?.interviewLog;
    const achievementCategory: string | undefined = body?.achievementCategory;
    const achievementCategoryOtherLabel: string | null = body?.achievementCategoryOtherLabel ?? null;
    // T-035: 会社別カテゴリマップ（optional、undefined / 空 / 部分指定すべて candidate-intake が後方互換動作）
    const companyCategoryMap: Record<string, string> | undefined =
      body?.companyCategoryMap && typeof body.companyCategoryMap === "object"
        ? (body.companyCategoryMap as Record<string, string>)
        : undefined;

    if (!resumeData || !interviewLog || !achievementCategory) {
      return NextResponse.json(
        { error: "resumeData / interviewLog / achievementCategory は必須です" },
        { status: 400 },
      );
    }

    const intakeUrl =
      process.env.CANDIDATE_INTAKE_URL ||
      process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
      HARDCODED_INTAKE_URL;
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[google-form/generate-form] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRET が設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, candidateNumber: true, name: true },
    });
    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }

    const companyCategoryMapKeyCount = companyCategoryMap ? Object.keys(companyCategoryMap).length : 0;
    console.log(
      `[google-form/generate-form] start candidateId=${candidateId} category=${achievementCategory} companyCategoryMap_keys=${companyCategoryMapKeyCount}`,
    );

    const upstreamUrl = `${intakeUrl}/api/intake/generate_form`;

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portal-secret": secret,
        },
        body: JSON.stringify({
          candidateId: candidate.candidateNumber,
          candidateName: candidate.name,
          resumeData,
          interviewLog,
          achievementCategory,
          achievementCategoryOtherLabel,
          // T-035: companyCategoryMap が指定されているときだけ送る（candidate-intake は undefined を後方互換処理）
          ...(companyCategoryMap !== undefined && { companyCategoryMap }),
        }),
      });
    } catch (e) {
      console.error("[google-form/generate-form] upstream fetch error:", e);
      return NextResponse.json(
        { error: `candidate-intake への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.json().catch(() => ({ error: upstreamRes.statusText }));
      console.error(
        `[google-form/generate-form] upstream error ${upstreamRes.status}:`,
        JSON.stringify(errBody),
      );
      return NextResponse.json(
        {
          error: `generate_form failed: ${errBody?.error || upstreamRes.statusText}`,
          upstream: errBody,
        },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    const latency = Date.now() - t0;
    console.log(
      `[google-form/generate-form] done candidateId=${candidateId} latency_ms=${latency} upstream_latency_ms=${data?.latency_ms}`,
    );

    return NextResponse.json({
      questionsJson: data.questionsJson,
      latency_ms: latency,
    });
  } catch (e) {
    console.error("[google-form/generate-form] unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
