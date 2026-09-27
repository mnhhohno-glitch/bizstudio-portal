/**
 * T-205 面談準備チャットの動作確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-dryrun.ts [求職者番号]"
 *   求職者番号（candidateNumber）を渡すと、その求職者の最新のマイナビレジュメを使う（step5）。省略時は直近の1名。
 *   ローカルから本番DBを読む場合: npx tsx --env-file=.env scripts/verify/interview-prep-dryrun.ts
 *   （Drive の認証情報と ANTHROPIC_API_KEY が環境に必要）
 *
 * やること（質問の往復は行わない）:
 *   1. 求職者の最新のマイナビレジュメの文字を取り出す（保存しない）
 *   2. 下調べ（会社のウェブ検索）を1回行う（保存しない・使用量ログも書かない）。失敗したら1回だけやり直す
 *   3. 最初の整理を1回生成する（保存しない）。step8: ツール save_prep_summary の入力で受け取り、検証に通らなければ1回だけ作り直す
 *   4. 出力: 下調べの状態・検索回数・会社数/特定できた数・出典URL数・トークン/費用/所要時間
 *      整理: 検証に通ったか（1回目／作り直し）、timeline・works・questions・strengths・glossary の件数、
 *            questions の1件目が mismatch か、fromSelfPr が true の強みの数、fromResearch が true の行の数、
 *            employmentStatus・careerType、文章化した文字数と2回実行で同じか、所要時間・費用
 *   AI 呼び出しは最大3回（下調べ1＋整理1＋作り直し1）。
 * 出力は数値と有無だけ（本文・氏名・会社名・ファイル名などの個人情報は出さない）。
 */
import { prisma } from "@/lib/prisma";
import { MYNAVI_RESUME_MEMO, extractResumeText, findLatestMynaviResume } from "@/lib/interview-prep/resume";
import { INTERVIEW_PREP_MODEL, buildPrepSystem, buildSummaryMessages, callSummaryTool } from "@/lib/interview-prep/chat";
import { computeCostUsd, extractTokens } from "@/lib/advisor-usage";
import { runResearch, RESEARCH_MODEL, RESEARCH_WEB_SEARCH_TOOL, type ResearchOutcome } from "@/lib/interview-prep/research";
import { normalizeResearch, researchSources } from "@/lib/interview-prep/research-format";
import { careerTypeForRoom, formatPrepSummaryText, normalizePrepSummary, type PrepSummary } from "@/lib/interview-prep/summary-format";
import { WEB_SEARCH_USD_PER_REQUEST } from "@/lib/claude";

