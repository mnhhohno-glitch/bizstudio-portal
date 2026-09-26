/**
 * T-XXX: AIアドバイザーの費用実態・送信内訳とマイナビレジュメ保存形式の調査（読み取りのみ）。
 *
 * - DB は default_transaction_read_only=on で接続（起動時に SHOW で確認）。SELECT のみ。
 * - AI（Anthropic / Gemini）は一切呼ばない。
 * - Drive からはマイナビ取り込みPDFを数件ダウンロードし、既存の pdf-parse で文字数と
 *   「学歴」「職歴」等の見出しの有無だけを見る（本文は出力しない）。
 * - 出力は集計値のみ（氏名・連絡先・本文・ファイル名は出さない。CA は匿名化）。
 *
 * 実行（master worktree）:
 *   npx tsx --env-file=.env scripts/survey/survey-advisor-cost-and-resume-t-xxx.ts
 *   npx tsx --env-file=.env scripts/survey/survey-advisor-cost-and-resume-t-xxx.ts --pdf 5
 */

import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { getJobMatchingSkillFull } from "../../src/lib/load-job-matching-skill";
import { TASK_DETECTION_PROMPT } from "../../src/lib/advisor/suggested-tasks";
import { downloadFileFromDrive } from "../../src/lib/google-drive";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c default_transaction_read_only=on",
});

const JPY_PER_USD = 150;
const TEST_CANDIDATE_ID = "cmmn4jipg00011dqt23w1q3bk"; // 大野テスト
const FROM_MONTH = "2026-06-01"; // 直近3ヶ月＋今月（JST）
const PDF_SAMPLES = Number(process.argv[process.argv.indexOf("--pdf") + 1]) || 0;

