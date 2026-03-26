import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await prisma.googleCalendarConnection.deleteMany({
    where: { userId: user.id },
  });

  return NextResponse.json({ success: true });
}
