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

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost || req.headers.get("host");
  const proto = forwardedProto || (host?.startsWith("localhost") ? "http" : "https");
  const location = host ? `${proto}://${host}/login` : "/login";

  return new Response(null, {
    status: 303,
    headers: { Location: location },
  });
}
