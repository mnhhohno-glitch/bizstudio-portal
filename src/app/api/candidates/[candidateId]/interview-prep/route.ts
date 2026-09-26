// T-205: 面談準備チャットの状態取得。
// 有効な部屋（archivedAt IS NULL）と、その最初の整理・会話、マイナビレジュメの有無を返す。
// レジュメの文字はここでは取り出さない（取り出しは summary の初回だけ）。
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { findLatestMynaviResume } from "@/lib/interview-prep/resume";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, name: true },
  });
  if (!candidate) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [room, resume] = await Promise.all([
    prisma.interviewPrepRoom.findFirst({
      where: { candidateId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            kind: true,
            createdAt: true,
            user: { select: { name: true } },
          },
        },
      },
    }),
    findLatestMynaviResume(candidateId),
  ]);

  const summary = room?.messages.find((m) => m.kind === "SUMMARY") ?? null;
  const messages = (room?.messages ?? [])
    .filter((m) => m.kind !== "SUMMARY")
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      userName: m.user?.name ?? null,
    }));

  return NextResponse.json({
    candidate,
    room: room
      ? {
          id: room.id,
          createdAt: room.createdAt,
          careerType: room.careerType,
          resumeImportedAt: room.resumeImportedAt,
          resumeChars: room.resumeText?.length ?? 0,
          summary: summary ? { id: summary.id, content: summary.content, createdAt: summary.createdAt } : null,
          messages,
        }
      : null,
    resume: resume ? { fileId: resume.id, importedAt: resume.createdAt } : null,
  });
}
