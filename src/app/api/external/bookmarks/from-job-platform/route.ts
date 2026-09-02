import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueOneDriveSync, triggerOneDriveSync } from "@/lib/onedrive-sync";
// T-181: generateAndStorePdf は本routeのローカル関数だったものを @/lib/job-platform-pdf へ
// 切り出した（サイト経由お気に入り・バックフィルと共有）。挙動は切り出し前と同一。
import { generateAndStorePdf } from "@/lib/job-platform-pdf";
// T-185: 求人名・職種の保存。payload の jobTitle/jobCategory を優先し、無ければ求人本文から抽出する。
import { extractJobTitleFromText, extractJobCategoryFromText } from "@/lib/bookmark-job-snapshot";

/**
 * POST /api/external/bookmarks/from-job-platform
 * 案Z 段階B：job-platform(別システムの求人検索)で見つけた求人を、指定求職者の
 * 既存ブックマーク（CandidateFile・category="BOOKMARK"）として Drive 実体なしで直接保存する。
 * これにより既存 AI 評価（analyze-batch・extractedText のみ参照）に無改修で乗る。
 *
 * - 認証: x-api-secret（JOB_PLATFORM_API_SECRET）。saved-jobs と同一。
 * - 保存者: body.savedByUserId（job-platform が portal SSO で得た User.id）が実在＆active なら
 *   uploadedByUserId に採用（担当列に本人名表示）。無い/不正は anonymous@local にフォールバック（後方互換）。
 * - extractedText（求人本文）必須。空は 400（AI評価対象外＝主目的未達のため）。
 * - fileName = 求人票_{会社名}_{10桁以上の数値ID}.pdf（数値ID無ければ 求人票_{会社名}.pdf）。
 *   ※ extractSearchNames p1（数値ID 10桁以上を末尾除去）/ p4（ID無し）で会社名を抽出。
 * - sourceType="job-platform"・externalJobRef=求人ID・driveFileId/driveViewUrl=null。
 * - lastExportedAt は立てない（配信ではないため weeklyMatrix 提案集計に乗せない・DECISION）。
 * - 冪等: 同一 candidateId × externalJobRef の既存 job-platform BOOKMARK 行があれば
 *   作成せずスナップショット（extractedText/fileName/memo）を更新（重複作成しない）。
 * - 一括対応: jobs[] で 複数求人 × 1求職者。単一は top-level でも可。
 */

