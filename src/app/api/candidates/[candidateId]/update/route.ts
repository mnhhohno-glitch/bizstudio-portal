import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { resetSubStatusForStatus } from "@/lib/support-sub-status";
import { isAutoRecommendAdmin } from "@/lib/auto-recommend-admin";
import { fetchCandidateConditions } from "@/lib/recommend/job-platform-conditions";
import { autoLinkCandidateToSlot } from "@/lib/scout/auto-link";

type RouteContext = { params: Promise<{ candidateId: string }> };

function normalizeSpaces(str: string): string {
  return str.replace(/\u3000/g, " ");
}

/** JST \u66a6\u65e5 YYYY-MM-DD\uff08\u7f60#17: toISOString \u306f\u4f7f\u308f\u306a\u3044\uff09 */
function jstYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
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
  // T-189 Phase2a: autoRecommendEnabled の更新は AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ。
  //   非admin は他フィールドが正当でも 403（部分適用しない）。他フィールドのみの更新は従来どおり。
  if (body.autoRecommendEnabled !== undefined && !isAutoRecommendAdmin(user)) {
    return NextResponse.json(
      { error: "自動配信の変更権限がありません" },
      { status: 403 }
    );
  }
  // T-189 Phase1: 自動配信 ON/OFF（true 以外は全て false に落とす）
  if (body.autoRecommendEnabled !== undefined) {
    updateData.autoRecommendEnabled = body.autoRecommendEnabled === true;
  }
  // T-189 追加: OFF→ON は「求人サイトに配信条件（パターン）が1件以上ある」ことを条件にする。
  //   ON なのに何も届かない状態を作らせないためのサーバー側ガード（画面側にも同じ判定があるが、
  //   画面の情報が古い場合・API直叩きの場合はここで止まる）。
  //   - 0件（404含む）→ 400 condition_not_found（フラグは変えない＝この時点で return）
  //   - 求人サイトに聞けなかった → 502 job_platform_unreachable（**「条件あり」とみなさない**＝fail-closed）
  //   - true→false（OFF）と、既に true の求職者への true 再送はチェックしない。
  if (updateData.autoRecommendEnabled === true && existing.autoRecommendEnabled !== true) {
    const conditions = await fetchCandidateConditions({
      candidateNumber: existing.candidateNumber,
    });
    if (!conditions.ok) {
      console.error(
        `[candidate-update] 配信条件の確認に失敗 candidate=${existing.candidateNumber} status=${conditions.status}: ${conditions.error}`,
      );
      return NextResponse.json(
        { error: "job_platform_unreachable", detail: conditions.error },
        { status: 502 }
      );
    }
    if (conditions.enabledCount < 1) {
      return NextResponse.json({ error: "condition_not_found" }, { status: 400 });
    }
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
  // T-158: OneDrive フォルダURL。javascript: 等のスキームを保存させないため https:// 始まりのみ許可。
  if (body.oneDriveFolderUrl !== undefined) {
    const raw = typeof body.oneDriveFolderUrl === "string" ? body.oneDriveFolderUrl.trim() : "";
    if (!raw) {
      updateData.oneDriveFolderUrl = null;
    } else if (!raw.startsWith("https://")) {
      return NextResponse.json(
        { error: "OneDriveのURLは https:// から始まる必要があります" },
        { status: 400 }
      );
    } else if (raw.length > 2000) {
      return NextResponse.json(
        { error: "OneDriveのURLが長すぎます（2000文字以内）" },
        { status: 400 }
      );
    } else {
      updateData.oneDriveFolderUrl = raw;
    }
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

  // T-190: 配信日（scoutDeliveryDate）の JST 暦日が変わったら、紐づく配信枠も張り替える。
  //   集計 API は ScoutDeliverySlot.deliveryDate しか見ないため、配信日だけ直しても数字が動かない。
  //   - 対象は applicationRoute="スカウト" かつ recruiterName 非空
  //   - scoutLinkedById 非 NULL（人が手で紐づけた行）は張り替えない
  //   - 指定日の枠が無ければ前日に飛ばさず現状維持（disablePreviousDayFallback）
  //   - 失敗しても求職者の更新自体は成功させる（ログのみ）
  if (body.scoutDeliveryDate !== undefined) {
    const beforeYmd = jstYmd(existing.scoutDeliveryDate);
    const afterYmd = jstYmd(updated.scoutDeliveryDate);
    if (beforeYmd !== afterYmd) {
      try {
        if (updated.scoutLinkedById) {
          console.log(
            `[candidate-update] T-190 relink skipped (manual link) candidate=${updated.candidateNumber}`,
          );
        } else if (updated.applicationRoute !== "スカウト" || !updated.recruiterName?.trim()) {
          console.log(
            `[candidate-update] T-190 relink skipped (route=${updated.applicationRoute ?? "null"} recruiter=${updated.recruiterName ?? "null"}) candidate=${updated.candidateNumber}`,
          );
        } else if (!updated.scoutDeliveryDate && !updated.applicationDate) {
          console.log(
            `[candidate-update] T-190 relink skipped (no anchor date) candidate=${updated.candidateNumber}`,
          );
        } else {
          const res = await autoLinkCandidateToSlot({
            candidateId: updated.id,
            recruiterName: updated.recruiterName,
            applicationDate: updated.applicationDate ?? updated.scoutDeliveryDate!,
            scoutDeliveryDate: updated.scoutDeliveryDate,
            disablePreviousDayFallback: true,
          });
          console.log(
            `[candidate-update] T-190 relink candidate=${updated.candidateNumber} ${beforeYmd ?? "null"}->${afterYmd ?? "null"} linked=${res.linked} reason=${res.reason}`,
          );
          // レスポンスの求職者は張り替え前の値を持っているので、成功時だけ整合させる
          if (res.linked && res.slotId && res.scoutNumber) {
            updated.scoutDeliverySlotId = res.slotId;
            updated.scoutNumber = res.scoutNumber;
            updated.scoutLinkedById = null;
          }
        }
      } catch (e) {
        console.error("[candidate-update] T-190 relink failed:", e);
      }
    }
  }

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
