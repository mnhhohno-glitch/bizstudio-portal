import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const majors = await prisma.jobCategoryMajor.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      middles: {
        orderBy: { sortOrder: "asc" },
        include: {
          minors: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  const items = majors.flatMap((major) =>
    major.middles.flatMap((middle) =>
      middle.minors.map((minor) => ({
        large: major.name,
        medium: middle.name,
        small: minor.name,
      }))
    )
  );

  return NextResponse.json(items);
}
