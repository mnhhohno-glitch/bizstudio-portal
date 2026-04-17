/**
 * 特定候補者のブックマーク評価データ調査（読み取り専用）
 *
 * 目的:
 *   指定された candidateId のブックマーク（category='BOOKMARK'）を全件取得し、
 *   aiMatchRating / aiAnalysisComment の現状を詳細ダンプする。
 *
 * 使い方:
 *   npx tsx scripts/inspect-candidate-bookmarks.ts
 *   railway run npx tsx scripts/inspect-candidate-bookmarks.ts
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
  const dbUrl = process.env.DATABASE_URL || "(未設定)";
  const dbHost = dbUrl.match(/@([^/:]+)/)?.[1] ?? "(unknown)";

  console.log("=== 候補者ブックマーク評価データ調査 ===");
  console.log(`実行日時: ${fmtJst(new Date())} (JST)`);
  console.log(`DB host: ${dbHost}`);
  console.log(`候補者ID: ${CANDIDATE_ID}`);
  console.log("");

  const candidate = await prisma.candidate.findUnique({
    where: { id: CANDIDATE_ID },
    select: { id: true, candidateNumber: true, name: true, nameKana: true },
  });

  if (!candidate) {
    console.log("★ 候補者が見つかりません");
    return;
  }

  console.log(`候補者: ${candidate.name} (${candidate.nameKana ?? "(フリガナなし)"}) / No.${candidate.candidateNumber}`);
  console.log("");

  const bookmarks = await prisma.candidateFile.findMany({
    where: { candidateId: CANDIDATE_ID, category: "BOOKMARK" },
    select: {
      id: true,
      fileName: true,
      aiMatchRating: true,
      aiAnalysisComment: true,
      aiAnalyzedAt: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`ブックマーク総数: ${bookmarks.length} 件`);
  console.log("");

  if (bookmarks.length === 0) {
    console.log("該当ブックマークなし");
    return;
  }

  bookmarks.forEach((f, idx) => {
    const comment = f.aiAnalysisComment;
    const len = comment ? comment.length : 0;
    const head = comment
      ? comment.substring(0, 200).replace(/\n/g, "\\n")
      : "(NULL)";
    const hasDesire = comment ? /■\s*本人希望[：:]\s*[ABCD]/.test(comment) : false;
    const hasPass = comment ? /■\s*通過率[：:]\s*[ABCD]/.test(comment) : false;
    const hasOverall = comment ? /■\s*総合[：:]\s*[ABCD]/.test(comment) : false;

    console.log(`────────────────────────────────────────────────────`);
    console.log(`[${idx + 1}/${bookmarks.length}] ${f.fileName}`);
    console.log(`  fileId         : ${f.id}`);
    console.log(`  aiMatchRating  : ${f.aiMatchRating ?? "NULL"}`);
    console.log(`  comment長さ    : ${len} 文字`);
    console.log(`  ■本人希望     : ${hasDesire}`);
    console.log(`  ■通過率       : ${hasPass}`);
    console.log(`  ■総合         : ${hasOverall}`);
    console.log(`  aiAnalyzedAt  : ${f.aiAnalyzedAt ? fmtJst(f.aiAnalyzedAt) : "NULL"}`);
    console.log(`  createdAt     : ${fmtJst(f.createdAt)}`);
    console.log(`  updatedAt     : ${fmtJst(f.updatedAt)}`);
    console.log(`  comment冒頭200:`);
    console.log(`    ${head}`);
  });

  console.log("");
  console.log(`────────────────────────────────────────────────────`);
  const valid = bookmarks.filter((f) => {
    const c = f.aiAnalysisComment;
    return c && /■\s*本人希望[：:]\s*[ABCD]/.test(c) && /■\s*通過率[：:]\s*[ABCD]/.test(c) && /■\s*総合[：:]\s*[ABCD]/.test(c);
  }).length;
  const nullOrEmpty = bookmarks.filter((f) => !f.aiAnalysisComment || f.aiAnalysisComment.trim() === "").length;
  const broken = bookmarks.length - valid - nullOrEmpty;
  console.log(`【集計】 正常: ${valid}件 / 3軸欠落: ${broken}件 / NULL空: ${nullOrEmpty}件`);
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
