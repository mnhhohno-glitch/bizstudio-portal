import { NextResponse } from "next/server";
import { clearSession, getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (user) {
    await writeAudit({
      actorUserId: user.id,
      action: "LOGOUT",
      targetType: "AUTH",
      targetId: user.id,
    });
  }
  await clearSession();

  // リクエストのoriginを取得してリダイレクト
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}
