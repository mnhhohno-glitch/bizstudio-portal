import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";

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
    const pdfFileId: string | undefined = body?.pdfFileId;
    const interviewLogFileId: string | undefined = body?.interviewLogFileId;

    if (!pdfFileId || !interviewLogFileId) {
      return NextResponse.json(
        { error: "pdfFileId と interviewLogFileId は必須です" },
        { status: 400 },
      );
    }

    const intakeUrl =
      process.env.CANDIDATE_INTAKE_URL ||
      process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL ||
      HARDCODED_INTAKE_URL;
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[google-form/extract-resume] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRET が設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    console.log(
      `[google-form/extract-resume] start candidateId=${candidateId} pdfFileId=${pdfFileId} txtFileId=${interviewLogFileId}`,
    );

    // CandidateFile を candidateId 一致確認込みで取得
    const [pdfFile, txtFile, candidate] = await Promise.all([
      prisma.candidateFile.findUnique({ where: { id: pdfFileId } }),
      prisma.candidateFile.findUnique({ where: { id: interviewLogFileId } }),
      prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { id: true, candidateNumber: true },
      }),
    ]);

    if (!candidate) {
      return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
    }
    if (!pdfFile || pdfFile.candidateId !== candidateId) {
      return NextResponse.json({ error: "指定された PDF ファイルが見つかりません" }, { status: 403 });
    }
    if (!txtFile || txtFile.candidateId !== candidateId) {
      return NextResponse.json({ error: "指定された面談ログファイルが見つかりません" }, { status: 403 });
    }

    // Google Drive からダウンロード
    let pdfData: { base64: string; mimeType: string };
    let txtData: { base64: string; mimeType: string };
    try {
      [pdfData, txtData] = await Promise.all([
        downloadFileFromDrive(pdfFile.driveFileId),
        downloadFileFromDrive(txtFile.driveFileId),
      ]);
    } catch (e) {
      console.error("[google-form/extract-resume] Drive download failed:", e);
      return NextResponse.json(
        { error: `Google Drive からのダウンロードに失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    const pdfBuffer = Buffer.from(pdfData.base64, "base64");
    const txtBuffer = Buffer.from(txtData.base64, "base64");
    const interviewLogText = txtBuffer.toString("utf-8");

    // multipart/form-data 構築
    const formData = new FormData();
    formData.append("candidateId", candidate.candidateNumber);
    formData.append(
      "pdf",
      new Blob([new Uint8Array(pdfBuffer)], { type: pdfData.mimeType || "application/pdf" }),
      pdfFile.fileName,
    );
    formData.append(
      "interviewLog",
      new Blob([new Uint8Array(txtBuffer)], { type: txtData.mimeType || "text/plain" }),
      txtFile.fileName,
    );

    const upstreamUrl = `${intakeUrl}/api/intake/extract_resume`;
    console.log(`[google-form/extract-resume] calling upstream ${upstreamUrl}`);

    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: "POST",
        headers: { "x-portal-secret": secret },
        body: formData,
      });
    } catch (e) {
      console.error("[google-form/extract-resume] upstream fetch error:", e);
      return NextResponse.json(
        { error: `candidate-intake への接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }

    if (!upstreamRes.ok) {
      const errBody = await upstreamRes.json().catch(() => ({ error: upstreamRes.statusText }));
      console.error(
        `[google-form/extract-resume] upstream error ${upstreamRes.status}:`,
        JSON.stringify(errBody),
      );
      return NextResponse.json(
        {
          error: `extract_resume failed: ${errBody?.error || upstreamRes.statusText}`,
          upstream: errBody,
        },
        { status: 502 },
      );
    }

    const data = await upstreamRes.json();
    const latency = Date.now() - t0;
    console.log(
      `[google-form/extract-resume] done candidateId=${candidateId} latency_ms=${latency} upstream_latency_ms=${data?.latency_ms}`,
    );

    return NextResponse.json({
      resumeData: data.resumeData,
      interviewLogText,
      latency_ms: latency,
    });
  } catch (e) {
    console.error("[google-form/extract-resume] unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
