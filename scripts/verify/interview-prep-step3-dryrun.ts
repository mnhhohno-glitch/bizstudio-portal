/**
 * T-208 step3 の確認: 面談準備の質問の会社ごとの振り分け（付録H）・チャットの「よく使う質問」（付録G）・台本の答えの添付。
 *
 * AI を呼ばない確認だけ（DB も使わない・ローカルで実行）:
 *   npx tsx scripts/verify/interview-prep-step3-dryrun.ts --no-ai
 *
 * staging のコンテナで AI を呼ぶ確認（保存はしない・使用量ログも書かない）:
 *   railway ssh --service bizstudio-portal-staging "cd /app && npx tsx scripts/verify/interview-prep-step3-dryrun.ts 5008627"
 *   求職者番号（candidateNumber）の「面談」フォルダの最新 PDF を材料にする。
 *   AI 呼び出しは最大4回（下調べ1・整理1・チャット1・再試行1）。
 *   出力は数値と OK/NG だけ（本文・氏名・会社名・ファイル名は出さない）。
 *
 * AI なしの確認:
 *   1. 会社名のそろえ方（株式会社・（株）・空白・全角半角）
 *   2. company が works に無い／無い（古い整理）→「全体」。一致すれば works の書き方に置き換わる
 *   3. 文章化（formatPrepSummaryText）は「全体」に何も付けず、会社ありは会社名を添える。決定的
 *   4. 台本: 会社ごとの場面 s5-wh-prep-questions はその会社の質問があるときだけ出る（食い違いを先に）。
 *      当たらない質問と「全体」は最後の「面談準備の質問（全体）」にまとまる。場面の位置は退職理由の前
 *   5. 【台本で分かったこと】の書式（1行「場面名: 値」・答えのある項目だけ・会社名の差し込み）と、
 *      今回の質問の先頭にだけ付くこと／保存する CA の発言（元の文）に添えた部分が入らないこと
 *   6. よく使う質問のボタン定義（5つ・fill は〔　〕が1つ・send は2つ）
 * AI ありの確認:
 *   7. 整理: questions の全件に company があり、works の会社名か「全体」になっているか。会社ごとの件数
 *   8. チャット: 見本の台本の答えを添えて［別の職種を提案］を1回送り、答えに提案が3つあるか（件数だけ）
 */
import {
  PREP_QUESTION_ALL,
  companyMatches,
  formatPrepSummaryText,
  normalizeCompanyKey,
  normalizePrepSummary,
  questionsForCompany,
  questionsUnassigned,
  type PrepSummary,
} from "@/lib/interview-prep/summary-format";
import { QUICK_QUESTIONS, QUICK_QUESTION_BLANK, blankRangeOf } from "@/lib/interview-prep/quick-questions";
import { SCRIPT_FACTS_HEADER, formatScriptFacts, scriptFactLines, withScriptFacts } from "@/lib/interview-script/facts";
import { buildContext, expandScenes, prepQuestionsForScene } from "@/lib/interview-script/runtime";
import type { AnswerMap } from "@/lib/interview-script/types";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "OK" : "NG"}: ${label}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed++;
}

/* ================= AI を呼ばない確認 ================= */

