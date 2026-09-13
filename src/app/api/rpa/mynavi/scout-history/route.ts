import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { parseRpaRequestBody } from "@/lib/mynavi-rpa/parse-request-body";
import { notifyMynaviError } from "@/lib/mynavi-rpa/notify";
import { autoLinkCandidateToSlot, findMachineByRecruiterName } from "@/lib/scout/auto-link";
import { computeMasType } from "@/lib/scout/mas-type";

export const runtime = "nodejs";

/**
 * POST /api/rpa/mynavi/scout-history
 * T-190 Step3-1: マイナビ「スカウト履歴一覧」モーダルの行を RPA(PAD) から受け取り、
 * 配信日（scoutDeliveryDate）・配信枠・開放日区分（masType）を確定させる受け口。
 *
 * これまでの配信日は「自社の送信結果Excel／送信明細との照合による推測」で、照合できなければ
 * 応募日がそのまま入っていた。マイナビ画面の履歴で状況が「応募済」の行のスカウト日だけが
 * 唯一の確定値なので、それを正として上書きする。
 *
 * 採用ルール（業務側確定）:
 *   - 応募済の行が複数あることがある（別々のスカウトから応募が来る）が、応募は1件として
 *     1つの配信にのみ紐づける
 *   - 応募日（無ければ createdAt）の JST 暦日以前にある応募済のうち、最も新しいものを採用
 *   - 応募日より後の応募済しか無い場合は最も古いものを採用（異常系だが枠から外さない）
 *   - 応募済が 0 件なら何も更新しない（今までどおり応募日ベースのまま）
 *
 * 認証: x-rpa-secret（verifyRpaSecret）
 * ボディ: parseRpaRequestBody（PAD は JSON を URL エンコードした文字列で送ってくる）
 */

/** レスポンスのキー集合は全ケースで固定。PAD がプロパティ参照で落ちるため（pdf-upload と同じ方針）。 */
type ScoutHistoryResponse = {
  status: "UPDATED" | "NO_APPLIED_ROW" | "CANDIDATE_NOT_FOUND" | "NO_CHANGE";
  candidateId: string | null;
  candidateNumber: string | null;
  received: number;
  stored: number;
  skipped: number;
  appliedRowCount: number;
  selectedScoutDate: string | null;
  previousScoutDeliveryDate: string | null;
  masType: string | null;
  recruiterMismatch: boolean;
  scoutLinkResult: string;
  scoutLinkedSlotId: string | null;
  reason: string | null;
};

function buildResponse(partial: Partial<ScoutHistoryResponse>): ScoutHistoryResponse {
  return {
    status: "NO_CHANGE",
    candidateId: null,
    candidateNumber: null,
    received: 0,
    stored: 0,
    skipped: 0,
    appliedRowCount: 0,
    selectedScoutDate: null,
    previousScoutDeliveryDate: null,
    masType: null,
    recruiterMismatch: false,
    scoutLinkResult: "not_attempted",
    scoutLinkedSlotId: null,
    reason: null,
    ...partial,
  };
}

/** Date → "YYYY-MM-DD"（JST 暦日）。罠#17: toISOString().slice(0,10) は使わない。 */
function jstYmd(d: Date | null | undefined): string | null {
  return d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null;
}

/** 空白（半角・全角）を全て除去 */
function stripSpaces(s: string): string {
  return s.replace(/[\s　]+/g, "");
}

type ParsedRow = {
  ymd: string; // "YYYY-MM-DD"（JST 暦日）
  scoutDate: Date; // JST 暦日を UTC 00:00 で表現
  scoutSentAt: Date | null; // 時刻まで取れた場合のみ
  subject: string | null;
  statusText: string;
  isApplied: boolean;
  recruiterName: string | null;
};

/**
 * "YYYY-MM-DD HH:MM" / "YYYY-MM-DD" / "YYYY/MM/DD HH:MM" 等をパースする。
 * 区切り文字は緩く受けるが、年月日が取れない行は null（＝skipped）にする。推測で埋めない。
 */
