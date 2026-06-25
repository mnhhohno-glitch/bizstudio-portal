import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resetSubStatusForStatus } from "@/lib/support-sub-status";

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
  if (body.recruiterName !== undefined) {
    updateData.recruiterName = body.recruiterName?.trim() || null;
  }
  if (body.applicationRoute !== undefined) {
    updateData.applicationRoute = body.applicationRoute?.trim() || null;
  }
  if (body.mediaSource !== undefined) {
    updateData.mediaSource = body.mediaSource?.trim() || null;
  }
  if (body.scoutNumber !== undefined) {
    updateData.scoutNumber = body.scoutNumber?.trim() || null;
  }
  if (body.scoutDeliveryDate !== undefined) {
    updateData.scoutDeliveryDate = body.scoutDeliveryDate ? new Date(body.scoutDeliveryDate) : null;
  }
  if (body.applicationDate !== undefined) {
    updateData.applicationDate = body.applicationDate ? new Date(body.applicationDate) : null;
  }
  if (body.masType !== undefined) {
    updateData.masType = body.masType?.trim() || null;
  }
  // T-111: 次回連絡予定（面談非依存・直接設定/修正/クリア）。日時はクライアントが JST→ISO 化して送る前提。
  if (body.nextContactAt !== undefined) {
    updateData.nextContactAt = body.nextContactAt ? new Date(body.nextContactAt) : null;
  }
  if (body.nextContactPurpose !== undefined) {
    updateData.nextContactPurpose = body.nextContactPurpose?.trim() || null;
  }
  if (body.nextContactNote !== undefined) {
    updateData.nextContactNote = body.nextContactNote?.trim() || null;
  }
  if (body.desiredJobType1 !== undefined) {
    updateData.desiredJobType1 = body.desiredJobType1?.trim() || null;
  }
  if (body.desiredJobType2 !== undefined) {
    updateData.desiredJobType2 = body.desiredJobType2?.trim() || null;
  }
  if (body.desiredIndustry1 !== undefined) {
    updateData.desiredIndustry1 = body.desiredIndustry1?.trim() || null;
  }
  if (body.desiredIndustry2 !== undefined) {
    updateData.desiredIndustry2 = body.desiredIndustry2?.trim() || null;
  }
  if (body.desiredPrefecture1 !== undefined) {
    updateData.desiredPrefecture1 = body.desiredPrefecture1?.trim() || null;
  }
  if (body.desiredPrefecture2 !== undefined) {
    updateData.desiredPrefecture2 = body.desiredPrefecture2?.trim() || null;
  }
  if (body.desiredEmploymentType !== undefined) {
    updateData.desiredEmploymentType = body.desiredEmploymentType?.trim() || null;
  }
  if (body.desiredSalaryMin !== undefined) {
    updateData.desiredSalaryMin = typeof body.desiredSalaryMin === "number" ? body.desiredSalaryMin : null;
  }
  if (body.birthday !== undefined) {
    updateData.birthday = body.birthday ? new Date(body.birthday) : null;
  }
  if (body.supportStatus !== undefined) {
    updateData.supportStatus = body.supportStatus;
    const statusChanged = body.supportStatus !== existing.supportStatus;
    if (body.supportStatus !== "ENDED") {
      updateData.supportEndReason = null;
      updateData.supportEndNote = null;
      updateData.supportEndDate = null;
    }
    if (statusChanged) {
      const nextSub = await resetSubStatusForStatus(candidateId, body.supportStatus);
      updateData.supportSubStatus = nextSub || null;
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