const USD_JPY = 150;
const MAX_AI_CALLS = 3;
let aiCalls = 0;

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
    const room = await prisma.interviewPrepRoom.findFirst({
      where: { candidateId: cand.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { researchJson: true, researchedAt: true, careerType: true, summaryJson: true, askedQuestions: true },
    });
    const saved = room ? normalizeResearch(room.researchJson) : null;
    const savedSummary = room ? normalizePrepSummary(room.summaryJson) : null;
    console.log(
      `saved_room: ${room ? "yes" : "no"} researched=${room?.researchedAt ? "yes" : "no"} career_type=${room?.careerType ?? "null"} summary_json=${room?.summaryJson ? (savedSummary ? "valid" : "invalid") : "none"} asked_questions=${room?.askedQuestions ? "yes" : "none"}`,
    );
    if (saved) {
      console.log(`saved_research: version=${saved.version ?? "none"}`);
      saved.companies.forEach((c, i) =>
        console.log(`saved_company[${i}]: found=${c.found} business=${c.business ? "yes" : "no"} urls=${c.source_urls.length} candidates=${c.candidates.length}`),
      );
    }
    file = await findLatestMynaviResume(cand.id);
  } else
    file = await prisma.candidateFile.findFirst({
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
  if (outcome.status !== "ok" && aiCalls < MAX_AI_CALLS - 1) {
    console.log("research_retry: yes");
    outcome = await runResearch(extracted.text);
    aiCalls++;
    printResearch("research_retry", outcome);
    researchUsd += researchCost(outcome);
    researchWaitMs += outcome.latencyMs;
  }
  console.log(`research_total: cost=${researchUsd.toFixed(4)} (¥${(researchUsd * USD_JPY).toFixed(1)}) wait=${(researchWaitMs / 1000).toFixed(1)}s`);
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
  const messages = buildSummaryMessages();

  // 最初の整理（ツール呼び出し）。検証に通らなければ残り回数の範囲で1回だけ作り直す
  let summary: PrepSummary | null = null;
  let summaryUsd = 0;
  let summaryMs = 0;
  let attempts = 0;
  let validOn: "first" | "retry" | "never" = "never";
  while (!summary && aiCalls < MAX_AI_CALLS) {
    aiCalls++;
    attempts++;
    const t0 = Date.now();
    try {
      const r = await callSummaryTool({ system, messages });
      const ms = Date.now() - t0;
      summaryMs += ms;
      const tokens = extractTokens(r.usage);
      const { costUsd } = computeCostUsd(INTERVIEW_PREP_MODEL, tokens);
      summaryUsd += costUsd;
      console.log(
        `summary_call[${attempts}]: valid=${r.summary ? "yes" : `no(${r.invalidReason})`} stop=${r.stopReason} input=${tokens.inputTokens} output=${tokens.outputTokens} ` +
          `cache_read=${tokens.cacheReadTokens} cache_write=${tokens.cacheCreationTokens} cost=$${costUsd.toFixed(4)} (¥${(costUsd * USD_JPY).toFixed(1)}) latency=${(ms / 1000).toFixed(1)}s`,
      );
      if (r.summary) {
        summary = r.summary;
        validOn = attempts === 1 ? "first" : "retry";
      }
    } catch (e) {
      summaryMs += Date.now() - t0;
      console.log(`summary_call[${attempts}]: error ${(e as { status?: number })?.status ?? ""} ${e instanceof Error ? e.message.slice(0, 200) : ""}`);
    }
  }
  console.log(`summary_valid: ${validOn === "first" ? "通った" : validOn === "retry" ? "作り直しで通った" : "通らない"}`);
  if (!summary) {
    console.log(`summary: failed ai_calls=${aiCalls}`);
    return;
  }

  console.log(
    `summary_counts: timeline=${summary.timeline.length} works=${summary.works.length} work_items=${summary.works.reduce((n, w) => n + w.items.length, 0)} questions=${summary.questions.length} strengths=${summary.strengths.length} glossary=${summary.glossary.length} qualifications=${summary.qualifications.length}`,
  );
  console.log(`first_question_mismatch: ${summary.questions[0]?.mismatch ? "yes" : "no"} (mismatch_total=${summary.questions.filter((q) => q.mismatch).length})`);
  console.log(`strengths_from_self_pr: ${summary.strengths.filter((s) => s.fromSelfPr).length}`);
  console.log(`timeline_from_research: ${summary.timeline.filter((t) => t.fromResearch).length}`);
  console.log(`employment_status: ${summary.employmentStatus} age=${summary.age ? "yes" : "no"} income=${summary.currentIncome ? "yes" : "no"}`);
  console.log(`career_type: ${summary.careerType} (room=${careerTypeForRoom(summary) ?? "null"}) reason=${summary.careerTypeReason ? "yes" : "no"}`);
  console.log(`summary_has_kibou: ${/希望/.test(JSON.stringify(summary)) ? "yes" : "no"}`);
  console.log(`summary_has_url: ${/https?:\/\//.test(JSON.stringify(summary)) ? "yes" : "no"}`);
  const text1 = formatPrepSummaryText(summary);
  const text2 = formatPrepSummaryText(summary);
  console.log(`formatted_text: chars=${text1.length} deterministic=${text1 === text2 ? "yes" : "no"}`);

  const totalUsd = researchUsd + summaryUsd;
  console.log(
    `total: cost=${totalUsd.toFixed(4)} (¥${(totalUsd * USD_JPY).toFixed(1)}) latency=${((researchWaitMs + summaryMs) / 1000).toFixed(1)}s (research ${(researchWaitMs / 1000).toFixed(1)}s + summary ${(summaryMs / 1000).toFixed(1)}s)`,
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
