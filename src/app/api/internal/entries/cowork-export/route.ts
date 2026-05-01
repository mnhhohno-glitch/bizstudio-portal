import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";

type Target = {
  entryId: string;
  candidateName: string;
  companyName: string;
  jobTitle: string;
  entryFlag: string;
  flagDetail: string;
};

function detectPlatform(jobDb: string): "hito-link" | "circus" | "mynavi-job" | "bee" | null {
  if (/hito/i.test(jobDb)) return "hito-link";
  if (/circus/i.test(jobDb)) return "circus";
  if (/マイナビ/.test(jobDb)) return "mynavi-job";
  if (/bee/i.test(jobDb)) return "bee";
  return null;
}

export async function GET(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await prisma.jobEntry.findMany({
    where: {
      AND: [
        {
          OR: [
            { jobDb: { contains: "HITO", mode: "insensitive" } },
            { jobDb: { contains: "Circus", mode: "insensitive" } },
            { jobDb: { contains: "マイナビ" } },
            { jobDb: { contains: "Bee", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { jobDbUrl: null },
            { jobDbUrl: "" },
          ],
        },
      ],
    },
    include: {
      candidate: {
        select: { name: true },
      },
    },
  });

  const batches: Record<"hito-link" | "circus" | "mynavi-job" | "bee", Target[]> = {
    "hito-link": [],
    "circus": [],
    "mynavi-job": [],
    "bee": [],
  };

  for (const entry of entries) {
    const platform = detectPlatform(entry.jobDb || "");
    if (!platform) continue;
    batches[platform].push({
      entryId: entry.id,
      candidateName: entry.candidate?.name || "",
      companyName: entry.companyName || "",
      jobTitle: entry.jobTitle || "",
      entryFlag: entry.entryFlag || "",
      flagDetail: entry.entryFlagDetail || "",
    });
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    batches: (Object.keys(batches) as Array<keyof typeof batches>).map((platform) => ({
      platform,
      targets: batches[platform],
    })),
    summary: {
      "hito-link": batches["hito-link"].length,
      "circus": batches["circus"].length,
      "mynavi-job": batches["mynavi-job"].length,
      "bee": batches["bee"].length,
      total: batches["hito-link"].length + batches["circus"].length + batches["mynavi-job"].length + batches["bee"].length,
    },
  });
}
