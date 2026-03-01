import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";

export async function GET() {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      manusApiKeyEncrypted: true,
      manusApiKeySetAt: true,
    },
  });

  const usersWithManusStatus = users.map((u) => {
    let manus_key_last4: string | null = null;
    if (u.manusApiKeyEncrypted) {
      try {
        const decrypted = decrypt(u.manusApiKeyEncrypted);
        manus_key_last4 = decrypted.slice(-4);
      } catch {
        manus_key_last4 = "****";
      }
    }

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      has_manus_key: !!u.manusApiKeyEncrypted,
      manus_key_last4,
      manus_key_set_at: u.manusApiKeySetAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ users: usersWithManusStatus });
}
