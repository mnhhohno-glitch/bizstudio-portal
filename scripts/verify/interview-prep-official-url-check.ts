/**
 * T-205 step10 公式サイトの URL（officialUrl）の確認（本番環境で実行・DB への書き込みなし）。
 *
 * 実行（railway run は使わない。コンテナに入って実行する）:
 *   railway ssh --service bizstudio-portal "cd /app && npx tsx scripts/verify/interview-prep-official-url-check.ts 求職者番号"
 *
 * やること: 求職者の「面談」フォルダの最新 PDFで下調べを1回行う（保存しない・使用量ログも書かない）。失敗したら1回だけやり直す。
 * AI 呼び出しは最大2回。出力は有無と数値だけ（URL・会社名・本文は出さない）。
 */
import { prisma } from "@/lib/prisma";
import { extractResumeText, findLatestMeetingPdf } from "@/lib/interview-prep/resume";
import { computeCostUsd, extractTokens } from "@/lib/advisor-usage";
import { runResearch, RESEARCH_MODEL, type ResearchOutcome } from "@/lib/interview-prep/research";
import { RESEARCH_VERSION } from "@/lib/interview-prep/research-format";
import { WEB_SEARCH_USD_PER_REQUEST } from "@/lib/claude";

const USD_JPY = 150;
const MAX_AI_CALLS = 2;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const candidateNumber = process.argv[2];
  if (!candidateNumber) throw new Error("求職者番号を渡してください");

  const cand = await prisma.candidate.findUnique({ where: { candidateNumber }, select: { id: true } });
  if (!cand) {
    console.log("candidate: not found");
    return;
  }
  const file = await findLatestMeetingPdf(cand.id);
  if (!file) {
    console.log("resume_file: none");
    return;
  }
  const extracted = await extractResumeText(file);
  if (!extracted.ok) {
    console.log(`resume_text: failed (${extracted.reason}, chars=${extracted.chars})`);
    return;
  }
  console.log(`resume_text: ok chars=${extracted.chars}`);

  const cost = (o: ResearchOutcome) =>
    computeCostUsd(RESEARCH_MODEL, extractTokens(o.usage)).costUsd + o.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  let totalUsd = 0;
  let totalMs = 0;
  let outcome: ResearchOutcome | null = null;
  for (let call = 1; call <= MAX_AI_CALLS; call++) {
    outcome = await runResearch(extracted.text);
    totalUsd += cost(outcome);
    totalMs += outcome.latencyMs;
    console.log(
      `research[${call}]: status=${outcome.status}${outcome.errorStatus ? ` http=${outcome.errorStatus}` : ""} searches=${outcome.webSearchRequests} ` +
        `search_result_urls=${outcome.searchResultUrlCount} cost=${cost(outcome).toFixed(4)} (¥${(cost(outcome) * USD_JPY).toFixed(1)}) latency=${(outcome.latencyMs / 1000).toFixed(1)}s`,
    );
    if (outcome.status === "ok") break;
  }
  if (!outcome) return;
  console.log(`research_total: cost=${totalUsd.toFixed(4)} (¥${(totalUsd * USD_JPY).toFixed(1)}) wait=${(totalMs / 1000).toFixed(1)}s`);

  const r = outcome.research;
  const found = r.companies.filter((c) => c.found).length;
  console.log(`research: version=${r.version} (expected ${RESEARCH_VERSION}) companiesStatus=${r.companiesStatus} companies=${r.companies.length} found=${found}`);
  r.companies.forEach((c, i) =>
    console.log(`company[${i}]: found=${c.found} official_url=${c.officialUrl ? "yes" : "no"} source_urls=${c.source_urls.length}`),
  );
  console.log(
    `official_url: proposed_by_ai=${outcome.officialUrlProposed} kept(matched search results)=${outcome.officialUrlKept} dropped(not in search results)=${outcome.officialUrlProposed - outcome.officialUrlKept}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

export {};
