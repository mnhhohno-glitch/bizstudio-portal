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
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const intakeUrl = process.env.CANDIDATE_INTAKE_URL;
  const secret = process.env.PORTAL_SHARED_SECRET;
  if (!intakeUrl || !secret) {
    return NextResponse.json(
      { error: "サーバー設定エラー: 管理者に連絡してください" },
      { status: 500 },
    );
  }

  const { id: interviewId } = await params;

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

  const txtAtts = record.attachments
    .filter((a) => a.fileType === "txt" || a.mimeType?.startsWith("text/"))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const pdfAtts = record.attachments
    .filter((a) => a.fileType === "pdf" || a.mimeType === "application/pdf")
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  if (txtAtts.length === 0 && pdfAtts.length === 0) {
    return NextResponse.json(
      { error: "Nottaログ(.txt)または履歴書PDFを添付��てください" },
      { status: 400 },
    );
  }

  let interviewLog = "";
  let pdfBuffer = "";

  if (txtAtts.length > 0) {
    const { data, error } = await supabase.storage.from(BUCKET).download(txtAtts[0].filePath);
    if (error || !data) {
      return NextResponse.json({ error: "面談ログのダウンロードに失敗しま��た" }, { status: 500 });
    }
    interviewLog = Buffer.from(await data.arrayBuffer()).toString("utf-8");
  }

  if (pdfAtts.length > 0) {
    const { data, error } = await supabase.storage.from(BUCKET).download(pdfAtts[0].filePath);
    if (error || !data) {
      return NextResponse.json({ error: "PDFのダウンロードに失敗しました" }, { status: 500 });
    }
    pdfBuffer = Buffer.from(await data.arrayBuffer()).toString("base64");
  }

  if (!interviewLog && !pdfBuffer) {
    return NextResponse.json(
      { error: "ファイルの読み取りに失敗しました" },
      { status: 500 },
    );
  }

  try {
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

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      console.error("[analyze-with-intake] Upstream error:", err);
      return NextResponse.json(
        { error: `解析サービスエラー: ${err.error || res.statusText}` },
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

    const { detailUpdates, interviewMemo } = mapFilemakerToDetail(fmMapping);
    const workHistories = mapWorkHistoryArray(rawWorkHistory);
    const detailFromWH = workHistoryToDetailSync(workHistories);

    return NextResponse.json({
      success: true,
      detailUpdates: { ...detailUpdates, ...detailFromWH },
      interviewMemo,
      workHistories,
      missingItems,
    });
  } catch (e) {
    console.error("[analyze-with-intake] Fetch error:", e);
    return NextResponse.json(
      { error: "解析サービスに接続できませんでした" },
      { status: 502 },
    );
  }
}
