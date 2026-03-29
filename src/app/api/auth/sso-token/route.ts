import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import jwt from "jsonwebtoken";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const secret = process.env.PORTAL_SSO_SECRET || "bizstudio-sso-shared-secret-key";

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
    },
    secret,
    { expiresIn: "5m" }
  );

  return NextResponse.json({ token });
}
