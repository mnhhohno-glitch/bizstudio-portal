/**
 * T-205 面談準備チャットの動作確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-dryrun.ts [求職者番号]"
 *   求職者番号（candidateNumber）を渡すと、その求職者の最新のマイナビレジュメを使う（step5）。省略時は直近の1名。
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
 * step5: 会社ごとの特定可否・出典URL数・候補数、「就職した会社」に（調べた情報）があるか、経歴の型の値（判定できない含む）、
 *        求職者番号指定時は今の部屋に保存済みの research_json の中身（版・特定可否・候補数・business の有無）も出す。
 *        AI 呼び出しは再試行を含め最大3回（下調べか整理が失敗したら1回だけやり直す）。
 * step6: 下調べは会社用と学校用の2つを同時に呼ぶ。下調べ全体の待ち時間と、部分ごとの所要時間・検索回数・費用・状態を出す。
 *        AI 呼び出しは最大4回（下調べ2＋整理1＋再試行1。失敗した部分か整理のどちらかを1回だけやり直す）。
 * step7: 学校の下調べをやめ、会社用の1回だけ（検索結果だけを返す基本版の検索）。AI 呼び出しは最大3回（下調べ1＋整理1＋再試行1）。
 *        整理に「偏差値」「学校のレベル」の語が無いか、今の状況が「記載なし」でないか、質問アドバイスの個数、
 *        強みに「（本人の自己PRより）」があるかも出す。
 * 出力は数値と有無だけ（本文・氏名・ファイル名などの個人情報は出さない）。
 */
import { prisma } from "@/lib/prisma";
import { MYNAVI_RESUME_MEMO, extractResumeText, findLatestMynaviResume } from "@/lib/interview-prep/resume";
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
import { runResearch, RESEARCH_MODEL, RESEARCH_WEB_SEARCH_TOOL, type ResearchOutcome } from "@/lib/interview-prep/research";
import { normalizeResearch, researchSources } from "@/lib/interview-prep/research-format";
import { WEB_SEARCH_USD_PER_REQUEST } from "@/lib/claude";

