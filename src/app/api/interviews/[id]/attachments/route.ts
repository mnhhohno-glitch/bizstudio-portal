import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];
const BUCKET = "interview-attachments";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const attachments = await prisma.interviewAttachment.findMany({
    where: { interviewRecordId: id },
    orderBy: { uploadedAt: "desc" },
  });

  return NextResponse.json(attachments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  const record = await prisma.interviewRecord.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!record) {
    return NextResponse.json(
      { error: "Interview record not found" },
      { status: 404 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const memo = (formData.get("memo") as string | null) ?? null;

  if (!file) {
    return NextResponse.json(
      { error: "ファイルが必要です" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "ファイルサイズが20MBを超えています" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "許可されていないファイル形式です" },
      { status: 400 }
    );
  }

  const fileId = randomUUID();
  const ext = (file.name.split(".").pop() || "bin").replace(
    /[^a-zA-Z0-9]/g,
    ""
  );
  const storagePath = `interviews/${id}/${fileId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("Supabase upload error:", uploadError);
    return NextResponse.json(
      { error: "ファイルのアップロードに失敗しました" },
      { status: 500 }
    );
  }

  const fileType = ext.toLowerCase();

  const attachment = await prisma.interviewAttachment.create({
    data: {
      interviewRecordId: id,
      fileName: file.name,
      fileType,
      filePath: storagePath,
      fileSize: file.size,
      mimeType: file.type,
      memo,
      uploadedBy: user.name ?? user.id,
    },
  });

  return NextResponse.json(attachment, { status: 201 });
}
