import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCategoryLabel } from "@/lib/constants/candidate-file-categories";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { parsePdfWithAI, parseTextFile } from "@/lib/file-parser";
import { extractAxis, RANK_ORDER, RANK_UNRANKED, RATING_VALUE } from "@/lib/ai-rating";
import { extractCompanyNameCandidates, stripFileMetadata } from "@/lib/normalize-filename";

const MEETING_TEXT_MAX_CHARS = 8000;
// T-XXX step7: 求人評価（mode="evaluation"＝buildAnalyzeCandidateContext）だけの全体上限。
//   チャット・挨拶文は messages route の 20,000字のまま（評価一覧・求人票を押し出さないため）。
export const EVAL_CONTEXT_MAX_CHARS = 50000;
// T-163: 評価一覧セクションの上限。コメント本文を含めない1行1件形式でもここで打ち切る。
const RATINGS_SECTION_MAX_CHARS = 2000;

// T-163: analyze-batch が候補者contextから評価系セクションを除去する際の目印。
// 評価一覧はチャット用（AIが「どれが一番いい？」等に答えるため）で、
// 求人を評価する側の analyze-batch に自分の過去評価を見せない（判定の自己調整を防ぐ）。
export const RATINGS_SECTION_MARKER = "## ブックマーク求人の評価一覧";

/**
 * T-164: context の材料（候補者・ファイル・評価・メモ・ワークシート・面談ログダイジェスト）の
 * 更新状態から指紋を作る。AIは呼ばない・軽い集計クエリのみ。
 * 指紋が一致すれば contextCache を経過時間に関係なく再利用できる（messages route が使用）。
 * 日時は UTC の instant（toISOString の完全形）をそのままハッシュ材料にする。
 * 暦日への変換はしない（罠#17: JST 暦日が必要な場面で toISOString().slice(0,10) を使わないこと）。
 */
