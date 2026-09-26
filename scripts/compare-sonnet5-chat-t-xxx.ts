/**
 * T-XXX step9 第1部 1-3: Sonnet 4.6 と Sonnet 5 の読み比べ（切り替え前）。
 *
 * 直近30日の実際のチャット（AIアドバイザー）の質問8件＋挨拶文2件を、その時と同じ入力で
 * Sonnet 4.6（従来の送り方）と Sonnet 5（chatRequestParams の送り方）に答えさせ、結果を並べる。
 * 本番の表には一切書き込まない（DB は default_transaction_read_only=on・起動時に SHOW で確認）。
 *
 * 入力の組み立て（本番 messages/route.ts・greeting/route.ts と同じ）:
 *   - チャット: system ①人物設定＋求人選定スキル＋タスク検出指示 ②候補者データ見出し＋セッションの contextCache
 *     messages = その質問までの履歴（求人分析の産物を除く直近20件・1件4,000字でクランプ）、最後は <ca_input> で包む
 *     「その時と同じ」を保証するため、contextCache がその質問の時点（＋2分）以前に作られたセッションの、
 *     最後の質問だけを選ぶ（それ以降に作り直されていない＝本番で実際に送った候補者データと同じ）
 *   - 挨拶文: system＝挨拶文テンプレート（担当CA名入り）、user＝求職者情報（contextCache）＋面談ログ（Drive の MEETING 最新5件）
 *     ＋それまでのチャット履歴。求職者情報は本番では生成時に作り直すため、contextCache で近似する（報告書に明記）
 *   - 添付ファイル付き・タイプ診断（未読ログ同梱）・大野テストは対象外。求職者・CA が偏らないよう1求職者1件・1CA最大2件
 *
 * 送り方: Message Batches API（半額）。応答の中身は同期と同じ。固定部（①）にだけ cache_control を付ける
 *   （本番と同じ位置。②は1回しか使わないため付けても書込が増えるだけ）。
 *   比較用の「1回あたり費用」は本番と同じ同期・キャッシュなし定価で換算して出す。
 *
 * 出力（個人情報を含むためコミットしない・scripts/output/ は .gitignore 済み）: scripts/output/t-xxx-sonnet5/
 *
 * 実行（master worktree・API キーは Railway の環境変数から渡す）:
 *   ANTHROPIC_API_KEY=... npx tsx --env-file=.env scripts/compare-sonnet5-chat-t-xxx.ts <plan|submit|wait|report>
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const OUT_DIR = path.join("scripts", "output", "t-xxx-sonnet5");
const PLAN_PATH = path.join(OUT_DIR, "compare-plan.json");
const STATE_PATH = path.join(OUT_DIR, "compare-state.json");
const RESULTS_PATH = path.join(OUT_DIR, "compare-results.json");
const HTML_PATH = path.join(OUT_DIR, "compare.html");

const TEST_CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk"; // 大野テスト
const DAYS = 30;
const N_CHAT = 8;
const N_GREETING = 2;
const MAX_PER_CA = 2;
const JPY_PER_USD = 157.42;
const BUDGET_JPY = 200; // 読み比べの上限（動作確認分を残して全体 ¥300 以内）
const MODEL_OLD = "claude-sonnet-4-6";
const MODEL_NEW = "claude-sonnet-5";
const PRICE: Record<string, { input: number; output: number; write5m: number; read: number }> = {
  [MODEL_OLD]: { input: 3, output: 15, write5m: 3.75, read: 0.3 },
  [MODEL_NEW]: { input: 2, output: 10, write5m: 2.5, read: 0.2 },
};

// 本番 messages/route.ts の定数（同じ値）
const MAX_CONTEXT_CHARS = 20000;
const MAX_PAST_MESSAGES = 20;
const MAX_PAST_MESSAGE_CHARS = 4000;
const ROUTE_CHAT = "src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts";
const ROUTE_GREETING = "src/app/api/candidates/[candidateId]/advisor/greeting/route.ts";

type Case = {
  key: string;
  kind: "chat" | "greeting";
  candidateId: string;
  caUserId: string;
  askedAt: string;
  question: string; // 画面に出す質問（挨拶文は "挨拶文(line|email)"）
  original: string; // 本番で実際に返った応答
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  maxTokens: number; // 従来（Sonnet 4.6）の上限
  advisorName?: string;
  note?: string;
};
type Plan = { createdAt: string; cases: Case[] };
type Result = {
  key: string;
  model: string;
  ok: boolean;
  error?: string;
  text: string;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  blockTypes: string[];
};

function readonlyDbUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未設定（npx tsx --env-file=.env で実行）");
  const u = new URL(url);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 未設定");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 600_000 });
}

/** 本番ルートのソースから、式展開の無いテンプレート文字列の定数を取り出す（本番と同じ文字列を使うため）。 */
function constFromSource(file: string, name: string): string {
  const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`${name} が ${file} に見つからない`);
  if (m[1].includes("${")) throw new Error(`${name} に式展開がある`);
  return m[1];
}

