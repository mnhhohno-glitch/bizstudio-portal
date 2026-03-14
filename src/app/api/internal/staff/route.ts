import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { Prisma } from "@prisma/client";

export async function GET(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");
  const email = searchParams.get("email");

  if (!name && !email) {
    return NextResponse.json(
      { error: "name または email パラメータが必要です" },
      { status: 400 }
    );
  }

  const where: Prisma.UserWhereInput = { status: "active" };

  if (name) {
    where.name = { contains: name, mode: "insensitive" };
  }
  if (email) {
    where.email = email;
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      lineworksId: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ staff: users });
}
