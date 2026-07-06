import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";

// T-134 Phase A: 求職者サイト（/site/）の行動ログ受信。
// POST /api/external/candidate-site/activity-log
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（401）。
// - 候補者スコープ: candidateNumber または candidateId で厳密解決（他者混入を防止）。
// - eventType は文字列（未知種別も受理・将来拡張のためenum化しない）。
// - fire-and-forget 受信: 失敗しても mypage 体験に影響なし。応答は軽量（{ok:true} のみ）。
// - preview（管理者プレビュー）行動は送信側 mypage で除外済み想定（本APIは無差別に受信する）。
// - 候補者本人向けの読み出しAPIは意図的に用意しない（露出防止・T-134確定方針）。

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// 文字列カラムの防御的な長さ上限（DBが仮に肥大送信を受けても保護される）。
const MAX_EVENT_TYPE = 64;
const MAX_SEARCH_ID = 128;
const MAX_JOB_REF = 128;
const MAX_NAV_SOURCE = 64;
const MAX_PAGE_PATH = 512;
const MAX_DETAIL_BYTES = 8 * 1024; // 8KB（検索params + totalCount 等は十分収まる）

export async function POST(request: Request) {
  if (!verifyCandidateSiteKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const eventType = str(body.eventType);
  if (!eventType) {
    return NextResponse.json({ error: "eventType is required" }, { status: 400 });
  }
  if (eventType.length > MAX_EVENT_TYPE) {
    return NextResponse.json({ error: "eventType too long" }, { status: 400 });
  }

  const searchId = str(body.searchId);
  const jobRef = str(body.jobRef);
  const navSource = str(body.navSource);
  const pagePath = str(body.pagePath);

  if (searchId && searchId.length > MAX_SEARCH_ID) {
    return NextResponse.json({ error: "searchId too long" }, { status: 400 });
  }
  if (jobRef && jobRef.length > MAX_JOB_REF) {
    return NextResponse.json({ error: "jobRef too long" }, { status: 400 });
  }
  if (navSource && navSource.length > MAX_NAV_SOURCE) {
    return NextResponse.json({ error: "navSource too long" }, { status: 400 });
  }
  if (pagePath && pagePath.length > MAX_PAGE_PATH) {
    return NextResponse.json({ error: "pagePath too long" }, { status: 400 });
  }

  // detail は任意JSON。サイズ上限のみチェック（形は問わない）。
  let detail: unknown = body.detail ?? null;
  if (detail !== null && detail !== undefined) {
    try {
      const serialized = JSON.stringify(detail);
      if (Buffer.byteLength(serialized, "utf8") > MAX_DETAIL_BYTES) {
        return NextResponse.json({ error: "detail too large" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "detail not serializable" }, { status: 400 });
    }
  } else {
    detail = null;
  }

  try {
    await prisma.candidateActivityLog.create({
      data: {
        candidateId: candidate.id,
        eventType,
        searchId,
        jobRef,
        navSource,
        pagePath,
        detail: detail as never,
      },
    });
  } catch (e) {
    // 書込み失敗は 500 のみ返し、mypage 側は捨てる（fire-and-forget）。
    console.error("[candidate-site/activity-log] write failed:", e);
    return NextResponse.json({ error: "Write failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
