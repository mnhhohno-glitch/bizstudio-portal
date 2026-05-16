import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseResumeData } from "@/lib/mynavi-rpa/parse-resume-data";
import { parseResumeWithGemini, type GeminiResumeResult } from "@/lib/gemini-resume-parser";
import { normalizePhoneNumber } from "@/lib/phone-normalize";
import { checkDuplicateProcessing } from "@/lib/mynavi-rpa/duplicate-check";
import { isAgeNg, isForeignNg, calculateAge } from "@/lib/mynavi-rpa/judgment";
import { notifyMynaviDuplicateSkip, notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { generateNextCandidateNumber } from "@/lib/candidate-number";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

export const runtime = "nodejs";
export const maxDuration = 300;

/** CandidateFile.uploadedByUserId 用のシステムユーザーを解決する */
async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({
    where: { email: "anonymous@local" },
    select: { id: true },
  });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/** フルネームから姓・名を推定（外国籍判定用） */
function deriveNameParts(
  name: string | null,
  lastName: string | null,
  firstName: string | null,
): { last: string; first: string } {
  if (lastName && firstName) return { last: lastName, first: firstName };
  const n = (name || "").trim();
  if (!n) return { last: "", first: "" };
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return { last: parts[0], first: parts.slice(1).join("") };
  }
  return { last: n, first: n };
}

/**
 * POST /api/rpa/mynavi/pdf-upload
 * RPA から 1 応募分の PDF を受領し、AI 解析 → 判定 → Candidate 登録までを行う。
 */
