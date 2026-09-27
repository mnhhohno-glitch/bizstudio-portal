/**
 * T-205 面談準備チャットの動作確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-dryrun.ts"
 *   ローカルから本番DBを読む場合: npx tsx --env-file=.env scripts/verify/interview-prep-dryrun.ts
 *   （Drive の認証情報と ANTHROPIC_API_KEY が環境に必要）
 *
 * やること（T-205 step3 で書き方の確認に更新。質問の往復は行わない）:
 *   1. 直近でマイナビレジュメが取り込まれた求職者1名（テスト除外）を選び、文字を取り出す（保存しない）
 *   2. 最初の整理を1回だけ生成する（保存しない。AI 呼び出しは1回）
 *   3. 見出し7つ・「→」で意味を添えた行数・斜線（／ または /）を2つ以上含む行数・経歴の型の取り出しを出す
 * 出力は数値と有無だけ（本文・氏名・ファイル名などの個人情報は出さない）。
 */
import { prisma } from "@/lib/prisma";
import { MYNAVI_RESUME_MEMO, extractResumeText } from "@/lib/interview-prep/resume";
import {
  INTERVIEW_PREP_MODEL,
  SUMMARY_MAX_TOKENS,
  buildPrepSystem,
  buildSummaryMessages,
  createPrepStream,
  extractCareerType,
  missingSummaryHeadings,
} from "@/lib/interview-prep/chat";
import { computeCostUsd, extractTokens } from "@/lib/advisor-usage";

const USD_JPY = 150;

type CallResult = {
  text: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  ms: number;
};

async function callPrep(system: ReturnType<typeof buildPrepSystem>, messages: ReturnType<typeof buildSummaryMessages>, maxTokens: number): Promise<CallResult> {
  const t0 = Date.now();
  const stream = createPrepStream({ system, messages, maxTokens });
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text;
  }
  const final = await stream.finalMessage();
  const ms = Date.now() - t0;
  const tokens = extractTokens(final.usage);
  const { costUsd } = computeCostUsd(INTERVIEW_PREP_MODEL, tokens);
  return {
    text,
    input: tokens.inputTokens,
    output: tokens.outputTokens,
    cacheRead: tokens.cacheReadTokens,
    cacheWrite: tokens.cacheCreationTokens,
    costUsd,
    ms,
  };
}

function printCall(label: string, r: CallResult) {
  console.log(
    `${label}: input=${r.input} output=${r.output} cache_read=${r.cacheRead} cache_write=${r.cacheWrite} ` +
      `cost=$${r.costUsd.toFixed(4)} (¥${(r.costUsd * USD_JPY).toFixed(1)}) latency=${(r.ms / 1000).toFixed(1)}s chars=${r.text.length}`,
  );
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が未設定です");

  const file = await prisma.candidateFile.findFirst({
    where: {
      category: "MEETING",
      memo: MYNAVI_RESUME_MEMO,
      mimeType: "application/pdf",
      archivedAt: null,
      driveFileId: { not: null },
      candidate: { name: { not: { contains: "テスト" } } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, driveFileId: true, createdAt: true },
  });
  if (!file) {
    console.log("resume_file: none");
    return;
  }
  console.log(`resume_file: found (imported ${file.createdAt.toISOString().slice(0, 10)})`);

  const extracted = await extractResumeText(file);
  if (!extracted.ok) {
    console.log(`resume_text: failed (${extracted.reason}, chars=${extracted.chars})`);
    return;
  }
  console.log(`resume_text: ok chars=${extracted.chars}`);

  const system = buildPrepSystem(extracted.text);

  // 最初の整理（1回だけ）
  const summary = await callPrep(system, buildSummaryMessages(), SUMMARY_MAX_TOKENS);
  printCall("call1 summary", summary);

  const missing = missingSummaryHeadings(summary.text);
  console.log(`summary_headings_7: ${missing.length === 0 ? "yes" : `no (missing: ${missing.join(", ")})`}`);

  const lines = summary.text.split(/\r?\n/);
  const arrowLines = lines.filter((l) => /^\s*[-*]/.test(l) && l.includes("→")).length;
  console.log(`arrow_meaning_lines: ${arrowLines}`);
  const slashLines = lines.filter((l) => (l.match(/[／/]/g) ?? []).length >= 2).length;
  console.log(`lines_with_2plus_slashes: ${slashLines}`);

  const careerType = extractCareerType(summary.text);
  console.log(`career_type_extracted: ${careerType ? `yes (${careerType})` : "no"}`);
  console.log("ai_calls: 1");
}

main()
  .catch((e) => {
    console.error("dryrun failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