/** 挨拶文の system（本番 buildSystemPrompt と同じ文字列を、担当名・形式を差し込んで作る）。 */
function greetingSystem(format: "line" | "email", advisorName: string): string {
  const src = fs.readFileSync(ROUTE_GREETING, "utf8").replace(/\r\n/g, "\n");
  const fr = src.match(/const formatRule = format === "line"\n\s*\? "([^"]*)"\n\s*: '([^']*)';/);
  const body = src.match(/return `(あなたは人材紹介会社[\s\S]*?)`;\n}/);
  if (!fr || !body) throw new Error("挨拶文テンプレートが見つからない");
  const formatRule = format === "line" ? fr[1] : fr[2];
  return body[1].replace(/\$\{advisorName\}/g, advisorName).replace(/\$\{formatRule\}/g, formatRule);
}

// ---------------------------------------------------------------- plan
async function plan() {
  readonlyDbUrl();
  const { prisma } = await import("../src/lib/prisma");
  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用接続になっていないため中止");
  console.error("default_transaction_read_only=on");

  const { getJobMatchingSkillFull } = await import("../src/lib/load-job-matching-skill");
  const { TASK_DETECTION_PROMPT } = await import("../src/lib/advisor/suggested-tasks");
  const { isAnalysisMessage } = await import("../src/lib/advisor-message-kind");
  const { downloadFileFromDrive } = await import("../src/lib/google-drive");
  const { parsePdfWithAI, parseDocWithAI, parseTextFile } = await import("../src/lib/file-parser");

  const persona = constFromSource(ROUTE_CHAT, "ADVISOR_PERSONA_PROMPT");
  const header = constFromSource(ROUTE_CHAT, "CANDIDATE_DATA_HEADER");
  const fixed = persona + getJobMatchingSkillFull() + TASK_DETECTION_PROMPT;

  const since = new Date(Date.now() - DAYS * 86400_000);
  const sessions = await prisma.advisorChatSession.findMany({
    where: { candidateId: { not: TEST_CANDIDATE_ID }, messages: { some: { createdAt: { gte: since } } } },
    select: {
      id: true, candidateId: true, createdByUserId: true, contextCache: true, contextCachedAt: true,
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, createdAt: true, kind: true } },
      candidate: { select: { employee: { select: { name: true } } } },
    },
  });
  // 新しい順に並べ、求職者・CA が偏らないよう選ぶ
  sessions.sort((a, b) => b.messages[b.messages.length - 1].createdAt.getTime() - a.messages[a.messages.length - 1].createdAt.getTime());

  const cases: Case[] = [];
  const usedCand = new Set<string>();
  const perCa = new Map<string, number>();
  const caOk = (id: string) => (perCa.get(id) ?? 0) < MAX_PER_CA;
  const take = (c: Case) => {
    cases.push(c);
    usedCand.add(c.candidateId);
    perCa.set(c.caUserId, (perCa.get(c.caUserId) ?? 0) + 1);
  };
  const isGreeting = (s: string) => s.startsWith("【LINE向け挨拶文】") || s.startsWith("【メール向け挨拶文】");

  // 挨拶文（先に2件確保）
  for (const s of sessions) {
    if (cases.filter((c) => c.kind === "greeting").length >= N_GREETING) break;
    if (usedCand.has(s.candidateId) || !caOk(s.createdByUserId) || !s.contextCache) continue;
    const gi = s.messages.findIndex((m) => m.role === "assistant" && isGreeting(m.content) && m.createdAt >= since);
    if (gi < 0) continue;
    const g = s.messages[gi];
    const format: "line" | "email" = g.content.startsWith("【LINE") ? "line" : "email";
    const advisorName = s.candidate?.employee?.name || "担当者";
    const chatHistory = s.messages.slice(0, gi).map((m) => `${m.role === "user" ? "CA" : "AI"}: ${m.content}`).join("\n\n");
    // 面談ログ（本番と同じ: MEETING 最新5件を Drive から読む。PDF/Office は Gemini で書き起こし＝本番と同じ関数）
    const files = await prisma.candidateFile.findMany({
      where: { candidateId: s.candidateId, category: "MEETING", createdAt: { lte: g.createdAt } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { driveFileId: true, fileName: true, mimeType: true },
    });
    let meeting = "";
    for (const f of files) {
      if (!f.driveFileId) continue;
      try {
        const ext = f.fileName.split(".").pop()?.toLowerCase() || "";
        const { base64 } = await downloadFileFromDrive(f.driveFileId);
        const parsed =
          ext === "txt" ? parseTextFile(base64)
          : ext === "pdf" ? await parsePdfWithAI(base64)
          : ["docx", "doc", "xlsx", "xls", "pptx", "ppt"].includes(ext) ? await parseDocWithAI(base64, f.mimeType)
          : `（${ext}形式のファイルは読み取り非対応です）`;
        meeting += `--- ファイル名: ${f.fileName} ---\n${parsed}\n\n`;
      } catch (e) {
        console.error(`面談ファイル読込失敗（スキップ）: ${(e as Error).message}`);
      }
    }
    let user = `## 求職者情報\n${s.contextCache}\n\n`;
    if (meeting) user += `## 面談ログ・面談資料\n${meeting}\n`;
    user += `## これまでのチャット履歴\n${chatHistory}\n\n`;
    user += `上記の情報をもとに、${format === "line" ? "LINE" : "メール"}向けの面談後挨拶文を作成してください。`;
    take({
      key: `greeting-${cases.length + 1}`,
      kind: "greeting",
      candidateId: s.candidateId,
      caUserId: s.createdByUserId,
      askedAt: g.createdAt.toISOString(),
      question: `挨拶文（${format === "line" ? "LINE" : "メール"}向け）`,
      original: g.content.replace(/^【[^】]+】\n\n/, ""),
      system: [{ type: "text", text: greetingSystem(format, advisorName) }],
      messages: [{ role: "user", content: user }],
      maxTokens: 2000,
      advisorName,
      note: `面談ファイル${files.length}件・求職者情報は contextCache で近似`,
    });
  }

  // チャット（最後の質問のうち、contextCache がその時点以前に作られたもの）
  for (const s of sessions) {
    if (cases.filter((c) => c.kind === "chat").length >= N_CHAT) break;
    if (usedCand.has(s.candidateId) || !caOk(s.createdByUserId) || !s.contextCache || !s.contextCachedAt) continue;
    const idx = [...s.messages.keys()].filter((i) => s.messages[i].role === "user" && !isAnalysisMessage(s.messages[i])).pop();
    if (idx == null) continue;
    const q = s.messages[idx];
    const ans = s.messages[idx + 1];
    if (q.createdAt < since || !ans || ans.role !== "assistant" || isGreeting(ans.content)) continue;
    if (q.content.includes("添付ファイル「") || q.content.startsWith("添付ファイル")) continue;
    if (s.contextCachedAt.getTime() > q.createdAt.getTime() + 2 * 60_000) continue; // その後に作り直された
    if (ans.content.includes("タイプ診断") && q.content.includes("タイプ診断")) continue; // 未読ログ同梱の可能性
    let context = s.contextCache;
    if (context.length > MAX_CONTEXT_CHARS) context = context.substring(0, MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
    const past = s.messages.slice(0, idx + 1).filter((m) => !isAnalysisMessage(m)).slice(-MAX_PAST_MESSAGES);
    const apiMessages: Anthropic.MessageParam[] = past.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.length > MAX_PAST_MESSAGE_CHARS ? m.content.substring(0, MAX_PAST_MESSAGE_CHARS) + "\n…（長いため省略）" : m.content,
    }));
    apiMessages[apiMessages.length - 1] = { role: "user", content: `<ca_input>\n${q.content.trim()}\n</ca_input>\n` };
    take({
      key: `chat-${cases.length + 1}`,
      kind: "chat",
      candidateId: s.candidateId,
      caUserId: s.createdByUserId,
      askedAt: q.createdAt.toISOString(),
      question: q.content,
      original: ans.content,
      system: [
        { type: "text", text: fixed, cache_control: { type: "ephemeral" } },
        { type: "text", text: header + context },
      ],
      messages: apiMessages,
      maxTokens: 4000,
      note: `履歴${past.length}件`,
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PLAN_PATH, JSON.stringify({ createdAt: new Date().toISOString(), cases } satisfies Plan, null, 2));
  console.log(`選んだ件数: チャット ${cases.filter((c) => c.kind === "chat").length}・挨拶文 ${cases.filter((c) => c.kind === "greeting").length}・求職者 ${usedCand.size}人・CA ${perCa.size}人`);

  // 費用の見積もり（count_tokens は無料）
  const cl = client();
  let est = 0;
  for (const c of cases) {
    for (const model of [MODEL_OLD, MODEL_NEW]) {
      const r = await cl.messages.countTokens({ model, system: c.system, messages: c.messages });
      const p = PRICE[model];
      // 上限見積もり: 入力は全部定価・出力は従来上限の半分、バッチ半額
      est += ((r.input_tokens * p.input + (c.maxTokens / 2) * p.output) / 1e6) * 0.5;
      console.log(`${c.key} ${model} input_tokens=${r.input_tokens}`);
    }
  }
  console.log(`見積もり（キャッシュなし・バッチ半額・出力は上限の半分と仮定）: ¥${Math.round(est * JPY_PER_USD)}（上限 ¥${BUDGET_JPY}）`);
  await prisma.$disconnect();
}

