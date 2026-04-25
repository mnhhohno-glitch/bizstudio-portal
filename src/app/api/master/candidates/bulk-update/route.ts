import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resetSubStatusForStatus } from "@/lib/support-sub-status";

const VALID_STATUSES = ["BEFORE", "ACTIVE", "WAITING", "ENDED", "ARCHIVED"];

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { action, candidateIds, payload } = body;

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return NextResponse.json(
      { error: "対象の求職者を選択してください" },
      { status: 400 }
    );
  }
  if (candidateIds.length > 20) {
    return NextResponse.json(
      { error: "一括操作は最大20件までです" },
      { status: 400 }
    );
  }

  try {
    let updatedCount = 0;
    let message = "";

    if (action === "archive") {
      const result = await prisma.candidate.updateMany({
        where: { id: { in: candidateIds } },
        data: {
          supportStatus: "ARCHIVED",
          supportSubStatus: null,
          supportSubStatusManual: false,
          supportEndReason: null,
          supportEndNote: null,
          supportEndDate: null,
        },
      });
      updatedCount = result.count;
      message = `${updatedCount}件の求職者をアーカイブしました`;
    } else if (action === "change_assignee") {
      const newAssigneeUserId = payload?.newAssigneeUserId;
      if (!newAssigneeUserId) {
        return NextResponse.json(
          { error: "担当CAを選択してください" },
          { status: 400 }
        );
      }
      const employee = await prisma.employee.findUnique({
        where: { id: newAssigneeUserId },
      });
      if (!employee) {
        return NextResponse.json(
          { error: "指定された担当CAが見つかりません" },
          { status: 400 }
        );
      }
      const result = await prisma.candidate.updateMany({
        where: { id: { in: candidateIds } },
        data: { employeeId: newAssigneeUserId },
      });
      updatedCount = result.count;
      message = `${updatedCount}件の担当CAを${employee.name}に変更しました`;
    } else if (action === "change_status") {
      const newStatus = payload?.newStatus;
      if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
        return NextResponse.json(
          { error: "無効な支援状況です" },
          { status: 400 }
        );
      }

      await prisma.$transaction(async (tx) => {
        for (const candidateId of candidateIds) {
          const updateData: Record<string, unknown> = {
            supportStatus: newStatus,
            supportSubStatusManual: false,
          };

          if (newStatus !== "ENDED") {
            updateData.supportEndReason = null;
            updateData.supportEndNote = null;
            updateData.supportEndDate = null;
          }

          const nextSub = await resetSubStatusForStatus(
            candidateId,
            newStatus
          );
          updateData.supportSubStatus = nextSub || null;

          await tx.candidate.update({
            where: { id: candidateId },
            data: updateData,
          });
        }
      });
      updatedCount = candidateIds.length;

      const statusLabels: Record<string, string> = {
        BEFORE: "支援前",
        ACTIVE: "支援中",
        WAITING: "待機",
        ENDED: "支援終了",
        ARCHIVED: "アーカイブ",
      };
      message = `${updatedCount}件の支援状況を「${statusLabels[newStatus]}」に変更しました`;
    } else {
      return NextResponse.json(
        { error: "無効な操作です" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, updatedCount, message });
  } catch (error) {
    console.error("Bulk update failed:", error);
    return NextResponse.json(
      { error: "一括操作に失敗しました" },
      { status: 500 }
    );
  }
}
