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
import { autoLinkCandidateToSlot, findMatchingSlot } from "@/lib/scout/auto-link";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * "YYYY-MM-DD"（AI抽出の応募日）を Date(UTC 00:00) に変換する。
 * JST暦日として保存するため Date.UTC を使う（罠#17: toISOString().slice は使わない）。
 * 不正・null は null を返す（推測で埋めない）。
 */
function parseYmdToDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * T-067: マイナビ会員No（10桁数字）を解決する。
 * 0) リクエスト由来（URLクエリ/form）の値が ^\d{10}$ ならそれを最優先で採用
 *    （RPAが本人検索に使った会員No＝PDF記載より確実・将幸さん確定）。
 * 1) 次に AI抽出値が ^\d{10}$ ならそれを採用（誤った値は入れない）。
 * 2) null/不正なら PDFテキストから「会員No.：1234567890」を正規表現でフォールバック抽出。
 * どれも取れなければ null。
 */
async function resolveMynaviMemberNo(
  requestValue: string | null | undefined,
  aiValue: string | null | undefined,
  pdfBuffer: Buffer,
): Promise<string | null> {
  const req = (requestValue ?? "").trim();
  if (/^\d{10}$/.test(req)) return req;
  const ai = (aiValue ?? "").trim();
  if (/^\d{10}$/.test(ai)) return ai;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(pdfBuffer);
    const text: string = typeof data?.text === "string" ? data.text : "";
    const m = text.match(/会員(?:No|ＮＯ|番号)[.．:：\s]*(\d{10})/);
    if (m) return m[1];
  } catch (e) {
    console.error("[rpa/mynavi/pdf-upload] memberNo fallback failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

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
    const recruiterNameFromRequest =
      (form.get("recruiterName") ? String(form.get("recruiterName")) : null)
      ?? req.nextUrl.searchParams.get("recruiterName");
    // T-067: RPAがExcel照合した正しい配信日 / マイナビ登録日（form/query 両対応・任意・"YYYY-MM-DD"）
    const scoutDeliveryDateFromRequest =
      (form.get("scoutDeliveryDate") ? String(form.get("scoutDeliveryDate")) : null)
      ?? req.nextUrl.searchParams.get("scoutDeliveryDate");
    const mynaviRegisteredDateFromRequest =
      (form.get("mynaviRegisteredDate") ? String(form.get("mynaviRegisteredDate")) : null)
      ?? req.nextUrl.searchParams.get("mynaviRegisteredDate");
    // T-067: RPAが本人検索に使った会員No（form/query 両対応・任意・10桁）。PDF抽出より優先。
    const mynaviMemberNoFromRequest =
      (form.get("mynaviMemberNo") ? String(form.get("mynaviMemberNo")) : null)
      ?? req.nextUrl.searchParams.get("mynaviMemberNo");

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

    // ---- recruiterName: リクエストパラメータ優先、AI抽出 consultantName でフォールバック ----
    const recruiterNameRaw = recruiterNameFromRequest?.trim()
      ? recruiterNameFromRequest.trim()
      : (parsed.consultantName?.trim() || null);

    // T-064 Phase A: ScoutMachineMaster で正規化（aliases 込みで照合し、正規名・号機番号を取得）
    let recruiterName = recruiterNameRaw;
    let matchedMachine: { recruiterName: string; machineNumber: number | null } | null = null;
    if (recruiterNameRaw) {
      // 半角/全角スペースを全削除して小文字化（auto-link と同じ正規化）
      const normalizeRc = (s: string) => s.replace(/[\s　]+/g, "").toLowerCase();
      const target = normalizeRc(recruiterNameRaw);
      const machines = await prisma.scoutMachineMaster.findMany();
      matchedMachine =
        machines.find(
          (m) =>
            normalizeRc(m.recruiterName) === target ||
            m.aliases.some((a) => normalizeRc(a) === target),
        ) ?? null;
      if (matchedMachine) recruiterName = matchedMachine.recruiterName;
    }
    // T-067 Phase2a: 旧「1号機=開放日」の誤判定を廃止。masType はこのPhaseでは新規付与しない（null）。
    // 真判定（配信日 − マイナビ登録日 ≤ 7日 → 開放日）は Phase2b で judgeMasType により実装する。

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
    // T-067 Phase B-3: マイナビ会員No（10桁）を AI抽出→PDF正規表現フォールバックで解決
    const mynaviMemberNo = await resolveMynaviMemberNo(mynaviMemberNoFromRequest, resumeData?.mynaviMemberNo, pdfBuffer);

    const candidateNumber = await generateNextCandidateNumber();
    const candidate = await prisma.candidate.create({
      data: {
        candidateNumber,
        name: parsed.name,
        ...(mynaviMemberNo ? { mynaviMemberNo } : {}),
        ...(parsed.nameKana ? { nameKana: parsed.nameKana } : {}),
        ...(parsed.gender ? { gender: parsed.gender } : {}),
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(phoneNormalized ? { phone: phoneNormalized } : {}),
        ...(parsed.address ? { address: parsed.address } : {}),
        ...(recruiterName?.trim() ? { recruiterName: recruiterName.trim() } : {}),
        // マイナビRPA新フローは経路・媒体が固定
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        // T-067 Phase2a: masType は新規付与しない（旧「1号機=開放日」判定を廃止）。Phase2bで配信日−登録日から判定。
        birthday: parsed.birthDate,
        ...(parsed.desiredJobType1 ? { desiredJobType1: parsed.desiredJobType1 } : {}),
        ...(parsed.desiredJobType2 ? { desiredJobType2: parsed.desiredJobType2 } : {}),
        ...(parsed.desiredIndustry1 ? { desiredIndustry1: parsed.desiredIndustry1 } : {}),
        ...(parsed.desiredIndustry2 ? { desiredIndustry2: parsed.desiredIndustry2 } : {}),
        ...(parsed.desiredPrefecture1 ? { desiredPrefecture1: parsed.desiredPrefecture1 } : {}),
        ...(parsed.desiredPrefecture2 ? { desiredPrefecture2: parsed.desiredPrefecture2 } : {}),
        ...(parsed.desiredEmploymentType ? { desiredEmploymentType: parsed.desiredEmploymentType } : {}),
        ...(typeof parsed.desiredSalaryMin === "number" ? { desiredSalaryMin: parsed.desiredSalaryMin } : {}),
      },
    });

    // ---- T-091/T-064/T-067: 応募日・配信日・登録日の自動セット ----
    // 応募日: AI抽出値があれば採用、無ければ createdAt（取り込み日）をフォールバック
    const extractedApplicationDate = parseYmdToDate(resumeData?.applicationDate);
    const effectiveApplicationDate = extractedApplicationDate ?? candidate.createdAt;
    // T-067: 配信日は RPA がExcel照合した値（scoutDeliveryDate）を最優先で採用。
    //        来ない間のみ従来の findMatchingSlot（応募日ベース推測）をフォールバックで残す。
    const deliveryDateFromRpa = parseYmdToDate(scoutDeliveryDateFromRequest);
    let scoutDeliveryDate: Date | null = deliveryDateFromRpa;
    if (!scoutDeliveryDate && recruiterName?.trim()) {
      try {
        const matched = await findMatchingSlot({
          recruiterName: recruiterName.trim(),
          applicationDate: effectiveApplicationDate,
        });
        scoutDeliveryDate = matched?.deliveryDate ?? null;
      } catch (e) {
        console.error("[rpa/mynavi/pdf-upload] findMatchingSlot failed:", e);
      }
    }
    // T-067: マイナビ登録日（RPA照合値があれば保存）。masType判定（Phase2b）の入力。
    const mynaviRegisteredDate = parseYmdToDate(mynaviRegisteredDateFromRequest);
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        applicationDate: effectiveApplicationDate,
        ...(scoutDeliveryDate ? { scoutDeliveryDate } : {}),
        ...(mynaviRegisteredDate ? { mynaviRegisteredDate } : {}),
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
            category: "MEETING",
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

    // ---- T-064: スカウト配信枠 自動紐付け ----
    let scoutLinkResult: string | null = null;
    let scoutLinkedSlotId: string | null = null;
    try {
      const linkRes = await autoLinkCandidateToSlot({
        candidateId: candidate.id,
        recruiterName: recruiterName?.trim() ?? null,
        // T-135: 配信日（Excel照合値）を優先。無ければ応募日（無ければ createdAt）にフォールバック
        scoutDeliveryDate,
        applicationDate: effectiveApplicationDate,
      });
      scoutLinkResult = linkRes.reason;
      scoutLinkedSlotId = linkRes.slotId ?? null;
    } catch (e) {
      console.error("[rpa/mynavi/pdf-upload] autoLinkCandidateToSlot failed:", e);
      scoutLinkResult = "error";
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
        scoutLinkResult,
        scoutLinkedSlotId,
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
      scoutLinkResult,
      scoutLinkedSlotId,
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
