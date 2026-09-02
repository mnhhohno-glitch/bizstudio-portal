import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
// T-189 Phase3-2a: 返却 DTO（型・select・変換・ヘルパ）は auto-matches API と共有するため lib へ切り出した。
import { FAVORITE_DTO_SELECT, toFavoriteDTO, type FavoriteDTO } from "@/lib/candidate-site-favorite-dto";
import { enqueueOneDriveSync, triggerOneDriveSync } from "@/lib/onedrive-sync";
import { generateAndStorePdf } from "@/lib/job-platform-pdf";
// T-185: mypage が jobTitle/jobCategory を送ってこないときに求人本文から補う。
import { extractJobTitleFromText, extractJobCategoryFromText } from "@/lib/bookmark-job-snapshot";

// T-128 T2: 求職者サイト向け お気に入り（ブックマーク）API。
// 台帳は CandidateFile（category="BOOKMARK"）。origin で CA追加(null|"ca") と 本人追加("candidate") を区別。
//
// GET    /api/external/candidate-site/favorites?candidateNumber=... （または candidateId）: 一覧
// POST   /api/external/candidate-site/favorites: 本人お気に入り追加（T-181: PDF生成→Drive保管を fire-and-forget で起動・AI分析は起動しない）
// PATCH  /api/external/candidate-site/favorites: メモ(candidateNote)更新（本人/CA推薦/PDF行いずれも可・candidateNote のみ。fileId 優先、無ければ externalJobRef で特定）
// DELETE /api/external/candidate-site/favorites: 本人お気に入り解除（origin="candidate" のみ）
//
// 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（全401）。
// スコープ: リクエストが指す候補者に厳密スコープ。全クエリで candidateId を条件に含める。

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// 本人追加行の uploadedByUserId 用。実ユーザー（求職者）は存在しないためシステムユーザーを使う。
// origin="candidate" 列が本人追加であることを示す（uploadedByUserId は台帳上の便宜）。
async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ---- GET: お気に入り一覧 ----
export async function GET(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  const { searchParams } = new URL(request.url);
  const candidate = await resolveScopedCandidate({
    candidateId: searchParams.get("candidateId"),
    candidateNumber: searchParams.get("candidateNumber"),
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // T-182: サイトに出すのは「CAが紹介した求人（introducedAt あり）」と「本人がサイトで追加した
  // お気に入り（origin="candidate"）」のみ。CAがブックマークしただけの未紹介行は本人に見せない。
  // origin 条件を外すと本人追加のお気に入りが全員分消えるため必ず残すこと。
  // T-189 Phase3-1: 自動配信（origin="auto"）の行は承認済み（introducedAt あり）でもこの枠には出さない。
  //   CA厳選求人と混ざるのを防ぐため、候補者サイトの専用枠「新着マッチ求人」（Phase 3②）が
  //   origin="auto" AND approvalStatus="APPROVED" を直接取得する設計にする。
  //   origin は null（旧CA行）を含むため、NOT origin="auto" は null を残す形で書く。
  const files = await prisma.candidateFile.findMany({
    where: {
      candidateId: candidate.id,
      category: "BOOKMARK",
      archivedAt: null,
      OR: [
        { introducedAt: { not: null } },
        { origin: "candidate" },
      ],
      AND: [{ OR: [{ origin: null }, { origin: { not: "auto" } }] }],
    },
    select: FAVORITE_DTO_SELECT,
    // T-133 FU-14a: CA手動順を先頭側に、未設定(NULL)行は従来ソート(createdAt DESC)で後続。
    // 全行 displayOrder=NULL なら第1キーが同値になり、従来の createdAt DESC と完全に同一の並びになる（後方互換）。
    orderBy: [{ displayOrder: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });

  // 応募済み externalJobRef 一覧（画面の「応募済み」表示用）。候補者スコープ。
  const applications = await prisma.candidateJobApplication.findMany({
    where: { candidateId: candidate.id },
    select: { externalJobRef: true },
  });
  const appliedRefs = new Set(applications.map((a) => a.externalJobRef));

  // DTO 変換は共通関数（切り出し前のインライン構築と同一のフィールド構成）。
  const favorites: FavoriteDTO[] = files.map((f) =>
    toFavoriteDTO(f, f.externalJobRef ? appliedRefs.has(f.externalJobRef) : false),
  );

  return NextResponse.json({
    ok: true,
    candidateNumber: candidate.candidateNumber,
    favorites,
    appliedExternalJobRefs: [...appliedRefs],
  });
}

// ---- POST: 本人お気に入り追加（T-181: 保存は同期・PDF生成は fire-and-forget） ----
export async function POST(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId,
    candidateNumber: body.candidateNumber,
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const externalJobRef = str(body.externalJobRef);
  if (!externalJobRef) {
    return NextResponse.json({ error: "externalJobRef is required" }, { status: 400 });
  }

  // 重複ガード: 同一候補者×同一求人の既存BOOKMARK行があれば新規作成しない（CA追加済みでも既存を返す）。
  // T-189 Phase3-1: 自動配信行（origin="auto"）は「既存」とみなさない（GET が返さない行を alreadyExists で
  //   返すと、本人には追加されたのに一覧に出ない状態になるため）。本人追加行は別行として作成する。
  const existing = await prisma.candidateFile.findFirst({
    where: {
      candidateId: candidate.id,
      category: "BOOKMARK",
      externalJobRef,
      archivedAt: null,
      AND: [{ OR: [{ origin: null }, { origin: { not: "auto" } }] }],
    },
    select: FAVORITE_DTO_SELECT,
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      alreadyExists: true,
      favorite: toFavoriteDTO(existing, false),
    });
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  const companyName = str(body.companyName);
  const extractedText = str(body.extractedText);
  // T-161: 職種。mypage が送ってくれば保存する（jobCategory / jobType 両方の名前を受け付ける）。
  // T-185: 送られてこない場合は求人本文（extractedText）から抽出する。どちらでも取れなければ
  //        null のまま（捏造しない）。to-entry 側でも同一求人の他行から解決を試みる。
  const jobTitle = str(body.jobTitle) ?? extractJobTitleFromText(extractedText);
  const jobCategory = str(body.jobCategory ?? body.jobType) ?? extractJobCategoryFromText(extractedText);
  const jobUrl = str(body.jobUrl);
  // 本人メモ（任意）。candidateNote / note 両方受け付ける。空文字・未指定は null。
  const candidateNote = str(body.candidateNote ?? body.note);

  // ファイル名は from-job-platform と同形式（求人票_{会社名}[_{数値ID}].pdf）。会社名が無ければ求人IDで代替。
  const numericId = externalJobRef.match(/\d{10,}/)?.[0] ?? null;
  const safeCompany = (companyName ?? `求人${externalJobRef}`).replace(/[\\/:*?"<>|]/g, "").trim();
  const fileName = numericId ? `求人票_${safeCompany}_${numericId}.pdf` : `求人票_${safeCompany}.pdf`;

  // T-181: 行の保存は従来どおり同期で行い、PDF生成（pdf-service→Drive保管）はレスポンス後に
  //        fire-and-forget で起動する（本人の「気になる」操作を待たせない・失敗しても保存は成立）。
  //        AI分析は起動しない（CAの手動起動のまま）。
  // extractedText があれば保存し extractedAt を立てる（将来CAが分析する際の材料。ここでは分析しない）。
  // T-159: CandidateFile の作成と OneDrive 同期の受付（PENDING 行）を同一トランザクションにする。
  //        PDF生成が成功した時点で triggerOneDriveSync に本体を渡して実コピーを起動する
  //        （from-job-platform の新規作成経路と同じ扱い）。生成失敗時は PENDING のまま残り
  //        SKIPPED(NO_FILE_BODY)（夜間判定）となる（従来挙動）。
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.candidateFile.create({
      data: {
        candidateId: candidate.id,
        category: "BOOKMARK",
        fileName,
        fileSize: extractedText ? Buffer.byteLength(extractedText, "utf8") : 0,
        mimeType: "text/plain",
        driveFileId: null,
        driveViewUrl: null,
        driveFolderId: null,
        sourceType: "job-platform",
        externalJobRef,
        origin: "candidate",
        memo: jobUrl,
        // T-161: 求人スナップショットを保存する（旧実装は jobTitle を受信しつつ void で破棄していた）。
        // 下流のエントリー化（to-entry）で JobEntry.jobTitle / jobCategory へ引き継ぐための保管。
        jobTitle,
        jobCategory,
        candidateNote, // 本人メモ（null 可）。caComment は本人追加時に触れない（CA専用列）。
        ...(extractedText ? { extractedText, extractedAt: new Date() } : {}),
        uploadedByUserId: systemUserId,
      },
      select: FAVORITE_DTO_SELECT,
    });
    // T-181: この時点では実体が無いので同期は起動しない（PENDING受付のみ）。
    // 実コピーは下の fire-and-forget PDF生成の成功時に triggerOneDriveSync で起動する。
    await enqueueOneDriveSync(
      { candidateFileId: row.id, candidateId: candidate.id, category: "BOOKMARK" },
      tx,
    );
    return row;
  });

  // T-181: PDF生成（pdf-service→Drive保管→driveFileId等更新）。★await しない（fire-and-forget）。
  // 本人のレスポンスは即返す。失敗しても保存済みの行はそのまま（HistoryTab 側は求人詳細への
  // フォールバックリンクで開ける）。sid = externalJobRef（job-platform の source_job_id）。
  void generateAndStorePdf({ fileId: created.id, candidateId: candidate.id, sid: externalJobRef, fileName })
    .then((pdfBuffer) => {
      // PDF実体が揃ったこの時点で OneDrive コピーを起動（本文は手元にあるので取り直さない）。
      triggerOneDriveSync({ candidateFileId: created.id, content: pdfBuffer, mimeType: "application/pdf" });
    })
    .catch((err) => {
      console.error(`[candidate-site/favorites] PDF gen/store failed (sid=${externalJobRef}):`, err instanceof Error ? err.message : String(err));
    });

  return NextResponse.json({ ok: true, created: true, favorite: toFavoriteDTO(created, false) });
}

// ---- PATCH: お気に入りのメモ(candidateNote)更新 ----
// T-133 FU-1: メモ解禁。本人追加(origin="candidate")に加え、CA推薦行(origin=null|"ca")・
// PDF行(externalJobRef=null)にも candidateNote の書込を許可する。
//   - 緩めるのは candidateNote のみ。caComment・origin・その他の列は本エンドポイントでは一切書き換えない
//     （data に candidateNote しか含めないため、機械的に他フィールドは変更不可）。
//   - 対象行の特定: fileId（CandidateFile.id）指定を優先。無ければ externalJobRef で特定（PDF行は
//     externalJobRef=null のため fileId 指定が必須）。いずれも candidateId でスコープし本人の行のみに限定。
//   - プレビューセッション（書込不可）からの書込拒否は mypage BFF 側の責務（本APIは共有鍵で BFF を信頼）。
export async function PATCH(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId,
    candidateNumber: body.candidateNumber,
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 対象行の特定キー: fileId 優先、無ければ externalJobRef。両方欠落は 400。
  const fileId = str(body.fileId);
  const externalJobRef = str(body.externalJobRef);
  if (!fileId && !externalJobRef) {
    return NextResponse.json({ error: "fileId or externalJobRef is required" }, { status: 400 });
  }

  // candidateNote / note 両方受け付ける（GET が candidateNote を返すため、クライアントは candidateNote で送る）。
  const candidateNote = str(body.candidateNote ?? body.note);

  // fileId 指定なら id で、無ければ externalJobRef で特定。いずれも candidateId でスコープ（本人の行のみ）。
  const row = await prisma.candidateFile.findFirst({
    where: fileId
      ? { id: fileId, candidateId: candidate.id, category: "BOOKMARK", archivedAt: null }
      : { candidateId: candidate.id, category: "BOOKMARK", externalJobRef, archivedAt: null },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ ok: false, updated: false, reason: "not-found" }, { status: 404 });
  }

  // candidateNote のみ更新（caComment・origin 等は data に含めない＝機械的に変更不可）。
  const updated = await prisma.candidateFile.update({
    where: { id: row.id },
    data: { candidateNote },
    select: FAVORITE_DTO_SELECT,
  });

  return NextResponse.json({ ok: true, updated: true, favorite: toFavoriteDTO(updated, false) });
}

// ---- DELETE: 本人お気に入り解除（origin="candidate" のみ） ----
export async function DELETE(request: Request) {
  if (!verifyCandidateSiteKey(request)) return unauthorized();

  // body 優先、無ければクエリでも受ける。
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* body なし可 */
  }
  const { searchParams } = new URL(request.url);

  const candidate = await resolveScopedCandidate({
    candidateId: body.candidateId ?? searchParams.get("candidateId"),
    candidateNumber: body.candidateNumber ?? searchParams.get("candidateNumber"),
  });
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const externalJobRef = str(body.externalJobRef) ?? str(searchParams.get("externalJobRef"));
  if (!externalJobRef) {
    return NextResponse.json({ error: "externalJobRef is required" }, { status: 400 });
  }

  const row = await prisma.candidateFile.findFirst({
    where: { candidateId: candidate.id, category: "BOOKMARK", externalJobRef, archivedAt: null },
    select: { id: true, origin: true },
  });
  if (!row) {
    return NextResponse.json({ ok: true, removed: false, reason: "not-found" });
  }
  // CA追加（null/"ca"）は本人操作で消せない。
  if (row.origin !== "candidate") {
    return NextResponse.json(
      { ok: false, removed: false, reason: "ca-added-not-removable" },
      { status: 403 }
    );
  }

  // 本人追加行のみアーカイブ（BOOKMARK は物理削除でなくアーカイブ運用に従う）。
  await prisma.candidateFile.update({
    where: { id: row.id },
    data: { archivedAt: new Date(), archivedReason: "candidate-unfavorite" },
  });

  return NextResponse.json({ ok: true, removed: true });
}
