import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json();

    const existing = await prisma.interviewRecord.findUnique({
      where: { id },
      select: { id: true, autosaveToken: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Interview record not found" },
        { status: 404 }
      );
    }

    if (
      body.autosaveToken &&
      existing.autosaveToken &&
      body.autosaveToken !== existing.autosaveToken
    ) {
      return NextResponse.json(
        {
          error: "Conflict: record was modified by another session",
          currentToken: existing.autosaveToken,
        },
        { status: 409 }
      );
    }

    const newToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const recordUpdate: Record<string, unknown> = {
      lastSavedAt: new Date(),
      autosaveToken: newToken,
    };

    const allowedRecordFields = [
      "interviewDate",
      "startTime",
      "endTime",
      "duration",
      "interviewTool",
      "interviewType",
      "interviewCount",
      "resultFlag",
      "interviewMemo",
      "previousMemo",
      "summaryText",
      "rawTranscript",
      "resumePdfFileId",
      "status",
    ];
    for (const field of allowedRecordFields) {
      if (body[field] !== undefined) {
        recordUpdate[field] = body[field];
      }
    }
    if (body.lastEditedBy) {
      recordUpdate.lastEditedBy = body.lastEditedBy;
    }
    if (recordUpdate.interviewDate) {
      recordUpdate.interviewDate = new Date(
        recordUpdate.interviewDate as string
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.interviewRecord.update({
        where: { id },
        data: recordUpdate,
      });

      if (body.detail && typeof body.detail === "object") {
        await tx.interviewDetail.upsert({
          where: { interviewRecordId: id },
          create: { interviewRecordId: id, ...body.detail },
          update: body.detail,
        });
      }

      if (body.rating && typeof body.rating === "object") {
        await tx.interviewRating.upsert({
          where: { interviewRecordId: id },
          create: { interviewRecordId: id, ...body.rating },
          update: body.rating,
        });
      }

      return updated;
    });

    return NextResponse.json({
      ok: true,
      lastSavedAt: result.lastSavedAt,
      autosaveToken: newToken,
    });
  } catch (error) {
    console.error("Autosave error:", error);
    return NextResponse.json(
      { error: "Autosave failed", message: (error as Error).message },
      { status: 500 }
    );
  }
}
