/**
 * 特定候補者のAdvisorChatMessage調査（読み取り専用）
 *
 * 目的:
 *   指定された candidateId のアドバイザーセッションに紐づく
 *   AIレスポンス (role='assistant') を最新5件、全文ダンプする。
 *
 * 使い方:
 *   railway run npx tsx scripts/inspect-advisor-messages.ts
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

  console.log("=== AdvisorChatMessage 実データ調査 ===");
  console.log(`実行日時: ${fmtJst(new Date())} (JST)`);
  console.log(`DB host: ${dbHost}`);
  console.log(`候補者ID: ${CANDIDATE_ID}`);
  console.log("");

  const sessions = await prisma.advisorChatSession.findMany({
    where: { candidateId: CANDIDATE_ID },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  console.log(`セッション数: ${sessions.length}`);
  sessions.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.id} / title="${s.title}" / createdAt=${fmtJst(s.createdAt)} / updatedAt=${fmtJst(s.updatedAt)}`);
  });
  console.log("");

  if (sessions.length === 0) {
    console.log("セッションなし");
    return;
  }

  for (const s of sessions) {
    const msgs = await prisma.advisorChatMessage.findMany({
      where: { sessionId: s.id, role: "assistant" },
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    console.log("============================================================");
    console.log(`[Session ${s.id}]`);
    console.log(`  title: ${s.title}`);
    console.log(`  assistant messages (最新5件): ${msgs.length}件`);
    console.log("============================================================");

    msgs.forEach((m, idx) => {
      console.log("");
      console.log(`------- [assistant #${idx + 1}] ${m.id} -------`);
      console.log(`createdAt: ${fmtJst(m.createdAt)}`);
      console.log(`content長さ: ${m.content.length} 文字`);
      console.log("------- content (全文) -------");
      console.log(m.content);
      console.log("------- content END -------");
    });
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
