import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const entry = await prisma.jobEntry.findUnique({
    where: { id: entryId },
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true, employeeId: true } },
    },
  });

  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  const body = await req.json();

  // Allow updating any field
  const allowedFields = [
    "companyName", "jobTitle", "externalJobNo", "jobDb", "prefecture", "jobCategory",
    "status", "entryFlag", "entryFlagDetail", "companyFlag", "personFlag",
    "hasJobPosting", "hasEntry", "hasJoined",
    "firstMeetingDate", "jobMeetingDate", "jobIntroDate", "documentSubmitDate",
    "documentPassDate", "aptitudeTestExists", "aptitudeTestDeadline",
    "interviewPrepDate", "interviewPrepTime", "firstInterviewDate", "firstInterviewTime",
    "finalInterviewDate", "finalInterviewTime", "offerDate", "offerDeadline",
    "offerMeetingDate", "offerMeetingTime", "acceptanceDate", "joinDate",
    "memo", "isActive", "careerAdvisorId", "entryDate",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = {};
  for (const key of allowedFields) {
    if (key in body) {
      const val = body[key];
      // Convert date strings to Date objects
      if (key.endsWith("Date") || key.endsWith("Deadline") || key === "entryDate") {
        data[key] = val ? new Date(val) : null;
      } else {
        data[key] = val;
      }
    }
  }

  const entry = await prisma.jobEntry.update({
    where: { id: entryId },
    data,
    include: {
      candidate: { select: { id: true, name: true, candidateNumber: true } },
    },
  });

  return NextResponse.json({ entry });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { entryId } = await params;
  await prisma.jobEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ ok: true });
}
