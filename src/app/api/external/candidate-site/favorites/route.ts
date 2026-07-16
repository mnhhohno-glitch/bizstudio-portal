import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import { SUBMITTABLE_STATUSES } from "@/lib/constants/response-status";

// T-128 T2: 求職者サイト向け お気に入り（ブックマーク）API。
// 台帳は CandidateFile（category="BOOKMARK"）。origin で CA追加(null|"ca") と 本人追加("candidate") を区別。
//
// GET    /api/external/candidate-site/favorites?candidateNumber=... （または candidateId）: 一覧
// POST   /api/external/candidate-site/favorites: 本人お気に入り追加（記録のみ・PDF/Drive/AI起動なし）
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

// T-131 step3a: externalJobRef が付いた行（＝job-platformに紐付いた求人。CA/本人が保存したjp求人と、
// PDFアップから自動フルデータ化された紐付け済み求人の両方）を「jp形」に正規化して返す。
//   - sourceJobId = externalJobRef（job-platformの媒体内ID。フル詳細/AI解説の取得キー）
//   - sourceType = "job-platform"（PDF由来でも紐付け済みは job-platform 扱いに昇格）
// これで既存jp行とT-131紐付け行のレスポンス形が一致し、求職者サイト側は区別できず自動でフルカード表示になる。
// externalJobRef（内部列名）は互換のため当面併記する（消費側がsourceJobIdへ移行後に削れる）。
function jpNormalize(
  externalJobRef: string | null,
  storedSourceType: string | null,
): { sourceJobId: string | null; sourceType: string | null } {
  if (externalJobRef) return { sourceJobId: externalJobRef, sourceType: "job-platform" };
  return { sourceJobId: null, sourceType: storedSourceType };
}

// T-133 P2: 未送信の仕分け変更フラグ（差分送信の対象になるか）。
// 対象 = INTERESTED/APPLY/PENDING かつ（未送信 or 送信後に変更）。response-submission API の差分抽出と同一解釈。
function computeHasUnsubmittedChange(f: {
  responseStatus: string | null;
  responseStatusUpdatedAt: Date | null;
  responseSubmittedAt: Date | null;
}): boolean {
  if (!f.responseStatus || !SUBMITTABLE_STATUSES.has(f.responseStatus as never)) return false;
  if (!f.responseStatusUpdatedAt) return false;
  if (!f.responseSubmittedAt) return true;
  return f.responseStatusUpdatedAt.getTime() > f.responseSubmittedAt.getTime();
}

