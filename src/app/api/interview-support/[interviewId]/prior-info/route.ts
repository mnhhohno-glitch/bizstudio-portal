// T-183 Phase 5: 面談サポートの事前情報（キャリアシート等）取得API。
// 面談レコード→求職者の添付ファイルから、ファイル名にキャリアシート/レジュメ/履歴書/職務経歴を含む
// PDF を自動選択し、テキストを抽出して返す。支援画面はこれを auto-scan の priorInfoText として使う。
// - 抽出は extractTextFromPdf（pdf-parse→pdfjs-dist。AI不使用＝費用ゼロ・数秒で完了）。
//   キャリアシートはテキスト入りPDF前提。抽出が MIN_PRIOR_TEXT_CHARS 未満ならスキャンPDFとみなし
//   「事前情報なし」扱い（available: false）。
// - T-164 の parsedText（AI解析の永続キャッシュ）が既にあればそれを使い、Driveダウンロードを省く。
//   ただしこのAPIから parsedText への書き込みはしない（advisor-context のAI解析パイプラインと混ぜない）。
// - 該当が複数あれば candidates に全件返し、支援画面がプルダウンで切り替えられるようにする
//   （?fileId= で明示指定）。1件なら自動採用。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { extractTextFromPdf } from "@/lib/ai/extract-text";

// Driveダウンロード＋PDF抽出で十数秒かかる大型ファイルに備える。
export const maxDuration = 60;

// これ未満しか抽出できないPDFはスキャン（画像）PDFとみなす。
const MIN_PRIOR_TEXT_CHARS = 200;
// auto-scan へ渡す上限。プロンプト肥大の防止（キャリアシートは冒頭にプロフィール・経歴が来る想定で先頭を残す）。
const MAX_PRIOR_TEXT_CHARS = 6000;

// ファイル名でキャリアシート系を判定するキーワード。複数該当時の自動選択はこの並び順を優先する。
const PRIOR_FILE_KEYWORDS = ["キャリアシート", "職務経歴", "レジュメ", "履歴書"] as const;

// 求人票系（BOOKMARK/JOB_POSTING）は対象外。添付タブ(MEETING)のほか、履歴書等が入りうる区分も見る。
const PRIOR_FILE_CATEGORIES = ["MEETING", "ORIGINAL", "BS_DOCUMENT", "APPLICATION"] as const;

function keywordRank(fileName: string): number {
  const idx = PRIOR_FILE_KEYWORDS.findIndex((k) => fileName.includes(k));
  return idx < 0 ? PRIOR_FILE_KEYWORDS.length : idx;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ interviewId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { interviewId } = await params;
  const record = await prisma.interviewRecord.findUnique({
    where: { id: interviewId },
    select: { candidateId: true },
  });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  const files = await prisma.candidateFile.findMany({
    where: {
      candidateId: record.candidateId,
      category: { in: [...PRIOR_FILE_CATEGORIES] },
      mimeType: "application/pdf",
      driveFileId: { not: null },
      archivedAt: null,
      OR: PRIOR_FILE_KEYWORDS.map((k) => ({ fileName: { contains: k } })),
    },
    select: { id: true, fileName: true, driveFileId: true, parsedText: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // 自動選択順: キーワード優先度（キャリアシート＞職務経歴＞レジュメ＞履歴書）→ 新しい順。
  const sorted = [...files].sort(
    (a, b) => keywordRank(a.fileName) - keywordRank(b.fileName) || b.createdAt.getTime() - a.createdAt.getTime()
  );
  const candidates = sorted.map((f) => ({ id: f.id, fileName: f.fileName }));

  if (sorted.length === 0) {
    return NextResponse.json({ available: false, candidates: [] });
  }

  const requestedFileId = req.nextUrl.searchParams.get("fileId");
  const selected = requestedFileId ? sorted.find((f) => f.id === requestedFileId) : sorted[0];
  if (!selected) {
    return NextResponse.json({ available: false, candidates });
  }

  try {
    // T-164 の解析済みキャッシュがあれば流用（Driveダウンロード不要・即応答）。
    let text = selected.parsedText?.trim() ?? "";
    if (text.length < MIN_PRIOR_TEXT_CHARS) {
      const { base64 } = await downloadFileFromDrive(selected.driveFileId!);
      text = (await extractTextFromPdf(Buffer.from(base64, "base64"))).trim();
    }
    if (text.length < MIN_PRIOR_TEXT_CHARS) {
      // スキャンPDF等。候補一覧は返す（複数候補時にユーザーが別ファイルへ切り替えられるように）。
      return NextResponse.json({ available: false, candidates });
    }
    return NextResponse.json({
      available: true,
      fileId: selected.id,
      fileName: selected.fileName,
      text: text.slice(0, MAX_PRIOR_TEXT_CHARS),
      candidates,
    });
  } catch (e) {
    console.error("[interview-support/prior-info] extract failed:", { fileId: selected.id, error: e });
    // 事前情報は無くても面談サポート本体は動く。エラーでも available: false で穏やかに返す。
    return NextResponse.json({ available: false, candidates });
  }
}