function checksWithoutAi() {
  // 1. 会社名のそろえ方
  check("normalize: 株式会社・空白・全角半角をそろえる", normalizeCompanyKey("株式会社ＡＢＣ 商事") === normalizeCompanyKey("ABC商事"));
  check("normalize: （株）・(株)・㈱ を取る", companyMatches("（株）abc商事", "ABC商事") && companyMatches("(株)ABC商事", "㈱ABC商事"));
  check("normalize: 後ろの株式会社も取る", companyMatches("ABC商事株式会社", "株式会社ABC商事"));
  check("normalize: 違う会社は一致しない", !companyMatches("ABC商事", "XYZ商事") && !companyMatches("", ""));

  // 2. 検証: company を works にそろえる／無ければ「全体」
  const base = {
    summary: "架空の人。",
    employmentStatus: "在職中",
    age: "",
    currentIncome: "",
    qualifications: [],
    careerType: "同職種転職型",
    careerTypeReason: "2社",
    timeline: [],
    works: [
      { company: "株式会社架空商事", items: [] },
      { company: "架空システム株式会社", items: [] },
    ],
    strengths: [],
    glossary: [],
  };
  const s = normalizePrepSummary({
    ...base,
    questions: [
      { question: "q1", why: "", reveals: "", mismatch: false, company: "架空商事" },
      { question: "q2", why: "", reveals: "", mismatch: true, company: "（株）架空商事" },
      { question: "q3", why: "", reveals: "", mismatch: false, company: "全体" },
      { question: "q4", why: "", reveals: "", mismatch: false, company: "知らない会社" },
      { question: "q5", why: "", reveals: "", mismatch: false, company: "架空システム" },
      { question: "q6", why: "", reveals: "", mismatch: false, company: "" },
    ],
  });
  check("normalize summary: company あり", !!s);
  if (s) {
    check("company: 表記ゆれは works の書き方に置き換わる", s.questions[0].company === "株式会社架空商事" && s.questions[1].company === "株式会社架空商事" && s.questions[4].company === "架空システム株式会社");
    check("company: 全体・不一致・空は「全体」", s.questions[2].company === PREP_QUESTION_ALL && s.questions[3].company === PREP_QUESTION_ALL && s.questions[5].company === PREP_QUESTION_ALL);
    check("company: 会社ごとの取り出し（食い違いが先・添字つき）", JSON.stringify(questionsForCompany(s.questions, "架空商事").map((h) => h.index)) === "[1,0]");
    check("company: 当たらない質問と全体は最後にまとまる（元の順）", JSON.stringify(questionsUnassigned(s.questions, ["株式会社架空商事", "架空システム株式会社"]).map((h) => h.index)) === "[2,3,5]");
    // 3. 文章化
    const t1 = formatPrepSummaryText(s);
    const t2 = formatPrepSummaryText(s);
    check("format: 決定的", t1 === t2);
    check("format: 会社ありは会社名を添え、全体は何も付けない", t1.includes("1. q1［株式会社架空商事］") && t1.includes("3. q3\n") && !t1.includes("［全体］"));
  }
  const old = normalizePrepSummary({
    ...base,
    questions: [
      { question: "q1", why: "", reveals: "", mismatch: false },
      { question: "q2", why: "", reveals: "", mismatch: true },
    ],
  });
  check("old summary（company なし）: 検証に通り、すべて「全体」", !!old && old.questions.every((q) => q.company === PREP_QUESTION_ALL));
  if (old) {
    const oldText = formatPrepSummaryText(old);
    check("old summary: 文章に会社名の飾りが入らない（byte 不変）", !oldText.includes("］") && oldText.includes("1. q1\n"));
  }

  // 4. 台本への差し込み先
  const mkCtx = (prepSummary: PrepSummary | null) =>
    buildContext({
      candidateName: "架空 太郎",
      candidateEmail: "k@example.com",
      caName: "大野 将幸",
      caFamilyName: "大野",
      startTime: "10:00",
      tool: "電話",
      detail: { employmentStatus: "在職中" },
      workHistories: [
        { order: 1, companyName: "架空商事（株）", jobTypeFlag: "営業", jobTypeMemo: null, hireDate: "2015年4月" },
        { order: 2, companyName: "架空システム株式会社", jobTypeFlag: "SE", jobTypeMemo: null, hireDate: "2020年4月" },
      ],
      prepSummary,
      askedQuestions: { "0": { askedAt: "2026-09-30T00:00:00Z", userId: "u" } },
      today: new Date("2026-09-30T00:00:00+09:00"),
    });
  if (s) {
    const ctx = mkCtx(s);
    const scenes = expandScenes(ctx, {});
    const ids = scenes.map((x) => x.key);
    const c0 = ids.indexOf("s5-wh-prep-questions#0");
    const r0 = ids.indexOf("s5-wh-reason#0");
    const w0 = ids.indexOf("s5-wh-work#0");
    check("script: 1社目（質問あり）に会社ごとの場面が出る", c0 >= 0);
    check("script: 場面の位置は「仕事の中身」の後・「退職理由」の前", w0 >= 0 && r0 >= 0 && w0 < c0 && c0 < r0);
    check("script: 2社目（質問あり・架空システム）にも出る", ids.includes("s5-wh-prep-questions#1"));
    const all = ids.indexOf("s5-prep-questions");
    check("script: 全体の場面は経歴確認の最後に残る", all >= 0 && all > ids.indexOf("s5-wh-reason#1"));
    const q0 = prepQuestionsForScene(ctx, scenes[c0]);
    check("script: 1社目の質問は食い違いが先・Q番号は整理の番号・聞いた済みを引き継ぐ", JSON.stringify(q0.map((q) => q.index)) === "[1,0]" && q0[1].asked === true && q0[0].asked === false);
    const qAll = prepQuestionsForScene(ctx, scenes[all]);
    check("script: 全体の場面には当たらない質問と全体だけ", JSON.stringify(qAll.map((q) => q.index)) === "[2,3,5]");
    check("script: 会社ごとの場面に全体の質問は出ない", !q0.some((q) => q.company === PREP_QUESTION_ALL));
  }
  if (old) {
    const ctx = mkCtx(old);
    const scenes = expandScenes(ctx, {});
    check("script: 古い整理（全部「全体」）では会社ごとの場面が出ず、全体に全件", !scenes.some((x) => x.scene.id === "s5-wh-prep-questions") && prepQuestionsForScene(ctx, scenes.find((x) => x.key === "s5-prep-questions")!).length === 2);
    check("script: 整理なしでは会社ごとの場面が出ない", !expandScenes(mkCtx(null), {}).some((x) => x.scene.id === "s5-wh-prep-questions"));
  }

  // 5. 【台本で分かったこと】
  const answers: AnswerMap = {
    "s4-employment": { choices: { status: "在職中" }, at: "2026-09-30T01:00:00Z" },
    "s4-timeline": { choices: { timeline: "3カ月以内" }, inputs: { month: "12月まで" } },
    "s5-wh-reason#0": { choices: { reason: "人間関係", small: "上司・同僚との人間関係" }, inputs: { detail: "上司と合わなかった" } },
    "s6-salary-current": { inputs: { annual: "400" }, choices: {} },
    "s6-job": { choices: {}, inputs: {} },
    __meta: { currentKey: "s6-job" } as unknown as AnswerMap[string],
  };
  const lines = scriptFactLines(answers, ["架空商事（株）", "架空システム株式会社"]);
  check("facts: 答えのある項目だけ（4行）", lines.length === 4, `lines=${lines.length}`);
  check("facts: 1行は「場面名: 値」", lines.every((l) => /^[^:\n]+: .+$/.test(l)));
  check("facts: 台本の順（在職→転職時期→退職理由→年収）", lines[0].startsWith("前置きと在職の確認: 在職中") && lines[1].startsWith("転職時期: 3カ月以内") && lines[2].startsWith("職歴：退職理由（架空商事（株））: ") && lines[3].startsWith("年収：現年収: "));
  check("facts: 入力は「ラベル: 値」・単位つき", lines[1].includes("希望の月（あれば）: 12月まで") && lines[3].includes("現年収: 400万円"));
  check("facts: 小分類（showIf）も入る", lines[2].includes("小分類（候補から1つ選ぶ）: 上司・同僚との人間関係") && lines[2].includes("退職理由の詳細（本人の言葉）: 上司と合わなかった"));
  const facts = formatScriptFacts(answers, []);
  check("facts: 見出しから始まり、会社名が無ければ「N社目」", facts.startsWith(`${SCRIPT_FACTS_HEADER}\n`) && facts.includes("（1社目）"));
  check("facts: 答えが無ければ空文字", formatScriptFacts({}, []) === "" && formatScriptFacts({ "s6-job": { choices: {} } }, []) === "" && formatScriptFacts(null, []) === "");
  const question = "この人の経験を生かせる、別の職種・業種を3つ、理由と注意点付きで提案して";
  const sent = withScriptFacts(question, facts);
  check("chat: 送る文は先頭に【台本で分かったこと】、末尾に今回の質問", sent.startsWith(SCRIPT_FACTS_HEADER) && sent.endsWith(`\n\n${question}`) && sent.indexOf(SCRIPT_FACTS_HEADER) === 0 && sent.split(SCRIPT_FACTS_HEADER).length === 2);
  check("chat: 台本の答えが無ければ質問そのまま", withScriptFacts(question, "") === question);
  check("chat: 保存する CA の発言（元の文）に添えた部分が入らない", !question.includes(SCRIPT_FACTS_HEADER) && question !== sent);
  check("facts: 決定的", formatScriptFacts(answers, ["A"]) === formatScriptFacts(answers, ["A"]));

  // 6. よく使う質問のボタン
  check("quick: 5つ", QUICK_QUESTIONS.length === 5);
  const fills = QUICK_QUESTIONS.filter((q) => q.kind === "fill");
  const sends = QUICK_QUESTIONS.filter((q) => q.kind === "send");
  check("quick: fill 3つは〔　〕が1つだけ", fills.length === 3 && fills.every((q) => q.text.split(QUICK_QUESTION_BLANK).length === 2 && blankRangeOf(q.text)?.start === 0));
  check("quick: send 2つは〔　〕なし", sends.length === 2 && sends.every((q) => !q.text.includes(QUICK_QUESTION_BLANK)));
  check("quick: ［別の職種を提案］の文", sends[0].text === question);
}

