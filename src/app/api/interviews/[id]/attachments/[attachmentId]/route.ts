import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

const BUCKET = "interview-attachments";

export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, attachmentId } = await params;

  const attachment = await prisma.interviewAttachment.findFirst({
    where: { id: attachmentId, interviewRecordId: id },
  });

  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(attachment);
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, attachmentId } = await params;
  const body = await req.json();

  const existing = await prisma.interviewAttachment.findFirst({
    where: { id: attachmentId, interviewRecordId: id },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (body.memo !== undefined) updateData.memo = body.memo;

  const attachment = await prisma.interviewAttachment.update({
    where: { id: attachmentId },
    data: updateData,
  });

  return NextResponse.json(attachment);
}

export async function DELETE(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id, attachmentId } = await params;

  const attachment = await prisma.interviewAttachment.findFirst({
    where: { id: attachmentId, interviewRecordId: id },
  });
  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found" },
      { status: 404 }
    );
  }

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.filePath]);

  if (storageError) {
    console.error("Supabase delete error:", storageError);
  }

  await prisma.interviewAttachment.delete({ where: { id: attachmentId } });

  return NextResponse.json({ ok: true });
}