export async function computeContextFingerprint(candidateId: string): Promise<string> {
  const [candidate, fileAgg, ratedCount, noteAgg, guide] = await Promise.all([
    prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { updatedAt: true, advisorLogDigestUpdatedAt: true },
    }),
    prisma.candidateFile.aggregate({
      where: { candidateId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.candidateFile.count({
      where: { candidateId, aiMatchRating: { not: null } },
    }),
    prisma.candidateNote.aggregate({
      where: { candidateId },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.guideEntry.findFirst({
      where: { candidateId, guideType: "INTERVIEW" },
      select: { updatedAt: true },
    }),
  ]);

  const material = [
    candidate?.updatedAt?.toISOString() ?? "",
    candidate?.advisorLogDigestUpdatedAt?.toISOString() ?? "",
    fileAgg._count._all,
    fileAgg._max.updatedAt?.toISOString() ?? "",
    ratedCount,
    noteAgg._count._all,
    noteAgg._max.updatedAt?.toISOString() ?? "",
    guide?.updatedAt?.toISOString() ?? "",
  ].join("|");

  return createHash("sha256").update(material).digest("hex");
}

const KEY_FILE_SELECT = {
  id: true,
  driveFileId: true,
  fileName: true,
  category: true,
  mimeType: true,
  parsedText: true, // T-164: 解析済みならDriveダウンロードもAI解析もスキップ
  createdAt: true,
  advisorIngestedAt: true,
} as const;

export type KeyFile = {
  id: string;
  driveFileId: string | null;
  fileName: string;
  category: string;
  mimeType: string;
  parsedText: string | null;
  createdAt: Date;
  advisorIngestedAt: Date | null;
};

/** 主要書類1件の本文（未加工の全文）を返す。失敗時は throw する。 */
export type KeyFileTextReader = (file: KeyFile, candidateId: string) => Promise<string>;

export type CandidateContextOptions = {
  /**
   * "chat"（既定）: AIアドバイザーのチャット・挨拶文と同じ組み立て。
   * "evaluation": 求人評価用（T-XXX step7）。主要書類の選び方と上限だけが違う（buildEvaluationKeyDocs 参照）。
   */
  mode?: "chat" | "evaluation";
  /** 本文の読み方の差し替え（確認スクリプトで Drive・OCR・書き込みを避けるため）。既定は readKeyFileText。 */
  readKeyFileText?: KeyFileTextReader;
};

/**
 * 主要書類1件の本文を読む。T-164: アップロード済みファイルの中身は変わらないため、一度解析したら永続再利用する
 * （従来はセッション30分キャッシュ失効のたびに Drive ダウンロード + Gemini 解析が走り、
 *  context 再ビルドに実測 15,507ms かかっていた＝「最初の1通が遅い」の主因）。
 * parsedText には未加工の全文を保存し、切り詰めは使用時に行う。
 */
export async function readKeyFileText(file: KeyFile, candidateId: string): Promise<string> {
  let raw = file.parsedText;
  if (!raw || raw.trim() === "") {
    const { base64 } = await downloadFileFromDrive(file.driveFileId!);
    if (file.mimeType === "text/plain") {
      raw = parseTextFile(base64);
    } else {
      // T-135: この OCR は費用の帰属先を追えるよう candidateId と呼び出し元を記録する。
      // parsePdfWithAI 自体は変更しない（呼ぶかどうかの判断だけを T-164 で変更）。
      raw = await parsePdfWithAI(base64, {
        candidateId,
        caller: "advisor-context",
        category: file.category,
      });
    }
    // parsePdfWithAI / parseTextFile は失敗時に throw せず定型文を返すため、
    // 定型文を parsedText に保存しない（失敗の永久キャッシュ防止・次回再試行）。
    const isFailureText =
      raw.trim() === "" ||
      raw === "（ファイルの読み取りに失敗しました）" ||
      raw === "（画像の読み取りに失敗しました）" ||
      raw === "（テキストファイルの読み取りに失敗しました）";
    try {
      await prisma.candidateFile.update({
        where: { id: file.id },
        data: isFailureText
          ? { parseFailedAt: new Date() }
          : { parsedText: raw, parsedAt: new Date(), parseFailedAt: null },
      });
    } catch (persistErr) {
      // 永続化の失敗は context ビルドを落とさない（次回再解析されるだけ）
      console.error(`[advisor-context] parsedText persist failed: ${file.fileName}`, persistErr);
    }
  }
  return raw;
}

/**
 * 主要書類1件を「### ファイル名（区分）\n本文\n\n」の形にする。
 * maxChars を指定すると txt（面談の文字起こし）だけその字数で切る。Drive 実体の無い行は null。
 */
async function renderKeyFile(
  file: KeyFile,
  candidateId: string,
  readText: KeyFileTextReader,
  maxChars: number | null,
): Promise<string | null> {
  if (!file.driveFileId) return null; // PDF実体が無い行はスキップ（BOOKMARK除外済だが型安全のため）
  try {
    const raw = await readText(file, candidateId);
    const parsedText =
      maxChars !== null && file.mimeType === "text/plain" && raw.length > maxChars
        ? raw.substring(0, maxChars) + "\n...(以下省略)"
        : raw;
    return `### ${file.fileName}（${getCategoryLabel(file.category)}）\n${parsedText}\n\n`;
  } catch (error) {
    console.error(`File parse error: ${file.fileName}`, error);
    // Drive ダウンロード等の例外も失敗として記録（次回再試行の対象。同一リクエスト内では再試行しない）
    try {
      await prisma.candidateFile.update({
        where: { id: file.id },
        data: { parseFailedAt: new Date() },
      });
    } catch { /* 記録失敗は無視 */ }
    return `### ${file.fileName}（${getCategoryLabel(file.category)}）\n（読み取りに失敗しました）\n\n`;
  }
}

/** 残りの字数がこれ未満なら、それ以降の書類は読まずに省略する。 */
const EVAL_MIN_PARTIAL_CHARS = 200;

/**
 * T-XXX step7: 求人評価用の「主要書類の内容」。チャット用（最新4件・面談 txt は各8,000字）との違いは次の3点。
 *   ① 最新の面談の文字起こし（面談 txt のうち最も新しいもの）は全文を、4件の枠とは別に先頭へ必ず入れる
 *   ② 要約（advisorLogDigest）がある人でも、要約に入っていない面談 txt は本文を入れる。
 *      「要約に入っているか」は面談 txt の advisorIngestedAt（要約の保存と同じトランザクションで立つ取り込み日時）で決める。
 *      null＝未取り込み＝要約に入っていない。要約が無い人は全部の面談 txt が対象（従来どおり）。
 *      最新の面談が取り込み済みなら①は行わない（要約で代替）。
 *   ③ 全体の上限（budget＝EVAL_CONTEXT_MAX_CHARS から前後のセクションを引いた残り）を超える分は、
 *      新しい順に並べた残りの書類の古い方から削る。最新の面談は削らない。
 * 最新の面談以外の書類は従来どおり新しい順に最大4件・面談 txt は各8,000字。
 */
async function buildEvaluationKeyDocs(
  candidateId: string,
  hasLogDigest: boolean,
  budget: number,
  readText: KeyFileTextReader,
): Promise<string> {
  const rows: KeyFile[] = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
      mimeType: { in: ["application/pdf", "text/plain"] },
    },
    orderBy: { createdAt: "desc" },
    select: KEY_FILE_SELECT,
  });
  const isMeetingTxt = (f: KeyFile) => f.category === "MEETING" && f.mimeType === "text/plain";
  const notInDigest = (f: KeyFile) => !hasLogDigest || f.advisorIngestedAt === null;

  const newestMeeting = rows.find((f) => isMeetingTxt(f) && f.driveFileId);
  const latest = newestMeeting && notInDigest(newestMeeting) ? newestMeeting : null;
  const others = rows
    .filter((f) => f !== latest && (!isMeetingTxt(f) || notInDigest(f)))
    .slice(0, 4);
  if (!latest && others.length === 0) return "";

  let section = `## 主要書類の内容\n\n`;
  if (latest) section += (await renderKeyFile(latest, candidateId, readText, null)) ?? "";
  let remaining = budget - section.length;
  let omitted = 0;
  for (const file of others) {
    if (!file.driveFileId) continue;
    if (omitted > 0 || remaining < EVAL_MIN_PARTIAL_CHARS) {
      omitted++;
      continue;
    }
    const block = await renderKeyFile(file, candidateId, readText, MEETING_TEXT_MAX_CHARS);
    if (!block) continue;
    if (block.length <= remaining) {
      section += block;
      remaining -= block.length;
    } else {
      const tail = "\n...(以下省略)\n\n";
      section += block.substring(0, Math.max(0, remaining - tail.length)) + tail;
      remaining = 0;
    }
  }
  if (omitted > 0) section += `（ほか${omitted}件の書類は字数の上限のため省略）\n\n`;
  return section;
}

