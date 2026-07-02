import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-128 T2: 求職者サイト向け お気に入り（ブックマーク）API。
// 台帳は CandidateFile（category="BOOKMARK"）。origin で CA追加(null|"ca") と 本人追加("candidate") を区別。
//
// GET    /api/external/candidate-site/favorites?candidateNumber=... （または candidateId）: 一覧
// POST   /api/external/candidate-site/favorites: 本人お気に入り追加（記録のみ・PDF/Drive/AI起動なし）
// PATCH  /api/external/candidate-site/favorites: 本人お気に入りのメモ(candidateNote)更新（origin="candidate" のみ・candidateNote のみ）
// DELETE /api/external/candidate-site/favorites: 本人お気に入り解除（origin="candidate" のみ）
//
// 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（全401）。
// スコープ: リクエストが指す候補者に厳密スコープ。全クエリで candidateId を条件に含める。

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// fileName（求人票_{会社名}_{10桁以上ID}.pdf / 求人票_{会社名}.pdf）から会社名をベストエフォート抽出。
// 旧PDF等で形式が違う場合は null（fileName 自体はそのまま返すので情報は落ちない）。
function parseCompanyFromFileName(fileName: string): string | null {
  const n = fileName.replace(/\.pdf$/i, "");
  const m = n.match(/^求人票_(.+?)(?:_\d{10,})?$/);
  return m ? m[1] : null;
}

// 本人追加行の uploadedByUserId 用。実ユーザー（求職者）は存在しないためシステムユーザーを使う。
// origin="candidate" 列が本人追加であることを示す（uploadedByUserId は台帳上の便宜）。
async function resolveSystemUserId(): Promise<string | null> {
  const anon = await prisma.user.findUnique({ where: { email: "anonymous@local" }, select: { id: true } });
  if (anon) return anon.id;
  const admin = await prisma.user.findFirst({ where: { role: "admin", status: "active" }, select: { id: true } });
  return admin?.id ?? null;
}

type FavoriteDTO = {
  id: string;
  externalJobRef: string | null;
  sourceType: string | null;
  origin: "ca" | "candidate";
  fileName: string;
  companyName: string | null;
  jobUrl: string | null;
  candidateNote: string | null; // 求職者本人のメモ（本人が編集可）
  caComment: string | null; // CAアドバイザーコメント（求職者からは読み取り専用）
  aiMatchRating: string | null;
  createdAt: string;
  applied: boolean;
};

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

  // 全ブックマーク（CA追加・本人追加・旧PDF経路すべて）を候補者スコープで取得。
  const files = await prisma.candidateFile.findMany({
    where: { candidateId: candidate.id, category: "BOOKMARK", archivedAt: null },
    select: {
      id: true,
      externalJobRef: true,
      sourceType: true,
      origin: true,
      fileName: true,
      memo: true,
      candidateNote: true,
      caComment: true,
      aiMatchRating: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // 応募済み externalJobRef 一覧（画面の「応募済み」表示用）。候補者スコープ。
  const applications = await prisma.candidateJobApplication.findMany({
    where: { candidateId: candidate.id },
    select: { externalJobRef: true },
  });
  const appliedRefs = new Set(applications.map((a) => a.externalJobRef));

  const favorites: FavoriteDTO[] = files.map((f) => ({
    id: f.id,
    externalJobRef: f.externalJobRef,
    sourceType: f.sourceType,
    origin: f.origin === "candidate" ? "candidate" : "ca", // null/"ca" は CA 追加として正規化
    fileName: f.fileName,
    companyName: parseCompanyFromFileName(f.fileName),
    jobUrl: f.memo,
    candidateNote: f.candidateNote,
    caComment: f.caComment,
    aiMatchRating: f.aiMatchRating,
    createdAt: f.createdAt.toISOString(),
    applied: f.externalJobRef ? appliedRefs.has(f.externalJobRef) : false,
  }));

  return NextResponse.json({
    ok: true,
    candidateNumber: candidate.candidateNumber,
    favorites,
    appliedExternalJobRefs: [...appliedRefs],
  });
}

// ---- POST: 本人お気に入り追加（記録のみ） ----
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
  const existing = await prisma.candidateFile.findFirst({
    where: {
      candidateId: candidate.id,
      category: "BOOKMARK",
      externalJobRef,
      archivedAt: null,
    },
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, sourceType: true, aiMatchRating: true, externalJobRef: true, createdAt: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      alreadyExists: true,
      favorite: toDTO(existing, false),
    });
  }

  const systemUserId = await resolveSystemUserId();
  if (!systemUserId) {
    return NextResponse.json({ error: "System user not found" }, { status: 500 });
  }

  const companyName = str(body.companyName);
  const jobTitle = str(body.jobTitle);
  const extractedText = str(body.extractedText);
  const jobUrl = str(body.jobUrl);
  // 本人メモ（任意）。空文字・未指定は null（メモなしお気に入りとして登録成立）。
  const candidateNote = str(body.note);

  // ファイル名は from-job-platform と同形式（求人票_{会社名}[_{数値ID}].pdf）。会社名が無ければ求人IDで代替。
  const numericId = externalJobRef.match(/\d{10,}/)?.[0] ?? null;
  const safeCompany = (companyName ?? `求人${externalJobRef}`).replace(/[\\/:*?"<>|]/g, "").trim();
  const fileName = numericId ? `求人票_${safeCompany}_${numericId}.pdf` : `求人票_${safeCompany}.pdf`;

  // 記録のみ: PDF生成・Drive保管・会社説明生成・AI分析は一切起動しない（driveFileId=null のまま）。
  // extractedText があれば保存し extractedAt を立てる（将来CAが分析する際の材料。ここでは分析しない）。
  const created = await prisma.candidateFile.create({
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
      candidateNote, // 本人メモ（null 可）。caComment は本人追加時に触れない（CA専用列）。
      ...(extractedText ? { extractedText, extractedAt: new Date() } : {}),
      uploadedByUserId: systemUserId,
    },
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, sourceType: true, aiMatchRating: true, externalJobRef: true, createdAt: true },
  });

  // jobTitle は現状 CandidateFile に専用列が無いため保持しない（会社名は fileName に含める）。
  void jobTitle;

  return NextResponse.json({ ok: true, created: true, favorite: toDTO(created, false) });
}

