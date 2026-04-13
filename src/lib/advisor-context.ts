import { prisma } from "@/lib/prisma";
import { getCategoryLabel } from "@/lib/constants/candidate-file-categories";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { parsePdfWithAI, parseTextFile } from "@/lib/file-parser";

const MEETING_TEXT_MAX_CHARS = 8000;

/**
 * Build candidate context string for AI advisor.
 * Includes: basic info, worksheet, PREP, AI report, resume, notes, file list,
 * key document contents (PDF parsed), and latest 5 bookmark texts.
 */
export async function getCandidateContext(candidateId: string): Promise<string> {
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
    throw new Error("Candidate not found");
  }

  const guideData = (guideEntry?.data ?? {}) as Record<string, unknown>;

  let context = "";

  // 基本情報
  context += `## 求職者の基本情報\n`;
  context += `- 氏名: ${candidate.name}\n`;
  context += `- ID: ${candidate.candidateNumber}\n`;
  if (candidate.email) context += `- メール: ${candidate.email}\n`;
  if (candidate.birthday) {
    const age = Math.floor(
      (Date.now() - new Date(candidate.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );
    context += `- 生年月日: ${new Date(candidate.birthday).toISOString().slice(0, 10)}\n`;
    context += `- 年齢: ${age}歳\n`;
  }
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

  // 主要書類の内容を読み込み（ORIGINAL, BS_DOCUMENT, MEETING のPDF/テキストのみ、最大4件）
  const keyFiles = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
      mimeType: { in: ["application/pdf", "text/plain"] },
    },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { driveFileId: true, fileName: true, category: true, mimeType: true },
  });

  if (keyFiles.length > 0) {
    context += `## 主要書類の内容\n\n`;
    for (const file of keyFiles) {
      try {
        const { base64 } = await downloadFileFromDrive(file.driveFileId);
        let parsedText: string;
        if (file.mimeType === "text/plain") {
          const raw = parseTextFile(base64);
          parsedText = raw.length > MEETING_TEXT_MAX_CHARS
            ? raw.substring(0, MEETING_TEXT_MAX_CHARS) + "\n...(以下省略)"
            : raw;
        } else {
          parsedText = await parsePdfWithAI(base64);
        }
        context += `### ${file.fileName}（${getCategoryLabel(file.category)}）\n`;
        context += `${parsedText}\n\n`;
      } catch (error) {
        console.error(`File parse error: ${file.fileName}`, error);
        context += `### ${file.fileName}（${getCategoryLabel(file.category)}）\n`;
        context += `（読み取りに失敗しました）\n\n`;
      }
    }
  }

  // 応募履歴
  const jobEntries = await prisma.jobEntry.findMany({
    where: { candidateId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      companyName: true,
      jobTitle: true,
      status: true,
      entryFlag: true,
      entryFlagDetail: true,
      documentSubmitDate: true,
      documentPassDate: true,
      firstInterviewDate: true,
      finalInterviewDate: true,
      offerDate: true,
      acceptanceDate: true,
      joinDate: true,
      createdAt: true,
    },
  });

  if (jobEntries.length > 0) {
    context += `## 応募履歴（直近${jobEntries.length}件）\n`;
    for (const entry of jobEntries) {
      const flag = entry.entryFlag || "不明";
      const detail = entry.entryFlagDetail || "";
      context += `- ${entry.companyName || "不明"} / ${entry.jobTitle || "不明"} — ${flag}${detail ? `（${detail}）` : ""}`;
      if (entry.documentSubmitDate) context += ` / 書類提出: ${entry.documentSubmitDate.toISOString().slice(0, 10)}`;
      if (entry.documentPassDate) context += ` / 書類通過: ${entry.documentPassDate.toISOString().slice(0, 10)}`;
      if (entry.firstInterviewDate) context += ` / 一次面接: ${entry.firstInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.finalInterviewDate) context += ` / 最終面接: ${entry.finalInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.offerDate) context += ` / 内定: ${entry.offerDate.toISOString().slice(0, 10)}`;
      if (entry.acceptanceDate) context += ` / 承諾: ${entry.acceptanceDate.toISOString().slice(0, 10)}`;
      if (entry.joinDate) context += ` / 入社: ${entry.joinDate.toISOString().slice(0, 10)}`;
      context += "\n";
    }
    context += "\n";
  }

  // ブックマーク求人票テキスト（最新5件のみ、コンテキスト肥大化防止）
  const bookmarkFiles = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: "BOOKMARK",
      extractedText: { not: null },
    },
    select: {
      fileName: true,
      extractedText: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (bookmarkFiles.length > 0) {
    const bookmarkTexts = bookmarkFiles
      .map((f, i) => {
        const truncatedText = f.extractedText!.substring(0, 1500);
        return `### 求人票${i + 1}: ${f.fileName}\n${truncatedText}`;
      })
      .join("\n\n---\n\n");

    context += `\n\n## ブックマーク求人票（最新${bookmarkFiles.length}件）\n${bookmarkTexts}`;
  }

  return context;
}