/**
 * Build candidate context string for AI advisor.
 * Includes: basic info, worksheet, PREP, AI report, resume, notes, file list,
 * key document contents (PDF parsed), and latest 5 bookmark texts.
 * T-XXX step7: options.mode="evaluation" は求人評価用（主要書類の組み立てだけが違う）。既定の "chat" の出力は従来と同一。
 */
export async function getCandidateContext(
  candidateId: string,
  options: CandidateContextOptions = {},
): Promise<string> {
  const mode = options.mode ?? "chat";
  const readText = options.readKeyFileText ?? readKeyFileText;
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

  // T-155: 面談ログの累積ダイジェスト。
  // ★messages route はコンテキストを末尾から 20,000 字で切り詰めるため、確実に届くよう
  //   基本情報の直後（前方）に置く。可変ブロック側なので prompt キャッシュ（罠#39）への影響は無い。
  const hasLogDigest = !!candidate.advisorLogDigest?.trim();
  if (hasLogDigest) {
    const digestDate = candidate.advisorLogDigestUpdatedAt
      ? candidate.advisorLogDigestUpdatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
      : "";
    context += `## 面談内容の要約（取り込み済みの面談ログより${digestDate ? `・${digestDate}更新` : ""}）\n`;
    context += `${candidate.advisorLogDigest!.trim()}\n\n`;
  }

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

  // 応募履歴（T-XXX step7: 評価では主要書類の字数の予算に応募履歴の長さが要るため、先に組み立てて後で足す）
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

  let entriesSection = "";
  if (jobEntries.length > 0) {
    entriesSection += `## 応募履歴（直近${jobEntries.length}件）\n`;
    for (const entry of jobEntries) {
      const flag = entry.entryFlag || "不明";
      const detail = entry.entryFlagDetail || "";
      entriesSection += `- ${entry.companyName || "不明"} / ${entry.jobTitle || "不明"} — ${flag}${detail ? `（${detail}）` : ""}`;
      if (entry.documentSubmitDate) entriesSection += ` / 書類提出: ${entry.documentSubmitDate.toISOString().slice(0, 10)}`;
      if (entry.documentPassDate) entriesSection += ` / 書類通過: ${entry.documentPassDate.toISOString().slice(0, 10)}`;
      if (entry.firstInterviewDate) entriesSection += ` / 一次面接: ${entry.firstInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.finalInterviewDate) entriesSection += ` / 最終面接: ${entry.finalInterviewDate.toISOString().slice(0, 10)}`;
      if (entry.offerDate) entriesSection += ` / 内定: ${entry.offerDate.toISOString().slice(0, 10)}`;
      if (entry.acceptanceDate) entriesSection += ` / 承諾: ${entry.acceptanceDate.toISOString().slice(0, 10)}`;
      if (entry.joinDate) entriesSection += ` / 入社: ${entry.joinDate.toISOString().slice(0, 10)}`;
      entriesSection += "\n";
    }
    entriesSection += "\n";
  }

  if (mode === "evaluation") {
    // T-XXX step7: 求人評価用。最新の面談は全文・4件枠の外・先頭。要約に入っていない面談も入れる。
    const budget = EVAL_CONTEXT_MAX_CHARS - context.length - entriesSection.length;
    context += await buildEvaluationKeyDocs(candidateId, hasLogDigest, budget, readText);
  } else {
    // 主要書類の内容を読み込み（ORIGINAL, BS_DOCUMENT, MEETING のPDF/テキストのみ、最大4件）
    // T-155: ダイジェストがある場合、MEETING の txt は本文読み込みを止める（ダイジェストと二重に
    //   入れる意味がなく、最新4件の枠と 8,000字/20,000字の予算を圧迫するだけのため）。
    //   ダイジェストが無い求職者では従来どおり本文を読む（既存の挙動を壊さない）。
    //   ORIGINAL / BS_DOCUMENT（履歴書PDF等）と MEETING の PDF は従来どおり読む。
    const keyFiles = await prisma.candidateFile.findMany({
      where: {
        candidateId,
        category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
        mimeType: { in: ["application/pdf", "text/plain"] },
        ...(hasLogDigest
          ? { NOT: { category: "MEETING", mimeType: "text/plain" } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: KEY_FILE_SELECT,
    });

    if (keyFiles.length > 0) {
      context += `## 主要書類の内容\n\n`;
      for (const file of keyFiles) {
        context += (await renderKeyFile(file, candidateId, readText, MEETING_TEXT_MAX_CHARS)) ?? "";
      }
    }
  }

  context += entriesSection;

  // T-163: ブックマーク求人の評価一覧（1行1件・コメント本文は絶対に含めない＝肥大化防止）。
  // チャットの送信窓から分析長文を除外した代わりに、AIが評価を踏まえて答えられる最小情報をここで渡す。
  // ※ analyze-batch はこのセクション（RATINGS_SECTION_MARKER）以降を除去して従来と同一入力を保つ。
  const ratedBookmarks = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: "BOOKMARK",
      archivedAt: null,
      aiMatchRating: { not: null },
    },
    select: { fileName: true, aiMatchRating: true, aiAnalysisComment: true },
    orderBy: { createdAt: "desc" },
  });

  if (ratedBookmarks.length > 0) {
    // 総合ランクの良い順（A → B+ → B → C → D → 幅表記等）。幅表記は先頭の評価値で並べる。
    const headRatingRe = new RegExp(`^(${RATING_VALUE})`);
    const rankOf = (rating: string | null): number => {
      const m = (rating ?? "").match(headRatingRe);
      return m ? RANK_ORDER[m[1]] ?? RANK_UNRANKED : RANK_UNRANKED;
    };
    const sorted = [...ratedBookmarks].sort(
      (a, b) => rankOf(a.aiMatchRating) - rankOf(b.aiMatchRating)
    );

    const lines: string[] = [];
    let usedChars = 0;
    let omitted = 0;
    for (const f of sorted) {
      const company =
        extractCompanyNameCandidates(f.fileName)[0] || stripFileMetadata(f.fileName) || f.fileName;
      const kibou = extractAxis(f.aiAnalysisComment, "本人希望") ?? "-";
      const tsuka = extractAxis(f.aiAnalysisComment, "通過率") ?? "-";
      const line = `- ${company} — 希望:${kibou} / 通過:${tsuka} / 総合:${f.aiMatchRating}`;
      if (usedChars + line.length + 1 > RATINGS_SECTION_MAX_CHARS) {
        omitted++;
        continue;
      }
      lines.push(line);
      usedChars += line.length + 1;
    }
    if (omitted > 0) lines.push(`（ほか${omitted}件は省略）`);

    context += `${RATINGS_SECTION_MARKER}（${ratedBookmarks.length}件・総合の良い順）\n`;
    context += `${lines.join("\n")}\n\n`;
  }

  // ブックマーク求人票テキスト（最新5件のみ、コンテキスト肥大化防止）
  const bookmarkFiles = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: "BOOKMARK",
      archivedAt: null,
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
