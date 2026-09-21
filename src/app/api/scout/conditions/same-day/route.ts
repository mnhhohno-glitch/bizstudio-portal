// T-214: 編集モーダルの右パネル「同日の他号機の条件」用の内部 API。
//   GET /api/scout/conditions/same-day?date=YYYY-MM-DD&machineId=<自分の号機>
//   date（配信日）が同じ、**他の稼働中号機**の有効・予約の条件を 号機順 → ▲▼順 で返す。
//   date が無効・省略なら今日（JST）。machineId が無ければ全号機を対象（新規作成で号機未選択のとき）。
//   重複の判定は返さない（画面側でフォームの入力と突き合わせて duplicate.ts で判定する）。
// 認証はログインセッション。外部 API とは無関係。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { conditionInclude, toConditionDto } from "@/lib/scout-conditions/server";
import { isValidYmd, jstTodayYmd, ymdToDbDate } from "@/lib/scout-conditions/dates";

export async function GET(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const dateParam = sp.get("date");
  const date = isValidYmd(dateParam) ? dateParam : jstTodayYmd();
  const machineId = sp.get("machineId") || null;

  const rows = await prisma.scoutCondition.findMany({
    where: {
      deliveryDate: ymdToDbDate(date),
      status: { in: ["RUNNING", "QUEUED"] },
      machine: { isActive: true, ...(machineId ? { id: { not: machineId } } : {}) },
    },
    include: conditionInclude,
    orderBy: [{ machine: { machineNo: "asc" } }, { queueOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ date, conditions: rows.map(toConditionDto) });
}
