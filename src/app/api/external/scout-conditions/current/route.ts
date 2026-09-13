// T-195: GET /api/external/scout-conditions/current?machineNo=2
// RPA（PAD）が配信前に、その号機で RUNNING の条件を取りに来る口。契約は docs/rpa/scout-conditions-api.md（変更禁止）。
// 認証: x-api-secret = EXTERNAL_API_SECRET（不一致は 401）。それ以外は HTTP 200 固定で ok/message に理由を入れる。
import { NextResponse } from "next/server";
import { isAuthorizedExternal } from "@/lib/schedule-tasks";
import { buildCurrentResponse, EXTERNAL_FIXED_VALUES } from "@/lib/scout-conditions/external";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedExternal(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const machineNo = new URL(request.url).searchParams.get("machineNo");
  try {
    const res = await buildCurrentResponse(machineNo);
    return NextResponse.json(res);
  } catch (e) {
    console.error("[external/scout-conditions/current] failed:", e);
    return NextResponse.json({ ok: false, machineNo: null, condition: null, fixed: EXTERNAL_FIXED_VALUES, message: "サーバー内部エラー" });
  }
}
