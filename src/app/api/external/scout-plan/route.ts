// T-178: GET /api/external/scout-plan
// マイナビ転職スカウトRPA向け。指定日（JST暦日）の配信計画を返す。
// RPA はこれを読んでマイナビ上の検索条件を上書き保存し、終わったら
// PATCH /api/external/scout-plan/[id]/reflect で結果を書き戻す。
// 認証: x-api-secret = EXTERNAL_API_SECRET（schedule-tasks と同一）。
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAuthorizedExternal } from "@/lib/schedule-tasks";
import { addDaysYmd, dbDateToJstOffsetIso, jstStringToDbDate } from "@/lib/rpa-scout/jst";
import { displayPatternName } from "@/lib/rpa-scout/pattern-name";

export const dynamic = "force-dynamic";

const SLOT_ORDER: Record<string, number> = { AM: 0, PM: 1, EVENING: 2 };

export async function GET(request: Request) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;

  const date = (sp.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date は YYYY-MM-DD（JST暦日）で指定してください" },
      { status: 400 },
    );
  }

  const machineNoRaw = sp.get("machineNo");
  let machineNo: number | null = null;
  if (machineNoRaw != null && machineNoRaw.trim() !== "") {
    const n = parseInt(machineNoRaw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6) {
      return NextResponse.json({ error: "machineNo は 1〜6 で指定してください" }, { status: 400 });
    }
    machineNo = n;
  }

  const unexecutedOnly = sp.get("unexecutedOnly") === "1";

  // planDate は「JST壁時計値をそのまま保持」する列（罠#17）。
  // toISOString().slice(0,10) / getDay() は使わず、JST0時〜翌JST0時の範囲で引く。
  const where: Prisma.RpaScoutPlanWhereInput = {
    planDate: {
      gte: jstStringToDbDate(date),
      lt: jstStringToDbDate(addDaysYmd(date, 1)),
    },
    ...(machineNo != null ? { machineNo } : {}),
    // RPAの未処理分＝まだマイナビへ反映していない計画
    ...(unexecutedOnly ? { reflectedAt: null } : {}),
  };

  const plans = await prisma.rpaScoutPlan.findMany({ where });

  plans.sort(
    (a, b) =>
      a.machineNo - b.machineNo ||
      (SLOT_ORDER[a.timeSlot] ?? 99) - (SLOT_ORDER[b.timeSlot] ?? 99),
  );

  return NextResponse.json({
    date,
    plans: plans.map((p) => ({
      id: p.id,
      machineNo: p.machineNo,
      timeSlot: p.timeSlot,
      patternId: p.patternId,
      patternName: p.patternName,
      // マイナビ上の保存名称と同じ「N号機：パターン名」形式（状況ボードの表示と同じ作り）
      patternDisplayName: displayPatternName(p.machineNo, p.patternName),
      subjectName: p.subjectName,
      memo: p.memo,
      expectedCount: p.expectedCount,
      reflectedAt: p.reflectedAt ? dbDateToJstOffsetIso(p.reflectedAt) : null,
      executedAt: p.executedAt ? dbDateToJstOffsetIso(p.executedAt) : null,
    })),
  });
}