const yen = (usd: number) => `¥${(usd * JPY_PER_USD).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
const n0 = (x: number) => Math.round(x).toLocaleString();
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "-");
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

async function main() {
  const ro = await q<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only");
  console.log(`<!-- read_only=${ro[0].default_transaction_read_only} -->`);
  if (ro[0].default_transaction_read_only !== "on") throw new Error("read-only で接続できていない");

  // ---------- 1. AdvisorUsageLog 月別・機能別 ----------
  console.log("\n## 1-1. AdvisorUsageLog 月別×機能別（JST月・1ドル=150円）\n");
  const monthly = await q<{ ym: string; endpoint: string; calls: string; usd: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') ym, endpoint,
            count(*) calls, sum(cost_usd)::float usd
       FROM advisor_usage_logs
      WHERE created_at >= ($1::date - interval '9 hours')
      GROUP BY 1,2 ORDER BY 1,2`,
    [FROM_MONTH],
  );
  console.log("| 月 | 機能 | 回数 | USD | 円 |\n|--|--|--:|--:|--:|");
  for (const r of monthly) console.log(`| ${r.ym} | ${r.endpoint} | ${r.calls} | $${r.usd.toFixed(2)} | ${yen(r.usd)} |`);
  const monthTotals = new Map<string, number>();
  for (const r of monthly) monthTotals.set(r.ym, (monthTotals.get(r.ym) ?? 0) + r.usd);
  console.log("\n| 月 | 合計USD | 合計円 |\n|--|--:|--:|");
  for (const [ym, usd] of monthTotals) console.log(`| ${ym} | $${usd.toFixed(2)} | ${yen(usd)} |`);

  const last30 = await q<{ endpoint: string; calls: string; usd: number }>(
    `SELECT endpoint, count(*) calls, sum(cost_usd)::float usd FROM advisor_usage_logs
      WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 3 DESC`,
  );
  console.log("\n直近30日（AdvisorUsageLog）:\n\n| 機能 | 回数 | 円 |\n|--|--:|--:|");
  let l30 = 0;
  for (const r of last30) {
    l30 += r.usd;
    console.log(`| ${r.endpoint} | ${r.calls} | ${yen(r.usd)} |`);
  }
  console.log(`| **合計** | | **${yen(l30)}** |`);

  // AiUsageLog（T-135 帳簿）のうちアドバイザー由来の書類読み取り
  console.log("\n## 1-2. AiUsageLog（file-parse 等）アドバイザー由来の書類読み取り（月別）\n");
  const fp = await q<{ ym: string; caller: string; kind: string; calls: string; jpy: number }>(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') ym,
            coalesce(meta->>'caller','(なし)') caller, coalesce(meta->>'kind','-') kind,
            count(*) calls, coalesce(sum(estimated_cost_jpy),0)::float jpy
       FROM ai_usage_logs
      WHERE system='portal' AND endpoint='file-parse'
        AND created_at >= ($1::date - interval '9 hours')
      GROUP BY 1,2,3 ORDER BY 1,2,3`,
    [FROM_MONTH],
  );
  console.log("| 月 | 呼び出し元 | 種別 | 回数 | 円（帳簿の推定） |\n|--|--|--|--:|--:|");
  for (const r of fp) console.log(`| ${r.ym} | ${r.caller} | ${r.kind} | ${r.calls} | ¥${r.jpy.toFixed(1)} |`);

  const portalEp = await q<{ endpoint: string; model: string; calls: string; jpy: number }>(
    `SELECT endpoint, model, count(*) calls, coalesce(sum(estimated_cost_jpy),0)::float jpy
       FROM ai_usage_logs WHERE system='portal' AND created_at >= now() - interval '30 days'
      GROUP BY 1,2 ORDER BY 4 DESC`,
  );
  console.log("\nAiUsageLog portal 直近30日（参考・endpoint×model）:\n\n| endpoint | model | 回数 | 円 |\n|--|--|--:|--:|");
  for (const r of portalEp) console.log(`| ${r.endpoint} | ${r.model} | ${r.calls} | ¥${r.jpy.toFixed(1)} |`);

  // ---------- 1-3. チャット1往復 ----------
  type ChatRow = {
    created_at: Date; candidate_id: string | null; model: string; input_tokens: number; output_tokens: number;
    cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number; note: string | null;
    latency_ms: number | null; context_build_ms: number | null;
  };
  const chats = await q<ChatRow>(
    `SELECT created_at, candidate_id, model, input_tokens, output_tokens, cache_read_tokens,
            cache_creation_tokens, cost_usd, note, latency_ms, context_build_ms
       FROM advisor_usage_logs
      WHERE endpoint='advisor-chat' AND created_at >= ($1::date - interval '9 hours')
      ORDER BY created_at`,
    [FROM_MONTH],
  );
  const ok = chats.filter((c) => !(c.note ?? "").startsWith("error-"));
  const errs = chats.length - ok.length;
  const win = ok.filter((c) => c.created_at.getTime() >= Date.now() - 30 * 86400_000);
  const describe = (label: string, rows: ChatRow[]) => {
    const cost = rows.map((r) => r.cost_usd);
    const lat = rows.map((r) => r.latency_ms).filter((x): x is number => x != null);
    const cb = rows.map((r) => r.context_build_ms).filter((x): x is number => x != null);
    const cbHit = cb.filter((x) => x === 0).length;
    const models = [...new Set(rows.map((r) => r.model))].join(", ");
    const totalIn = rows.map((r) => r.input_tokens + r.cache_read_tokens + r.cache_creation_tokens);
    console.log(`| ${label} | ${rows.length} | ${yen(avg(cost))} | ${yen(median(cost))} | ${yen(Math.max(...cost, 0))} | ${n0(avg(rows.map((r) => r.input_tokens)))} | ${n0(avg(rows.map((r) => r.output_tokens)))} | ${n0(avg(rows.map((r) => r.cache_read_tokens)))} | ${n0(avg(rows.map((r) => r.cache_creation_tokens)))} | ${n0(avg(totalIn))} / ${n0(median(totalIn))} | ${lat.length ? `${(avg(lat) / 1000).toFixed(1)}s / ${(median(lat) / 1000).toFixed(1)}s (n=${lat.length})` : "記録なし"} | ${cb.length ? `${pct(cbHit, cb.length)} / 再ビルド時 ${(avg(cb.filter((x) => x > 0)) / 1000).toFixed(1)}s` : "-"} | ${models} |`);
  };
  console.log("\n## 1-3. チャット1往復（advisor-chat・エラー行除外）\n");
  console.log(`エラー行: ${errs} 件（期間内 ${chats.length} 件中）\n`);
  console.log("| 範囲 | 件数 | 平均 | 中央値 | 最大 | 通常入力 平均 | 出力 平均 | キャッシュ読 平均 | キャッシュ書 平均 | 入力合計 平均/中央値 | 所要 平均/中央値 | context キャッシュ命中率 / 再ビルド平均 | モデル |");
  console.log("|--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--|");
  describe("2026-06〜今月", ok);
  describe("直近30日", win);
  const byMonth = new Map<string, ChatRow[]>();
  for (const c of ok) {
    const ym = new Date(c.created_at.getTime() + 9 * 3600_000).toISOString().slice(0, 7);
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), c]);
  }
  for (const [ym, rows] of byMonth) describe(ym, rows);
  const readHit = win.filter((c) => c.cache_read_tokens > 0).length;
  console.log(`\n直近30日: キャッシュ読みが1トークン以上あった呼び出し ${readHit}/${win.length}（${pct(readHit, win.length)}）`);
  const readShare = win.reduce((a, c) => a + c.cache_read_tokens, 0);
  const allIn = win.reduce((a, c) => a + c.input_tokens + c.cache_read_tokens + c.cache_creation_tokens, 0);
  console.log(`直近30日: 入力合計に占めるキャッシュ読みの割合 ${pct(readShare, allIn)}`);
  console.log("\n直近30日の所要時間（通常／タイプ診断で面談ログ同梱）:\n\n| 種別 | 件数 | 所要 平均 | 中央値 | 出力 平均 | 費用 平均 |\n|--|--:|--:|--:|--:|--:|");
  const kinds: [string, ChatRow[]][] = [
    ["通常", win.filter((c) => !(c.note ?? "").includes("t184"))],
    ["診断+面談ログ同梱", win.filter((c) => (c.note ?? "").includes("t184"))],
  ];
  for (const [label, rows] of kinds) {
    const lat = rows.map((r) => r.latency_ms ?? 0);
    console.log(`| ${label} | ${rows.length} | ${(avg(lat) / 1000).toFixed(1)}s | ${(median(lat) / 1000).toFixed(1)}s | ${n0(avg(rows.map((r) => r.output_tokens)))} | ${yen(avg(rows.map((r) => r.cost_usd)))} |`);
  }
  const first = await q<{ first: Date }>("SELECT min(created_at) first FROM advisor_usage_logs");
  console.log(`\nAdvisorUsageLog の最古の行: ${first[0].first.toISOString()}`);
  const noteDist = new Map<string, number>();
  for (const c of win) {
    const k = (c.note ?? "(null)").replace(/t184-digest-\d+/, "t184-digest-N");
    noteDist.set(k, (noteDist.get(k) ?? 0) + 1);
  }
  console.log(`直近30日 note 内訳: ${[...noteDist].map(([k, v]) => `${k}=${v}`).join(" / ")}`);

  // Sonnet 5 単価での再計算（トークン数はそのまま＝日本語 1.01 倍は無視）
  const s5 = (r: ChatRow) =>
    (r.input_tokens * 2 + r.output_tokens * 10 + r.cache_read_tokens * 0.2 + r.cache_creation_tokens * 2.5) / 1e6;
  console.log(`直近30日を Sonnet 5 単価で再計算: 平均 ${yen(avg(win.map(s5)))} / 中央値 ${yen(median(win.map(s5)))}`);

  // ---------- 1-4. 求職者・CA 別 ----------
  console.log("\n## 1-4. 求職者1人あたりの月の往復数（テスト求職者除外）\n");
  console.log("| 月 | 使った求職者数 | 往復数 | 1人あたり平均 | 1人あたり最大 | 1往復だけの人 |\n|--|--:|--:|--:|--:|--:|");
  for (const [ym, rows] of byMonth) {
    const per = new Map<string, number>();
    for (const r of rows) if (r.candidate_id && r.candidate_id !== TEST_CANDIDATE_ID) per.set(r.candidate_id, (per.get(r.candidate_id) ?? 0) + 1);
    const vals = [...per.values()];
    console.log(`| ${ym} | ${per.size} | ${vals.reduce((a, b) => a + b, 0)} | ${avg(vals).toFixed(1)} | ${Math.max(...vals, 0)} | ${vals.filter((v) => v === 1).length} |`);
  }

  // CA 別（利用者＝セッション作成者。メッセージに送信者は無いため）。匿名化。
  const byCa = await q<{ ym: string; uid: string; msgs: string; cands: string }>(
    `SELECT to_char(m.created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM') ym, s.created_by_user_id uid,
            count(*) msgs, count(DISTINCT s.candidate_id) cands
       FROM advisor_chat_messages m JOIN advisor_chat_sessions s ON s.id = m.session_id
      WHERE m.role='user' AND (m.kind IS NULL OR m.kind <> 'ANALYSIS')
        AND m.created_at >= ($1::date - interval '9 hours') AND s.candidate_id <> $2
      GROUP BY 1,2 ORDER BY 1, 3 DESC`,
    [FROM_MONTH, TEST_CANDIDATE_ID],
  );
  const alias = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const r of byCa) totals.set(r.uid, (totals.get(r.uid) ?? 0) + Number(r.msgs));
  [...totals].sort((a, b) => b[1] - a[1]).forEach(([uid], i) => alias.set(uid, `CA-${String.fromCharCode(65 + i)}`));
  const months = [...new Set(byCa.map((r) => r.ym))];
  console.log(`\nCA別の質問数（セッション作成者で集計・現存セッションのみ＝クリア済みは消えている）:\n`);
  console.log(`| CA | ${months.join(" | ")} | 計 |\n|--|${months.map(() => "--:").join("|")}|--:|`);
  for (const [uid, name] of alias) {
    const cells = months.map((ym) => byCa.find((r) => r.ym === ym && r.uid === uid)?.msgs ?? "0");
    console.log(`| ${name} | ${cells.join(" | ")} | ${totals.get(uid)} |`);
  }

  // ---------- 2. 送信内訳 ----------
  console.log("\n## 2. 送信内訳（文字数）\n");
  const routeSrc = readFileSync(
    join(process.cwd(), "src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts"),
    "utf-8",
  );
  const persona = routeSrc.match(/const ADVISOR_PERSONA_PROMPT = `([\s\S]*?)`;/)?.[1] ?? "";
  const skillFull = getJobMatchingSkillFull();
  const skillBody = readFileSync(join(process.cwd(), "src/skills/job-matching-advisor/SKILL_full.md"), "utf-8");
  const mid = readFileSync(join(process.cwd(), "src/skills/job-matching-advisor/references/middle-career.md"), "utf-8");
  console.log("| 部品 | 文字数 |\n|--|--:|");
  console.log(`| 人物設定（ADVISOR_PERSONA_PROMPT） | ${n0(persona.length)} |`);
  console.log(`| SKILL_full.md 本体 | ${n0(skillBody.length)} |`);
  console.log(`| references/middle-career.md | ${n0(mid.length)} |`);
  console.log(`| スキル結合後（getJobMatchingSkillFull） | ${n0(skillFull.length)} |`);
  console.log(`| タスク検出指示（TASK_DETECTION_PROMPT） | ${n0(TASK_DETECTION_PROMPT.length)} |`);
  console.log(`| **固定ブロック合計** | **${n0(persona.length + skillFull.length + TASK_DETECTION_PROMPT.length)}** |`);

  const ctx = await q<{ len: number }>(
    `SELECT length(context_cache) len FROM advisor_chat_sessions
      WHERE context_cache IS NOT NULL AND updated_at >= now() - interval '90 days' AND candidate_id <> $1`,
    [TEST_CANDIDATE_ID],
  );
  const lens = ctx.map((r) => Math.min(r.len, 20000));
  console.log(`\n候補者context（直近90日に更新のセッション n=${ctx.length}・20,000字で切詰め後）: 平均 ${n0(avg(lens))} 字 / 中央値 ${n0(median(lens))} 字 / 最大 ${n0(Math.max(...lens, 0))} 字 / 20,000字到達 ${pct(ctx.filter((r) => r.len > 20000).length, ctx.length)}`);

  const msgStats = await q<{ role: string; n: string; avg_len: number; p50: number; over4k: string }>(
    `SELECT m.role, count(*) n, avg(length(m.content))::float avg_len,
            percentile_cont(0.5) within group (order by length(m.content))::float p50,
            count(*) FILTER (WHERE length(m.content) > 4000) over4k
       FROM advisor_chat_messages m JOIN advisor_chat_sessions s ON s.id=m.session_id
      WHERE m.created_at >= now() - interval '90 days' AND (m.kind IS NULL OR m.kind <> 'ANALYSIS')
        AND s.candidate_id <> $1
      GROUP BY 1`,
    [TEST_CANDIDATE_ID],
  );
  console.log("\n会話メッセージ（直近90日・分析カード除外）:\n\n| 発言者 | 件数 | 平均文字数 | 中央値 | 4,000字超（送信時に切詰め） |\n|--|--:|--:|--:|--:|");
  for (const r of msgStats) console.log(`| ${r.role} | ${r.n} | ${n0(r.avg_len)} | ${n0(r.p50)} | ${r.over4k} |`);

  // ---------- 4. 会話の保存構造 ----------
  console.log("\n## 4. セッション数（現存）\n");
  const sess = await q<{ per: number; cands: string }>(
    `SELECT per, count(*) cands FROM (SELECT candidate_id, count(*) per FROM advisor_chat_sessions GROUP BY 1) t GROUP BY 1 ORDER BY 1`,
  );
  console.log("| 1人あたりセッション数 | 求職者数 |\n|--:|--:|");
  for (const r of sess) console.log(`| ${r.per} | ${r.cands} |`);
  const msgPerSess = await q<{ n: string; avg: number; p50: number; mx: number }>(
    `SELECT count(*) n, avg(c)::float avg, percentile_cont(0.5) within group (order by c)::float p50, max(c) mx
       FROM (SELECT s.id, count(m.id) c FROM advisor_chat_sessions s LEFT JOIN advisor_chat_messages m ON m.session_id=s.id GROUP BY 1) t`,
  );
  console.log(`\n1セッションのメッセージ数: セッション ${msgPerSess[0].n} 件 / 平均 ${msgPerSess[0].avg.toFixed(1)} / 中央値 ${msgPerSess[0].p50} / 最大 ${msgPerSess[0].mx}`);
  const orphan = await q<{ n: string }>(
    `SELECT count(*) n FROM advisor_usage_logs u WHERE u.endpoint='advisor-chat' AND u.created_at >= now() - interval '90 days'
        AND u.candidate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM advisor_chat_sessions s WHERE s.candidate_id=u.candidate_id)`,
  );
  console.log(`直近90日のチャット使用量ログのうち、その求職者のセッションが今は1件も無い（クリア等で消えた）もの: ${orphan[0].n} 件`);

  // ---------- 3. マイナビレジュメ ----------
  console.log("\n## 3. マイナビレジュメの保有率（直近3ヶ月に登録＝created_at が過去92日）\n");
  const cov = await q<{ grp: string; n: string; with_rpa_pdf: string; with_any_pdf_meeting: string; with_original: string }>(
    `WITH c AS (
       SELECT id, CASE WHEN media_source = 'マイナビ転職' THEN 'マイナビ転職' ELSE coalesce(media_source,'(空)') END grp
         FROM candidates WHERE created_at >= now() - interval '92 days' AND id <> $1)
     SELECT grp, count(*) n,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM candidate_files f WHERE f.candidate_id=c.id AND f.memo='マイナビRPA自動取り込み')) with_rpa_pdf,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM candidate_files f WHERE f.candidate_id=c.id AND f.category='MEETING' AND f.mime_type='application/pdf')) with_any_pdf_meeting,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM candidate_files f WHERE f.candidate_id=c.id AND f.category IN ('ORIGINAL','BS_DOCUMENT') AND f.mime_type='application/pdf')) with_original
     FROM c GROUP BY 1 ORDER BY 2 DESC`,
    [TEST_CANDIDATE_ID],
  );
  console.log("| 媒体（media_source） | 登録数 | マイナビRPA取込PDFあり | 面談区分のPDFあり | 原本/BS作成書類のPDFあり |\n|--|--:|--:|--:|--:|");
  let tn = 0, tr = 0;
  for (const r of cov) {
    tn += Number(r.n); tr += Number(r.with_rpa_pdf);
    console.log(`| ${r.grp} | ${r.n} | ${r.with_rpa_pdf}（${pct(Number(r.with_rpa_pdf), Number(r.n))}） | ${r.with_any_pdf_meeting}（${pct(Number(r.with_any_pdf_meeting), Number(r.n))}） | ${r.with_original}（${pct(Number(r.with_original), Number(r.n))}） |`);
  }
  console.log(`| **全体** | ${tn} | ${tr}（${pct(tr, tn)}） | | |`);

  const route = await q<{ route: string; n: string }>(
    `SELECT coalesce(application_route,'(空)') route, count(*) n FROM candidates
      WHERE created_at >= now() - interval '92 days' AND media_source='マイナビ転職' GROUP BY 1 ORDER BY 2 DESC`,
  );
  console.log(`\nマイナビ転職の応募経路内訳: ${route.map((r) => `${r.route}=${r.n}`).join(" / ")}`);

  const rpaFiles = await q<{ n: string; parsed: string; avg_parsed: number; p50_parsed: number; avg_size: number; category: string; with_drive: string }>(
    `SELECT category, count(*) n, count(*) FILTER (WHERE parsed_text IS NOT NULL) parsed,
            avg(length(parsed_text))::float avg_parsed,
            percentile_cont(0.5) within group (order by length(parsed_text))::float p50_parsed,
            avg(file_size)::float avg_size, count(*) FILTER (WHERE drive_file_id IS NOT NULL) with_drive
       FROM candidate_files WHERE memo='マイナビRPA自動取り込み' GROUP BY 1`,
  );
  console.log("\nマイナビRPA取込PDF（全期間）:\n\n| カテゴリ | 件数 | Drive実体あり | parsedText 保存済み | parsedText 平均字数 | 中央値 | 平均サイズ |\n|--|--:|--:|--:|--:|--:|--:|");
  for (const r of rpaFiles) console.log(`| ${r.category} | ${r.n} | ${r.with_drive} | ${r.parsed}（${pct(Number(r.parsed), Number(r.n))}） | ${n0(r.avg_parsed ?? 0)} | ${n0(r.p50_parsed ?? 0)} | ${n0((r.avg_size ?? 0) / 1024)} KB |`);

  const names = await q<{ pat: string; n: string }>(
    `SELECT CASE WHEN file_name ~ '^[0-9]+_.+\\.pdf$' THEN '<求職者番号>_<氏名>.pdf' ELSE 'その他' END pat, count(*) n
       FROM candidate_files WHERE memo='マイナビRPA自動取り込み' GROUP BY 1`,
  );
  console.log(`\nファイル名の形: ${names.map((r) => `${r.pat}=${r.n}`).join(" / ")}`);

  // 経歴情報の充足（直近3ヶ月のマイナビ転職登録者）
  const hist = await q<{ n: string; with_rec: string; with_wh: string; with_edu: string; with_parsed_resume: string }>(
    `WITH c AS (SELECT id FROM candidates WHERE created_at >= now() - interval '92 days' AND media_source='マイナビ転職')
     SELECT count(*) n,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM interview_records r WHERE r.candidate_id=c.id)) with_rec,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM interview_records r JOIN work_histories w ON w.interview_record_id=r.id WHERE r.candidate_id=c.id)) with_wh,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM interview_records r JOIN interview_details d ON d.interview_record_id=r.id WHERE r.candidate_id=c.id AND (d.education_flag IS NOT NULL OR d.education_memo IS NOT NULL))) with_edu,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM guide_entries g WHERE g.candidate_id=c.id AND g.data ? 'parsed_resume')) with_parsed_resume
     FROM c`,
  );
  const h = hist[0];
  console.log(`\n経歴情報の充足（直近3ヶ月のマイナビ転職登録者 n=${h.n}）: 面談記録あり ${pct(Number(h.with_rec), Number(h.n))} / 職歴(WorkHistory)あり ${pct(Number(h.with_wh), Number(h.n))} / 学歴(InterviewDetail.education*)あり ${pct(Number(h.with_edu), Number(h.n))} / ガイドの parsed_resume あり ${pct(Number(h.with_parsed_resume), Number(h.n))}`);

  // PDF 実物（AI なしの文字取り出し）
  if (PDF_SAMPLES > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const files = await q<{ id: string; drive_file_id: string; parsed_len: number | null }>(
      `SELECT id, drive_file_id, length(parsed_text) parsed_len FROM candidate_files
        WHERE memo='マイナビRPA自動取り込み' AND drive_file_id IS NOT NULL
        ORDER BY (parsed_text IS NOT NULL) DESC, created_at DESC LIMIT $1`,
      [PDF_SAMPLES],
    );
    console.log("\n## 3-PDF. pdf-parse による文字取り出し（AIなし・本文は出力しない）\n");
    console.log("| # | ページ数 | 抽出文字数（空白除く） | 学歴 | 職歴/職務経歴 | 自己PR | 希望 | 同じPDFの parsedText（Gemini）字数 |\n|--:|--:|--:|--|--|--|--|--:|");
    let i = 0;
    for (const f of files) {
      i++;
      try {
        const { base64 } = await downloadFileFromDrive(f.drive_file_id);
        const data = await pdfParse(Buffer.from(base64, "base64"));
        const text: string = data.text ?? "";
        const compact = text.replace(/\s+/g, "");
        const has = (re: RegExp) => (re.test(compact) ? "あり" : "なし");
        console.log(`| ${i} | ${data.numpages} | ${n0(compact.length)} | ${has(/学歴/)} | ${has(/職歴|職務経歴/)} | ${has(/自己PR|自己ＰＲ/)} | ${has(/希望/)} | ${f.parsed_len ?? "-"} |`);
      } catch (e) {
        console.log(`| ${i} | - | 失敗: ${e instanceof Error ? e.message.slice(0, 60) : "?"} | | | | | |`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

export {};
