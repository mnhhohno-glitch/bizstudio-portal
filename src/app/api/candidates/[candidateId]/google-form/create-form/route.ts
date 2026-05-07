import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const questionsJson = body?.questionsJson;

    if (!questionsJson) {
      return NextResponse.json({ error: "questionsJson は必須です" }, { status: 400 });
    }

    const intakeUrl =
      process.env.CANDIDATE_INTAKE_URL ||
      process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
      HARDCODED_INTAKE_URL;
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[google-form/create-form] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRET が設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, candidateNumber: true },
    });
    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }

    console.log(`[google-form/create-form] start candidateId=${candidateId}`);

    const upstreamUrl = `${intakeUrl}/api/intake/create_form_v2`;

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
          questionsJson,
        }),
      });
    } catch (e) {
      console.error("[google-form/create-form] upstream fetch error:", e);
      return NextResponse.json(
        { error: `candidate-intake への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.json().catch(() => ({ error: upstreamRes.statusText }));
      console.error(
        `[google-form/create-form] upstream error ${upstreamRes.status}:`,
        JSON.stringify(errBody),
      );
      return NextResponse.json(
        {
          error: `create_form_v2 failed: ${errBody?.error || upstreamRes.statusText}`,
          upstream: errBody,
        },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    const formId: string | undefined = data?.formId;
    const editUrl: string | undefined = data?.editUrl;
    const viewUrl: string | undefined = data?.responseUrl;

    if (!formId || !editUrl || !viewUrl) {
      console.error("[google-form/create-form] upstream returned incomplete result:", data);
      return NextResponse.json(
        { error: "candidate-intake のレスポンスに必須フィールドが含まれていません", upstream: data },
        { status: 502 },
      );
    }

    // 永続化: isLatest=true があれば update、なければスキップ
    let persisted = false;
    let interviewRecordId: string | null = null;
    try {
      const latest = await prisma.interviewRecord.findFirst({
        where: { candidateId, isLatest: true },
        select: { id: true },
      });
      if (latest) {
        await prisma.interviewRecord.update({
          where: { id: latest.id },
          data: {
            googleFormId: formId,
            googleFormEditUrl: editUrl,
            googleFormViewUrl: viewUrl,
            googleFormCreatedAt: new Date(),
            googleFormStatus: "completed",
            googleFormError: null,
          },
        });
        persisted = true;
        interviewRecordId = latest.id;
      }
    } catch (e) {
      console.error("[google-form/create-form] persistence failed (non-fatal):", e);
    }

    const latency = Date.now() - t0;
    console.log(
      `[google-form/create-form] done formId=${formId} persisted=${persisted} latency_ms=${latency} upstream_latency_ms=${data?.latency_ms}`,
    );

    return NextResponse.json({
      formId,
      editUrl,
      viewUrl,
      persisted,
      interviewRecordId,
      latency_ms: latency,
    });
  } catch (e) {
    console.error("[google-form/create-form] unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
