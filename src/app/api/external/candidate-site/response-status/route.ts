import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCandidateSiteKey, resolveScopedCandidate } from "@/lib/candidate-site-auth";
import {
  isResponseStatus,
  USER_SETTABLE_STATUSES,
  PORTAL_INTENT_MAP,
  EXCLUDED_ACTOR_VALUES,
  isCandidateExcludeReasonChoice,
  formatCandidateExcludeReason,
  CANDIDATE_EXCLUDE_REASON_CHOICES,
  type ExcludedActor,
} from "@/lib/constants/response-status";
import {
  CANDIDATE_CA_SELECT,
  applyJobResponseIntent,
  createOrUpdateResponseTask,
} from "@/lib/mypage-response-sync";

// T-133 P2: 箱A（CandidateFile BOOKMARK）の仕分けステータス変更 API（portal内製・箱B PUT /jobs/feedback-status 相当）。
//
// PATCH /api/external/candidate-site/response-status
//   body: { candidateNumber|candidateId, kyuujinJobId?|fileId?, status: 7値, actor: "user"|"ca" }
//   対象特定は fileId（CandidateFile.id）優先、無ければ kyuujinJobId（候補者スコープ内・一意制約により高々1行）。
//
// 箱B（deployed feedback-status ハンドラ）とのパリティ:
//   - EXCLUDED → excludedBy=actor / excludedAt=now。それ以外へ変更 → excludedBy/At を無条件クリア（箱Bと同一）
//   - portal応募意向の同期はステータス変更時に即時発火（INTERESTED→INTERESTED / APPLY→WANT_TO_APPLY /
//     UNANSWERED・PENDING・EXCLUDED→取り消し削除。IN_SELECTION/SELECTION_ENDED は同期しない）
//     ※PENDING/EXCLUDED の削除は箱Bからの意図的な差分（保留・対象外にした求人が
//       「気になる」として回答タスク／フラグに残り続ける不整合を解消するため）
//   - restore（EXCLUDED→UNANSWERED）は本APIの status=UNANSWERED で対応（箱B restore と同等・CAのみ）
// actor 制約: user は EXCLUDED を指定不可・READONLY(IN_SELECTION/SELECTION_ENDED)も指定不可。
//   EXCLUDED からの復帰も CA のみ（箱B restore が CA専用のため）。
// 同値変更は no-op（responseStatusUpdatedAt を進めない＝偽の未送信差分を作らない）。
// kyuujinPDF への同期送信はしない（P2 は並行稼働なし・箱Bはこの経路から更新しない）。
//
// T-189 Phase3-2a（対象外理由・任意項目・後方互換）:
//   body.excludeReason     … "職種が違う" | "会社の雰囲気" | "年収" | "その他"（任意）
//   body.excludeReasonText … excludeReason="その他" の自由記述（任意・200文字まで）
//   - status=EXCLUDED のときだけ CandidateFile.candidateExcludeReason に保存（「その他」は `その他: 本文`）。
//     auto 行・手動行を問わず保存する。EXCLUDED 以外へ変更したときは excludedBy/At と同時にクリアする。
//   - 未指定なら従来どおり（列に触らない）。excludeReason が不正値なら 400。
//   - 同値変更（EXCLUDED→EXCLUDED）で excludeReason だけ来た場合は理由のみ更新する（updatedAt は進めない）。
//   - actor=user の EXCLUDED は、自動配信行（autoSourcedAt 非null＝マイページ「新着マッチ求人」）に限り許可する。
//     手動行（CA厳選）は従来どおり CA のみ（現行 /site/ 仕様を維持）。EXCLUDED からの復帰は従来どおり CA のみ。

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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

  const status = body.status;
  if (!isResponseStatus(status)) {
    return NextResponse.json(
      { error: "status must be one of UNANSWERED/INTERESTED/APPLY/PENDING/EXCLUDED/IN_SELECTION/SELECTION_ENDED" },
      { status: 400 },
    );
  }

  const actor = body.actor;
  if (typeof actor !== "string" || !(EXCLUDED_ACTOR_VALUES as readonly string[]).includes(actor)) {
    return NextResponse.json({ error: "actor must be 'user' or 'ca'" }, { status: 400 });
  }

  // actor=user の権限制約（現行 /site/ 仕様: EXCLUDED は CA/管理者のみ・選考2値は READONLY）。
  // T-189 Phase3-2a: EXCLUDED だけは対象行が自動配信行なら user にも許可するため、行を引いてから判定する（下）。
  if (actor === "user" && !USER_SETTABLE_STATUSES.has(status) && status !== "EXCLUDED") {
    return NextResponse.json(
      { error: `actor=user cannot set status=${status}` },
      { status: 403 },
    );
  }

  // T-189 Phase3-2a: 対象外理由（任意）。不正値は 400。EXCLUDED 以外の status に付いてきた場合は無視する。
  const excludeReasonRaw = body.excludeReason;
  if (excludeReasonRaw != null && excludeReasonRaw !== "" && !isCandidateExcludeReasonChoice(excludeReasonRaw)) {
    return NextResponse.json(
      { error: `excludeReason must be one of ${CANDIDATE_EXCLUDE_REASON_CHOICES.join("/")}` },
      { status: 400 },
    );
  }
  const excludeReasonText =
    typeof body.excludeReasonText === "string" ? body.excludeReasonText : null;
  const candidateExcludeReason =
    status === "EXCLUDED" && isCandidateExcludeReasonChoice(excludeReasonRaw)
      ? formatCandidateExcludeReason(excludeReasonRaw, excludeReasonText)
      : null;

  // 対象行の特定: fileId 優先、無ければ kyuujinJobId（候補者スコープ・一意制約で高々1行）
  const fileId = body.fileId != null ? String(body.fileId) : null;
  const kyuujinJobIdRaw = body.kyuujinJobId;
  const kyuujinJobId =
    typeof kyuujinJobIdRaw === "number"
      ? kyuujinJobIdRaw
      : kyuujinJobIdRaw != null && !Number.isNaN(Number(kyuujinJobIdRaw))
        ? Number(kyuujinJobIdRaw)
        : null;

  if (!fileId && kyuujinJobId == null) {
    return NextResponse.json({ error: "fileId or kyuujinJobId is required" }, { status: 400 });
  }

  const row = await prisma.candidateFile.findFirst({
    where: {
      candidateId: candidate.id,
      category: "BOOKMARK",
      archivedAt: null,
      ...(fileId ? { id: fileId } : { kyuujinJobId: kyuujinJobId! }),
    },
    select: { id: true, kyuujinJobId: true, responseStatus: true, fileName: true, autoSourcedAt: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  }

  // T-189 Phase3-2a: user の EXCLUDED は自動配信行のみ（手動行は従来どおり CA のみ）
  if (actor === "user" && status === "EXCLUDED" && !row.autoSourcedAt) {
    return NextResponse.json(
      { error: "actor=user cannot set status=EXCLUDED (only auto-recommended jobs)" },
      { status: 403 },
    );
  }

  const current = row.responseStatus ?? "UNANSWERED";

  // EXCLUDED からの復帰は CA のみ（箱B restore=CA専用のパリティ）
  if (current === "EXCLUDED" && actor === "user") {
    return NextResponse.json(
      { error: "actor=user cannot change status of an EXCLUDED job" },
      { status: 403 },
    );
  }

  // 同値変更は no-op（updatedAt を進めない）。EXCLUDED→EXCLUDED で理由だけ来たら理由のみ更新。
  if (current === status) {
    if (candidateExcludeReason !== null) {
      await prisma.candidateFile.update({ where: { id: row.id }, data: { candidateExcludeReason } });
      return NextResponse.json({ ok: true, changed: false, status, candidateExcludeReason });
    }
    return NextResponse.json({ ok: true, changed: false, status });
  }

  const now = new Date();
  await prisma.candidateFile.update({
    where: { id: row.id },
    data: {
      responseStatus: status,
      responseStatusUpdatedAt: now,
      // 箱Bパリティ: EXCLUDED はactor/日時を記録、それ以外への変更は無条件クリア
      ...(status === "EXCLUDED"
        ? {
            excludedBy: actor as ExcludedActor,
            excludedAt: now,
            // T-189 Phase3-2a: 理由が来たときだけ保存（未指定は列に触らない＝後方互換）
            ...(candidateExcludeReason !== null ? { candidateExcludeReason } : {}),
          }
        : { excludedBy: null, excludedAt: null, candidateExcludeReason: null }),
    },
  });

  // portal応募意向の即時同期（箱B feedback-status と同一の対象範囲・kyuujinJobId がある行のみ）
  let synced: string | null = null;
  const intent = PORTAL_INTENT_MAP[status]; // undefined = 同期対象外
  if (intent !== undefined && row.kyuujinJobId != null) {
    try {
      const result = await applyJobResponseIntent(candidate.id, row.kyuujinJobId, intent, now);
      synced = result;
      // 回答（気になる/応募したい）→ タスク生成/集約。
      // 取り消し（UNANSWERED/PENDING/EXCLUDED → intent=null）→ 既存の未着手タスクがある場合のみ
      //   本文を全量で追従させる（取り消しを契機に新しいタスクは作らない＝refreshOnly）。
      const candWithCa = await prisma.candidate.findUnique({
        where: { id: candidate.id },
        select: CANDIDATE_CA_SELECT,
      });
      if (candWithCa) {
        try {
          await createOrUpdateResponseTask(
            candWithCa,
            intent === null ? { refreshOnly: true } : undefined
          );
        } catch (e) {
          console.error("[response-status] タスク自動生成に失敗:", e);
        }
      }
    } catch (e) {
      console.error("[response-status] CandidateJobResponse 同期に失敗:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    fileId: row.id,
    status,
    previousStatus: current,
    synced, // "upserted" | "cleared" | null（同期対象外 or kyuujinJobId なし）
    candidateExcludeReason: status === "EXCLUDED" ? candidateExcludeReason : null,
  });
}