type FavoriteDTO = {
  id: string;
  externalJobRef: string | null;
  /** job-platform 媒体内ID（紐付け済み行のみ・= externalJobRef）。フル詳細/AI解説の取得キー。 */
  sourceJobId: string | null;
  /** kyuujinPDF の Job 内部ID（jobs.id・Int）。PDF由来求人を会社名照合せず直接引くための鍵。未紐付けは null。 */
  kyuujinJobId: number | null;
  /** T-133 P2: 箱A内製の仕分けステータス（7値・箱B feedback_status と同一文字列）。null=未仕分け（UNANSWERED相当）。 */
  responseStatus: string | null;
  /** T-133 P2: CA手動の◎○△（aiMatchRating A-D とは別系統）。 */
  caMatchLabel: string | null;
  /** T-133 P2: 紹介日時（ISO）。null=未設定。 */
  introducedAt: string | null;
  /** T-133 P2: 現在の仕分けを最後にまとめ送信した日時（ISO）。null=未送信。 */
  responseSubmittedAt: string | null;
  /** T-133 P2: 未送信の仕分け変更があるか（INTERESTED/APPLY/PENDING かつ 送信後に変更 or 未送信）。 */
  hasUnsubmittedChange: boolean;
  sourceType: string | null;
  origin: "ca" | "candidate";
  fileName: string;
  companyName: string | null;
  jobUrl: string | null;
  candidateNote: string | null; // 求職者本人のメモ（本人が編集可）
  caComment: string | null; // CAアドバイザーコメント（求職者からは読み取り専用）
  /** T-133 FU-13a: CAによる求職者向け表示の上書き（13項目のキー→上書き文字列）。null=上書きなし。mypage BFF が元データにマージ。 */
  displayOverrides: Record<string, string> | null;
  /** T-133 FU-14a: CAによる手動並び順。null=手動順なし（従来ソート）。小さいほど先頭。favorites は既にこの順で返る。 */
  displayOrder: number | null;
  /** ピックアップ: CAが「先頭固定」を付けた日時（ISO）。null=非ピックアップ。上限3件／求職者は API 側で判定。 */
  pickedUpAt: string | null;
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
      kyuujinJobId: true,
      sourceType: true,
      origin: true,
      fileName: true,
      memo: true,
      candidateNote: true,
      caComment: true,
      displayOverrides: true,
      displayOrder: true,
      pickedUpAt: true,
      aiMatchRating: true,
      responseStatus: true,
      responseStatusUpdatedAt: true,
      responseSubmittedAt: true,
      caMatchLabel: true,
      introducedAt: true,
      createdAt: true,
    },
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

  const favorites: FavoriteDTO[] = files.map((f) => {
    const jp = jpNormalize(f.externalJobRef, f.sourceType);
    return {
    id: f.id,
    externalJobRef: f.externalJobRef,
    sourceJobId: jp.sourceJobId,
    kyuujinJobId: f.kyuujinJobId,
    responseStatus: f.responseStatus,
    caMatchLabel: f.caMatchLabel,
    introducedAt: f.introducedAt ? f.introducedAt.toISOString() : null,
    responseSubmittedAt: f.responseSubmittedAt ? f.responseSubmittedAt.toISOString() : null,
    hasUnsubmittedChange: computeHasUnsubmittedChange(f),
    sourceType: jp.sourceType,
    origin: f.origin === "candidate" ? "candidate" : "ca", // null/"ca" は CA 追加として正規化
    fileName: f.fileName,
    companyName: parseCompanyFromFileName(f.fileName),
    jobUrl: f.memo,
    candidateNote: f.candidateNote,
    caComment: f.caComment,
    displayOverrides: (f.displayOverrides ?? null) as unknown as Record<string, string> | null,
    displayOrder: f.displayOrder,
    pickedUpAt: f.pickedUpAt ? f.pickedUpAt.toISOString() : null,
    aiMatchRating: f.aiMatchRating,
    createdAt: f.createdAt.toISOString(),
    applied: f.externalJobRef ? appliedRefs.has(f.externalJobRef) : false,
    };
  });

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
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, displayOverrides: true, displayOrder: true, pickedUpAt: true, sourceType: true, aiMatchRating: true, externalJobRef: true, kyuujinJobId: true, responseStatus: true, responseStatusUpdatedAt: true, responseSubmittedAt: true, caMatchLabel: true, introducedAt: true, createdAt: true },
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
  // 本人メモ（任意）。candidateNote / note 両方受け付ける。空文字・未指定は null。
  const candidateNote = str(body.candidateNote ?? body.note);

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
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, displayOverrides: true, displayOrder: true, pickedUpAt: true, sourceType: true, aiMatchRating: true, externalJobRef: true, kyuujinJobId: true, responseStatus: true, responseStatusUpdatedAt: true, responseSubmittedAt: true, caMatchLabel: true, introducedAt: true, createdAt: true },
  });

  // jobTitle は現状 CandidateFile に専用列が無いため保持しない（会社名は fileName に含める）。
  void jobTitle;

  return NextResponse.json({ ok: true, created: true, favorite: toDTO(created, false) });
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
    select: { id: true, origin: true, fileName: true, memo: true, candidateNote: true, caComment: true, displayOverrides: true, displayOrder: true, pickedUpAt: true, sourceType: true, aiMatchRating: true, externalJobRef: true, kyuujinJobId: true, responseStatus: true, responseStatusUpdatedAt: true, responseSubmittedAt: true, caMatchLabel: true, introducedAt: true, createdAt: true },
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
    kyuujinJobId: number | null;
    responseStatus: string | null;
    responseStatusUpdatedAt: Date | null;
    responseSubmittedAt: Date | null;
    caMatchLabel: string | null;
    introducedAt: Date | null;
    sourceType: string | null;
    origin: string | null;
    fileName: string;
    memo: string | null;
    candidateNote: string | null;
    caComment: string | null;
    displayOverrides: unknown;
    displayOrder: number | null;
    pickedUpAt: Date | null;
    aiMatchRating: string | null;
    createdAt: Date;
  },
  applied: boolean
): FavoriteDTO {
  const jp = jpNormalize(f.externalJobRef, f.sourceType);
  return {
    id: f.id,
    externalJobRef: f.externalJobRef,
    sourceJobId: jp.sourceJobId,
    kyuujinJobId: f.kyuujinJobId,
    responseStatus: f.responseStatus,
    caMatchLabel: f.caMatchLabel,
    introducedAt: f.introducedAt ? f.introducedAt.toISOString() : null,
    responseSubmittedAt: f.responseSubmittedAt ? f.responseSubmittedAt.toISOString() : null,
    hasUnsubmittedChange: computeHasUnsubmittedChange(f),
    sourceType: jp.sourceType,
    origin: f.origin === "candidate" ? "candidate" : "ca",
    fileName: f.fileName,
    companyName: parseCompanyFromFileName(f.fileName),
    jobUrl: f.memo,
    candidateNote: f.candidateNote,
    caComment: f.caComment,
    displayOverrides: (f.displayOverrides ?? null) as Record<string, string> | null,
    displayOrder: f.displayOrder,
    pickedUpAt: f.pickedUpAt ? f.pickedUpAt.toISOString() : null,
    aiMatchRating: f.aiMatchRating,
    createdAt: f.createdAt.toISOString(),
    applied,
  };
}
