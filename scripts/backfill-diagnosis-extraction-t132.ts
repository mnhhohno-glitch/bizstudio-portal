/**
 * T-132 Phase2: 過去のタイプ診断（advisor_chat_messages）を構造化抽出して advisor_type_diagnosis へ保存するバッチ。
 *
 * 対象: role='assistant' かつ isDiagnosisContent が真の応答。候補者1名につき **最新の診断メッセージ** を採用。
 * 抽出: src/lib/advisor/diagnosis-extract.ts の runDiagnosisExtraction（本番の発火点と同一ロジック）。
 * 冪等: advisor_type_diagnosis に同一 sourceMessageId で既に行があればスキップ（再実行で未処理分のみ）。
 *
 * 使い方（本番コンテナ上・railway ssh）:
 *   npx tsx scripts/backfill-diagnosis-extraction-t132.ts                 # DRY-RUN（件数・概算費用・サンプル10件の対比）
 *   npx tsx scripts/backfill-diagnosis-extraction-t132.ts --samples 10    # サンプル数変更
 *   npx tsx scripts/backfill-diagnosis-extraction-t132.ts --only 5004272,5999998  # 候補者番号限定
 *   npx tsx scripts/backfill-diagnosis-extraction-t132.ts --execute       # 本実行（未処理分のみ抽出・保存）
 *   npx tsx scripts/backfill-diagnosis-extraction-t132.ts --execute --force  # 既存行も再抽出・上書き
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import {
  isDiagnosisContent,
  extractDiagnosisPreferences,
  runDiagnosisExtraction,
} from "../src/lib/advisor/diagnosis-extract";
import { MODEL_PRICING_PER_MTOK } from "../src/lib/claude";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const argv = process.argv.slice(2);
const EXECUTE = argv.includes("--execute");
const FORCE = argv.includes("--force");
const SAMPLES = (() => {
  const i = argv.indexOf("--samples");
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : 10;
})();
const ONLY = (() => {
  const i = argv.indexOf("--only");
  if (i >= 0 && argv[i + 1]) return new Set(argv[i + 1].split(",").map((s) => s.trim()));
  return null;
})();
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

function excerptSearchSection(content: string, span = 900): string {
  const idx = content.search(/検索条件/);
  const start = idx >= 0 ? Math.max(0, idx - 40) : 0;
  return content.slice(start, start + span).replace(/\n{3,}/g, "\n\n");
}

async function main() {
  console.log(`=== T-132 診断バッチ構造化 (mode=${MODE}${FORCE ? " FORCE" : ""}) ===`);

  // 1) 全 assistant 診断メッセージ → 候補者ごと最新を採用
  const msgs = await prisma.advisorChatMessage.findMany({
    where: { role: "assistant" },
    select: { id: true, sessionId: true, content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const diagMsgs = msgs.filter((m) => isDiagnosisContent(m.content));

  const sessions = await prisma.advisorChatSession.findMany({
    where: { id: { in: [...new Set(diagMsgs.map((m) => m.sessionId))] } },
    select: { id: true, candidateId: true, candidate: { select: { candidateNumber: true, name: true, supportStatus: true } } },
  });
  const sessById = new Map(sessions.map((s) => [s.id, s]));

  // candidateId -> 最新診断
  const latestByCand = new Map<
    string,
    { messageId: string; sessionId: string; content: string; createdAt: Date; candidateNumber: string | null; name: string | null; supportStatus: string | null }
  >();
  for (const m of diagMsgs) {
    const s = sessById.get(m.sessionId);
    if (!s) continue;
    if (ONLY && !(s.candidate?.candidateNumber && ONLY.has(s.candidate.candidateNumber))) continue;
    const prev = latestByCand.get(s.candidateId);
    if (!prev || m.createdAt > prev.createdAt) {
      latestByCand.set(s.candidateId, {
        messageId: m.id,
        sessionId: m.sessionId,
        content: m.content,
        createdAt: m.createdAt,
        candidateNumber: s.candidate?.candidateNumber ?? null,
        name: s.candidate?.name ?? null,
        supportStatus: s.candidate?.supportStatus ?? null,
      });
    }
  }

  const targets = [...latestByCand.entries()].map(([candidateId, v]) => ({ candidateId, ...v }));
  console.log(`診断メッセージ総数=${diagMsgs.length} / 対象候補者(distinct・最新採用)=${targets.length}`);

  // 2) 既存行の冪等スキップ判定
  const existing = await prisma.advisorTypeDiagnosis.findMany({
    where: { candidateId: { in: targets.map((t) => t.candidateId) } },
    select: { candidateId: true, sourceMessageId: true },
  });
  const existingByCand = new Map(existing.map((e) => [e.candidateId, e.sourceMessageId]));

  const pending = targets.filter((t) => {
    if (FORCE) return true;
    const src = existingByCand.get(t.candidateId);
    return src !== t.messageId; // 同一メッセージで既抽出済みならスキップ
  });
  console.log(`既存 advisor_type_diagnosis 行=${existing.length} / 今回処理対象(未処理 or 新診断)=${pending.length}`);

  // 3) 概算費用（DRY-RUN 用・入力トークンは content 長から粗く見積もり）
  const price = MODEL_PRICING_PER_MTOK["gemini-3-flash-preview"];
  const estInputTokens = pending.reduce((a, t) => a + Math.ceil(t.content.length / 2.2), 0); // 日本語~2.2char/token目安
  const estOutputTokens = pending.length * 300;
  const estCost = price ? (estInputTokens * price.input + estOutputTokens * price.output) / 1_000_000 : 0;
  console.log(
    `概算: 入力~${estInputTokens.toLocaleString()}tok / 出力~${estOutputTokens.toLocaleString()}tok / 費用~$${estCost.toFixed(4)}（gemini-3-flash-preview概算単価）`,
  );

  if (!EXECUTE) {
    // 4) サンプル抽出（目視検証用の対比・保存はしない）
    const sample = pending.slice(0, SAMPLES);
    console.log(`\n===== サンプル抽出 ${sample.length}件（原文要点 vs 構造化結果・DBには保存しない） =====`);
    for (const t of sample) {
      console.log(`\n--- ${t.candidateNumber} ${t.name}（${t.supportStatus}）msg=${t.messageId} ---`);
      console.log("[原文・検索条件抜粋]");
      console.log(excerptSearchSection(t.content));
      try {
        const { extraction, row } = await extractDiagnosisPreferences(t.content);
        console.log("[抽出(生)]", JSON.stringify(extraction, null, 0));
        console.log("[保存行(採用ルール適用)]", JSON.stringify(row, null, 0));
      } catch (e) {
        console.log("[抽出失敗]", e instanceof Error ? e.message : String(e));
      }
    }
    console.log(`\n(DRY-RUN: 保存はしていません。--execute で本実行。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // 5) 本実行（未処理分のみ・失敗隔離・失敗リスト出力）
  console.log(`\n===== EXECUTE: ${pending.length}件を抽出・保存 =====`);
  let saved = 0,
    noSignal = 0,
    failed = 0;
  const failures: string[] = [];
  for (const t of pending) {
    const r = await runDiagnosisExtraction({
      candidateId: t.candidateId,
      sessionId: t.sessionId,
      messageId: t.messageId,
      diagnosisText: t.content,
      recordUsage: true,
    });
    if (r.ok && r.saved) {
      saved++;
      console.log(`  ✓ ${t.candidateNumber} ${t.name}: min=${r.row.desiredSalaryMin} max=${r.row.desiredSalaryMax} 職種=${r.row.desiredJobTypes.length} 県=${r.row.desiredPrefectures.join("/")}`);
    } else if (r.ok && !r.saved) {
      noSignal++;
      console.log(`  - ${t.candidateNumber} ${t.name}: 希望条件0（no-signal・保存せず）`);
    } else {
      failed++;
      failures.push(`${t.candidateNumber} ${t.name} msg=${t.messageId}: ${r.reason} ${("error" in r && r.error) || ""}`);
      console.log(`  ✗ ${t.candidateNumber} ${t.name}: ${r.reason}`);
    }
  }
  console.log(`\n結果: 保存=${saved} / no-signal=${noSignal} / 失敗=${failed}`);
  if (failures.length) {
    console.log(`\n[失敗リスト（再実行で未処理分のみ再試行される）]`);
    failures.forEach((f) => console.log("  " + f));
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