// ---------------------------------------------------------------- submit / wait
async function submit() {
  const p: Plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  process.env.CHAT_MODEL = MODEL_NEW;
  const { chatRequestParams } = await import("../src/lib/claude");
  const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];
  for (const c of p.cases) {
    const temperature = 0.7; // チャット・挨拶文とも本番は 0.7
    requests.push({
      custom_id: `${c.key}__old`,
      params: { model: MODEL_OLD, max_tokens: c.maxTokens, temperature, system: c.system, messages: c.messages },
    });
    requests.push({
      custom_id: `${c.key}__new`,
      params: { ...chatRequestParams({ maxTokens: c.maxTokens, temperature }), system: c.system, messages: c.messages },
    });
  }
  const newParams = requests.find((r) => r.custom_id.endsWith("__new"))!.params;
  console.log("Sonnet 5 の送り方:", JSON.stringify({ model: newParams.model, max_tokens: newParams.max_tokens, temperature: newParams.temperature, thinking: newParams.thinking }));
  const batch = await client().messages.batches.create({ requests });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ batchId: batch.id, submittedAt: new Date().toISOString() }, null, 2));
  console.log(`submitted ${batch.id} (${requests.length} requests)`);
}

async function wait() {
  const { batchId } = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const cl = client();
  for (;;) {
    const b = await cl.messages.batches.retrieve(batchId);
    console.error(`${new Date().toISOString()} ${b.processing_status} ${JSON.stringify(b.request_counts)}`);
    if (b.processing_status === "ended") break;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const results: Result[] = [];
  for await (const r of await cl.messages.batches.results(batchId)) {
    const [key, which] = r.custom_id.split("__");
    const model = which === "old" ? MODEL_OLD : MODEL_NEW;
    if (r.result.type !== "succeeded") {
      results.push({ key, model, ok: false, error: JSON.stringify(r.result), text: "", stopReason: null, usage: null, blockTypes: [] });
      continue;
    }
    const m = r.result.message;
    const { chatResponseText } = await import("../src/lib/claude");
    results.push({
      key, model, ok: true,
      text: chatResponseText(m.content as { type: string; text?: string }[]),
      stopReason: m.stop_reason,
      usage: {
        input: m.usage.input_tokens,
        output: m.usage.output_tokens,
        cacheRead: m.usage.cache_read_input_tokens ?? 0,
        cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
      },
      blockTypes: m.content.map((b) => b.type),
    });
  }
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`results ${results.length}`);
}