export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let batchId = "";
  try {
    const form = await req.formData();
    const pdf = form.get("pdf");
    batchId = String(form.get("batchId") || "") || req.nextUrl.searchParams.get("batchId") || "";
    // 担当RC（スカウト配信者名）: URLクエリ優先、multipart form フィールドもフォールバック対応
    const recruiterName =
      (form.get("recruiterName") ? String(form.get("recruiterName")) : null)
      ?? req.nextUrl.searchParams.get("recruiterName");

    if (!batchId) {
      return NextResponse.json({ error: "batchId は必須です" }, { status: 400 });
    }
    if (!(pdf instanceof File)) {
      return NextResponse.json({ error: "pdf ファイルは必須です" }, { status: 400 });
    }

    const batch = await prisma.rpaExecutionBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "指定されたバッチが見つかりません" }, { status: 404 });
    }

    const pdfBuffer = Buffer.from(await pdf.arrayBuffer());

    // ---- Gemini API で履歴書解析（求職者新規登録モーダルと同一経路）----
    let resumeData: GeminiResumeResult | null = null;
    let aiErrorDetail: string | null = null;
    try {
      resumeData = await parseResumeWithGemini(pdfBuffer);
    } catch (e) {
      aiErrorDetail = e instanceof Error ? e.message : String(e);
      console.error("[rpa/mynavi/pdf-upload] Gemini error:", aiErrorDetail);
    }

    const parsed = parseResumeData(resumeData);

    // ---- AI 解析失敗（氏名 or 生年月日 が取得できない）----
    if (aiErrorDetail || !parsed.name || !parsed.birthDate) {
      const reason = aiErrorDetail
        ? `AI解析失敗（Gemini解析エラー）`
        : "AI解析失敗";
      const log = await prisma.mynaviRpaProcessingLog.create({
        data: {
          batchId,
          status: "AI_FAILED",
          reason,
          canSendReply: false,
          candidateName: parsed.name,
          phoneNormalized: normalizePhoneNumber(parsed.phone),
          errorMessage: aiErrorDetail,
        },
      });
      await notifyMynaviError(
        `AI解析に失敗しました（応募1件をスキップ）`,
        { batchId, detail: aiErrorDetail ?? "氏名または生年月日を抽出できませんでした" },
      );
      return NextResponse.json({
        processingLogId: log.id,
        candidateId: null,
        candidateNumber: null,
        canSendReply: false,
        reason,
        status: "AI_FAILED",
      });
    }

    // ---- 二重処理チェック ----
    const phoneNormalized = normalizePhoneNumber(parsed.phone);
    if (phoneNormalized) {
      const dup = await checkDuplicateProcessing(phoneNormalized);
      if (dup) {
        const log = await prisma.mynaviRpaProcessingLog.create({
          data: {
            batchId,
            status: "DUPLICATE_SKIP",
            reason: "直近30分以内に同一電話番号の処理あり",
            canSendReply: false,
            candidateName: parsed.name,
            candidateAge: calculateAge(parsed.birthDate),
            phoneNormalized,
          },
        });
        await notifyMynaviDuplicateSkip(phoneNormalized, parsed.name ?? undefined);
        return NextResponse.json({
          processingLogId: log.id,
          candidateId: null,
          candidateNumber: null,
          canSendReply: false,
          reason: "二重処理",
          status: "DUPLICATE_SKIP",
        });
      }
    }

    // ---- 送信可否判定 ----
    const age = calculateAge(parsed.birthDate);
    const ageNg = isAgeNg(parsed.birthDate);
    const { last, first } = deriveNameParts(parsed.name, parsed.lastName, parsed.firstName);
    const foreignNg = isForeignNg(last, first);

    let status: "NORMAL" | "AGE_NG" | "FOREIGN_NG";
    let reason: string | null;
    let canSendReply: boolean;
    if (ageNg && foreignNg) {
      status = "AGE_NG";
      reason = "40歳以上 / 外国籍";
      canSendReply = false;
    } else if (ageNg) {
      status = "AGE_NG";
      reason = "40歳以上";
      canSendReply = false;
    } else if (foreignNg) {
      status = "FOREIGN_NG";
      reason = "外国籍";
      canSendReply = false;
    } else {
      status = "NORMAL";
      reason = null;
      canSendReply = true;
    }

    // ---- Candidate 新規登録 ----
    const candidateNumber = await generateNextCandidateNumber();
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: parsed.name,
        ...(parsed.nameKana ? { nameKana: parsed.nameKana } : {}),
        ...(parsed.gender ? { gender: parsed.gender } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(phoneNormalized ? { phone: phoneNormalized } : {}),
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        // マイナビRPA新フローは経路・媒体が固定
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        birthday: parsed.birthDate,
      },
    });

    // ---- PDF を Google Drive に保存し CandidateFile 登録 ----
    let pdfFileId: string | null = null;
    let pdfFileName: string | null = null;
    let fileWarning: string | null = null;
    try {
      const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
      if (!parentFolderId) throw new Error("GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID が未設定");
      const folderId = await getOrCreateFolder(candidate.id, parentFolderId);
      const safeName = parsed.name.replace(/[\\/:*?"<>|]/g, "_");
      pdfFileName = `${candidateNumber}_${safeName}.pdf`;
      const uploaded = await uploadFileToDrive(
        pdfFileName,
        pdfBuffer,
        folderId,
        "application/pdf",
      );
      const systemUserId = await resolveSystemUserId();
      if (systemUserId) {
        const file = await prisma.candidateFile.create({
          data: {
            candidateId: candidate.id,
            category: "ORIGINAL",
            fileName: pdfFileName,
            fileSize: pdfBuffer.length,
            mimeType: "application/pdf",
            driveFileId: uploaded.fileId,
            driveViewUrl: uploaded.webViewLink,
            driveFolderId: folderId,
            memo: "マイナビRPA自動取り込み",
            uploadedByUserId: systemUserId,
          },
        });
        pdfFileId = file.id;
      } else {
        fileWarning = "システムユーザー未解決のため CandidateFile を作成できませんでした";
      }
    } catch (e) {
      fileWarning = e instanceof Error ? e.message : String(e);
      console.error("[rpa/mynavi/pdf-upload] Drive/CandidateFile error:", fileWarning);
    }

    const log = await prisma.mynaviRpaProcessingLog.create({
      data: {
        batchId,
        candidateId: candidate.id,
        phoneNormalized,
        candidateName: parsed.name,
        candidateAge: age,
        status,
        reason,
        canSendReply,
        pdfFileName,
        pdfFileId,
        errorMessage: fileWarning,
      },
    });

    try {
      await recalculateSubStatusIfAuto(candidate.id);
    } catch (e) {
      console.error("[rpa/mynavi/pdf-upload] recalculateSubStatusIfAuto failed:", e);
    }

    return NextResponse.json({
      processingLogId: log.id,
      candidateId: candidate.id,
      candidateNumber,
      canSendReply,
      reason,
      status,
    });
  } catch (e) {
    console.error("[rpa/mynavi/pdf-upload] unexpected error:", e);
    const message = e instanceof Error ? e.message : String(e);
    if (batchId) {
      try {
        await prisma.mynaviRpaProcessingLog.create({
          data: {
            batchId,
            status: "ERROR",
            reason: "処理中に予期しないエラーが発生しました",
            canSendReply: false,
            errorMessage: message,
          },
        });
      } catch (logErr) {
        console.error("[rpa/mynavi/pdf-upload] ERROR ログ作成失敗:", logErr);
      }
    }
    await notifyMynaviError(`PDF処理中にエラーが発生しました`, { batchId, detail: message });
    return NextResponse.json(
      { error: `予期しないエラー: ${message}`, status: "ERROR", canSendReply: false },
      { status: 500 },
    );
  }
}