/* ================= AI を呼ぶ確認（staging） ================= */

const USD_JPY = 150;
const MAX_AI_CALLS = 4;

/** 答えの中の提案の数（番号つき項目・見出しを数える。大きい方） */
function countProposals(text: string): { numbered: number; headings: number } {
  const lines = text.split("\n");
  const numbered = lines.filter((l) => /^\s*\d+[.．)）、]\s*\S/.test(l)).length;
  const headings = lines.filter((l) => /^#{1,4}\s+\S/.test(l) || /^\s*\*\*[^*]+\*\*\s*$/.test(l)).length;
  return { numbered, headings };
}

async function checksWithAi(candidateNumber: string) {
  const { prisma } = await import("@/lib/prisma");
  const { extractResumeText, findLatestMeetingPdf } = await import("@/lib/interview-prep/resume");
  const { INTERVIEW_PREP_MODEL, CHAT_MAX_TOKENS, buildPrepSystem, buildSummaryMessages, buildChatMessages, callSummaryTool, createPrepStream } =
    await import("@/lib/interview-prep/chat");
  const { computeCostUsd, extractTokens } = await import("@/lib/advisor-usage");
  const { runResearch, RESEARCH_MODEL } = await import("@/lib/interview-prep/research");
  const { WEB_SEARCH_USD_PER_REQUEST } = await import("@/lib/claude");

  let aiCalls = 0;
  let totalUsd = 0;
  let totalMs = 0;
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が未設定です");
    const cand = await prisma.candidate.findUnique({ where: { candidateNumber }, select: { id: true } });
    if (!cand) {
      console.log("candidate: not found");
      failed++;
      return;
    }
    const file = await findLatestMeetingPdf(cand.id);
    if (!file) {
      console.log("resume_file: none");
      failed++;
      return;
    }
    const extracted = await extractResumeText(file);
    if (!extracted.ok) {
      console.log(`resume_text: failed (${extracted.reason}, chars=${extracted.chars})`);
      failed++;
      return;
    }
    console.log(`resume_text: ok chars=${extracted.chars}`);

    // 下調べ 1回（失敗しても止めない）
    aiCalls++;
    const outcome = await runResearch(extracted.text);
    const rt = extractTokens(outcome.usage);
    const researchUsd = computeCostUsd(RESEARCH_MODEL, rt).costUsd + outcome.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
    totalUsd += researchUsd;
    totalMs += outcome.latencyMs;
    console.log(
      `research: status=${outcome.status} searches=${outcome.webSearchRequests} companies=${outcome.research?.companies.length ?? 0} found=${outcome.research?.companies.filter((c) => c.found).length ?? 0} cost=¥${(researchUsd * USD_JPY).toFixed(1)} latency=${(outcome.latencyMs / 1000).toFixed(1)}s`,
    );
    const research = outcome.research;

    // 整理（検証に通らなければ1回だけ作り直し）
    const system = buildPrepSystem(extracted.text, research);
    let summary: PrepSummary | null = null;
    let attempts = 0;
    while (!summary && attempts < 2 && aiCalls < MAX_AI_CALLS - 1) {
      aiCalls++;
      attempts++;
      const t0 = Date.now();
      const r = await callSummaryTool({ system, messages: buildSummaryMessages() });
      const ms = Date.now() - t0;
      const tk = extractTokens(r.usage);
      const usd = computeCostUsd(INTERVIEW_PREP_MODEL, tk).costUsd;
      totalUsd += usd;
      totalMs += ms;
      console.log(
        `summary_call[${attempts}]: valid=${r.summary ? "yes" : `no(${r.invalidReason})`} stop=${r.stopReason} input=${tk.inputTokens} output=${tk.outputTokens} cache_read=${tk.cacheReadTokens} cache_write=${tk.cacheCreationTokens} cost=¥${(usd * USD_JPY).toFixed(1)} latency=${(ms / 1000).toFixed(1)}s`,
      );
      summary = r.summary;
    }
    if (!summary) {
      console.log("summary: failed");
      failed++;
      return;
    }
    // 7. questions の company
    const workNames = summary.works.map((w) => w.company);
    const qs = summary.questions;
    const allHave = qs.every((q) => typeof q.company === "string" && q.company.length > 0);
    const allValid = qs.every((q) => q.company === PREP_QUESTION_ALL || workNames.includes(q.company));
    const perWork = workNames.map((name, i) => `works[${i}]=${qs.filter((q) => q.company === name).length}`);
    const allCount = qs.filter((q) => q.company === PREP_QUESTION_ALL).length;
    console.log(`questions: total=${qs.length} works=${workNames.length} mismatch_first=${qs[0]?.mismatch ? "yes" : "no"}`);
    console.log(`question_company_counts: 全体=${allCount} ${perWork.join(" ")}`);
    check("ai summary: questions 全件に company がある", allHave);
    check("ai summary: company は works の会社名か「全体」", allValid);
    check("ai summary: 会社ごとに振り分けられた質問が1つ以上ある", qs.some((q) => q.company !== PREP_QUESTION_ALL), "（レジュメの会社が特定できないと全体のみになることがある）");

    // 8. チャット: 見本の台本の答えを添えて［別の職種を提案］
    const sampleAnswers: AnswerMap = {
      "s4-employment": { choices: { status: "在職中" } },
      "s4-timeline": { choices: { timeline: "3カ月以内" } },
      "s6-salary-current": { inputs: { annual: "350" } },
    };
    const facts = formatScriptFacts(sampleAnswers, workNames);
    const question = QUICK_QUESTIONS.find((q) => q.key === "alt-jobs")!.text;
    const sent = withScriptFacts(question, facts);
    console.log(`chat_facts: lines=${facts.split("\n").length - 1} sent_chars=${sent.length} saved_chars=${question.length}`);
    const messages = buildChatMessages(formatPrepSummaryText(summary), [], sent);
    aiCalls++;
    const t0 = Date.now();
    const stream = createPrepStream({ system, messages, maxTokens: CHAT_MAX_TOKENS });
    let text = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text;
    }
    const final = await stream.finalMessage();
    const ms = Date.now() - t0;
    const tk = extractTokens(final.usage);
    const usd = computeCostUsd(INTERVIEW_PREP_MODEL, tk).costUsd;
    totalUsd += usd;
    totalMs += ms;
    const n = countProposals(text);
    console.log(
      `chat: stop=${final.stop_reason} chars=${text.length} input=${tk.inputTokens} output=${tk.outputTokens} cache_read=${tk.cacheReadTokens} cache_write=${tk.cacheCreationTokens} cost=¥${(usd * USD_JPY).toFixed(1)} latency=${(ms / 1000).toFixed(1)}s`,
    );
    console.log(`chat_proposals: numbered=${n.numbered} headings=${n.headings}`);
    check("ai chat: 提案が3つ", Math.max(n.numbered, n.headings) >= 3);
    check("ai chat: 注意点に触れている", /注意/.test(text));
  } finally {
    console.log(`total: cost=¥${(totalUsd * USD_JPY).toFixed(1)} latency=${(totalMs / 1000).toFixed(1)}s ai_calls=${aiCalls}`);
    await prisma.$disconnect();
  }
}

async function main() {
  const arg = process.argv[2];
  checksWithoutAi();
  if (arg && arg !== "--no-ai") {
    console.log("---- AI ----");
    await checksWithAi(arg);
  }
  console.log(failed === 0 ? "ALL OK" : `FAILED: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
