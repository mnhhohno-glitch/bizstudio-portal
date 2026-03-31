import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { uploadFileToDrive, getOrCreateFolder } from "@/lib/google-drive";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { taskId } = await params;
  const { attachmentIds, candidateId, category } = (await req.json()) as {
    attachmentIds: string[];
    candidateId: string;
    category: string;
  };

  if (!attachmentIds?.length || !candidateId || !category) {
    return NextResponse.json({ error: "attachmentIds, candidateId, category are required" }, { status: 400 });
  }

  const attachments = await prisma.taskAttachment.findMany({
    where: { id: { in: attachmentIds }, taskId },
  });

  if (attachments.length === 0) {
    return NextResponse.json({ error: "No attachments found" }, { status: 404 });
  }

  const parentFolderId = process.env.GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID;
  if (!parentFolderId) {
    return NextResponse.json({ error: "Google Drive folder not configured" }, { status: 500 });
  }

  const candidateFolderId = await getOrCreateFolder(candidateId, parentFolderId);

  let saved = 0;
  let failed = 0;

  for (const att of attachments) {
    try {
      // Download from Supabase public URL
      const res = await fetch(att.publicUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // Upload to Google Drive
      const { fileId, webViewLink } = await uploadFileToDrive(
        att.fileName,
        buffer,
        candidateFolderId,
        att.mimeType
      );

      // Create CandidateFile record
      await prisma.candidateFile.create({
        data: {
          candidateId,
          category: category as "ORIGINAL" | "BS_DOCUMENT" | "APPLICATION" | "INTERVIEW_PREP" | "MEETING",
          fileName: att.fileName,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          driveFileId: fileId,
          driveViewUrl: webViewLink,
          driveFolderId: candidateFolderId,
          uploadedByUserId: user.id,
        },
      });

      saved++;
    } catch (e) {
      console.error(`[SaveToCandidate] Failed for ${att.fileName}:`, e);
      failed++;
    }
  }

  return NextResponse.json({
    saved,
    failed,
    message: `${saved}件のファイルを保存しました`,
  });
}
