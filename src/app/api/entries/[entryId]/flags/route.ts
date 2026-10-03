import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { PERSON_FLAG_RULES, COMPANY_FLAG_RULES, applyEntryFlagAutoTransitions } from "@/lib/constants/entry-flag-rules";
import { resolveEntryIsActive } from "@/lib/entries/resolveEntryIsActive";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import { todayJstDateString } from "@/lib/dailyReport/jstDate";
import { needsStageAutoDates, stageAutoDates } from "@/lib/entries/documentPassDate";
// T-XXX step5B: 選考ステータスが変わる保存を同じトランザクションで記録する
import { ENTRY_STATUS_SELECT, ENTRY_STATUS_ROUTES, recordJobEntryStatusChange } from "@/lib/entry-status-history";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const body = await req.json();
  const { entryFlag, entryFlagDetail, companyFlag, personFlag } = body as {
    entryFlag?: string;
    entryFlagDetail?: string;
    companyFlag?: string | null;
    personFlag?: string | null;
  };

  // Validate person/company flags against rules
  const effectiveEntryFlag = entryFlag || (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { entryFlag: true } }))?.entryFlag || "";

  if (personFlag && effectiveEntryFlag) {
    const allowed = PERSON_FLAG_RULES[effectiveEntryFlag] || [];
    if (!allowed.includes(personFlag)) {
      return NextResponse.json({ error: `「${personFlag}」は「${effectiveEntryFlag}」では使用できません` }, { status: 400 });
    }
  }

  if (companyFlag && effectiveEntryFlag) {
    const allowed = COMPANY_FLAG_RULES[effectiveEntryFlag] || [];
    if (!allowed.includes(companyFlag)) {
      return NextResponse.json({ error: `「${companyFlag}」は「${effectiveEntryFlag}」では使用できません` }, { status: 400 });
    }
  }

  // Determine isActive based on flags
  const effectivePersonFlag = personFlag !== undefined ? personFlag : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { personFlag: true } }))?.personFlag;
  const effectiveCompanyFlag = companyFlag !== undefined ? companyFlag : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { companyFlag: true } }))?.companyFlag;
  const effectiveEntryFlagDetail = entryFlagDetail !== undefined ? entryFlagDetail : (await prisma.jobEntry.findUnique({ where: { id: entryId }, select: { entryFlagDetail: true } }))?.entryFlagDetail;

  // T-140: is_active を resolveEntryIsActive に統一（決着判定＋双方向再計算）。
  // 従来の一方通行判定を置き換え、「決着済みレコードのフラグを触ると有効に戻る」既存の穴も塞ぐ。
  const isActive = resolveEntryIsActive({
    entryFlag: effectiveEntryFlag || null,
    entryFlagDetail: effectiveEntryFlagDetail,
    companyFlag: effectiveCompanyFlag,
    personFlag: effectivePersonFlag,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { isActive };
  if (entryFlag !== undefined) data.entryFlag = entryFlag;
  if (entryFlagDetail !== undefined) data.entryFlagDetail = entryFlagDetail;
  if (companyFlag !== undefined) data.companyFlag = companyFlag;
  if (personFlag !== undefined) data.personFlag = personFlag;

  // 段階日付の自動入力：フラグが進んだとき、対応する日付欄が空なら JST 当日をセットする。
  // 既存値が入っているレコードは上書きしない（手入力・訂正済みの書類通過日などを保護）。
  // ルール本体は src/lib/entries/documentPassDate.ts の stageAutoDates（テスト対象）。
  const stageChange = { entryFlag, entryFlagDetail };
  if (needsStageAutoDates(stageChange)) {
    const existing = await prisma.jobEntry.findUnique({
      where: { id: entryId },
      select: { documentSubmitDate: true, documentPassDate: true, offerDate: true, acceptanceDate: true },
    });
    if (existing) Object.assign(data, stageAutoDates(stageChange, existing, todayJstDateString()));
  }

  const transformedData = applyEntryFlagAutoTransitions(data);

  // T-XXX step5B: 更新と同じトランザクションで、選考ステータスが変わったときだけ履歴を 1 行追記する。
  const entry = await prisma.$transaction(async (tx) => {
    const before = await tx.jobEntry.findUnique({ where: { id: entryId }, select: ENTRY_STATUS_SELECT });
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
    if (before) {
      await recordJobEntryStatusChange(tx, { event: "update", before, after: row, changedByUserId: user.id, route: ENTRY_STATUS_ROUTES.entryFlags });
    }
    return row;
  });

  if ("entryFlag" in transformedData || "personFlag" in transformedData) {
    try {
      await recalculateSubStatusIfAuto(entry.candidateId, user.id);
    } catch (e) {
      console.error("[flags.PATCH] recalculateSubStatusIfAuto failed:", e);
    }
  }

  return NextResponse.json({ entry });
}