// ---- PATCH: 本人お気に入りのメモ(candidateNote)更新 ----
// 求職者が変更できるのは「自分が追加したお気に入り(origin="candidate")」の「candidateNote のみ」。
// caComment・origin・その他の列は本エンドポイントでは一切書き換えない（機械的に candidateNote 限定）。
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

  const externalJobRef = str(body.externalJobRef);
  if (!externalJobRef) {
    return NextResponse.json({ error: "externalJobRef is required" }, { status: 400 });
  }

  // 空文字・null はメモ削除（null 化）として扱う。未指定(body.note が無い)も null。
  const candidateNote = str(body.note);

  const row = await prisma.candidateFile.findFirst({
    where: { candidateId: candidate.id, category: "BOOKMARK", externalJobRef, archivedAt: null },
    select: { id: true, origin: true },
  });
  if (!row) {
    return NextResponse.json({ ok: false, updated: false, reason: "not-found" }, { status: 404 });
  }
  // CA追加（null/"ca"）は本人がメモ編集できない（本人追加のみ許可）。
  if (row.origin !== "candidate") {
    return NextResponse.json(
      { ok: false, updated: false, reason: "ca-added-not-editable" },
      { status: 403 }
    );
  }

  // candidateNote のみ更新（caComment・origin 等は data に含めない＝機械的に変更不可）。
  const updated = await prisma.candidateFile.update({
    where: { id: row.id },
    data: { candidateNote },
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, sourceType: true, aiMatchRating: true, externalJobRef: true, createdAt: true },
  });

  return NextResponse.json({ ok: true, updated: true, favorite: toDTO(updated, false) });
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

// 追加/重複/更新時のレスポンス用 DTO 変換（applied は呼び出し側が持つ場合のみ true）。
function toDTO(
  f: {
    id: string;
    externalJobRef: string | null;
    sourceType: string | null;
    origin: string | null;
    fileName: string;
    memo: string | null;
    candidateNote: string | null;
    caComment: string | null;
    aiMatchRating: string | null;
    createdAt: Date;
  },
  applied: boolean
): FavoriteDTO {
  return {
    id: f.id,
    externalJobRef: f.externalJobRef,
    sourceType: f.sourceType,
    origin: f.origin === "candidate" ? "candidate" : "ca",
    fileName: f.fileName,
    companyName: parseCompanyFromFileName(f.fileName),
    jobUrl: f.memo,
    candidateNote: f.candidateNote,
    caComment: f.caComment,
    aiMatchRating: f.aiMatchRating,
    createdAt: f.createdAt.toISOString(),
    applied,
  };
}
