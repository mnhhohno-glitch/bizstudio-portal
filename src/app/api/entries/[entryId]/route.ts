import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import { applyEntryFlagAutoTransitions } from "@/lib/constants/entry-flag-rules";

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

  // Allow updating any field
  const allowedFields = [
    "companyName", "jobTitle", "externalJobNo", "jobDb", "jobType", "prefecture", "jobCategory",
    "entryRoute", "entryJobId",
    "status", "entryFlag", "entryFlagDetail", "companyFlag", "personFlag",
    "hasJobPosting", "hasEntry", "hasJoined",
    "firstMeetingDate", "jobMeetingDate", "jobIntroDate", "documentSubmitDate",
    "documentPassDate", "aptitudeTestExists", "aptitudeTestDeadline",
    "interviewPrepDate", "interviewPrepTime", "firstInterviewDate", "firstInterviewTime",
    "secondInterviewDate", "secondInterviewTime",
    "finalInterviewDate", "finalInterviewTime", "offerDate", "offerDeadline",
    "offerMeetingDate", "offerMeetingTime", "acceptanceDate", "joinDate",
    "memo", "isActive", "careerAdvisorId", "entryDate", "jobDbUrl",
    "archivedAt",
    // T-088: 課金方式（年収％/固定）と粗利関連。revenue はサーバー側で確定計算する（後段）。
    "feeType", "theoreticalAnnualIncome", "feeRatePercent", "revenue",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  for (const key of allowedFields) {
    if (key in body) {
      const val = body[key];
      // Convert date strings to Date objects
      if (key.endsWith("Date") || key.endsWith("Deadline") || key.endsWith("At") || key === "entryDate") {
        data[key] = val ? new Date(val) : null;
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

  const entry = await prisma.jobEntry.update({
    where: { id: entryId },
    data: transformedData,
    include: {
      candidate: {
        select: {
          id: true,
          name: true,
          candidateNumber: true,
          employeeId: true,
          employee: { select: { name: true } },
        },
      },
    },
  });

  // entryFlag / personFlag / hasJoined の変更は中項目の自動判定トリガー
  if ("entryFlag" in transformedData || "personFlag" in transformedData || "hasJoined" in transformedData) {
    try {
      await recalculateSubStatusIfAuto(entry.candidateId);
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
  await prisma.jobEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ ok: true });
}