const USD_JPY = 150;
const MAX_AI_CALLS = 3;
let aiCalls = 0;

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

  const candidateNumber = process.argv[2];
  let file: Awaited<ReturnType<typeof findLatestMynaviResume>> = null;
  if (candidateNumber) {
    const cand = await prisma.candidate.findUnique({ where: { candidateNumber }, select: { id: true } });
    if (!cand) {
      console.log("candidate: not found");
      return;
    }
    // 今の部屋に保存済みの下調べ（前回の結果）
    const room = await prisma.interviewPrepRoom.findFirst({
      where: { candidateId: cand.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { researchJson: true, researchedAt: true, careerType: true },
    });
    const saved = room ? normalizeResearch(room.researchJson) : null;
    console.log(`saved_room: ${room ? "yes" : "no"} researched=${room?.researchedAt ? "yes" : "no"} career_type=${room?.careerType ?? "null"}`);
    if (saved) {
      console.log(`saved_research: version=${saved.version ?? "none"}`);
      saved.companies.forEach((c, i) =>
        console.log(`saved_company[${i}]: found=${c.found} business=${c.business ? "yes" : "no"} urls=${c.source_urls.length} candidates=${c.candidates.length}`),
      );
    }
    file = await findLatestMynaviResume(cand.id);
  } else file = await prisma.candidateFile.findFirst({
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

  // 下調べ（保存しない・使用量ログも書かない）。失敗したら1回だけやり直す
  const researchCost = (o: ResearchOutcome) =>
    computeCostUsd(RESEARCH_MODEL, extractTokens(o.usage)).costUsd + o.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  const printResearch = (label: string, o: ResearchOutcome) => {
    const t = extractTokens(o.usage);
    const c = researchCost(o);
    console.log(
      `${label}: tool=${RESEARCH_WEB_SEARCH_TOOL} status=${o.status}${o.errorStatus ? ` http=${o.errorStatus}` : ""} searches=${o.webSearchRequests} ` +
        `input=${t.inputTokens} output=${t.outputTokens} cache_read=${t.cacheReadTokens} cost=${c.toFixed(4)} (¥${(c * USD_JPY).toFixed(1)}) latency=${(o.latencyMs / 1000).toFixed(1)}s`,
    );
    if (o.status !== "ok" && o.errorMessage) console.log(`${label}_error: ${o.errorMessage}`);
  };
  let outcome = await runResearch(extracted.text);
  aiCalls++;
  printResearch("research", outcome);
  let researchUsd = researchCost(outcome);
  let researchWaitMs = outcome.latencyMs;
  if (outcome.status !== "ok" && aiCalls < MAX_AI_CALLS) {
    console.log("research_retry: yes");
    outcome = await runResearch(extracted.text);
    aiCalls++;
    printResearch("research_retry", outcome);
    researchUsd += researchCost(outcome);
    researchWaitMs += outcome.latencyMs;
  }
  const rCost = researchUsd;
  console.log(`research_total: cost=${rCost.toFixed(4)} (¥${(rCost * USD_JPY).toFixed(1)}) wait=${(researchWaitMs / 1000).toFixed(1)}s`);
  const research = outcome.research;
  if (research) {
    const found = research.companies.filter((c) => c.found).length;
    console.log(
      `research_companies: ${research.companies.length} (found=${found}) identified=${found > 0 ? "yes" : "no"} version=${research.version ?? "none"} companiesStatus=${research.companiesStatus}`,
    );
    research.companies.forEach((c, i) =>
      console.log(`research_company[${i}]: found=${c.found} urls=${c.source_urls.length} candidates=${c.candidates.length}`),
    );
    const sources = researchSources(research);
    console.log(`research_source_urls: ${sources.reduce((n, s) => n + s.urls.length, 0)} (labels=${sources.length})`);
  }

  const system = buildPrepSystem(extracted.text, research);

  // 最初の整理（失敗・空なら残り回数の範囲で1回だけやり直す）
  let summary: CallResult | null = null;
  while (!summary && aiCalls < MAX_AI_CALLS) {
    aiCalls++;
    try {
      const r = await callPrep(system, buildSummaryMessages(), SUMMARY_MAX_TOKENS);
      if (r.text.trim()) summary = r;
      else console.log("summary_retry: empty");
    } catch (e) {
      console.log(`summary_retry: ${(e as { status?: number })?.status ?? "error"}`);
    }
  }
  if (!summary) {
    console.log(`summary: failed ai_calls=${aiCalls}`);
    return;
  }
  printCall("summary", summary);

  const missing = missingSummaryHeadings(summary.text);
  console.log(`summary_headings_9: ${missing.length === 0 ? "yes" : `no (missing: ${missing.join(", ")})`}`);

  const lines = summary.text.split(/\r?\n/);
  console.log(`research_tagged_lines: ${lines.filter((l) => l.includes("（調べた情報）")).length}`);
  // 「就職した会社」の節（次の見出しまで）に（調べた情報）の文があるか
  const hIdx = lines.findIndex((l) => l.replace(/^#+\s*/, "").trim() === "就職した会社");
  const nIdx = hIdx < 0 ? -1 : lines.findIndex((l, i) => i > hIdx && /^#+\s/.test(l));
  const companySection = hIdx < 0 ? [] : lines.slice(hIdx + 1, nIdx < 0 ? undefined : nIdx);
  console.log(`company_section_research_tagged: ${companySection.some((l) => l.includes("（調べた情報）")) ? "yes" : "no"}`);
  const rawType = summary.text.match(/経歴の型[:：]\s*(一社継続型|同職種転職型|職種転換型|判定できない)/);
  console.log(`career_type_raw: ${rawType ? rawType[1] : "none"}`);
  console.log(`urls_in_body: ${(summary.text.match(/https?:\/\//g) ?? []).length}`);
  console.log(`lines_with_kibou: ${lines.filter((l) => l.includes("希望")).length}`);
  console.log(`question_advice_count: ${lines.filter((l) => /聞き方[:：]/.test(l)).length}`);
  const arrowLines = lines.filter((l) => /^\s*[-*]/.test(l) && l.includes("→")).length;
  console.log(`arrow_meaning_lines: ${arrowLines}`);
  const slashLines = lines.filter((l) => (l.match(/[／/]/g) ?? []).length >= 2).length;
  console.log(`lines_with_2plus_slashes: ${slashLines}`);

  // step7: 学校のレベル・偏差値の語／今の状況／質問アドバイスの個数／自己PRの明記
  console.log(`summary_has_hensachi_or_school_level: ${/偏差値|学校のレベル/.test(summary.text) ? "yes" : "no"}`);
  const statusLine = lines.find((l) => /今の状況/.test(l)) ?? lines.find((l) => /在職中|離職中/.test(l));
  console.log(
    `current_status: ${statusLine ? (statusLine.includes("記載なし") ? "記載なし" : /在職中/.test(statusLine) ? "在職中" : /離職中/.test(statusLine) ? "離職中" : "other") : "none"}`,
  );
  const sIdx = lines.findIndex((l) => l.replace(/^#+s*/, "").trim() === "強み");
  const sEnd = sIdx < 0 ? -1 : lines.findIndex((l, i) => i > sIdx && /^#+s/.test(l));
  const strengths = sIdx < 0 ? [] : lines.slice(sIdx + 1, sEnd < 0 ? undefined : sEnd).filter((l) => /^s*[-*]/.test(l));
  console.log(`strengths: ${strengths.length} self_pr_marked=${strengths.filter((l) => l.includes("（本人の自己PRより）")).length}`);

  const careerType = extractCareerType(summary.text);
  console.log(`career_type_extracted: ${careerType ? `yes (${careerType})` : "no"}`);
  const totalUsd = rCost + summary.costUsd;
  console.log(
    `total: cost=${totalUsd.toFixed(4)} (¥${(totalUsd * USD_JPY).toFixed(1)}) latency=${((researchWaitMs + summary.ms) / 1000).toFixed(1)}s`,
  );
  console.log(`ai_calls: ${aiCalls}`);
}

main()
  .catch((e) => {
    console.error("dryrun failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