function parseScoutDate(raw: string): { ymd: string; scoutDate: Date; scoutSentAt: Date | null } | null {
  const m = raw.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})(?:\D{1,3}(\d{1,2})[:：時](\d{1,2}))?/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const scoutDate = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(scoutDate.getTime())) return null;
  // 桁溢れ（2026-02-31 等）を弾く
  if (scoutDate.getUTCMonth() !== mo - 1 || scoutDate.getUTCDate() !== d) return null;

  let scoutSentAt: Date | null = null;
  if (m[4] !== undefined && m[5] !== undefined) {
    const hh = parseInt(m[4], 10);
    const mi = parseInt(m[5], 10);
    if (hh >= 0 && hh <= 23 && mi >= 0 && mi <= 59) {
      // 画面の時刻は JST。UTC 実時刻へ直して保存する。
      scoutSentAt = new Date(Date.UTC(y, mo - 1, d, hh - 9, mi));
    }
  }
  const ymd = `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { ymd, scoutDate, scoutSentAt };
}

function parseHistoryRow(raw: unknown): ParsedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const scoutDateRaw = typeof r.scoutDate === "string" ? r.scoutDate.trim() : "";
  if (!scoutDateRaw) return null;
  const parsed = parseScoutDate(scoutDateRaw);
  if (!parsed) return null;

  const statusRaw = typeof r.status === "string" ? r.status.trim() : "";
  const subjectRaw = typeof r.subject === "string" ? r.subject.trim() : "";
  const recruiterRaw = typeof r.recruiterName === "string" ? r.recruiterName.trim() : "";

  return {
    ymd: parsed.ymd,
    scoutDate: parsed.scoutDate,
    scoutSentAt: parsed.scoutSentAt,
    subject: subjectRaw || null,
    statusText: statusRaw,
    // 前後空白・全角空白を除いてから「応募済」を含むかで判定
    isApplied: stripSpaces(statusRaw).includes("応募済"),
    recruiterName: recruiterRaw || null,
  };
}

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let candidateIdInput = "";
  let memberNoInput = "";
  try {
    const body = await parseRpaRequestBody(req);
    candidateIdInput = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
    memberNoInput = typeof body.mynaviMemberNo === "string"
      ? body.mynaviMemberNo.trim()
      : typeof body.mynaviMemberNo === "number"
        ? String(body.mynaviMemberNo)
        : "";

    const rawHistories = Array.isArray(body.histories) ? (body.histories as unknown[]) : [];
    const received = rawHistories.length;

    // ---- 1) 求職者を特定する ----
    //   見つからなくても 200 で返す（400 にすると PAD が止まる）
    const candidate = candidateIdInput
      ? await prisma.candidate.findUnique({
          where: { id: candidateIdInput },
          select: CANDIDATE_SELECT,
        })
      : memberNoInput
        ? await prisma.candidate.findFirst({
            where: { mynaviMemberNo: memberNoInput },
            orderBy: { createdAt: "desc" },
            select: CANDIDATE_SELECT,
          })
        : null;

    if (!candidate) {
      const reason = !candidateIdInput && !memberNoInput
        ? "candidateId / mynaviMemberNo のいずれも指定されていません"
        : `求職者が見つかりません (candidateId=${candidateIdInput || "-"} memberNo=${memberNoInput || "-"})`;
      console.warn(`[rpa/mynavi/scout-history] ${reason}`);
      return NextResponse.json(
        buildResponse({ status: "CANDIDATE_NOT_FOUND", received, reason }),
      );
    }

    // ---- 2) 履歴行のパース＆保存（冪等 upsert） ----
    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (const raw of rawHistories) {
      const row = parseHistoryRow(raw);
      if (!row) {
        skipped++; // 1行が不正でも全体は落とさない（send-records と同じ方針）
        continue;
      }
      rows.push(row);
    }

    const ownerKey = candidate.id;
    const memberNoForRow = candidate.mynaviMemberNo ?? (memberNoInput || null);
    const fetchedAt = new Date();
    let stored = 0;
    for (const row of rows) {
      const recruiterNormalized = row.recruiterName
        ? await resolveRecruiterNormalized(row.recruiterName)
        : null;
      const subjectKey = row.subject ? stripSpaces(row.subject) : "";
      try {
        await prisma.mynaviScoutHistory.upsert({
          where: {
            ownerKey_scoutDate_subjectKey: { ownerKey, scoutDate: row.scoutDate, subjectKey },
          },
          create: {
            candidateId: candidate.id,
            mynaviMemberNo: memberNoForRow,
            scoutDate: row.scoutDate,
            scoutSentAt: row.scoutSentAt,
            subject: row.subject,
            statusText: row.statusText,
            isApplied: row.isApplied,
            recruiterName: row.recruiterName,
            recruiterNormalized,
            ownerKey,
            subjectKey,
            fetchedAt,
          },
          update: {
            candidateId: candidate.id,
            mynaviMemberNo: memberNoForRow,
            scoutSentAt: row.scoutSentAt,
            subject: row.subject,
            statusText: row.statusText,
            isApplied: row.isApplied,
            recruiterName: row.recruiterName,
            recruiterNormalized,
            fetchedAt,
          },
        });
        stored++;
      } catch (e) {
        console.error("[rpa/mynavi/scout-history] upsert failed:", e);
        skipped++;
      }
    }

    const previousScoutDeliveryDate = jstYmd(candidate.scoutDeliveryDate);

    // ---- 3) 応募済の行を抽出 ----
    const applied = rows.filter((r) => r.isApplied);
    const appliedRowCount = applied.length;
    if (appliedRowCount === 0) {
      // 配信日も枠も触らない（今までどおり応募日ベースのまま）
      return NextResponse.json(
        buildResponse({
          status: "NO_APPLIED_ROW",
          candidateId: candidate.id,
          candidateNumber: candidate.candidateNumber,
          received,
          stored,
          skipped,
          appliedRowCount,
          previousScoutDeliveryDate,
          masType: candidate.masType,
          scoutLinkResult: "not_attempted",
          scoutLinkedSlotId: candidate.scoutDeliverySlotId,
          reason: "応募済の行が無いため配信日・配信枠は変更していません",
        }),
      );
    }

    // ---- 4) 採用する1行を決める ----
    const anchorYmd = jstYmd(candidate.applicationDate ?? candidate.createdAt)!;
    const onOrBefore = applied.filter((r) => r.ymd <= anchorYmd);
    let selected: ParsedRow;
    let reason: string | null = null;
    if (onOrBefore.length > 0) {
      // 応募日の JST 暦日の終わり以前で最も新しいもの
      selected = onOrBefore.reduce((a, b) => (b.ymd > a.ymd ? b : a));
      if (onOrBefore.length > 1) {
        reason = `応募済 ${appliedRowCount} 件のうち応募日(${anchorYmd})に最も近い ${selected.ymd} を採用`;
      }
    } else {
      // 異常系: 応募日より後の応募済しか無い。枠から外さないため最も古いものを採用する。
      selected = applied.reduce((a, b) => (b.ymd < a.ymd ? b : a));
      reason = `応募済が全て応募日(${anchorYmd})より後のため、最も古い ${selected.ymd} を採用（要確認）`;
    }

    // ---- 5) 配信日を保存（既存の書き込み経路 master/candidates と同じ JST暦日 + T12:00:00.000Z） ----
    const newScoutDeliveryDate = new Date(selected.ymd + "T12:00:00.000Z");
    const dateChanged = previousScoutDeliveryDate !== selected.ymd;

    // ---- 6) recruiterName は空のときだけ補完。既存値は上書きしない。 ----
    const existingRecruiter = candidate.recruiterName?.trim() ?? "";
    const rowRecruiter = selected.recruiterName?.trim() ?? "";
    const fillRecruiter = !existingRecruiter && !!rowRecruiter;
    const recruiterMismatch =
      !!existingRecruiter && !!rowRecruiter && stripSpaces(existingRecruiter) !== stripSpaces(rowRecruiter);
    if (recruiterMismatch) {
      console.warn(
        `[rpa/mynavi/scout-history] 担当者不一致 candidate=${candidate.candidateNumber} portal="${existingRecruiter}" history="${rowRecruiter}"`,
      );
    }
    const effectiveRecruiter = existingRecruiter || rowRecruiter;

    // ---- 7) masType を再計算（判定式は backfill-delivery-date と共通。式は不変） ----
    //   mynaviRegisteredDate が NULL の行は今までどおり触らない。
    const computedMasType = computeMasType(newScoutDeliveryDate, candidate.mynaviRegisteredDate);
    const masTypeChanged = computedMasType !== null && computedMasType !== candidate.masType;
    const resultMasType = computedMasType ?? candidate.masType;

    await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        scoutDeliveryDate: newScoutDeliveryDate,
        ...(fillRecruiter ? { recruiterName: rowRecruiter } : {}),
        ...(masTypeChanged ? { masType: computedMasType } : {}),
      },
    });

    // ---- 8) 配信枠の張り替え ----
    //   集計 API は ScoutDeliverySlot.deliveryDate しか見ないため、配信日だけ直しても数字は動かない。
    //   - scoutLinkedById 非 NULL（人が手で紐づけた行）は触らない
    //   - 履歴由来は確定値なので前日フォールバックは抑止する
    //   - 失敗しても 500 にしない
    let scoutLinkResult = "not_attempted";
    let scoutLinkedSlotId: string | null = candidate.scoutDeliverySlotId;
    let relinked = false;

    const linkedSlotYmd = candidate.scoutDeliverySlot
      ? jstYmd(candidate.scoutDeliverySlot.deliveryDate)
      : null;
    // 枠が採用日とズレている（未紐付けを含む）ときだけ張り替える
    const slotNeedsRelink = linkedSlotYmd !== selected.ymd;

    if (!slotNeedsRelink) {
      scoutLinkResult = "already_on_selected_date";
    } else if (candidate.scoutLinkedById) {
      scoutLinkResult = "skipped_manual_link";
    } else if (candidate.applicationRoute !== "スカウト") {
      scoutLinkResult = `skipped_route_${candidate.applicationRoute ?? "null"}`;
    } else if (!effectiveRecruiter) {
      scoutLinkResult = "no_recruiter_name";
    } else {
      try {
        const res = await autoLinkCandidateToSlot({
          candidateId: candidate.id,
          recruiterName: effectiveRecruiter,
          applicationDate: candidate.applicationDate ?? newScoutDeliveryDate,
          scoutDeliveryDate: newScoutDeliveryDate,
          disablePreviousDayFallback: true,
        });
        scoutLinkResult = res.reason;
        if (res.linked && res.slotId) {
          scoutLinkedSlotId = res.slotId;
          relinked = true;
        }
      } catch (e) {
        console.error("[rpa/mynavi/scout-history] autoLinkCandidateToSlot failed:", e);
        scoutLinkResult = "error";
      }
    }

    const changed = dateChanged || masTypeChanged || fillRecruiter || relinked;
    console.log(
      `[rpa/mynavi/scout-history] candidate=${candidate.candidateNumber} received=${received} stored=${stored} skipped=${skipped} applied=${appliedRowCount} selected=${selected.ymd} prev=${previousScoutDeliveryDate ?? "null"} masType=${resultMasType ?? "null"} link=${scoutLinkResult} mismatch=${recruiterMismatch}`,
    );

    return NextResponse.json(
      buildResponse({
        status: changed ? "UPDATED" : "NO_CHANGE",
        candidateId: candidate.id,
        candidateNumber: candidate.candidateNumber,
        received,
        stored,
        skipped,
        appliedRowCount,
        selectedScoutDate: selected.ymd,
        previousScoutDeliveryDate,
        masType: resultMasType,
        recruiterMismatch,
        scoutLinkResult,
        scoutLinkedSlotId,
        reason,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[rpa/mynavi/scout-history] unexpected error:", e);
    await notifyMynaviError("スカウト履歴の取り込みでエラーが発生しました", {
      candidateId: candidateIdInput || null,
      mynaviMemberNo: memberNoInput || null,
      detail: message,
    });
    // 500 でもキー集合は同じにする（PAD がプロパティ参照で落ちるため）
    return NextResponse.json(
      buildResponse({
        status: "NO_CHANGE",
        candidateId: candidateIdInput || null,
        scoutLinkResult: "error",
        reason: `予期しないエラー: ${message}`,
      }),
      { status: 500 },
    );
  }
}

const CANDIDATE_SELECT = {
  id: true,
  candidateNumber: true,
  mynaviMemberNo: true,
  scoutDeliveryDate: true,
  mynaviRegisteredDate: true,
  applicationDate: true,
  applicationRoute: true,
  recruiterName: true,
  masType: true,
  scoutLinkedById: true,
  scoutDeliverySlotId: true,
  createdAt: true,
  scoutDeliverySlot: { select: { id: true, deliveryDate: true } },
} as const;

/** ScoutMachineMaster で担当者名を正規化する。引けなければ null（推測で埋めない）。 */
async function resolveRecruiterNormalized(recruiterName: string): Promise<string | null> {
  try {
    const machine = await findMachineByRecruiterName(recruiterName);
    return machine?.recruiterName ?? null;
  } catch (e) {
    console.error("[rpa/mynavi/scout-history] recruiter 正規化に失敗:", e);
    return null;
  }
}
