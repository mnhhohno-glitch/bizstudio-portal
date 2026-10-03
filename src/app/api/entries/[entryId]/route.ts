import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import { applyEntryFlagAutoTransitions } from "@/lib/constants/entry-flag-rules";
import { resolveEntryIsActive } from "@/lib/entries/resolveEntryIsActive";
import { isDocumentPassDateOnlyUpdate, isValidDocumentPassDateBody } from "@/lib/entries/documentPassDate";
// T-XXX step5B: 選考ステータスが変わる保存・削除を同じトランザクションで記録する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusChange } from "@/lib/entry-status-history";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const entry = await prisma.jobEntry.findUnique({
    where: { id: entryId },
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true, employeeId: true } },
    },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const body = await req.json();

  // entryDate は NOT NULL 列。空値（null/空文字）での更新は 400 で弾き、DB は更新前の値を維持する。
  if ("entryDate" in body && !body.entryDate) {
    return NextResponse.json({ error: "エントリー日は必須です（空にできません）" }, { status: 400 });
  }
  if ("documentPassDate" in body && !isValidDocumentPassDateBody(body.documentPassDate)) {
    return NextResponse.json({ error: "書類通過日の形式が正しくありません" }, { status: 400 });
  }
  // 書類通過日だけの訂正（エントリー編集画面・書類選考タブのセル）は、選考フラグ・連絡状況・有効/無効を一切動かさない。
  const documentPassDateOnly = isDocumentPassDateOnlyUpdate(body);

  // Allow updating any field
  const allowedFields = [
    "companyName", "jobTitle", "externalJobNo", "jobDb", "jobType", "prefecture", "jobCategory",
    "entryRoute", "entryJobId",
    "status", "entryFlag", "entryFlagDetail", "companyFlag", "personFlag",
    "hasJobPosting", "hasEntry", "hasJoined",
    "firstMeetingDate", "jobMeetingDate", "jobIntroDate", "documentSubmitDate",
    "documentPassDate", "aptitudeTestExists", "aptitudeTestDeadline",
    "interviewPrepDate", "interviewPrepTime", "firstInterviewDate", "firstInterviewTime", "firstInterviewTool",
    "secondInterviewDate", "secondInterviewTime", "secondInterviewTool",
    "finalInterviewDate", "finalInterviewTime", "finalInterviewTool", "offerDate", "offerDeadline",
    "offerMeetingDate", "offerMeetingTime", "acceptanceDate", "joinDate",
    "memo", "isActive", "careerAdvisorId", "entryDate", "jobDbUrl",
    "archivedAt",
    // T-087/T-088: 粗利金額（revenue）と課金方式（年収％/固定）。revenue はサーバー側で確定計算する（後段の feeType 分岐）。
    "feeType", "theoreticalAnnualIncome", "feeRatePercent", "revenue",
    // T-099: 仕入れ費（cost・手入力・円・整数）。
    "cost",
    // T-100: 求人DB費（jobDbCost・手入力・円・整数）。粗利は保存せず revenue - (jobDbCost ?? 0) - (cost ?? 0) で表示計算。
    "jobDbCost",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  for (const key of allowedFields) {
    if (key in body) {
      const val = body[key];
      // Convert date strings to Date objects
      if (key.endsWith("Date") || key.endsWith("Deadline") || key.endsWith("At") || key === "entryDate") {
        data[key] = val ? new Date(val) : null;
      } else if (key === "revenue" || key === "cost" || key === "jobDbCost") {
        // revenue=売上, cost=仕入れ費, jobDbCost=求人DB費（円）: null=未入力 / 数値=保存。
        // 空文字列は null、0 はそのまま保存。粗利はサーバーに保存しない（read 時に revenue - (jobDbCost ?? 0) - (cost ?? 0)）。
        if (val === null || val === "" || typeof val === "undefined") {
          data[key] = null;
        } else {
          const n = typeof val === "number" ? val : Number(val);
          data[key] = Number.isFinite(n) ? Math.round(n) : null;
        }
      } else {
        data[key] = val;
      }
    }
  }

  // T-088: 課金方式に応じてサーバー側で revenue を確定計算する（SSoT保証・改ざん防止）。
  // ・feeType が body に来た場合のみ確定処理（部分更新で feeType を触らない PATCH は revenue を上書きしない）。
  // ・feeType = "ANNUAL_RATE"：revenue = round(theoreticalAnnualIncome * feeRatePercent / 100)。
  //   theoreticalAnnualIncome / feeRatePercent はそのまま保存。どちらか欠ければ revenue は null。
  // ・feeType = "FIXED"：revenue = body.revenue（数値 or null）。theoreticalAnnualIncome / feeRatePercent は null。
  // ・feeType = null：revenue は body の値をそのまま採用（後方互換：feeType 未設定でも固定金額として有効）。
  if ("feeType" in body) {
    const ft = data.feeType;
    if (ft === "ANNUAL_RATE") {
      const inc = data.theoreticalAnnualIncome;
      // feeRatePercent は Decimal を文字列で受け取る可能性があるため Number 化
      const rateRaw = data.feeRatePercent;
      const rate = rateRaw == null ? null : Number(rateRaw);
      if (typeof inc === "number" && inc > 0 && rate != null && Number.isFinite(rate) && rate > 0) {
        data.revenue = Math.round((inc * rate) / 100);
      } else {
        data.revenue = null;
      }
    } else if (ft === "FIXED") {
      // 固定方式：理論年収・%はクリア。revenue は body の値（数値 or null）。
      data.theoreticalAnnualIncome = null;
      data.feeRatePercent = null;
      const rev = "revenue" in body ? body.revenue : null;
      data.revenue = typeof rev === "number" && Number.isFinite(rev) ? Math.round(rev) : null;
    } else if (ft === null) {
      // 方式未設定にリセット：理論年収・%もクリア、revenue は body の値をそのまま（または null）。
      data.theoreticalAnnualIncome = null;
      data.feeRatePercent = null;
      data.revenue = "revenue" in body && typeof body.revenue === "number" && Number.isFinite(body.revenue) ? Math.round(body.revenue) : null;
    }
  }

  const transformedData = applyEntryFlagAutoTransitions(data);

  // T-140: is_active を双方向で再計算する（sticky false の解消）。
  // applyEntryFlagAutoTransitions は false 方向のみだったため、非トリガーな更新（面接日入力など）で
  // 一度無効になったエントリーが永久に無効のまま取り残されていた。
  // 更新後の最終フラグ = リクエスト値（transformedData に載る）?? 既存値 でマージして判定する。
  // body に isActive が明示された場合は手動編集とみなし explicitIsActive で最優先尊重する。
  const existingFlags = await prisma.jobEntry.findUnique({
    where: { id: entryId },
    select: ENTRY_STATUS_SELECT,
  });
  const mergedFlag = <K extends "entryFlag" | "entryFlagDetail" | "companyFlag" | "personFlag">(k: K) =>
    k in transformedData ? (transformedData[k] as string | null) : (existingFlags?.[k] ?? null);
  // 書類通過日だけの更新では is_active を再計算しない（既存値のまま。T-140 の双方向再計算は他の更新で従来どおり）。
  if (!documentPassDateOnly) transformedData.isActive = resolveEntryIsActive({
    entryFlag: mergedFlag("entryFlag"),
    entryFlagDetail: mergedFlag("entryFlagDetail"),
    companyFlag: mergedFlag("companyFlag"),
    personFlag: mergedFlag("personFlag"),
    explicitIsActive: "isActive" in body && typeof body.isActive === "boolean" ? body.isActive : undefined,
  });

  // T-XXX step5B: 更新と同じトランザクションで、選考ステータスが変わったときだけ履歴を 1 行追記する。
  const entry = await prisma.$transaction(async (tx) => {
    const row = await tx.jobEntry.update({
      where: { id: entryId },
      data: transformedData,
      include: {
        candidate: {
          select: {
            id: true,
            name: true,
            candidateNumber: true,
            employeeId: true,
            // T-161: 一覧(GET /api/entries)と同じく担当RCを返す。EntryBoard は本レスポンスで
            // 行を丸ごと差し替えるため、ここに無い列は更新直後の画面から消える（リロードで復活）。
            recruiterName: true,
            employee: { select: { name: true } },
          },
        },
      },
    });
    if (existingFlags) {
      await recordJobEntryStatusChange(tx, {
        event: "update",
        before: existingFlags,
        after: row,
        changedByUserId: user.id,
        route: ENTRY_STATUS_ROUTES.entryUpdate,
      });
    }
    return row;
  });

  // entryFlag / personFlag / hasJoined の変更は中項目の自動判定トリガー
  if ("entryFlag" in transformedData || "personFlag" in transformedData || "hasJoined" in transformedData) {
    try {
      await recalculateSubStatusIfAuto(entry.candidateId, user.id);
    } catch (e) {
      console.error("[entries.PATCH] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({ entry });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
  }

  const { entryId } = await params;
  // T-XXX step5B: 削除は event=delete として履歴に残す（同じトランザクション）。
  await prisma.$transaction(async (tx) => {
    const before = await tx.jobEntry.findUnique({ where: { id: entryId }, select: ENTRY_STATUS_SELECT });
    await tx.jobEntry.delete({ where: { id: entryId } });
    if (before) {
      await recordJobEntryStatusChange(tx, { event: "delete", before, after: null, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.entryDelete });
    }
  });
  return NextResponse.json({ ok: true });
}