type JobInput = {
  externalJobRef?: unknown;
  companyName?: unknown;
  jobTitle?: unknown;
  // T-185: 職種。jobCategory / jobType のどちらの名前でも受け付ける（送られてこなければ本文から抽出）。
  jobCategory?: unknown;
  jobType?: unknown;
  extractedText?: unknown;
  jobUrl?: unknown;
  fileNumericId?: unknown; // ファイル名用の数値ID（10桁以上推奨）。無ければ会社名のみ。
  // T-128 Phase2-1: 元媒体の識別子（例: "hito_link"）。任意・後方互換（未送信でも従来どおり動作）。
  //   受信時は CandidateFile.sourceMedia に生値のまま保存。マッピング（→ "HITO-Link" 等）は HistoryTab で解決。
  sourceMedia?: unknown;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// ファイル名の数値ID：fileNumericId が 10桁以上の数字ならそれ、
// 無ければ externalJobRef 内の 10桁以上連続数字、無ければ null（会社名のみのファイル名）。
function pickNumericId(fileNumericId: string | null, externalJobRef: string): string | null {
  if (fileNumericId && /^\d{10,}$/.test(fileNumericId)) return fileNumericId;
  const m = externalJobRef.match(/\d{10,}/);
  return m ? m[0] : null;
}

// 求人票_{会社名}_{数値ID}.pdf（数値ID無ければ 求人票_{会社名}.pdf）。
// ファイル名に使えない文字・区切り崩れ防止のためスラッシュ等は除去。
function buildFileName(companyName: string, numericId: string | null): string {
  const safe = companyName.replace(/[\\/:*?"<>|]/g, "").trim();
  return numericId ? `求人票_${safe}_${numericId}.pdf` : `求人票_${safe}.pdf`;
}

async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.JOB_PLATFORM_API_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 求職者キー: candidateId（cuid）優先、無ければ candidateNumber。
  const candidateIdRaw = str(body.candidateId);
  const candidateNumberRaw = str(body.candidateNumber);
  const key = candidateIdRaw ?? candidateNumberRaw;
  if (!key) {
    return NextResponse.json({ error: "candidateNumber or candidateId is required" }, { status: 400 });
  }
  const candidate = await prisma.candidate.findFirst({
    where: candidateIdRaw
      ? { id: candidateIdRaw }
      : key.startsWith("cm")
        ? { id: key }
        : { candidateNumber: key },
    select: { id: true, candidateNumber: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  // 保存者本人（job-platform が portal SSO で取得した User.id）。実在＆status=active のみ採用。
  // 無い/不正/非active は従来どおりシステムユーザー(anonymous@local)へフォールバック（後方互換）。
  let uploaderUserId = systemUserId;
  let savedBy: string | null = null;
  const savedByUserId = str(body.savedByUserId);
  if (savedByUserId) {
    const u = await prisma.user.findUnique({ where: { id: savedByUserId }, select: { id: true, status: true } });
    if (u && u.status === "active") {
      uploaderUserId = u.id;
      savedBy = u.id;
    }
  }

  const rawJobs: JobInput[] = Array.isArray(body.jobs) ? (body.jobs as JobInput[]) : [body as JobInput];

  // T-189 Phase 2a: 自動引き当て（job-platform エンジン）由来の受け口。
  // origin="auto" のときだけこの分岐に入り、既存の手動経路（この下の処理）は一切変更しない。
  //   - CandidateFile を origin="auto" / autoSourcedAt=now / approvalStatus="PENDING" /
  //     introducedAt=null（未設定）で作成。候補者サイトの表示ゲート
  //     （introducedAt IS NOT NULL OR origin='candidate'）に掛からず、承認まで本人に見えない。
  //   - PDF生成（generateAndStorePdf）と OneDrive 同期は実行しない（承認時に Phase 3 で生成）。
  //     extractedText はそのまま保存する（AI評価の入力に必要）。
  //   - 冪等: 同一 candidateId × externalJobRef の既存 BOOKMARK 行（archivedAt IS NULL）があれば
  //     **作成も更新もしない**。手動行（autoSourcedAt null）= skipped:manual_exists（手動を汚さない）、
  //     自動行 = skipped:auto_exists（REJECTED/EXPIRED でも行が残り続けるため再送は常にここで止まる）。
  if (str(body.origin) === "auto") {
    // 引き当てCA（sourcedBy・任意）。実在＆active のみ採用。無ければ既存フォールバック
    //（savedByUserId → anonymous@local）と同じ uploaderUserId を使う。
    let autoUploaderId = uploaderUserId;
    const sourcedBy = str(body.sourcedBy);
    if (sourcedBy) {
      const u = await prisma.user.findUnique({ where: { id: sourcedBy }, select: { id: true, status: true } });
      if (u && u.status === "active") autoUploaderId = u.id;
    }

    let autoCreated = 0;
    let autoSkipped = 0;
    const autoErrors: { index: number; error: string }[] = [];
    const results: { index: number; externalJobRef: string | null; result: string }[] = [];

    for (let i = 0; i < rawJobs.length; i++) {
      const j = rawJobs[i] ?? {};
      const externalJobRef = str(j.externalJobRef);
      const companyName = str(j.companyName);
      const extractedText = str(j.extractedText);
      if (!externalJobRef || !companyName) {
        autoErrors.push({ index: i, error: "externalJobRef and companyName are required" });
        results.push({ index: i, externalJobRef, result: "error" });
        continue;
      }
      if (!extractedText) {
        autoErrors.push({ index: i, error: "extractedText (job body) is required and must be non-empty" });
        results.push({ index: i, externalJobRef, result: "error" });
        continue;
      }
      try {
        // 冪等判定は sourceType を問わない（サイト経由行・PDF昇格行も「既存」として尊重する）。
        // T-189 修正: 自動配信行（autoSourcedAt 非null）は archivedAt を問わず「既存」とみなす。
        //   自動配信行では紹介保留＝却下なので、保留にされた求人が再送で復活してはならない。
        //   手動ブックマークは従来どおり未保留（archivedAt: null）の行だけを既存扱い。自動行を優先して拾う。
        const existing = await prisma.candidateFile.findFirst({
          where: {
            candidateId: candidate.id,
            category: "BOOKMARK",
            externalJobRef,
            OR: [{ autoSourcedAt: { not: null } }, { archivedAt: null }],
          },
          orderBy: { autoSourcedAt: { sort: "desc", nulls: "last" } },
          select: { id: true, autoSourcedAt: true },
        });
        if (existing) {
          results.push({
            index: i,
            externalJobRef,
            result: existing.autoSourcedAt ? "skipped:auto_exists" : "skipped:manual_exists",
          });
          autoSkipped++;
          continue;
        }
        const numericId = pickNumericId(str(j.fileNumericId), externalJobRef);
        const fileName = buildFileName(companyName, numericId);
        const memo = str(j.jobUrl);
        const fileSize = Buffer.byteLength(extractedText, "utf8");
        const sourceMedia = str(j.sourceMedia);
        const jobTitle = str(j.jobTitle) ?? extractJobTitleFromText(extractedText);
        const jobCategory = str(j.jobCategory ?? j.jobType) ?? extractJobCategoryFromText(extractedText);
        await prisma.candidateFile.create({
          data: {
            candidateId: candidate.id,
            category: "BOOKMARK",
            fileName,
            fileSize,
            mimeType: "text/plain",
            driveFileId: null,
            driveViewUrl: null,
            driveFolderId: null,
            extractedText,
            // テキスト化済みシグナル: AI評価フィルタ（extractedAt 必須）を通すため受領時点で立てる。
            extractedAt: new Date(),
            sourceType: "job-platform",
            externalJobRef,
            sourceMedia,
            memo,
            jobTitle,
            jobCategory,
            origin: "auto",
            autoSourcedAt: new Date(),
            approvalStatus: "PENDING",
            uploadedByUserId: autoUploaderId,
          },
        });
        results.push({ index: i, externalJobRef, result: "created" });
        autoCreated++;
      } catch (e) {
        console.error("[external/bookmarks/from-job-platform] auto save failed:", e);
        autoErrors.push({ index: i, error: "save failed" });
        results.push({ index: i, externalJobRef, result: "error" });
      }
    }

    return NextResponse.json({
      ok: autoErrors.length === 0,
      origin: "auto",
      candidateNumber: candidate.candidateNumber,
      received: rawJobs.length,
      created: autoCreated,
      skipped: autoSkipped,
      errors: autoErrors,
      // 求人ごとの結果: created / skipped:manual_exists / skipped:auto_exists / error
      results,
    });
  }

  let created = 0;
  let updated = 0;
  let pdfStored = 0;
  let pdfFailed = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < rawJobs.length; i++) {
    const j = rawJobs[i] ?? {};
    const externalJobRef = str(j.externalJobRef);
    const companyName = str(j.companyName);
    const extractedText = str(j.extractedText);
    if (!externalJobRef || !companyName) {
      errors.push({ index: i, error: "externalJobRef and companyName are required" });
      continue;
    }
    if (!extractedText) {
      errors.push({ index: i, error: "extractedText (job body) is required and must be non-empty" });
      continue;
    }

    const numericId = pickNumericId(str(j.fileNumericId), externalJobRef);
    const fileName = buildFileName(companyName, numericId);
    const memo = str(j.jobUrl); // UI 段階Dで求人URLを表示する用（任意）
    const fileSize = Buffer.byteLength(extractedText, "utf8");
    // T-128 Phase2-1: 元媒体（例: "hito_link"）。未送信は null（既存動作）。
    const sourceMedia = str(j.sourceMedia);
    // T-185: 求人名・職種を CandidateFile に保存する。
    //   旧実装は payload の jobTitle を型宣言だけして一度も書いていなかったため、CA がブックマークした
    //   行（本番 7,851 行）の job_title が全件 NULL になり、to-entry で作るエントリーの求人名が空だった。
    //   payload に無い場合は求人本文（extractedText）から抽出する（job-platform の構造化テキスト
    //   「【求人タイトル】」/ HITO-Link 求人票PDFの「求人名」行）。どちらでも取れなければ null のまま。
    const jobTitle = str(j.jobTitle) ?? extractJobTitleFromText(extractedText);
    const jobCategory = str(j.jobCategory ?? j.jobType) ?? extractJobCategoryFromText(extractedText);

    try {
      // 冪等: 同一求職者×同一求人（job-platform）の既存BOOKMARK行を探す。
      const existing = await prisma.candidateFile.findFirst({
        where: {
          candidateId: candidate.id,
          category: "BOOKMARK",
          sourceType: "job-platform",
          externalJobRef,
          archivedAt: null,
        },
        select: { id: true, extractedAt: true, driveFileId: true },
      });
      let fileId: string;
      let needsPdf: boolean; // driveFileId が未設定の行だけPDF生成（冪等・重複生成しない）
      if (existing) {
        // スナップショット更新（重複作成しない）。AI評価結果(aiMatchRating等)は触らない。
        // 保存者が明示された場合のみ uploadedByUserId も是正（既存Anonymous行の担当を本人に更新可能）。
        // extractedAt は「テキスト化済み」シグナル（AI分析フィルタが参照）。未設定なら立てる（既存値は維持）。
        await prisma.candidateFile.update({
          where: { id: existing.id },
          data: {
            fileName, fileSize, extractedText, memo,
            // T-185: 求人名・職種は取れたときだけ上書き（取れないときに既存値を消さない）。
            ...(jobTitle ? { jobTitle } : {}),
            ...(jobCategory ? { jobCategory } : {}),
            ...(existing.extractedAt ? {} : { extractedAt: new Date() }),
            ...(savedBy ? { uploadedByUserId: savedBy } : {}),
            // T-128 Phase2-1: sourceMedia が来ていれば更新（未送信＝undefined は既存値維持）。
            ...(sourceMedia ? { sourceMedia } : {}),
          },
        });
        updated++;
        fileId = existing.id;
        needsPdf = !existing.driveFileId; // 既にPDF保管済みなら再生成しない
      } else {
        // T-159: CandidateFile の作成と OneDrive 同期の受付（PENDING 行）を同一トランザクションにする。
        const createdRow = await prisma.$transaction(async (tx) => {
          const row = await tx.candidateFile.create({
            data: {
              candidateId: candidate.id,
              category: "BOOKMARK",
              fileName,
              fileSize,
              mimeType: "text/plain",
              driveFileId: null,
              driveViewUrl: null,
              driveFolderId: null,
              extractedText,
              // テキスト化済みシグナル: 保存時点で求人本文を受領済み＝AI分析フィルタ(extractedAt必須)を通すため立てる。
              extractedAt: new Date(),
              sourceType: "job-platform",
              externalJobRef,
              // T-128 Phase2-1: 元媒体（"hito_link" 等・未送信は null）。
              sourceMedia,
              memo,
              // T-185: 求人名・職種のスナップショット（to-entry で JobEntry へ引き継ぐ）。
              jobTitle,
              jobCategory,
              uploadedByUserId: uploaderUserId,
            },
            select: { id: true },
          });
          await enqueueOneDriveSync(
            { candidateFileId: row.id, candidateId: candidate.id, category: "BOOKMARK" },
            tx,
          );
          return row;
        });
        created++;
        fileId = createdRow.id;
        needsPdf = true;
      }

      // D-3: PDF生成→Drive保管→URL埋め（driveFileId未設定の行のみ・冪等）。
      // 失敗しても保存(CandidateFile作成/更新)は成功扱いのまま（PDFは後で再生成可能）＝失敗隔離。
      if (needsPdf) {
        try {
          // T-159: 既存行に後からPDFが付く経路（サイトのお気に入り由来＝実体なしで作られた行など）を拾う。
          //        新規作成分は上のトランザクションで受付済みなので、ここで足すのは既存行のときだけ。
          if (existing) {
            await enqueueOneDriveSync({
              candidateFileId: fileId,
              candidateId: candidate.id,
              category: "BOOKMARK",
            });
          }
          const pdfBuffer = await generateAndStorePdf({ fileId, candidateId: candidate.id, sid: externalJobRef, fileName });
          pdfStored++;
          // T-159: PDF実体が揃ったこの時点でコピーを起動する。★await しない。
          //        本文は手元にあるので Google Drive から取り直さない。
          triggerOneDriveSync({ candidateFileId: fileId, content: pdfBuffer, mimeType: "application/pdf" });
        } catch (pdfErr) {
          console.error(`[external/bookmarks/from-job-platform] PDF gen/store failed (sid=${externalJobRef}):`, pdfErr instanceof Error ? pdfErr.message : String(pdfErr));
          pdfFailed++;
        }
      }
    } catch (e) {
      console.error("[external/bookmarks/from-job-platform] save failed:", e);
      errors.push({ index: i, error: "save failed" });
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    candidateNumber: candidate.candidateNumber,
    received: rawJobs.length,
    created,
    updated, // 既存と同一求人の再保存（冪等・スナップショット更新）
    skipped: errors.length,
    pdfStored,  // D-3: PDF生成→Drive保管に成功した数
    pdfFailed,  // D-3: PDF生成/保管に失敗した数（保存自体は成功・後で再生成可）
    errors,
  });
}
