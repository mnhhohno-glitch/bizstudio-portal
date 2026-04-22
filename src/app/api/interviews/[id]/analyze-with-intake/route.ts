import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  mapFilemakerToDetail,
  mapWorkHistoryArray,
  workHistoryToDetailSync,
} from "@/lib/interview-analyzer-mapping";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "interview-attachments";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const intakeUrl = process.env.CANDIDATE_INTAKE_URL
      || process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL
      || "https://candidate-intake-production.up.railway.app";
    const secret = process.env.PORTAL_SHARED_SECRET;
    if (!secret) {
      console.error("[analyze-with-intake] PORTAL_SHARED_SECRET is not configured");
      return NextResponse.json(
        { error: "PORTAL_SHARED_SECRET\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002Railway\u74B0\u5883\u5909\u6570\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002" },
        { status: 500 },
      );
    }

    const { id: interviewId } = await params;
    console.log(`[analyze-with-intake] Starting for interview=${interviewId}, intakeUrl=${intakeUrl}`);

    const record = await prisma.interviewRecord.findUnique({
      where: { id: interviewId },
      include: {
        attachments: true,
        candidate: { select: { candidateNumber: true } },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "面談レコードが見つかりません" }, { status: 404 });
    }

    console.log(`[analyze-with-intake] Found ${record.attachments.length} attachments`);

    const txtAtts = record.attachments
      .filter((a) => a.fileType === "txt" || a.mimeType?.startsWith("text/"))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    const pdfAtts = record.attachments
      .filter((a) => a.fileType === "pdf" || a.mimeType === "application/pdf")
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    console.log(`[analyze-with-intake] txt=${txtAtts.length}, pdf=${pdfAtts.length}`);

    if (txtAtts.length === 0 && pdfAtts.length === 0) {
      return NextResponse.json(
        { error: "Nottaログ(.txt)または履歴書PDFを添付してください" },
        { status: 400 },
      );
    }

    let interviewLog = "";
    let pdfBuffer = "";

    if (txtAtts.length > 0) {
      console.log(`[analyze-with-intake] Downloading txt: ${txtAtts[0].filePath}`);
      const { data, error } = await supabase.storage.from(BUCKET).download(txtAtts[0].filePath);
      if (error || !data) {
        console.error("[analyze-with-intake] txt download error:", error);
        return NextResponse.json({ error: "面談ログのダウンロードに失敗しました" }, { status: 500 });
      }
      interviewLog = Buffer.from(await data.arrayBuffer()).toString("utf-8");
      console.log(`[analyze-with-intake] txt loaded: ${interviewLog.length} chars`);
    }

    if (pdfAtts.length > 0) {
      console.log(`[analyze-with-intake] Downloading pdf: ${pdfAtts[0].filePath}`);
      const { data, error } = await supabase.storage.from(BUCKET).download(pdfAtts[0].filePath);
      if (error || !data) {
        console.error("[analyze-with-intake] pdf download error:", error);
        return NextResponse.json({ error: "PDFのダウンロードに失敗しました" }, { status: 500 });
      }
      pdfBuffer = Buffer.from(await data.arrayBuffer()).toString("base64");
      console.log(`[analyze-with-intake] pdf loaded: ${pdfBuffer.length} base64 chars`);
    }

    if (!interviewLog && !pdfBuffer) {
      return NextResponse.json(
        { error: "ファイルの読み取りに失敗しました" },
        { status: 500 },
      );
    }

    console.log(`[analyze-with-intake] Calling candidate-intake API...`);
    const res = await fetch(`${intakeUrl}/api/portal/analyze-interview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-secret": secret,
      },
      body: JSON.stringify({
        pdfBuffer: pdfBuffer || "IA==",
        interviewLog: interviewLog || " ",
        candidateNumber: record.candidate.candidateNumber || "0000000",
      }),
    });

    console.log(`[analyze-with-intake] Upstream response: ${res.status}`);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      console.error("[analyze-with-intake] Upstream error:", JSON.stringify(err));
      return NextResponse.json(
        { error: `解析サービスエラー (${res.status}): ${err.error || res.statusText}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    if (!data.success) {
      return NextResponse.json(
        { error: `解析に失敗しました: ${data.error || "Unknown"}` },
        { status: 500 },
      );
    }

    const fmMapping = (data.filemaker_mapping || {}) as Record<string, unknown>;
    const rawWorkHistory = (data.work_history || []) as Record<string, unknown>[];
    const missingItems = (data.missing_items || []) as string[];

    console.log("[analyze-with-intake] DEBUG raw work_history:", JSON.stringify(rawWorkHistory.map((r) => ({ 入社年月: r["入社年月"], 退職年月: r["退職年月"], 在籍期間_年: r["在籍期間_年"], 在籍期間_ヶ月: r["在籍期間_ヶ月"] }))));

    const { detailUpdates, interviewMemo } = mapFilemakerToDetail(fmMapping);
    const workHistories = mapWorkHistoryArray(rawWorkHistory);
    const detailFromWH = workHistoryToDetailSync(workHistories);

    console.log("[analyze-with-intake] DEBUG mapped workHistories:", JSON.stringify(workHistories.map((w) => ({ hireDate: w.hireDate, leaveDate: w.leaveDate, tenureYear: w.tenureYear, tenureMonth: w.tenureMonth }))));
    console.log(`[analyze-with-intake] Success: ${Object.keys(detailUpdates).length} detail fields, ${workHistories.length} work histories`);

    return NextResponse.json({
      success: true,
      detailUpdates: { ...detailUpdates, ...detailFromWH },
      interviewMemo,
      workHistories,
      missingItems,
    });
  } catch (e) {
    console.error("[analyze-with-intake] Unexpected error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
