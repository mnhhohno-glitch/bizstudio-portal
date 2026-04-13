import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  resetSubStatusForStatus,
  SUPPORT_SUB_STATUS_MAP,
} from "@/lib/support-sub-status";

type RouteContext = { params: Promise<{ candidateId: string }> };

function normalizeSpaces(str: string): string {
  return str.replace(/\u3000/g, " ");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { candidateId } = await context.params;

  const existing = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "求職者が見つかりません" },
      { status: 404 }
    );
  }

  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updateData.name = normalizeSpaces(body.name.trim());
  }
  if (body.furigana !== undefined) {
    updateData.nameKana = normalizeSpaces(body.furigana.trim());
  }
  if (body.email !== undefined) {
    updateData.email = body.email.trim() || null;
  }
  if (body.phone !== undefined) {
    updateData.phone = body.phone.trim() || null;
  }
  if (body.address !== undefined) {
    updateData.address = body.address.trim() || null;
  }
  if (body.candidateNumber !== undefined) {
    updateData.candidateNumber = body.candidateNumber.trim();
  }
  if (body.gender !== undefined) {
    updateData.gender = body.gender || null;
  }
  if (body.assignedEmployeeId !== undefined) {
    updateData.employeeId = body.assignedEmployeeId || null;
  }
  if (body.birthday !== undefined) {
    updateData.birthday = body.birthday ? new Date(body.birthday) : null;
  }
  let statusChanged = false;
  if (body.supportStatus !== undefined) {
    updateData.supportStatus = body.supportStatus;
    statusChanged = body.supportStatus !== existing.supportStatus;
    // Clear end reason when moving away from ENDED
    if (body.supportStatus !== "ENDED") {
      updateData.supportEndReason = null;
      updateData.supportEndNote = null;
      updateData.supportEndDate = null;
    }
    if (statusChanged) {
      // 大項目変更時は中項目の手動フラグをリセットして再判定
      updateData.supportSubStatusManual = false;
      const nextSub = await resetSubStatusForStatus(candidateId, body.supportStatus);
      updateData.supportSubStatus = nextSub || null;
    }
  }
  if (body.supportSubStatus !== undefined) {
    const targetStatus =
      (updateData.supportStatus as string | undefined) ?? existing.supportStatus;
    const allowed = SUPPORT_SUB_STATUS_MAP[targetStatus] ?? [];
    if (body.supportSubStatus && !allowed.includes(body.supportSubStatus)) {
      return NextResponse.json(
        { error: "中項目の値が不正です" },
        { status: 400 }
      );
    }
    updateData.supportSubStatus = body.supportSubStatus || null;
    // 中項目を直接変更した場合は手動フラグを立てる（大項目変更と同時の場合は除く）
    if (!statusChanged) {
      updateData.supportSubStatusManual = true;
    }
  }
  if (body.supportEndReason !== undefined) {
    updateData.supportEndReason = body.supportEndReason || null;
  }
  if (body.supportEndNote !== undefined) {
    updateData.supportEndNote = body.supportEndNote || null;
  }
  if (body.supportEndDate !== undefined) {
    updateData.supportEndDate = body.supportEndDate ? new Date(body.supportEndDate) : null;
  }
  if (body.supportEndComment !== undefined) {
    updateData.supportEndComment = body.supportEndComment || null;
  }

  const updated = await prisma.candidate.update({
    where: { id: candidateId },
    data: updateData,
    include: {
      employee: { select: { id: true, name: true } },
    },
  });

  // Sync birthday hash to kyuujinPDF when birthday is changed
  if (body.birthday !== undefined) {
    const kyuujinApiUrl = process.env.KYUUJIN_API_URL || "https://web-production-95808.up.railway.app";
    const kyuujinApiSecret = process.env.KYUUJIN_API_SECRET;
    if (kyuujinApiSecret && existing.candidateNumber) {
      try {
        const syncRes = await fetch(`${kyuujinApiUrl}/api/external/mypage/update-birthday`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-secret": kyuujinApiSecret,
          },
          body: JSON.stringify({
            job_seeker_id: existing.candidateNumber,
            birthday: body.birthday || null,
          }),
        });
        if (!syncRes.ok) {
          console.warn(`[BIRTHDAY-SYNC] Failed to sync birthday hash: ${syncRes.status}`);
        } else {
          const result = await syncRes.json();
          console.log(`[BIRTHDAY-SYNC] Updated ${result.updated_count} share tokens for candidateNumber: ${existing.candidateNumber}`);
        }
      } catch (error) {
        console.error("[BIRTHDAY-SYNC] Error syncing birthday hash:", error);
      }
    }
  }

  return NextResponse.json({ candidate: updated });
}
