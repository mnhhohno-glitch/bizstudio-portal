import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import {
  mapFilemakerToDetail,
  mapWorkHistoryArray,
  workHistoryToDetailSync,
} from "@/lib/interview-analyzer-mapping";

export const runtime = "nodejs";
export const maxDuration = 300;

// T-067 Phase 5: 解析対象ファイルの source of truth を
// InterviewAttachment(Supabase) → CandidateFile(category=MEETING, Google Drive) に変更。
// ファイル取得は candidateId 経由で Drive から実体ダウンロードする。

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
        { error: "PORTAL_SHARED_SECRETが設定されていません。Railway環境変数を確認してください。" },
        { status: 500 },
      );
    }

    const { id: interviewId } = await params;
    console.log(`[analyze-with-intake] Starting for interview=${interviewId}, intakeUrl=${intakeUrl}`);

    const record = await prisma.interviewRecord.findUnique({
      where: { id: interviewId },
      include: {
        candidate: { select: { id: true, candidateNumber: true } },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "面談レコードが見つかりません" }, { status: 404 });
    }

    // T-067: CandidateFile(category=MEETING) から txt/pdf を取得
    const meetingFiles = await prisma.candidateFile.findMany({
      where: {
        candidateId: record.candidate.id,
        category: "MEETING",
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[analyze-with-intake] Found ${meetingFiles.length} MEETING files`);

    const isTxt = (f: typeof meetingFiles[number]) =>
      f.mimeType.startsWith("text/") || f.fileName.toLowerCase().endsWith(".txt");
    const isPdf = (f: typeof meetingFiles[number]) =>
      f.mimeType === "application/pdf" || f.fileName.toLowerCase().endsWith(".pdf");

    // 最新を優先（findMany が createdAt desc なので先頭が最新）
    const txtFiles = meetingFiles.filter(isTxt);
    const pdfFiles = meetingFiles.filter(isPdf);

    console.log(`[analyze-with-intake] txt=${txtFiles.length}, pdf=${pdfFiles.length}`);

    if (txtFiles.length === 0 && pdfFiles.length === 0) {
      return NextResponse.json(
        { error: "Nottaログ(.txt)または履歴書PDFを添付してください" },
        { status: 400 },
      );
    }

    let interviewLog = "";
    let pdfBuffer = "";

    if (txtFiles.length > 0) {
      const target = txtFiles[0];
      console.log(`[analyze-with-intake] Downloading txt from Drive: ${target.fileName} (${target.driveFileId})`);
      try {
        const { base64 } = await downloadFileFromDrive(target.driveFileId);
        interviewLog = Buffer.from(base64, "base64").toString("utf-8");
        console.log(`[analyze-with-intake] txt loaded: ${interviewLog.length} chars`);
      } catch (e) {
        console.error("[analyze-with-intake] txt download error:", e);
        return NextResponse.json({ error: "面談ログのダウンロードに失敗しました" }, { status: 500 });
      }
    }

    if (pdfFiles.length > 0) {
      const target = pdfFiles[0];
      console.log(`[analyze-with-intake] Downloading pdf from Drive: ${target.fileName} (${target.driveFileId})`);
      try {
        const { base64 } = await downloadFileFromDrive(target.driveFileId);
        pdfBuffer = base64;
        console.log(`[analyze-with-intake] pdf loaded: ${pdfBuffer.length} base64 chars`);
      } catch (e) {
        console.error("[analyze-with-intake] pdf download error:", e);
        return NextResponse.json({ error: "PDFのダウンロードに失敗しました" }, { status: 500 });
      }
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

    const { detailUpdates, interviewMemo } = mapFilemakerToDetail(fmMapping);
    const workHistories = mapWorkHistoryArray(rawWorkHistory);
    const detailFromWH = workHistoryToDetailSync(workHistories);

    const merged = { ...detailUpdates, ...detailFromWH } as Record<string, unknown>;

    const existing = await prisma.interviewDetail.findUnique({
      where: { interviewRecordId: interviewId },
    });
    const empty = (v: unknown) => v == null || v === "";

    const prefPattern = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;
    function resolvePrefecture(): string {
      if (!empty(merged.desiredPrefecture)) return String(merged.desiredPrefecture);
      const area = merged.desiredArea;
      if (!area || typeof area !== "string") return "";
      const m = area.match(prefPattern);
      return m ? m[1] : "";
    }

    const REG_MAP: [string, string][] = [
      ["desiredJobType1", "regJobType1"],
      ["desiredJobType2", "regJobType2"],
      ["desiredEmploymentType", "regEmploymentType"],
      ["desiredSalaryMin", "regSalaryMin"],
    ];
    for (const [src, dst] of REG_MAP) {
      if (empty(existing?.[dst as keyof typeof existing]) && !empty(merged[src])) {
        merged[dst] = merged[src];
      }
    }
    const resolvedPref = resolvePrefecture();
    if (empty(existing?.regAreaPrefecture) && resolvedPref) {
      merged.regAreaPrefecture = resolvedPref;
    }

    console.log(`[analyze-with-intake] Success: ${Object.keys(merged).length} detail fields, ${workHistories.length} work histories`);

    return NextResponse.json({
      success: true,
      detailUpdates: merged,
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