// ---------------------------------------------------------------- report
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function report() {
  const p: Plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const results: Result[] = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  const { extractSuggestedTasks } = await import("../src/lib/advisor/suggested-tasks");

  const syncCost = (r: Result) => {
    if (!r.usage) return 0;
    const pr = PRICE[r.model];
    // 同期・キャッシュなしの定価で換算（両モデルを同じ条件で比べる）
    return ((r.usage.input + r.usage.cacheRead + r.usage.cacheWrite) * pr.input + r.usage.output * pr.output) / 1e6;
  };
  const batchCost = (r: Result) => {
    if (!r.usage) return 0;
    const pr = PRICE[r.model];
    return ((r.usage.input * pr.input + r.usage.cacheRead * pr.read + r.usage.cacheWrite * pr.write5m + r.usage.output * pr.output) / 1e6) * 0.5;
  };
  const check = (c: Case, r: Result | undefined): string[] => {
    const issues: string[] = [];
    if (!r) return ["結果なし"];
    if (!r.ok) return [`エラー ${r.error}`];
    if (!r.text.trim()) issues.push("空の応答");
    if (r.stopReason === "max_tokens") issues.push("途中で切れた（max_tokens）");
    if (r.blockTypes.some((t) => t !== "text")) issues.push(`text 以外のブロック: ${r.blockTypes.join(",")}`);
    if (c.kind === "chat") {
      const { cleanContent } = extractSuggestedTasks(r.text);
      if (/T150_TASKS|<<<|>>>/.test(cleanContent)) issues.push("タスク候補ブロックの崩れ");
      if (/<\/?(ca_input|thinking|antml)/.test(cleanContent)) issues.push("タグの混入");
    } else {
      if (!r.text.includes(`${c.advisorName}`)) issues.push("担当者名なし");
      if (!/様/.test(r.text.split("\n").slice(0, 3).join("\n"))) issues.push("宛名なし");
      if (!/^・/m.test(r.text)) issues.push("箇条書きなし");
    }
    return issues;
  };

  const rows = p.cases.map((c) => {
    const o = results.find((r) => r.key === c.key && r.model === MODEL_OLD);
    const n = results.find((r) => r.key === c.key && r.model === MODEL_NEW);
    return { c, o, n, io: check(c, o), in: check(c, n) };
  });
  const sum = (f: (r: Result) => number, model: string) => results.filter((r) => r.model === model).reduce((s, r) => s + f(r), 0);
  const avg = (f: (r: Result) => number, model: string) => sum(f, model) / Math.max(1, results.filter((r) => r.model === model).length);
  const yen = (usd: number) => `¥${(usd * JPY_PER_USD).toFixed(1)}`;

  const md: string[] = [];
  md.push("| # | 種類 | 4.6 文字数 | 5 文字数 | 4.6 出力tok | 5 出力tok | 4.6 入力tok | 5 入力tok | 4.6 1回費用 | 5 1回費用 | 4.6 問題 | 5 問題 |");
  md.push("|--|--|--:|--:|--:|--:|--:|--:|--:|--:|--|--|");
  for (const r of rows) {
    const inTok = (x?: Result) => (x?.usage ? x.usage.input + x.usage.cacheRead + x.usage.cacheWrite : 0);
    md.push(`| ${r.c.key} | ${r.c.kind === "chat" ? "チャット" : "挨拶文"} | ${r.o?.text.length ?? "-"} | ${r.n?.text.length ?? "-"} | ${r.o?.usage?.output ?? "-"} | ${r.n?.usage?.output ?? "-"} | ${inTok(r.o)} | ${inTok(r.n)} | ${r.o ? yen(syncCost(r.o)) : "-"} | ${r.n ? yen(syncCost(r.n)) : "-"} | ${r.io.join("・") || "なし"} | ${r.in.join("・") || "なし"} |`);
  }
  const chars = (m: string) => avg((r) => r.text.length, m);
  const outTok = (m: string) => avg((r) => r.usage?.output ?? 0, m);
  const inTokAvg = (m: string) => avg((r) => (r.usage ? r.usage.input + r.usage.cacheRead + r.usage.cacheWrite : 0), m);
  md.push("");
  md.push(`平均: 文字数 4.6=${chars(MODEL_OLD).toFixed(0)} / 5=${chars(MODEL_NEW).toFixed(0)}・出力トークン 4.6=${outTok(MODEL_OLD).toFixed(0)} / 5=${outTok(MODEL_NEW).toFixed(0)}・入力トークン 4.6=${inTokAvg(MODEL_OLD).toFixed(0)} / 5=${inTokAvg(MODEL_NEW).toFixed(0)}（比 ${(inTokAvg(MODEL_NEW) / inTokAvg(MODEL_OLD)).toFixed(2)}）`);
  md.push(`1回あたり費用（同期・キャッシュなし定価換算）: 4.6=${yen(avg(syncCost, MODEL_OLD))} / 5=${yen(avg(syncCost, MODEL_NEW))}（比 ${(avg(syncCost, MODEL_NEW) / avg(syncCost, MODEL_OLD)).toFixed(2)}）`);
  md.push(`1文字あたりの出力トークン: 4.6=${(sum((r) => r.usage?.output ?? 0, MODEL_OLD) / sum((r) => r.text.length, MODEL_OLD)).toFixed(3)} / 5=${(sum((r) => r.usage?.output ?? 0, MODEL_NEW) / sum((r) => r.text.length, MODEL_NEW)).toFixed(3)}`);
  md.push(`今回の読み比べの実費（バッチ・キャッシュ込み）: ${yen(sum(batchCost, MODEL_OLD) + sum(batchCost, MODEL_NEW))}`);
  fs.writeFileSync(path.join(OUT_DIR, "compare-summary.md"), md.join("\n"));
  console.log(md.join("\n"));

  // HTML（並べて読む用・個人情報を含む）
  const card = (title: string, body: string, issues: string[] | null, meta: string) => `
    <div class="col"><h4>${esc(title)}</h4><div class="meta">${esc(meta)}</div>
    ${issues ? `<div class="${issues.length ? "bad" : "good"}">${issues.length ? esc(issues.join("・")) : "問題なし"}</div>` : ""}
    <pre>${esc(body)}</pre></div>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sonnet 5 読み比べ</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--card:#f7f7f5;--good:#1b7f3b;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--muted:#aaa;--line:#333;--card:#202020;--good:#6fcf8f;--bad:#ff8a80}}
body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0;padding:16px;line-height:1.6}
h1{font-size:20px}h2{font-size:16px;border-top:1px solid var(--line);padding-top:16px}h4{margin:0 0 4px}
.q{background:var(--card);padding:8px 12px;border-radius:6px;white-space:pre-wrap}
.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:900px){.row{grid-template-columns:1fr}}
.col{background:var(--card);border-radius:6px;padding:8px 12px;min-width:0}
pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;margin:0}
.meta{color:var(--muted);font-size:12px}.good{color:var(--good);font-size:12px}.bad{color:var(--bad);font-size:12px;font-weight:bold}
table{border-collapse:collapse;font-size:12px}td,th{border:1px solid var(--line);padding:2px 6px}
</style></head><body><h1>Sonnet 4.6 と Sonnet 5 の読み比べ（${p.cases.length}件）</h1>
<p class="meta">左＝本番で実際に返った応答／中＝Sonnet 4.6 の再実行／右＝Sonnet 5（temperature なし・思考無効）。個人情報を含むため共有しない。</p>
<pre>${esc(md.join("\n"))}</pre>
${rows.map((r) => `<h2>${esc(r.c.key)}（${r.c.kind === "chat" ? "チャット" : "挨拶文"}・${esc(r.c.askedAt.slice(0, 16))}・${esc(r.c.note ?? "")}）</h2>
<div class="q">${esc(r.c.question)}</div>
<div class="row">
${card("本番の応答（当時）", r.c.original, null, "")}
${card("Sonnet 4.6（再実行）", r.o?.text ?? r.o?.error ?? "", r.io, r.o?.usage ? `出力 ${r.o.usage.output} tok・${r.o.text.length}字・stop=${r.o.stopReason}` : "")}
${card("Sonnet 5", r.n?.text ?? r.n?.error ?? "", r.in, r.n?.usage ? `出力 ${r.n.usage.output} tok・${r.n.text.length}字・stop=${r.n.stopReason}` : "")}
</div>`).join("\n")}
</body></html>`;
  fs.writeFileSync(HTML_PATH, html);
  console.log(`html: ${HTML_PATH}`);
}

const cmd = process.argv[2];
const run = cmd === "plan" ? plan : cmd === "submit" ? submit : cmd === "wait" ? wait : cmd === "report" ? report : null;
if (!run) {
  console.error("usage: plan | submit | wait | report");
  process.exit(1);
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};
