import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import { SUBMITTABLE_STATUSES, PORTAL_INTENT_MAP } from "@/lib/constants/response-status";
import {
  CANDIDATE_CA_SELECT,
  applyJobResponseIntent,
  createOrUpdateResponseTask,
} from "@/lib/mypage-response-sync";
import {
  notifySubmissionViaLineWorks,
  notifySubmissionViaResendEmail,
  type SubmissionNotificationPayload,
} from "@/lib/candidate-site-notifications";

// T-133 P2: まとめ送信 API（portal内製・箱B POST /{token}/submit 相当）。
//
// POST /api/external/candidate-site/response-submission
//   body: { candidateNumber|candidateId }
//
// 差分抽出（箱B「未送信かつ status != none」と同一解釈）:
//   responseStatus ∈ {INTERESTED, APPLY, PENDING} かつ
//   （responseSubmittedAt IS NULL または responseStatusUpdatedAt > responseSubmittedAt）
//   ※UNANSWERED（=none相当）は箱Bと同じく差分に含めない。取り消しの CandidateJobResponse 削除は
//     response-status API がステータス変更時に即時実行済み（箱B feedback-status パリティ）。
//   ※EXCLUDED/IN_SELECTION/SELECTION_ENDED はCA駆動状態であり送信対象外（箱B同様）。
//
// 実行内容:
//   1. CandidateResponseSubmission + Item（送信時点スナップショット）記録
//   2. 対象行の responseSubmittedAt 更新
//   3. INTERESTED/APPLY 行の CandidateJobResponse upsert（冪等・kyuujinJobId がある行のみ。
//      箱B submit も notify_portal_responses で同じ差分を portal へ送っていたパリティ）
//   4. タスク自動生成（既存ロジック流用・10分dedup）
//   5. 通知①LINE WORKS ②Resend は P3 TODO フック呼び出しのみ（no-op）
//   差分0件 → Submission 行を作らず {submitted: 0}（箱Bの空送信レスポンス相当）。
// kyuujinPDF への同期送信はしない（P2 は並行稼働なし）。

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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

  // 差分抽出（箱B submit の is_submitted=false AND status != none 相当）。
  // 「未送信 or 送信後に変更あり」はカラム間比較（updatedAt > submittedAt）を含むため raw で ID を抽出。
  void SUBMITTABLE_STATUSES; // IN句はraw側に直書き（値は定数と同一。ズレたらここを直す）
  const diffIds = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM candidate_files
    WHERE candidate_id = ${candidate.id} AND category = 'BOOKMARK' AND archived_at IS NULL
      AND response_status IN ('INTERESTED','APPLY','PENDING')
      AND (response_submitted_at IS NULL OR response_status_updated_at > response_submitted_at)`;
  const targets = diffIds.length
    ? await prisma.candidateFile.findMany({
        where: { id: { in: diffIds.map((r) => r.id) } },
        select: {
          id: true, fileName: true, kyuujinJobId: true, responseStatus: true,
          responseStatusUpdatedAt: true, responseSubmittedAt: true,
        },
      })
    : [];

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      submitted: 0,
      message: "送信する新しい回答がありません",
    });
  }

  const now = new Date();
  const interested = targets.filter((t) => t.responseStatus === "INTERESTED");
  const apply = targets.filter((t) => t.responseStatus === "APPLY");

  // 1. Submission + Items（送信時点スナップショット）
  const submission = await prisma.candidateResponseSubmission.create({
    data: {
      candidateId: candidate.id,
      submittedAt: now,
      interestedCount: interested.length,
      applyCount: apply.length,
      items: {
        create: targets.map((t) => ({
          candidateFileId: t.id,
          responseStatus: t.responseStatus!,
        })),
      },
    },
    select: { id: true },
  });

  // 2. responseSubmittedAt 更新（対象行のみ）
  await prisma.candidateFile.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { responseSubmittedAt: now },
  });

  // 3. INTERESTED/APPLY の CandidateJobResponse upsert（冪等・kyuujinJobId のある行のみ）
  let syncedCount = 0;
  for (const t of [...interested, ...apply]) {
    if (t.kyuujinJobId == null) continue; // jp専用行等は同期不能（P4 設計で扱う）
    const intent = PORTAL_INTENT_MAP[t.responseStatus!];
    if (!intent) continue;
    try {
      await applyJobResponseIntent(candidate.id, t.kyuujinJobId, intent, now);
      syncedCount++;
    } catch (e) {
      console.error(`[response-submission] sync failed fileId=${t.id}:`, e);
    }
  }

  // 4. タスク自動生成（既存ロジック流用・10分dedup）
  if (syncedCount > 0) {
    const candWithCa = await prisma.candidate.findUnique({
      where: { id: candidate.id },
      select: CANDIDATE_CA_SELECT,
    });
    if (candWithCa) {
      try {
        await createOrUpdateResponseTask(candWithCa);
      } catch (e) {
        console.error("[response-submission] タスク自動生成に失敗:", e);
      }
    }
  }

  // 5. 通知（P3 実装済み: ①LINE WORKSマイページBot ②候補者確認メール。失敗は本体を失敗させない）
  const payload: SubmissionNotificationPayload = {
    candidateId: candidate.id,
    candidateNumber: candidate.candidateNumber,
    candidateName: candidate.name,
    submissionId: submission.id,
    interestedCount: interested.length,
    applyCount: apply.length,
    jobs: targets.map((t) => ({
      fileName: t.fileName,
      kyuujinJobId: t.kyuujinJobId,
      responseStatus: t.responseStatus!,
    })),
  };
  try {
    await notifySubmissionViaLineWorks(payload);
    await notifySubmissionViaResendEmail(payload);
  } catch (e) {
    console.error("[response-submission] 通知フック呼び出しに失敗（no-op期のため影響なし）:", e);
  }

  return NextResponse.json({
    ok: true,
    submitted: targets.length,
    submissionId: submission.id,
    interestedCount: interested.length,
    applyCount: apply.length,
    pendingCount: targets.length - interested.length - apply.length,
    syncedCount,
  });
}
