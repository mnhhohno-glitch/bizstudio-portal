import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { getCategoryLabel } from "@/lib/constants/candidate-file-categories";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  const [candidate, guideEntry, notes, files] = await Promise.all([
    prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { employee: { select: { name: true } } },
    }),
    prisma.guideEntry.findFirst({
      where: { candidateId, guideType: "INTERVIEW" },
    }),
    prisma.candidateNote.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.candidateFile.findMany({
      where: { candidateId },
      select: { category: true, fileName: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!candidate) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const guideData = (guideEntry?.data ?? {}) as Record<string, unknown>;

  let context = "";

  // 基本情報
  context += `## 求職者の基本情報\n`;
  context += `- 氏名: ${candidate.name}\n`;
  context += `- ID: ${candidate.candidateNumber}\n`;
  if (candidate.email) context += `- メール: ${candidate.email}\n`;
  if (candidate.gender) context += `- 性別: ${candidate.gender === "male" ? "男性" : candidate.gender === "female" ? "女性" : "その他"}\n`;
  context += `- 担当CA: ${candidate.employee?.name || "未設定"}\n`;
  context += `- 登録日: ${candidate.createdAt.toISOString().slice(0, 10)}\n\n`;

  // 転職軸ワークシート
  const ws1 = guideData.worksheet_q1;
  const ws2 = guideData.worksheet_q2;
  const ws3 = guideData.worksheet_q3;
  if (ws1 || ws2 || ws3) {
    context += `## 転職軸ワークシート\n`;
    if (ws1) context += `### なぜ転職するのか？\n${ws1}\n\n`;
    if (ws2) context += `### 何を大切にして働きたいか？\n${ws2}\n\n`;
    if (ws3) context += `### どんな自分になりたいか？\n${ws3}\n\n`;
  }

  // PREP法
  const pp = guideData.prep_point;
  const pr = guideData.prep_reason;
  const pe = guideData.prep_example;
  const pp2 = guideData.prep_point2;
  if (pp || pr || pe || pp2) {
    context += `## PREP法練習シート\n`;
    if (pp) context += `- Point（結論）: ${pp}\n`;
    if (pr) context += `- Reason（理由）: ${pr}\n`;
    if (pe) context += `- Example（具体例）: ${pe}\n`;
    if (pp2) context += `- Point（再結論）: ${pp2}\n`;
    context += "\n";
  }

  // AI自己分析レポート
  if (guideData.ai_generated_axis) {
    context += `## AI自己分析レポート\n${guideData.ai_generated_axis}\n\n`;
  }

  // 職務経歴書解析テキスト
  if (guideData.parsed_resume) {
    context += `## 職務経歴書（解析テキスト）\n${guideData.parsed_resume}\n\n`;
  }

  // メモ
  if (notes.length > 0) {
    context += `## CAメモ（${notes.length}件）\n`;
    for (const note of notes) {
      const date = note.createdAt.toISOString().slice(0, 10);
      context += `- ${note.author.name} (${date}): ${note.content}\n`;
    }
    context += "\n";
  }

  // ファイル一覧
  if (files.length > 0) {
    context += `## アップロード済みファイル\n`;
    for (const file of files) {
      context += `- [${getCategoryLabel(file.category)}] ${file.fileName}\n`;
    }
    context += "\n";
  }

  return NextResponse.json({ context });
}
