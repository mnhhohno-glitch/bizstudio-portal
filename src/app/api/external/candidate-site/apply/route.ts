import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import { notifyCandidateApplication } from "@/lib/candidate-site/apply-notification";

// T-128 T2: 求職者サイトからの応募受付＋担当CAへ LINE WORKS 通知。
// POST /api/external/candidate-site/apply
//
// - 認証: X-Auth-Key（CANDIDATE_SITE_API_KEY）。未設定は fail-closed（401）。
// - 候補者スコープ: リクエストが指す候補者に厳密スコープ。
// - 記録: CandidateJobApplication に upsert（同一候補者×同一求人は既存を返し二重通知しない）。
// - 通知: 担当CAへ LINE WORKS。通知失敗しても応募記録は残す（notifiedAt を立てないだけ）。
// - エントリー管理への正式連携はフェーズ2（本タスクは記録＋通知のみ）。

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

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

  const externalJobRef = str(body.externalJobRef);
  if (!externalJobRef) {
    return NextResponse.json({ error: "externalJobRef is required" }, { status: 400 });
  }

  // 重複応募ガード: 既存レコードがあれば再通知しない（冪等）。
  const existing = await prisma.candidateJobApplication.findUnique({
    where: { candidateId_externalJobRef: { candidateId: candidate.id, externalJobRef } },
    select: { id: true, appliedAt: true, notifiedAt: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      alreadyApplied: true,
      applicationId: existing.id,
      appliedAt: existing.appliedAt.toISOString(),
      notified: existing.notifiedAt !== null,
    });
  }

  // 応募記録を先に作成（通知失敗しても応募は残す＝応募が消えるのが最悪）。
  const application = await prisma.candidateJobApplication.create({
    data: { candidateId: candidate.id, externalJobRef },
    select: { id: true, appliedAt: true },
  });

  // 担当CA情報を取得（通知先）。
  const ca = await prisma.candidate.findUnique({
    where: { id: candidate.id },
    select: { employee: { select: { name: true, lineUserId: true } } },
  });

  const jobTitle = str(body.jobTitle);
  const companyName = str(body.companyName);

  // LINE WORKS 通知。失敗しても応募記録は残し、失敗はログのみ（再送可能）。
  let notified = false;
  try {
    notified = await notifyCandidateApplication({
      candidateName: candidate.name,
      candidateNumber: candidate.candidateNumber,
      caName: ca?.employee?.name ?? null,
      caLineworksId: ca?.employee?.lineUserId ?? null,
      jobTitle,
      companyName,
      externalJobRef,
    });
    if (notified) {
      await prisma.candidateJobApplication.update({
        where: { id: application.id },
        data: { notifiedAt: new Date() },
      });
    }
  } catch (e) {
    console.error("[candidate-site/apply] LINE WORKS 通知失敗（応募記録は保持）:", e);
    notified = false;
  }

  return NextResponse.json({
    ok: true,
    created: true,
    applicationId: application.id,
    appliedAt: application.appliedAt.toISOString(),
    notified,
  });
}
