/**
 * T-205 面談準備チャットの動作確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-dryrun.ts"
 *   ローカルから本番DBを読む場合: npx tsx --env-file=.env scripts/verify/interview-prep-dryrun.ts
 *   （Drive の認証情報と ANTHROPIC_API_KEY が環境に必要）
 *
 * やること:
 *   1. 直近でマイナビレジュメが取り込まれた求職者1名（テスト除外）を選び、文字を取り出す（保存しない）
 *   2. 最初の整理を1回生成し、続けて質問を1回送る（保存しない）
 *   3. 2回目でキャッシュ読みが出ていなければ、同じ質問をもう1回だけ送って確認する（AI 呼び出しは最大3回）
 * 出力は数値と有無だけ（本文・氏名・ファイル名などの個人情報は出さない）。
 */
import { prisma } from "@/lib/prisma";
import { MYNAVI_RESUME_MEMO, extractResumeText } from "@/lib/interview-prep/resume";
import {
  INTERVIEW_PREP_MODEL,
  SUMMARY_MAX_TOKENS,
  CHAT_MAX_TOKENS,
  buildPrepSystem,
  buildSummaryMessages,
  buildChatMessages,
  createPrepStream,
  extractCareerType,
  hasSummaryHeadings,
} from "@/lib/interview-prep/chat";
import { computeCostUsd, extractTokens } from "@/lib/advisor-usage";

const QUESTION = "この人の職種で、新人CAが知っておくべき用語を教えて";
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

async function callPrep(system: ReturnType<typeof buildPrepSystem>, messages: ReturnType<typeof buildChatMessages>, maxTokens: number): Promise<CallResult> {
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
  let calls = 0;

  // 1. 最初の整理
  calls++;
  const summary = await callPrep(system, buildSummaryMessages(), SUMMARY_MAX_TOKENS);
  printCall("call1 summary", summary);
  console.log(`summary_headings_3: ${hasSummaryHeadings(summary.text) ? "yes" : "no"}`);
  console.log(`summary_has_kisai_nashi: ${summary.text.includes("記載なし") ? "yes" : "no"}`);
  const careerType = extractCareerType(summary.text);
  console.log(`career_type_extracted: ${careerType ? `yes (${careerType})` : "no"}`);

  // 2. 質問1往復
  calls++;
  const chat = await callPrep(system, buildChatMessages(summary.text, [], QUESTION), CHAT_MAX_TOKENS);
  printCall("call2 chat", chat);
  console.log(`call2_cache_read: ${chat.cacheRead > 0 ? "yes" : "no"}`);

  // 3. 2回目でキャッシュ読みが無ければ、同じ内容をもう1回だけ送って確認（最大3回）
  if (chat.cacheRead === 0 && calls < 3) {
    calls++;
    const retry = await callPrep(system, buildChatMessages(summary.text, [], QUESTION), CHAT_MAX_TOKENS);
    printCall("call3 chat(retry)", retry);
    console.log(`call3_cache_read: ${retry.cacheRead > 0 ? "yes" : "no"}`);
  }
  console.log(`ai_calls: ${calls}`);
}

main()
  .catch((e) => {
    console.error("dryrun failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
