/**
 * extractRatingsAndComments() シミュレーションスクリプト（読み取り専用）
 *
 * 目的:
 *   本番のAdvisorChatMessage.content に対して、route.ts の抽出ロジックを
 *   そのまま手元で実行し、Phase 1 / Phase 2 / フォールバックが
 *   どのファイルに対してどのような結果を返しているかを可視化する。
 *
 * 使い方:
 *   railway run npx tsx scripts/simulate-extract.ts
 *
 * 注意:
 *   DB更新・削除は一切行わない。select のみ。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const CANDIDATE_ID = "cmnfvise700081dml1b4fw1qt";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ===== route.ts からそのまま移植したロジック =====

function normalizeSpaces(str: string): string {
  return str.replace(/　/g, " ");
}

function normalizeCompanyName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
    .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[・]/g, "")
    .replace(/[\s　]/g, "")
    .trim()
    .toLowerCase();
}

function extractSearchNames(fileName: string): string[] {
  const names: string[] = [];
  const name = fileName.replace(/\.pdf$/i, "");

  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/);
  if (p1) names.push(p1[1]);

  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
  if (p2) names.push(p2[1]);

  const p3 = name.match(/^(.+?)_No\d+$/i);
  if (p3) names.push(p3[1]);

  const p4 = name.match(/^求人票[_]?(.+)$/);
  if (p4 && !names.includes(p4[1])) names.push(p4[1]);

  if (names.length === 0) names.push(name);

  for (let i = 0; i < names.length; i++) {
    names[i] = normalizeSpaces(names[i]);
  }

  const expanded: string[] = [...names];
  for (const n of names) {
    const stripped = n
      .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
      .trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) {
      expanded.push(stripped);
    }
    const normalized = n
      .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    if (normalized !== n && !expanded.includes(normalized)) {
      expanded.push(normalized);
    }
  }
  return expanded;
}

type Trace = {
  fileId: string;
  fileName: string;
  searchNames: string[];
  phase1Hit: boolean;
  phase1Rating: string;
  phase2SectionFound: boolean;
  phase2MatchedPattern: string;
  phase2MatchedName: string;
  phase2MatchedText: string;
  phase2CommentLen: number;
  phase2CommentHead: string;
  phase2Rating: string;
  fallbackHit: boolean;
  fallbackRating: string;
  finalRating: string;
  finalComment: string;
  finalCommentLen: number;
};

function extractRatingsAndCommentsTraced(
  analysisText: string,
  batchFiles: { id: string; fileName: string }[]
): { results: Map<string, { rating: string; comment: string }>; traces: Trace[] } {
  const results = new Map<string, { rating: string; comment: string }>();
  const traces: Trace[] = [];

  // Phase 1
  const summaryMatch = analysisText.match(/【総合優先順位[^】]*】([\s\S]*?)(?:$|\n\n\n)/);
  const summarySection = summaryMatch ? summaryMatch[1] : "";
  const summaryRatings = new Map<string, string>();

  if (summarySection) {
    let currentRating = "";
    for (const line of summarySection.split("\n")) {
      const trimmed = line.trim();
      if (/^[ABCD]$/.test(trimmed)) { currentRating = trimmed; continue; }
      if (trimmed === "該当なし" || trimmed === "") continue;
      if (trimmed.startsWith("*")) {
        const cn = trimmed.replace(/^\*\s*/, "").trim();
        if (cn && cn !== "該当なし" && currentRating) summaryRatings.set(cn, currentRating);
        continue;
      }
      if (currentRating && trimmed.length > 1 && !trimmed.startsWith("【")) {
        summaryRatings.set(trimmed, currentRating);
      }
    }

    for (const file of batchFiles) {
      if (results.has(file.id)) continue;
      const searchNames = extractSearchNames(file.fileName);
      for (const [summaryCompany, rating] of summaryRatings) {
        let matched = false;
        for (const name of searchNames) {
          if (
            summaryCompany.includes(name) ||
            name.includes(summaryCompany) ||
            normalizeCompanyName(summaryCompany) === normalizeCompanyName(name)
          ) {
            results.set(file.id, { rating, comment: "" });
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }
  }

  // Phase 2
  const normalizedText = normalizeSpaces(analysisText);

  for (const file of batchFiles) {
    const searchNames = extractSearchNames(file.fileName);
    const preEntry = results.get(file.id);
    const trace: Trace = {
      fileId: file.id,
      fileName: file.fileName,
      searchNames,
      phase1Hit: !!preEntry,
      phase1Rating: preEntry?.rating ?? "",
      phase2SectionFound: false,
      phase2MatchedPattern: "",
      phase2MatchedName: "",
      phase2MatchedText: "",
      phase2CommentLen: 0,
      phase2CommentHead: "",
      phase2Rating: "",
      fallbackHit: false,
      fallbackRating: "",
      finalRating: "",
      finalComment: "",
      finalCommentLen: 0,
    };

    for (const name of searchNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionPatterns = [
        { re: new RegExp(`(?:^|\\n)(?:#{1,3}\\s*)?(?:\\*\\*\\s*)?【[^】]*${escaped}[^】]*】`, "i"), label: "new1(anchored)" },
        { re: new RegExp(`【[^】]*${escaped}[^】]*】`, "i"), label: "new2(bare)" },
        { re: new RegExp(`(?:###?\\s*)?求人\\d+[：:]\\s*[^\\n]*${escaped}`, "i"), label: "new3(求人N:)" },
      ];

      let startIndex = -1;
      for (const p of sectionPatterns) {
        const match = normalizedText.match(p.re);
        if (match) {
          const matchedText = match[0];
          const rawIndex = normalizedText.indexOf(matchedText);
          if (rawIndex !== -1) {
            const braceOffset = matchedText.indexOf("【");
            startIndex = braceOffset >= 0 ? rawIndex + braceOffset : rawIndex;
            trace.phase2MatchedPattern = p.label;
            trace.phase2MatchedName = name;
            trace.phase2MatchedText = matchedText;
            break;
          }
        }
      }

      if (startIndex === -1) {
        startIndex = normalizedText.indexOf(name);
        if (startIndex !== -1) {
          const before = analysisText.substring(Math.max(0, startIndex - 200), startIndex);
          const lastSep = before.lastIndexOf("---");
          if (lastSep !== -1) {
            startIndex = startIndex - 200 + lastSep + before.length - before.lastIndexOf("---");
            startIndex = Math.max(0, startIndex - 200) + lastSep + 3;
          }
          trace.phase2MatchedPattern = "direct-name-search";
          trace.phase2MatchedName = name;
        }
      }

      if (startIndex === -1) continue;

      const afterStart = analysisText.substring(startIndex);
      const nextSection = afterStart
        .slice(1)
        .match(/\n##\s+【[^】]+】|\n\*\*\s*【[^】]+】|\n\n【[^】]+】|\n(?:###?\s*)?求人\d+[：:]|\n━━━/);
      const endIndex = nextSection
        ? startIndex + 1 + (nextSection.index || afterStart.length)
        : startIndex + Math.min(afterStart.length, 3000);

      const comment = analysisText.substring(startIndex, endIndex).trim();

      if (comment.length > 10) {
        trace.phase2SectionFound = true;
        trace.phase2CommentLen = comment.length;
        trace.phase2CommentHead = comment.substring(0, 150).replace(/\n/g, "\\n");

        const existing = results.get(file.id);
        if (existing) {
          existing.comment = comment;
        } else {
          const ratingMatch = comment.match(/■\s*総合[：:]\s*([ABCD])/) || comment.match(/総合[：:]\s*([ABCD])/);
          trace.phase2Rating = ratingMatch ? ratingMatch[1] : "";
          results.set(file.id, { rating: ratingMatch ? ratingMatch[1] : "", comment });
        }
        break;
      }
    }

    // Fallback rating
    const entry = results.get(file.id);
    if (entry && !entry.rating) {
      for (const name of searchNames) {
        const idx = normalizedText.indexOf(name);
        if (idx === -1) continue;
        const area = analysisText.substring(Math.max(0, idx - 100), Math.min(analysisText.length, idx + 600));
        const patterns = [/■\s*総合[：:]\s*([ABCD])/, /総合[：:]\s*([ABCD])/, /評価[：:]\s*([ABCD])/, /【([ABCD])】/];
        for (const p of patterns) {
          const m = area.match(p);
          if (m) { entry.rating = m[1]; break; }
        }
        if (entry.rating) break;
      }
    }

    // Fallback: Phase 2 が失敗した場合は results に追加しない（新仕様）
    if (!results.has(file.id)) {
      trace.fallbackHit = false;
    }

    const finalEntry = results.get(file.id);
    trace.finalRating = finalEntry?.rating ?? "(なし)";
    trace.finalComment = finalEntry?.comment ?? "";
    trace.finalCommentLen = finalEntry?.comment.length ?? 0;

    traces.push(trace);
  }

  return { results, traces };
}

// ===== 本番DB取得＋シミュ =====

function fmtJst(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(/\//g, "-");
}

async function main() {
  console.log("=== extractRatingsAndComments シミュレーション ===");
  console.log(`実行日時: ${fmtJst(new Date())} (JST)`);
  console.log(`候補者ID: ${CANDIDATE_ID}`);
  console.log("");

  // このセッション内で対象のメッセージ
  const sessions = await prisma.advisorChatSession.findMany({
    where: { candidateId: CANDIDATE_ID },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  if (sessions.length === 0) {
    console.log("セッションなし");
    return;
  }
  const sessionId = sessions[0].id;

  const files = await prisma.candidateFile.findMany({
    where: { candidateId: CANDIDATE_ID, category: "BOOKMARK" },
    select: { id: true, fileName: true, aiMatchRating: true, aiAnalysisComment: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  // 関心のあるメッセージIDs（時系列順、22:38:21 / 22:51:39 / 22:53:52）
  const targetMessages = await prisma.advisorChatMessage.findMany({
    where: {
      sessionId,
      role: "assistant",
      content: { contains: "【求人分析" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  for (const m of targetMessages) {
    console.log(`========================================================`);
    console.log(`Message ${m.id}  /  createdAt: ${fmtJst(m.createdAt)}`);
    console.log(`content長さ: ${m.content.length}`);

    // content から最初の【求人分析...】 label を切り取って analysisText 相当を作る
    // route.ts では `${label}\n\n${analysisText}` で保存されているので、
    // 逆算: 最初の \n\n 以降が analysisText
    const firstBreak = m.content.indexOf("\n\n");
    const analysisText = firstBreak >= 0 ? m.content.substring(firstBreak + 2) : m.content;
    const label = firstBreak >= 0 ? m.content.substring(0, firstBreak) : "(unknown)";
    console.log(`label: ${label}`);

    // バッチ番号をlabelから推定
    const batchMatch = label.match(/バッチ(\d+)/);
    const batchNum = batchMatch ? parseInt(batchMatch[1], 10) : 0;
    const sizeMatch = label.match(/（(\d+)〜(\d+)件目/);
    const start = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
    const end = sizeMatch ? parseInt(sizeMatch[2], 10) : 0;
    console.log(`batchNum=${batchNum}, range=${start}〜${end}`);

    // どのファイルがbatchだったかは履歴から確定不能なので、全19件を渡してmatchする
    // ものだけをダンプする。
    const batchFiles = files;

    const { results, traces } = extractRatingsAndCommentsTraced(
      analysisText,
      batchFiles.map((f) => ({ id: f.id, fileName: f.fileName }))
    );

    console.log("--- 抽出結果（HITまたはfallback hitのファイルのみ）---");
    let hitCount = 0;
    for (const tr of traces) {
      if (!tr.phase2SectionFound && !tr.fallbackHit && tr.finalRating === "(なし)") continue;
      hitCount++;
      console.log(`[${tr.fileName}]`);
      console.log(`  Phase2 section-match: ${tr.phase2SectionFound ? "HIT" : "MISS"}`);
      console.log(`    pattern: ${tr.phase2MatchedPattern || "(none)"}`);
      console.log(`    matchedName: ${tr.phase2MatchedName || "(none)"}`);
      console.log(`    matchedText: ${tr.phase2MatchedText || "(none)"}`);
      console.log(`    phase2CommentLen: ${tr.phase2CommentLen}`);
      console.log(`    phase2CommentHead: ${tr.phase2CommentHead || "(none)"}`);
      console.log(`  fallback hit: ${tr.fallbackHit} (rating=${tr.fallbackRating})`);
      console.log(`  FINAL: rating="${tr.finalRating}" / commentLen=${tr.finalCommentLen}`);
      console.log("");
    }

    console.log(`--- hits: ${hitCount} / total: ${batchFiles.length} ---`);
    console.log("");
  }

  console.log("=== 完了 ===");
}

main()
  .catch((e) => {
    console.error("エラー:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
