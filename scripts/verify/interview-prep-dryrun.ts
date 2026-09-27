/**
 * T-205 面談準備チャットの動作確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-dryrun.ts"
 *   ローカルから本番DBを読む場合: npx tsx --env-file=.env scripts/verify/interview-prep-dryrun.ts
 *   （Drive の認証情報と ANTHROPIC_API_KEY が環境に必要）
 *
 * やること（T-205 step4 で下調べを追加。質問の往復は行わない）:
 *   1. 直近でマイナビレジュメが取り込まれた求職者1名（テスト除外）を選び、文字を取り出す（保存しない）
 *   2. 下調べ（会社と学校のウェブ検索）を1回行う（保存しない・使用量ログも書かない）
 *   3. 最初の整理を1回だけ生成する（保存しない）。AI 呼び出しは合計2回
 *   4. 下調べ: 状態・検索回数・会社数/特定できた数・学校のレベルの有無・出典URL数・トークン/費用/所要時間
 *      整理: 見出し9つ・（調べた情報）の付いた行数・本文中のURL数・「希望」を含む行数・「聞き方:」の数・
 *            「→」で意味を添えた行数・斜線を2つ以上含む行数・経歴の型の取り出し
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
import { runResearch, RESEARCH_MODEL } from "@/lib/interview-prep/research";
import { researchSources } from "@/lib/interview-prep/research-format";
import { WEB_SEARCH_USD_PER_REQUEST } from "@/lib/claude";

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

  // 下調べ（1回だけ・保存しない・使用量ログも書かない）
  const outcome = await runResearch(extracted.text);
  const rTokens = extractTokens(outcome.usage);
  const rCost =
    computeCostUsd(RESEARCH_MODEL, rTokens).costUsd + outcome.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  console.log(
    `call1 research: status=${outcome.status}${outcome.errorStatus ? ` http=${outcome.errorStatus}` : ""} searches=${outcome.webSearchRequests} ` +
      `input=${rTokens.inputTokens} output=${rTokens.outputTokens} cache_read=${rTokens.cacheReadTokens} cache_write=${rTokens.cacheCreationTokens} ` +
      `cost=$${rCost.toFixed(4)} (¥${(rCost * USD_JPY).toFixed(1)}) latency=${(outcome.latencyMs / 1000).toFixed(1)}s`,
  );
  if (outcome.status !== "ok" && outcome.errorMessage) console.log(`research_error: ${outcome.errorMessage}`);
  const research = outcome.research;
  if (research) {
    const found = research.companies.filter((c) => c.found).length;
    console.log(`research_companies: ${research.companies.length} (found=${found})`);
    console.log(
      `research_school: ${research.school ? `yes level=${research.school.level} hensachi=${research.school.hensachi ? "yes" : "no"}` : "null"}`,
    );
    const sources = researchSources(research);
    console.log(`research_source_urls: ${sources.reduce((n, s) => n + s.urls.length, 0)} (labels=${sources.length})`);
  }

  const system = buildPrepSystem(extracted.text, research);

  // 最初の整理（1回だけ）
  const summary = await callPrep(system, buildSummaryMessages(), SUMMARY_MAX_TOKENS);
  printCall("call2 summary", summary);

  const missing = missingSummaryHeadings(summary.text);
  console.log(`summary_headings_9: ${missing.length === 0 ? "yes" : `no (missing: ${missing.join(", ")})`}`);

  const lines = summary.text.split(/\r?\n/);
  console.log(`research_tagged_lines: ${lines.filter((l) => l.includes("（調べた情報）")).length}`);
  console.log(`urls_in_body: ${(summary.text.match(/https?:\/\//g) ?? []).length}`);
  console.log(`lines_with_kibou: ${lines.filter((l) => l.includes("希望")).length}`);
  console.log(`question_advice_count: ${lines.filter((l) => /聞き方[:：]/.test(l)).length}`);
  const arrowLines = lines.filter((l) => /^\s*[-*]/.test(l) && l.includes("→")).length;
  console.log(`arrow_meaning_lines: ${arrowLines}`);
  const slashLines = lines.filter((l) => (l.match(/[／/]/g) ?? []).length >= 2).length;
  console.log(`lines_with_2plus_slashes: ${slashLines}`);

  const careerType = extractCareerType(summary.text);
  console.log(`career_type_extracted: ${careerType ? `yes (${careerType})` : "no"}`);
  console.log("ai_calls: 2");
}

main()
  .catch((e) => {
    console.error("dryrun failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
