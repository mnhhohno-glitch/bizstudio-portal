/**
 * T-XXX step6: 切り替え後（Opus 5.5）の評価の確認 ＋ 面談テキスト 8,000字切り詰めの調査。
 * 読み取りのみ（default_transaction_read_only=on で接続）・AI は一切呼ばない。
 *
 * 第1部 切り替え後の評価
 *   - 直近48時間の手動評価（analyze-batch）を CA（チャットセッションの作成者）× 求職者で集計
 *   - Opus 5.5 の失敗・形式崩れ（SKIPPED）・途切れ（stop-max_tokens）・総合評価表の破り
 *   - ランク分布（step5 の基準値と並べる）、同じ求人の Opus 4.6 → 5.5 の変化
 *       4.6 側のランクは (1) 完了カード（advisor_chat_messages kind=ANALYSIS）の「・会社名 — 本人希望:X / 通過率:Y」行
 *       （会社名で一意に照合できたものだけ）、(2) step1/step4 の手元スナップショット（plan.json）の順で探す
 *   - 1件あたり費用・1バッチの所要時間（同じ run の連続するバッチの記録間隔）・スキップ件数
 *   - job_eval_records / job_eval_parts が AdvisorUsageLog の送信件数どおり入っているか
 *   - 自動配信: 台帳（recommend_analyze_batches）と自動由来行の到着状況
 * 第2部 面談テキストの切り詰め（直近30日に評価された求職者）
 *   - getCandidateContext（src/lib/advisor-context.ts）と buildAnalyzeCandidateContext（src/lib/analyze-bookmarks.ts）を
 *     DB の保存値だけで再現し（Drive・OCR は呼ばない。parsedText が無い書類は長さ不明として数える）、
 *     面談 txt ごとの 8,000字切り詰め・主要書類4件の枠・全体 20,000字切り詰めでどれだけ落ちているかを測る
 *   - 再現の正しさは、切り替え後に評価された求職者の job_eval_parts（context_core）とハッシュ一致で確かめる
 *   - 直す案（A: 上限引き上げ / B: 同じ予算で新しい面談を優先 / C: 上限なし）ごとの入力増と費用の試算
 *
 * 実行（master worktree・本番 DB 読み取り）:
 *   npx tsx --env-file=.env scripts/survey-interview-truncation-t-xxx.ts
 * 出力: 標準出力に集計（ID のみ）。明細 CSV・比較 HTML は scripts/output/t-xxx-truncation/（個人情報を含む・コミットしない）
 *
 * 罠#17（JST）: 日付は toLocaleString('sv-SE', {timeZone:'Asia/Tokyo'})。toISOString().slice(0,10) は使わない
 * （ただし getCandidateContext の再現部分は本番コードと同じ toISOString().slice(0,10) をあえて使う）。
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { getCategoryLabel } from "../src/lib/constants/candidate-file-categories";
import { extractCompanyNameCandidates, stripCorpSuffixes } from "../src/lib/normalize-filename";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c default_transaction_read_only=on",
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const OUT_DIR = path.join(__dirname, "output", "t-xxx-truncation");
const JPY_PER_USD = 157.42; // step1〜5 と同じ
const TEST_CANDIDATE_NUMBER = "5999999"; // 大野テスト
const AUTO_REJECT_REASON_D = "AI評価D（自動）";

// Opus 5.5 の料金（src/lib/claude.ts MODEL_PRICING_PER_MTOK と同値。USD / 100万トークン）
const P55 = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8, batchFactor: 0.5 };

// 本番コードの上限（src/lib/advisor-context.ts / src/lib/analyze-bookmarks.ts）
const MEETING_TEXT_MAX_CHARS = 8000;
const KEY_FILES_TAKE = 4;
const MAX_CONTEXT_CHARS = 20000;
const JOB_TEXT_MAX_CHARS = 3000;
const JOB_ENTRIES_TAKE = 20;
const RATINGS_SECTION_MARKER = "## ブックマーク求人の評価一覧";

const RANKS = ["A", "B+", "B", "C", "D"] as const;
const PASS_RANKS = ["A", "B", "C", "D"] as const;
const RANK_SCORE: Record<string, number> = { A: 4, "B+": 3, B: 2, C: 1, D: 0 };
// 総合評価表（本人希望 × 通過率 → 総合）。step1〜4 と同じ
const TABLE: Record<string, string> = {
  AA: "A", AB: "B+", BA: "B+", AC: "B", AD: "B", BB: "B", BC: "C", BD: "C",
  CA: "C", CB: "C", CC: "C", CD: "D", DA: "D", DB: "D", DC: "D", DD: "D",
};
// step5 の基準値（Opus 4.6・2026-08-26〜09-24・手動）
const BASE_OVERALL: Record<string, number> = { A: 13, "B+": 27, B: 27, C: 27, D: 6 };
const BASE_PASS: Record<string, number> = { A: 34, B: 47, C: 12, D: 6 };

const RATING_RE = "B\\+|A|B|C|D";

function jst(d: Date | null | undefined): string {
  return d ? d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }).slice(0, 16) : "";
}
function yen(usd: number): string {
  return `¥${(usd * JPY_PER_USD).toFixed(1)}`;
}
function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "-";
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function dist(values: string[], ranks: readonly string[]): string {
  const c: Record<string, number> = {};
  for (const v of values) c[v] = (c[v] ?? 0) + 1;
  const n = values.length;
  return ranks.map((r) => `${r} ${c[r] ?? 0}（${pct(c[r] ?? 0, n)}）`).join(" / ");
}
function sha256(t: string): string {
  return createHash("sha256").update(t, "utf8").digest("hex");
}
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return fs.writeFileSync(file, "");
  const cols = Object.keys(rows[0]);
  const body = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  fs.writeFileSync(file, "﻿" + body, "utf8");
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function axis(comment: string | null | undefined, label: string): string | null {
  const m = (comment ?? "").match(new RegExp(`■\\s*${label}[：:]\\s*(${RATING_RE})`));
  return m ? m[1] : null;
}
function head(v: string | null | undefined): string | null {
  const m = (v ?? "").match(new RegExp(`^(${RATING_RE})`));
  return m ? m[1] : null;
}
/** 会社名の照合キー（法人格・空白・記号を落とす） */
function normCompany(s: string): string {
  return stripCorpSuffixes(s).replace(/[\s　・･\-－―（）()【】「」『』]/g, "").toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// 第1部
// ─────────────────────────────────────────────────────────────

type CardLine = { label: string; key: string; overall: string; desire: string; pass: string };
function parseCard(content: string): CardLine[] {
  const out: CardLine[] = [];
  let cur: string | null = null;
  for (const raw of content.split("\n")) {
    const t = raw.trim();
    const h = t.match(new RegExp(`^■\\s*総合(${RATING_RE})`));
    if (h) {
      cur = h[1];
      continue;
    }
    const m = t.match(new RegExp(`^・(.+?)\\s*[—–-]+\\s*本人希望[:：]\\s*(${RATING_RE})\\s*/\\s*通過率[:：]\\s*(${RATING_RE})`));
    if (m && cur) out.push({ label: m[1], key: normCompany(m[1].replace(/（.*$/, "").replace(/※.*$/, "")), overall: cur, desire: m[2], pass: m[3] });
  }
  return out;
}

type SnapshotPast = { rating: string; comment: string; source: string };
function loadSnapshots(): Map<string, SnapshotPast> {
  const map = new Map<string, SnapshotPast>();
  const tryLoad = (file: string, pick: (f: any) => SnapshotPast | null) => {
    const p = path.join(__dirname, "output", file);
    if (!fs.existsSync(p)) return;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const f of j.files ?? []) {
        const v = pick(f);
        if (v && f.id && !map.has(f.id)) map.set(f.id, v);
      }
    } catch {
      /* 手元に無い・壊れている場合は使わない */
    }
  };
  tryLoad("t-xxx-opus55-outcomes/plan.json", (f) => (f.past?.comment ? { rating: head(f.past.rating) ?? "", comment: f.past.comment, source: "snapshot(step4)" } : null));
  tryLoad("t-xxx-eval-compare/plan.json", (f) => (f.pastComment ? { rating: head(f.pastRatingRaw ?? f.pastRating) ?? "", comment: f.pastComment, source: "snapshot(step1)" } : null));
  return map;
}

async function part1(md: string[]) {
  const now = new Date();
  const since48 = new Date(now.getTime() - 48 * 3600 * 1000);
  md.push(`# 第1部 切り替え後の評価（集計時刻 ${jst(now)} JST・直近48時間 = ${jst(since48)} 以降）`, "");

  const test = await prisma.candidate.findFirst({ where: { candidateNumber: TEST_CANDIDATE_NUMBER }, select: { id: true } });
  const testId = test?.id ?? "";

  const firstSwitch = await prisma.advisorUsageLog.findFirst({
    where: { endpoint: { in: ["analyze-batch", "recommend-analyze"] }, model: "claude-opus-5-5" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  md.push(`- 求人評価で最初に claude-opus-5-5 が記録された時刻: ${jst(firstSwitch?.createdAt)} JST`, "");

  // 1-1-a CA × 求職者 × モデル（AdvisorUsageLog の run を完了カードのセッションに寄せて CA を特定）
  const logs = await prisma.advisorUsageLog.findMany({
    where: { endpoint: "analyze-batch", createdAt: { gte: since48 } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, candidateId: true, model: true, batchIndex: true, batchTotal: true, fileCount: true, costUsd: true, note: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
  });
  const cands = await prisma.candidate.findMany({
    where: { id: { in: [...new Set(logs.map((l) => l.candidateId).filter((x): x is string => !!x))] } },
    select: { id: true, candidateNumber: true, employee: { select: { name: true } } },
  });
  const candNo = new Map(cands.map((c) => [c.id, c.candidateNumber]));
  const candCa = new Map(cands.map((c) => [c.id, c.employee?.name ?? "-"]));

  // 記録（切り替え後）の run → 実行者（セッション作成者）
  const recs = await prisma.jobEvalRecord.findMany({
    where: { createdAt: { gte: since48 }, route: { not: "auto" } },
    orderBy: { createdAt: "asc" },
  });
  const sessionIds = [...new Set(recs.map((r) => r.requestKey.split(":")[0]))];
  const sessions = await prisma.advisorChatSession.findMany({
    where: { id: { in: sessionIds } },
    select: { id: true, createdBy: { select: { name: true } } },
  });
  const sessUser = new Map(sessions.map((s) => [s.id, s.createdBy?.name ?? "-"]));
  const userOfLog = new Map<string, string>();
  for (const r of recs) if (r.usageLogId) userOfLog.set(r.usageLogId, sessUser.get(r.requestKey.split(":")[0]) ?? "-");

  // 切り替え前（4.6）の run は完了カードのセッション作成者で特定（最終バッチの直後に書かれる）
  const cards = await prisma.advisorChatMessage.findMany({
    where: { kind: "ANALYSIS", role: "assistant", createdAt: { gte: new Date(since48.getTime() - 60 * 24 * 3600 * 1000) } },
    select: { createdAt: true, content: true, session: { select: { candidateId: true, createdBy: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  // run 単位にまとめる（同じ求職者で batchIndex=0 から始まる連続）
  type Run = { cand: string; model: string; user: string; logs: typeof logs };
  const runs: Run[] = [];
  const openRun = new Map<string, Run>();
  for (const l of logs) {
    const c = l.candidateId ?? "";
    let r = openRun.get(c);
    if (!r || l.batchIndex === 0 || r.model !== l.model) {
      r = { cand: c, model: l.model, user: "", logs: [] };
      runs.push(r);
      openRun.set(c, r);
    }
    r.logs.push(l);
  }
  for (const r of runs) {
    const u = r.logs.map((l) => userOfLog.get(l.id)).find((x) => x);
    if (u) {
      r.user = u;
      continue;
    }
    const last = r.logs[r.logs.length - 1].createdAt.getTime();
    const card = cards.find((m) => m.session.candidateId === r.cand && m.createdAt.getTime() >= last - 5000 && m.createdAt.getTime() <= last + 10 * 60 * 1000);
    r.user = card?.session.createdBy?.name ?? "(不明)";
  }

  md.push("## 1-1-a 直近48時間の手動評価（run 単位・大野テストは別掲）", "");
  md.push("| 実行者（セッション作成者） | 求職者ID | 担当CA | モデル | run数 | 送信 | AI評価件数 | 開始〜終了（JST） | 費用 |");
  md.push("|--|--|--|--|--:|--:|--:|--|--:|");
  const byKey = new Map<string, { user: string; cand: string; model: string; runs: number; sends: number; files: number; first: Date; last: Date; cost: number }>();
  for (const r of runs) {
    const k = `${r.user}|${r.cand}|${r.model}`;
    const a = byKey.get(k) ?? { user: r.user, cand: r.cand, model: r.model, runs: 0, sends: 0, files: 0, first: r.logs[0].createdAt, last: r.logs[0].createdAt, cost: 0 };
    a.runs++;
    for (const l of r.logs) {
      a.sends++;
      a.files += l.fileCount ?? 0;
      a.cost += l.costUsd;
      if (l.createdAt > a.last) a.last = l.createdAt;
    }
    byKey.set(k, a);
  }
  for (const a of [...byKey.values()].sort((x, y) => x.first.getTime() - y.first.getTime())) {
    const no = candNo.get(a.cand) ?? "-";
    md.push(`| ${a.user} | ${no}${a.cand === testId ? "（大野テスト）" : ""} | ${candCa.get(a.cand) ?? "-"} | ${a.model} | ${a.runs} | ${a.sends} | ${a.files} | ${jst(a.first)}〜${jst(a.last).slice(11)} | ${yen(a.cost)} |`);
  }
  md.push("");

  // 1-1-b Opus 5.5 の動作（大野テスト除く）
  const logs55 = logs.filter((l) => l.model === "claude-opus-5-5" && l.candidateId !== testId);
  const recs55 = recs.filter((r) => r.model === "claude-opus-5-5" && r.candidateId !== testId);
  const byStatus: Record<string, number> = {};
  for (const r of recs55) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const saved = recs55.filter((r) => r.status === "SAVED");
  const errLogs = logs55.filter((l) => l.note?.startsWith("error-")).length;
  const maxTok = logs55.filter((l) => l.note?.includes("stop-max_tokens")).length;
  const noAxes = saved.filter((r) => !r.desireRating || !r.passRating || !r.overallRating).length;
  const violations = saved.filter((r) => r.desireRating && r.passRating && r.overallRating && TABLE[r.desireRating + r.passRating] !== r.overallRating);

  // 記録の入り方: 送信（AdvisorUsageLog）ごとに fileCount と SAVED+SKIPPED+FAILED の件数が一致するか
  const recByLog = new Map<string, number>();
  for (const r of recs55) if (r.usageLogId && r.status !== "REUSED") recByLog.set(r.usageLogId, (recByLog.get(r.usageLogId) ?? 0) + 1);
  let logMatch = 0;
  const logMismatch: string[] = [];
  for (const l of logs55) {
    const n = recByLog.get(l.id) ?? 0;
    if (n === (l.fileCount ?? 0)) logMatch++;
    else logMismatch.push(`${l.id}: fileCount=${l.fileCount} records=${n}`);
  }
  const recNoLog = recs55.filter((r) => r.status !== "REUSED" && !r.usageLogId).length;
  const reusedBad = recs55.filter((r) => r.status === "REUSED" && !r.reusedFromId).length;
  // 部品の参照切れ
  const hashes = new Set<string>();
  for (const r of recs55) {
    for (const h of [r.fixedHash, r.instructionHash, r.contextCoreHash, r.contextFilesHash, r.jobHash]) if (h) hashes.add(h);
  }
  const partsFound = await prisma.jobEvalPart.findMany({ where: { hash: { in: [...hashes] } }, select: { hash: true, kind: true } });
  const missingParts = hashes.size - partsFound.length;

  md.push("## 1-1-b Opus 5.5 の動作（切り替え後・大野テスト除く）", "");
  md.push("| 項目 | 件数 |", "|--|--:|");
  md.push(`| 送信（AdvisorUsageLog） | ${logs55.length} |`);
  md.push(`| AI に送った求人（fileCount 合計） | ${logs55.reduce((s, l) => s + (l.fileCount ?? 0), 0)} |`);
  md.push(`| job_eval_records: SAVED / REUSED / SKIPPED(形式崩れ) / FAILED / PENDING | ${byStatus.SAVED ?? 0} / ${byStatus.REUSED ?? 0} / ${byStatus.SKIPPED ?? 0} / ${byStatus.FAILED ?? 0} / ${byStatus.PENDING ?? 0} |`);
  md.push(`| API エラー（note=error-*） | ${errLogs} |`);
  md.push(`| 途切れ（stop-max_tokens） | ${maxTok} |`);
  md.push(`| SAVED のうち3軸が取り出せない行 | ${noAxes} |`);
  md.push(`| 総合評価表の破り（本人希望×通過率と総合の食い違い） | ${violations.length} / ${saved.length} |`);
  md.push(`| 送信ごとの記録件数が fileCount と一致 | ${logMatch} / ${logs55.length} |`);
  md.push(`| 記録に usage_log_id が無い（REUSED 以外） | ${recNoLog} |`);
  md.push(`| REUSED なのに reused_from_id が無い | ${reusedBad} |`);
  md.push(`| 参照している部品ハッシュ / 見つからない部品 | ${hashes.size} / ${missingParts} |`);
  md.push("");
  if (logMismatch.length) md.push("不一致の送信:", ...logMismatch.map((s) => `- ${s}`), "");
  if (violations.length) md.push("表の破り:", ...violations.map((r) => `- record ${r.id}: 本人希望${r.desireRating}×通過率${r.passRating}→総合${r.overallRating}（表では${TABLE[r.desireRating! + r.passRating!]}）`), "");

  // 1-1-c ランク分布
  const ov = saved.map((r) => r.overallRating ?? "-");
  const ps = saved.map((r) => r.passRating ?? "-");
  const cnt = (xs: string[], r: string) => xs.filter((x) => x === r).length;
  md.push("## 1-1-c ランク分布（Opus 5.5 SAVED・大野テスト除く）と step5 基準値（Opus 4.6・30日）", "");
  md.push(`n = ${saved.length}`, "");
  md.push("| 総合 | " + RANKS.join(" | ") + " |", "|--|" + RANKS.map(() => "--:").join("|") + "|");
  md.push("| Opus 5.5 | " + RANKS.map((r) => `${cnt(ov, r)}（${pct(cnt(ov, r), ov.length)}）`).join(" | ") + " |");
  md.push("| 基準 4.6 | " + RANKS.map((r) => `${BASE_OVERALL[r]}%`).join(" | ") + " |", "");
  md.push("| 通過率 | " + PASS_RANKS.join(" | ") + " |", "|--|" + PASS_RANKS.map(() => "--:").join("|") + "|");
  md.push("| Opus 5.5 | " + PASS_RANKS.map((r) => `${cnt(ps, r)}（${pct(cnt(ps, r), ps.length)}）`).join(" | ") + " |");
  md.push("| 基準 4.6 | " + PASS_RANKS.map((r) => `${BASE_PASS[r]}%`).join(" | ") + " |", "");
  // CA 別
  const byUser = new Map<string, string[]>();
  for (const r of saved) {
    const u = sessUser.get(r.requestKey.split(":")[0]) ?? "-";
    byUser.set(u, [...(byUser.get(u) ?? []), r.overallRating ?? "-"]);
  }
  md.push("実行者別（総合）:", "");
  for (const [u, xs] of byUser) md.push(`- ${u}: n=${xs.length} ${dist(xs, RANKS)}`);
  md.push("");

  // 1-1-d 同じ求人の 4.6 → 5.5
  const snapshots = loadSnapshots();
  const files = await prisma.candidateFile.findMany({
    where: { id: { in: [...new Set(saved.map((r) => r.candidateFileId))] } },
    select: { id: true, fileName: true, createdAt: true, candidateId: true },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));
  type Change = { rec: (typeof saved)[number]; prev: { overall: string; desire: string | null; pass: string | null; comment: string | null; source: string; at: Date | null } | null; reason: string };
  const changes: Change[] = [];
  // 同じ求人に複数の 5.5 SAVED がある場合は最初のもの（4.6 との比較が目的）
  const firstRec = new Map<string, (typeof saved)[number]>();
  for (const r of saved) if (!firstRec.has(r.candidateFileId)) firstRec.set(r.candidateFileId, r);
  for (const rec of firstRec.values()) {
    const f = fileById.get(rec.candidateFileId);
    let prev: Change["prev"] = null;
    let reason = "";
    if (f) {
      // 4.6 の完了カード（この求人の登録後〜この評価の前）を新しい順に見て、会社名で一意に一致した行
      const keys = extractCompanyNameCandidates(f.fileName).map(normCompany).filter((k) => k.length >= 2);
      const candCards = cards
        .filter((m) => m.session.candidateId === rec.candidateId && m.createdAt < rec.createdAt && m.createdAt > f.createdAt && m.createdAt < (firstSwitch?.createdAt ?? rec.createdAt))
        .reverse();
      for (const m of candCards) {
        const lines = parseCard(m.content);
        const hits = lines.filter((ln) => keys.some((k) => ln.key.startsWith(k) || k.startsWith(ln.key)));
        if (hits.length === 1) {
          prev = { overall: hits[0].overall, desire: hits[0].desire, pass: hits[0].pass, comment: null, source: "完了カード", at: m.createdAt };
          break;
        }
        if (hits.length > 1) {
          const same = new Set(hits.map((h) => h.overall));
          if (same.size === 1) {
            prev = { overall: hits[0].overall, desire: null, pass: null, comment: null, source: "完了カード(同社複数・同ランク)", at: m.createdAt };
            break;
          }
          reason = "同じ会社の行が複数で特定不能";
        }
      }
      const snap = snapshots.get(rec.candidateFileId);
      if (snap) {
        if (!prev) prev = { overall: snap.rating, desire: axis(snap.comment, "本人希望"), pass: axis(snap.comment, "通過率"), comment: snap.comment, source: snap.source, at: null };
        else if (!prev.comment) prev.comment = snap.comment;
      }
      if (!prev && !reason) reason = candCards.length === 0 ? "4.6 の評価なし（新しい求人）" : "カードに一致する行なし";
    }
    changes.push({ rec, prev, reason });
  }
  const withPrev = changes.filter((c) => c.prev && RANK_SCORE[c.prev.overall] !== undefined && c.rec.overallRating);
  const up = withPrev.filter((c) => RANK_SCORE[c.rec.overallRating!] > RANK_SCORE[c.prev!.overall]);
  const same = withPrev.filter((c) => RANK_SCORE[c.rec.overallRating!] === RANK_SCORE[c.prev!.overall]);
  const down = withPrev.filter((c) => RANK_SCORE[c.rec.overallRating!] < RANK_SCORE[c.prev!.overall]);
  const reasons: Record<string, number> = {};
  for (const c of changes.filter((c) => !c.prev)) reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
  md.push("## 1-1-d 同じ求人の Opus 4.6 → 5.5（総合）", "");
  md.push(`- 5.5 で評価した求人（重複除く）: ${changes.length}件。うち 4.6 の評価が見つかったもの: ${withPrev.length}件`);
  md.push(`- 上がった ${up.length} / 同じ ${same.length} / 下がった ${down.length}`);
  md.push(`- 4.6 が見つからない内訳: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  const mat: Record<string, Record<string, number>> = {};
  for (const c of withPrev) {
    mat[c.prev!.overall] ??= {};
    mat[c.prev!.overall][c.rec.overallRating!] = (mat[c.prev!.overall][c.rec.overallRating!] ?? 0) + 1;
  }
  md.push("", "| 4.6 ＼ 5.5 | " + RANKS.join(" | ") + " |", "|--|" + RANKS.map(() => "--:").join("|") + "|");
  for (const a of RANKS) md.push(`| ${a} | ` + RANKS.map((b) => mat[a]?.[b] ?? 0).join(" | ") + " |");
  const axisPrev = withPrev.filter((c) => c.prev!.desire && c.prev!.pass);
  const axDown = (k: "desire" | "pass") =>
    axisPrev.filter((c) => RANK_SCORE[(k === "desire" ? c.rec.desireRating : c.rec.passRating)!] < RANK_SCORE[c.prev![k]!]).length;
  const axUp = (k: "desire" | "pass") =>
    axisPrev.filter((c) => RANK_SCORE[(k === "desire" ? c.rec.desireRating : c.rec.passRating)!] > RANK_SCORE[c.prev![k]!]).length;
  md.push("", `- 軸別（4.6 の3軸が分かる ${axisPrev.length}件）: 本人希望 上がる${axUp("desire")}・下がる${axDown("desire")} / 通過率 上がる${axUp("pass")}・下がる${axDown("pass")}`, "");

  // 明細 CSV（コミットしない）
  writeCsv(
    path.join(OUT_DIR, "part1-rank-changes.csv"),
    changes.map((c) => ({
      recordId: c.rec.id,
      candidateNumber: candNo.get(c.rec.candidateId) ?? "",
      candidateFileId: c.rec.candidateFileId,
      fileName: fileById.get(c.rec.candidateFileId)?.fileName ?? "",
      evaluatedAtJst: jst(c.rec.createdAt),
      route: c.rec.route,
      overall55: c.rec.overallRating,
      desire55: c.rec.desireRating,
      pass55: c.rec.passRating,
      overall46: c.prev?.overall ?? "",
      desire46: c.prev?.desire ?? "",
      pass46: c.prev?.pass ?? "",
      source46: c.prev?.source ?? c.reason,
      change: c.prev && c.rec.overallRating ? Math.sign(RANK_SCORE[c.rec.overallRating] - RANK_SCORE[c.prev.overall]) : "",
    })),
  );

  // 比較 HTML（下がった求人を中心に最大10件）
  const pickHtml = [...down.sort((a, b) => (b.prev!.comment ? 1 : 0) - (a.prev!.comment ? 1 : 0) || RANK_SCORE[b.prev!.overall] - RANK_SCORE[b.rec.overallRating!] - (RANK_SCORE[a.prev!.overall] - RANK_SCORE[a.rec.overallRating!])), ...up].slice(0, 10);
  const html = [
    `<!doctype html><meta charset="utf-8"><title>Opus 4.6 vs 5.5 評価コメント比較</title>`,
    `<style>body{font-family:sans-serif;margin:16px;background:#fff;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;vertical-align:top;padding:8px;font-size:13px}pre{white-space:pre-wrap;margin:0;font-family:inherit}h2{font-size:15px;margin-top:28px}.m{color:#666}</style>`,
    `<h1>Opus 4.6 → 5.5 評価コメント比較（ランクが下がった求人を中心に${pickHtml.length}件）</h1>`,
    `<p class="m">集計 ${esc(jst(now))} JST。4.6 側は完了カードの行（3軸のみ）または手元スナップショット（全文）。社外秘・コミットしない。</p>`,
  ];
  for (const c of pickHtml) {
    const f = fileById.get(c.rec.candidateFileId);
    html.push(`<h2>${esc(f?.fileName ?? c.rec.candidateFileId)}（求職者 ${esc(candNo.get(c.rec.candidateId) ?? "")}）: 総合 ${c.prev!.overall} → ${c.rec.overallRating}</h2>`);
    html.push(`<table><tr><th>Opus 4.6（${esc(c.prev!.source)}${c.prev!.at ? " " + esc(jst(c.prev!.at)) : ""}）</th><th>Opus 5.5（${esc(jst(c.rec.createdAt))}）</th></tr>`);
    const prevText = c.prev!.comment ?? `（全文なし）本人希望:${c.prev!.desire ?? "-"} / 通過率:${c.prev!.pass ?? "-"} / 総合:${c.prev!.overall}`;
    html.push(`<tr><td><pre>${esc(prevText)}</pre></td><td><pre>${esc(c.rec.comment ?? "")}</pre></td></tr></table>`);
  }
  if (pickHtml.length === 0) {
    // 4.6 と比べられる求人が無い場合は、5.5 の低いランク（D → C）のコメントを最大10件並べて中身を確認できるようにする
    const low = [...saved].sort((a, b) => (RANK_SCORE[a.overallRating ?? "D"] ?? 0) - (RANK_SCORE[b.overallRating ?? "D"] ?? 0)).slice(0, 10);
    html.push(`<p><b>4.6 の評価がある求人が無かったため（${changes.length}件すべて切り替え後に初めて評価された求人）、Opus 5.5 の総合が低い順に${low.length}件のコメントを載せる。</b></p>`);
    for (const r of low) {
      html.push(`<h2>${esc(fileById.get(r.candidateFileId)?.fileName ?? r.candidateFileId)}（求職者 ${esc(candNo.get(r.candidateId) ?? "")}・${esc(jst(r.createdAt))}）: 本人希望 ${r.desireRating} / 通過率 ${r.passRating} / 総合 ${r.overallRating}</h2>`);
      html.push(`<table><tr><td><pre>${esc(r.comment ?? "")}</pre></td></tr></table>`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "part1-compare.html"), html.join("\n"), "utf8");

  // 1-1-e 費用・時間・スキップ
  const cost55 = logs55.reduce((s, l) => s + l.costUsd, 0);
  const files55 = logs55.reduce((s, l) => s + (l.fileCount ?? 0), 0);
  const reused = recs55.filter((r) => r.status === "REUSED").length;
  // 1バッチの所要時間: 同じ run の連続するバッチ記録の間隔（1バッチ = AI 応答 + 保存。画面は逐次送信）
  const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const logs30 = await prisma.advisorUsageLog.findMany({
    where: { endpoint: "analyze-batch", createdAt: { gte: since30 }, candidateId: { not: testId } },
    orderBy: { createdAt: "asc" },
    select: { candidateId: true, model: true, batchIndex: true, batchTotal: true, fileCount: true, createdAt: true, costUsd: true },
  });
  const gaps: Record<string, number[]> = {};
  const runSpans: Record<string, number[]> = {};
  const lastByCand = new Map<string, (typeof logs30)[number]>();
  const runStart = new Map<string, (typeof logs30)[number]>();
  for (const l of logs30) {
    const c = l.candidateId ?? "";
    const prev = lastByCand.get(c);
    if (l.batchIndex === 0) runStart.set(c, l);
    if (prev && l.batchIndex === (prev.batchIndex ?? -9) + 1 && prev.model === l.model) {
      const g = (l.createdAt.getTime() - prev.createdAt.getTime()) / 1000;
      if (g > 0 && g < 600) (gaps[l.model] ??= []).push(g);
    }
    if (l.batchTotal && l.batchIndex === l.batchTotal - 1 && l.batchTotal >= 2) {
      const s = runStart.get(c);
      if (s && s.model === l.model) {
        const span = (l.createdAt.getTime() - s.createdAt.getTime()) / 1000;
        // 先頭バッチの所要時間は記録間隔から見えないので、1バッチ分（中央値）を足す
        (runSpans[l.model] ??= []).push((span * l.batchTotal) / (l.batchTotal - 1));
      }
    }
    lastByCand.set(c, l);
  }
  const perFile = (m: string) => {
    const ls = logs30.filter((l) => l.model === m);
    const f = ls.reduce((s, l) => s + (l.fileCount ?? 0), 0);
    return f > 0 ? ls.reduce((s, l) => s + l.costUsd, 0) / f : 0;
  };
  md.push("## 1-1-e 費用・時間・スキップ（大野テスト除く）", "");
  md.push("| 項目 | Opus 4.6（直近30日） | Opus 5.5（切り替え後） |", "|--|--:|--:|");
  md.push(`| 1件あたり費用（費用 ÷ AI に送った求人数） | ${yen(perFile("claude-opus-4-6"))} | ${yen(perFile("claude-opus-5-5"))}（${yen(cost55)} ÷ ${files55}件） |`);
  md.push(`| 1バッチ（最大5件）の所要時間 中央値 | ${Math.round(median(gaps["claude-opus-4-6"] ?? []))}秒（n=${gaps["claude-opus-4-6"]?.length ?? 0}） | ${Math.round(median(gaps["claude-opus-5-5"] ?? []))}秒（n=${gaps["claude-opus-5-5"]?.length ?? 0}） |`);
  md.push(`| 1回の実行（2バッチ以上の run）の所要時間 中央値 | ${Math.round(median(runSpans["claude-opus-4-6"] ?? []))}秒（n=${runSpans["claude-opus-4-6"]?.length ?? 0}） | ${Math.round(median(runSpans["claude-opus-5-5"] ?? []))}秒（n=${runSpans["claude-opus-5-5"]?.length ?? 0}） |`);
  md.push(`| スキップ（前回の結果を使用・REUSED） | - | ${reused}件（AI に送った ${files55}件に対し） |`);
  md.push("");

  // 1-2 自動配信
  md.push("## 1-2 自動配信", "");
  const autoLogs = await prisma.advisorUsageLog.findMany({
    where: { endpoint: "recommend-analyze", createdAt: { gte: since48 } },
    select: { model: true, fileCount: true },
  });
  const lastAuto = await prisma.advisorUsageLog.findFirst({ where: { endpoint: "recommend-analyze" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, model: true } });
  const ledger = await prisma.recommendAnalyzeBatch.groupBy({ by: ["status"], _count: { _all: true }, where: { submittedAt: { gte: since48 } } });
  const ledgerOpen = await prisma.recommendAnalyzeBatch.count({ where: { status: { in: ["RESERVED", "SUBMITTED", "COLLECTING"] } } });
  const autoRecs = await prisma.jobEvalRecord.groupBy({ by: ["status", "model"], _count: { _all: true }, where: { route: "auto" } });
  const today = new Date(`${now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}T00:00:00+09:00`);
  const autoToday = await prisma.candidateFile.count({ where: { autoSourcedAt: { gte: today } } });
  const lastAutoFile = await prisma.candidateFile.findFirst({ where: { autoSourcedAt: { not: null } }, orderBy: { autoSourcedAt: "desc" }, select: { autoSourcedAt: true } });
  const auto30 = await prisma.candidateFile.findMany({
    where: { autoSourcedAt: { gte: since30 }, aiAnalyzedAt: { not: null } },
    select: { rejectedReason: true },
  });
  md.push(`- 直近48時間の自動配信の評価（recommend-analyze）: ${autoLogs.length}送信・${autoLogs.reduce((s, l) => s + (l.fileCount ?? 0), 0)}件（モデル: ${[...new Set(autoLogs.map((l) => l.model))].join(", ") || "なし"}）`);
  md.push(`- 最後の自動配信の評価: ${jst(lastAuto?.createdAt)} JST（${lastAuto?.model ?? "-"}）`);
  md.push(`- 本日（JST）到着した自動由来の求人: ${autoToday}件（最後の到着 ${jst(lastAutoFile?.autoSourcedAt)} JST）`);
  md.push(`- 台帳（直近48時間の投入）: ${ledger.map((g) => `${g.status} ${g._count._all}`).join(" / ") || "なし"}。未回収（RESERVED/SUBMITTED/COLLECTING）全期間: ${ledgerOpen}件`);
  md.push(`- job_eval_records の自動配信行（全期間）: ${autoRecs.map((g) => `${g.model} ${g.status} ${g._count._all}`).join(" / ") || "なし"}`);
  const d30 = auto30.filter((f) => f.rejectedReason === AUTO_REJECT_REASON_D).length;
  md.push(`- 直近30日の自動配信で評価済みの求人: ${auto30.length}件、うち D で自動除外 ${d30}件（${pct(d30, auto30.length)}）。基準値 375件中137件（37%）`);
  md.push("");
}

// ─────────────────────────────────────────────────────────────
// 第2部
// ─────────────────────────────────────────────────────────────

type KeyFile = { id: string; fileName: string; category: string; mimeType: string | null; parsedText: string | null; driveFileId: string | null; createdAt: Date; advisorIngestedAt: Date | null };
type Scenario = { name: string; meetingCap: number | null; totalCap: number | null; meetingMode: "per-file" | "newest-budget" };

/** getCandidateContext（src/lib/advisor-context.ts）を DB の保存値だけで再現し、評価用に加工する（buildAnalyzeCandidateContext）。 */
async function buildContextPieces(candidateId: string) {
  const [candidate, guideEntry, notes, files, jobEntries] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: candidateId }, include: { employee: { select: { name: true } } } }),
    prisma.guideEntry.findFirst({ where: { candidateId, guideType: "INTERVIEW" } }),
    prisma.candidateNote.findMany({ where: { candidateId }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
    prisma.candidateFile.findMany({ where: { candidateId }, select: { category: true, fileName: true }, orderBy: { createdAt: "desc" } }),
    prisma.jobEntry.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      select: { companyName: true, jobTitle: true, entryFlag: true, entryFlagDetail: true, documentSubmitDate: true, documentPassDate: true, firstInterviewDate: true, finalInterviewDate: true, offerDate: true, acceptanceDate: true, joinDate: true },
    }),
  ]);
  if (!candidate) return null;
  const g = (guideEntry?.data ?? {}) as Record<string, unknown>;
  let pre = "";
  pre += `## 求職者の基本情報\n- 氏名: ${candidate.name}\n- ID: ${candidate.candidateNumber}\n`;
  if (candidate.email) pre += `- メール: ${candidate.email}\n`;
  if (candidate.birthday) {
    const age = Math.floor((Date.now() - new Date(candidate.birthday).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    pre += `- 生年月日: ${new Date(candidate.birthday).toISOString().slice(0, 10)}\n- 年齢: ${age}歳\n`;
  }
  if (candidate.gender) pre += `- 性別: ${candidate.gender === "male" ? "男性" : candidate.gender === "female" ? "女性" : "その他"}\n`;
  pre += `- 担当CA: ${candidate.employee?.name || "未設定"}\n- 登録日: ${candidate.createdAt.toISOString().slice(0, 10)}\n\n`;
  const hasDigest = !!candidate.advisorLogDigest?.trim();
  let digestLen = 0;
  if (hasDigest) {
    const dd = candidate.advisorLogDigestUpdatedAt ? candidate.advisorLogDigestUpdatedAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "";
    const block = `## 面談内容の要約（取り込み済みの面談ログより${dd ? `・${dd}更新` : ""}）\n${candidate.advisorLogDigest!.trim()}\n\n`;
    pre += block;
    digestLen = block.length;
  }
  const beforeDigestLen = pre.length - digestLen;
  if (g.worksheet_q1 || g.worksheet_q2 || g.worksheet_q3) {
    pre += `## 転職軸ワークシート\n`;
    if (g.worksheet_q1) pre += `### なぜ転職するのか？\n${g.worksheet_q1}\n\n`;
    if (g.worksheet_q2) pre += `### 何を大切にして働きたいか？\n${g.worksheet_q2}\n\n`;
    if (g.worksheet_q3) pre += `### どんな自分になりたいか？\n${g.worksheet_q3}\n\n`;
  }
  if (g.prep_point || g.prep_reason || g.prep_example || g.prep_point2) {
    pre += `## PREP法練習シート\n`;
    if (g.prep_point) pre += `- Point（結論）: ${g.prep_point}\n`;
    if (g.prep_reason) pre += `- Reason（理由）: ${g.prep_reason}\n`;
    if (g.prep_example) pre += `- Example（具体例）: ${g.prep_example}\n`;
    if (g.prep_point2) pre += `- Point（再結論）: ${g.prep_point2}\n`;
    pre += "\n";
  }
  if (g.ai_generated_axis) pre += `## AI自己分析レポート\n${g.ai_generated_axis}\n\n`;
  const resumeLen = g.parsed_resume ? String(g.parsed_resume).length : 0;
  if (g.parsed_resume) pre += `## 職務経歴書（解析テキスト）\n${g.parsed_resume}\n\n`;
  let notesLen = 0;
  if (notes.length > 0) {
    const s0 = pre.length;
    pre += `## CAメモ（${notes.length}件）\n`;
    for (const n of notes) pre += `- ${n.author.name} (${n.createdAt.toISOString().slice(0, 10)}): ${n.content}\n`;
    pre += "\n";
    notesLen = pre.length - s0;
  }
  let fileListLen = 0;
  if (files.length > 0) {
    const s0 = pre.length;
    pre += `## アップロード済みファイル\n`;
    for (const f of files) pre += `- [${getCategoryLabel(f.category)}] ${f.fileName}\n`;
    pre += "\n";
    fileListLen = pre.length - s0;
  }
  const keyFiles: KeyFile[] = await prisma.candidateFile.findMany({
    where: {
      candidateId,
      category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
      mimeType: { in: ["application/pdf", "text/plain"] },
      ...(hasDigest ? { NOT: { category: "MEETING", mimeType: "text/plain" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: KEY_FILES_TAKE,
    select: { id: true, driveFileId: true, fileName: true, category: true, mimeType: true, parsedText: true, createdAt: true, advisorIngestedAt: true },
  });
  // 面談 txt（全件。枠4件・ダイジェストで落ちたものも含めて数える）
  const meetings = await prisma.candidateFile.findMany({
    where: { candidateId, category: "MEETING", mimeType: { startsWith: "text/" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, mimeType: true, parsedText: true, createdAt: true, advisorIngestedAt: true, archivedAt: true, driveFileId: true, fileSize: true },
  });
  const keyCandidatesAll = await prisma.candidateFile.count({
    where: {
      candidateId,
      category: { in: ["ORIGINAL", "BS_DOCUMENT", "MEETING"] },
      mimeType: { in: ["application/pdf", "text/plain"] },
      ...(hasDigest ? { NOT: { category: "MEETING", mimeType: "text/plain" } } : {}),
    },
  });
  let post = "";
  if (jobEntries.length > 0) {
    const es = jobEntries.slice(0, JOB_ENTRIES_TAKE);
    post += `## 応募履歴（直近${es.length}件）\n`;
    for (const e of es) {
      post += `- ${e.companyName || "不明"} / ${e.jobTitle || "不明"} — ${e.entryFlag || "不明"}${e.entryFlagDetail ? `（${e.entryFlagDetail}）` : ""}`;
      if (e.documentSubmitDate) post += ` / 書類提出: ${e.documentSubmitDate.toISOString().slice(0, 10)}`;
      if (e.documentPassDate) post += ` / 書類通過: ${e.documentPassDate.toISOString().slice(0, 10)}`;
      if (e.firstInterviewDate) post += ` / 一次面接: ${e.firstInterviewDate.toISOString().slice(0, 10)}`;
      if (e.finalInterviewDate) post += ` / 最終面接: ${e.finalInterviewDate.toISOString().slice(0, 10)}`;
      if (e.offerDate) post += ` / 内定: ${e.offerDate.toISOString().slice(0, 10)}`;
      if (e.acceptanceDate) post += ` / 承諾: ${e.acceptanceDate.toISOString().slice(0, 10)}`;
      if (e.joinDate) post += ` / 入社: ${e.joinDate.toISOString().slice(0, 10)}`;
      post += "\n";
    }
    post += "\n";
  }
  return { candidate, pre, post, keyFiles, meetings, hasDigest, digestLen, beforeDigestLen, resumeLen, notesLen, fileListLen, jobEntryCount: jobEntries.length, keyCandidatesAll };
}

type Pieces = NonNullable<Awaited<ReturnType<typeof buildContextPieces>>>;

/** シナリオ別に評価用 context を組み立て、面談 txt ごとに「送られた字数」を返す。 */
function assemble(p: Pieces, sc: Scenario) {
  let ctx = p.pre;
  const sentByFile = new Map<string, { start: number; len: number; raw: number }>();
  const meetingIdx = p.keyFiles.filter((f) => f.mimeType === "text/plain" && f.driveFileId);
  // newest-budget: 現行と同じ総字数（各 min(len, 8000) の合計）を新しい面談から順に満たす
  let budget = sc.meetingMode === "newest-budget" ? meetingIdx.reduce((s, f) => s + Math.min((f.parsedText ?? "").length, MEETING_TEXT_MAX_CHARS), 0) : 0;
  let unknownParsed = 0;
  if (p.keyFiles.length > 0) {
    ctx += `## 主要書類の内容\n\n`;
    for (const f of p.keyFiles) {
      if (!f.driveFileId) continue;
      let raw = f.parsedText ?? "";
      if (!raw.trim()) {
        unknownParsed++;
        raw = "";
      }
      let text = raw;
      if (f.mimeType === "text/plain") {
        if (sc.meetingMode === "newest-budget") {
          const take = Math.min(raw.length, budget);
          budget -= take;
          text = take < raw.length ? raw.substring(0, take) + "\n...(以下省略)" : raw;
        } else if (sc.meetingCap !== null && raw.length > sc.meetingCap) {
          text = raw.substring(0, sc.meetingCap) + "\n...(以下省略)";
        }
      }
      ctx += `### ${f.fileName}（${getCategoryLabel(f.category)}）\n`;
      const start = ctx.length;
      ctx += `${text}\n\n`;
      if (f.mimeType === "text/plain") sentByFile.set(f.id, { start, len: Math.min(text.length, raw.length), raw: raw.length });
    }
  }
  ctx += p.post;
  // buildAnalyzeCandidateContext: 評価一覧・ブックマーク求人票は getCandidateContext の末尾（応募履歴の後）なので除去後 = ctx.trim()
  ctx = ctx.trim();
  const fullLen = ctx.length;
  if (sc.totalCap !== null && ctx.length > sc.totalCap) ctx = ctx.substring(0, sc.totalCap) + "\n\n...（コンテキストが長いため一部省略）";
  const cut = sc.totalCap !== null && fullLen > sc.totalCap ? sc.totalCap : fullLen;
  // 全体上限で落ちた分を面談ごとに反映
  const delivered = new Map<string, { sent: number; raw: number }>();
  for (const [id, s] of sentByFile) delivered.set(id, { sent: Math.max(0, Math.min(s.len, cut - s.start)), raw: s.raw });
  return { ctx, fullLen, delivered, unknownParsed };
}

function splitCandidateContext(context: string): { core: string; files: string } {
  const header = "## アップロード済みファイル\n";
  const start = context.indexOf(header);
  if (start === -1) return { core: context, files: "" };
  const bodyStart = start + header.length;
  const nextSection = context.indexOf("\n## ", bodyStart);
  const sectionEnd = nextSection === -1 ? context.length : nextSection + 1;
  const section = context.substring(bodyStart, sectionEnd);
  const prefix = `- [${getCategoryLabel("BOOKMARK")}] `;
  const b: string[] = [];
  const o: string[] = [];
  for (const line of section.split("\n")) (line.startsWith(prefix) ? b : o).push(line);
  return { core: context.substring(0, bodyStart) + o.join("\n") + context.substring(sectionEnd), files: b.join("\n") };
}

async function part2(md: string[]) {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  md.push("", `# 第2部 面談テキストの切り詰め（直近30日 = ${jst(since30)} 以降に評価された求職者）`, "");
  const test = await prisma.candidate.findFirst({ where: { candidateNumber: TEST_CANDIDATE_NUMBER }, select: { id: true } });
  const logs = await prisma.advisorUsageLog.findMany({
    where: { endpoint: { in: ["analyze-batch", "recommend-analyze"] }, createdAt: { gte: since30 }, candidateId: { not: test?.id ?? "" } },
    select: { id: true, candidateId: true, endpoint: true, batchIndex: true, fileCount: true, costUsd: true, createdAt: true, model: true, cacheCreationTokens: true, cacheReadTokens: true, inputTokens: true },
  });
  const candIds = [...new Set(logs.map((l) => l.candidateId).filter((x): x is string => !!x))];
  // run 数（手動: batchIndex=0 の送信）・送信数（手動）・自動配信の送信数
  const manualRuns = new Map<string, number>();
  const manualSends = new Map<string, number>();
  const autoSends = new Map<string, number>();
  const filesEval = new Map<string, number>();
  for (const l of logs) {
    const c = l.candidateId!;
    filesEval.set(c, (filesEval.get(c) ?? 0) + (l.fileCount ?? 0));
    if (l.endpoint === "recommend-analyze") autoSends.set(c, (autoSends.get(c) ?? 0) + 1);
    else {
      manualSends.set(c, (manualSends.get(c) ?? 0) + 1);
      if (l.batchIndex === 0) manualRuns.set(c, (manualRuns.get(c) ?? 0) + 1);
    }
  }

  // 文字→トークンの換算: Opus 5.5 の先頭バッチで固定部がキャッシュ読込だった送信は cacheCreation ≒ 候補者 context ブロック
  const recs55 = await prisma.jobEvalRecord.findMany({
    where: { model: "claude-opus-5-5", status: "SAVED", usageLogId: { not: null }, route: { not: "auto" } },
    select: { usageLogId: true, contextCoreHash: true, contextFilesHash: true, candidateId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const logIds = [...new Set(recs55.map((r) => r.usageLogId!))];
  const l55 = await prisma.advisorUsageLog.findMany({ where: { id: { in: logIds } }, select: { id: true, batchIndex: true, cacheCreationTokens: true, cacheReadTokens: true } });
  const partHashes = [...new Set(recs55.flatMap((r) => [r.contextCoreHash, r.contextFilesHash].filter((x): x is string => !!x)))];
  const parts = await prisma.jobEvalPart.findMany({ where: { hash: { in: partHashes } }, select: { hash: true, chars: true } });
  const partChars = new Map(parts.map((p) => [p.hash, p.chars]));
  const ratios: number[] = [];
  for (const l of l55) {
    if (l.batchIndex !== 0 || l.cacheReadTokens < 20000 || l.cacheReadTokens > 23000) continue; // 固定部だけが読込の送信
    const r = recs55.find((x) => x.usageLogId === l.id);
    if (!r) continue;
    const chars = (partChars.get(r.contextCoreHash) ?? 0) + (r.contextFilesHash ? partChars.get(r.contextFilesHash) ?? 0 : 0) + 8;
    if (chars > 1000) ratios.push(l.cacheCreationTokens / chars);
  }
  const TOK_PER_CHAR = ratios.length >= 3 ? median(ratios) : 0.9;
  md.push(`- 文字→トークン換算: ${TOK_PER_CHAR.toFixed(3)} トークン/字（Opus 5.5 の先頭バッチ ${ratios.length}送信の「候補者情報ブロックの書込トークン ÷ 保存された字数」の中央値）`, "");

  // 再現の正しさ: 切り替え後に評価された求職者の最新 context_core とハッシュ比較（その後にデータが変わった人は不一致になりうる）
  const latestCore = new Map<string, string>();
  for (const r of recs55) if (!latestCore.has(r.candidateId)) latestCore.set(r.candidateId, r.contextCoreHash);

  const scenarios: Scenario[] = [
    { name: "現行（面談8,000字・全体20,000字）", meetingCap: 8000, totalCap: 20000, meetingMode: "per-file" },
    { name: "A-16k（面談16,000字・全体20,000字のまま）", meetingCap: 16000, totalCap: 20000, meetingMode: "per-file" },
    { name: "A-24k（面談24,000字・全体20,000字のまま）", meetingCap: 24000, totalCap: 20000, meetingMode: "per-file" },
    { name: "A-16k+全体40k（面談16,000字・全体40,000字）", meetingCap: 16000, totalCap: 40000, meetingMode: "per-file" },
    { name: "A-24k+全体48k（面談24,000字・全体48,000字）", meetingCap: 24000, totalCap: 48000, meetingMode: "per-file" },
    { name: "B（面談の総字数は現行と同じ・新しい面談から順に満たす・全体20,000字）", meetingCap: null, totalCap: 20000, meetingMode: "newest-budget" },
    { name: "C（面談・全体とも上限なし）", meetingCap: null, totalCap: null, meetingMode: "per-file" },
  ];

  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  const meetingRows: Row[] = [];
  const scStats = scenarios.map(() => ({ addChars: [] as number[], changed: 0, costUsd30: 0, reevalFiles: 0, tokSends: 0 }));
  let verified = 0, verifyTried = 0;
  let unknownParsedCands = 0;
  const bookmarkCounts = await prisma.candidateFile.groupBy({ by: ["candidateId"], where: { candidateId: { in: candIds }, category: "BOOKMARK", archivedAt: null }, _count: { _all: true } });
  const bmCount = new Map(bookmarkCounts.map((b) => [b.candidateId, b._count._all]));

  // Opus 5.5 の手動1件あたり費用（一時費用の見積もり用）
  const l55all = await prisma.advisorUsageLog.findMany({ where: { endpoint: "analyze-batch", model: "claude-opus-5-5", candidateId: { not: test?.id ?? "" } }, select: { costUsd: true, fileCount: true } });
  const perFile55 = l55all.reduce((s, l) => s + l.costUsd, 0) / Math.max(1, l55all.reduce((s, l) => s + (l.fileCount ?? 0), 0));

  // 面談 txt の parsedText は「一度 context に読み込まれた」ものにしか無い（枠外・要約ありの人は未保存が多い）。
  // 未保存分は fileSize（UTF-8 バイト）÷ 1字あたりバイト数（保存済み分の中央値）で字数を推定する。
  const calib = await prisma.candidateFile.findMany({
    where: { candidateId: { in: candIds }, category: "MEETING", mimeType: { startsWith: "text/" }, parsedText: { not: null } },
    select: { fileSize: true, parsedText: true },
  });
  const bpcList = calib.filter((c) => (c.parsedText ?? "").length > 1000 && c.fileSize > 0).map((c) => c.fileSize / (c.parsedText ?? "").length);
  const BYTES_PER_CHAR = bpcList.length ? median(bpcList) : 3;
  md.push(`- 面談 txt の字数推定: parsedText 未保存の面談 txt は fileSize ÷ ${BYTES_PER_CHAR.toFixed(2)} バイト/字（保存済み ${bpcList.length}件の中央値）で推定`);
  const estChars = (m: { parsedText: string | null; fileSize: number }) => (m.parsedText && m.parsedText.length > 0 ? m.parsedText.length : Math.round(m.fileSize / BYTES_PER_CHAR));
  const estRows: { est: number; known: boolean }[] = [];
  const dExtra = { changed: 0, addChars: [] as number[], costUsd30: 0, reevalFiles: 0, tokSends: 0 };

  let i = 0;
  for (const cid of candIds) {
    i++;
    if (i % 20 === 0) console.error(`  ${i}/${candIds.length}`);
    const p = await buildContextPieces(cid);
    if (!p) continue;
    const base = assemble(p, scenarios[0]);
    if (base.unknownParsed > 0) unknownParsedCands++;
    // 検証（ブックマーク行を除いた部分のハッシュ）
    const lc = latestCore.get(cid);
    if (lc) {
      verifyTried++;
      if (sha256(splitCandidateContext(base.ctx).core) === lc) verified++;
    }
    const meetingsAll = p.meetings; // 新しい順
    const newest = meetingsAll[0];
    const inKey = new Set(p.keyFiles.map((f) => f.id));
    const newestDel = newest ? base.delivered.get(newest.id) : undefined;
    const newestRaw = newest ? (newest.parsedText ?? "").length : 0;
    let newestState = "面談txtなし";
    if (newest) {
      if (p.hasDigest) newestState = newest.advisorIngestedAt ? "要約に取り込み済み（本文は送らない）" : "要約あり・最新は未取り込み（本文も送らない）";
      else if (!inKey.has(newest.id)) newestState = "主要書類4件の枠外（丸ごと未送信）";
      else if (!newestDel || newestDel.sent === 0) newestState = newestRaw === 0 ? "本文なし（parsedText 未保存）" : "全体20,000字で丸ごと切られた";
      else if (newestDel.sent < newestDel.raw) newestState = "一部切られた";
      else newestState = "全文届いた";
    }
    const sendsM = manualSends.get(cid) ?? 0;
    const runsM = manualRuns.get(cid) ?? 0;
    const sendsA = autoSends.get(cid) ?? 0;
    const row: Row = {
      candidateId: cid,
      candidateNumber: p.candidate.candidateNumber,
      manualRuns30d: runsM,
      manualSends30d: sendsM,
      autoSends30d: sendsA,
      filesEvaluated30d: filesEval.get(cid) ?? 0,
      activeBookmarks: bmCount.get(cid) ?? 0,
      hasDigest: p.hasDigest,
      digestChars: p.digestLen,
      resumeChars: p.resumeLen,
      notesChars: p.notesLen,
      fileListChars: p.fileListLen,
      meetingTxtCount: meetingsAll.length,
      meetingTxtCharsTotal: meetingsAll.reduce((s, m) => s + (m.parsedText ?? "").length, 0),
      meetingTxtOver8000: meetingsAll.filter((m) => (m.parsedText ?? "").length > MEETING_TEXT_MAX_CHARS).length,
      keyFilesSent: p.keyFiles.length,
      keyFilesEligible: p.keyCandidatesAll,
      jobEntries: p.jobEntryCount,
      contextFullChars: base.fullLen,
      contextOver20000: base.fullLen > MAX_CONTEXT_CHARS,
      meetingCharsDelivered: [...base.delivered.values()].reduce((s, d) => s + d.sent, 0),
      meetingCharsRawInKey: [...base.delivered.values()].reduce((s, d) => s + d.raw, 0),
      newestMeetingRawChars: newestRaw,
      newestMeetingEstChars: newest ? estChars(newest) : 0,
      newestMeetingSentChars: newestDel?.sent ?? 0,
      newestMeetingState: newestState,
      verifiedAgainstRecord: lc ? sha256(splitCandidateContext(base.ctx).core) === lc : "",
    };
    // シナリオ
    scenarios.forEach((sc, k) => {
      if (k === 0) return;
      const r = assemble(p, sc);
      const add = r.ctx.length - base.ctx.length;
      const changed = r.ctx !== base.ctx;
      row[`add_${k}`] = add;
      scStats[k].addChars.push(add);
      if (changed) {
        scStats[k].changed++;
        scStats[k].reevalFiles += bmCount.get(cid) ?? 0;
      }
      // 30日の費用増: 手動は run ごとに先頭で5分書込・以降の送信は読込、自動配信は Batch（半額）で書込
      const tok = Math.max(0, add) * TOK_PER_CHAR;
      const usd = (tok / 1e6) * (runsM * P55.cacheWrite5m + Math.max(0, sendsM - runsM) * P55.cacheRead + sendsA * P55.cacheWrite5m * P55.batchFactor);
      scStats[k].costUsd30 += usd;
      scStats[k].tokSends += tok * (sendsM + sendsA);
      if (k === scenarios.length - 1) {
        row.newestMeetingSentChars_C = r.delivered.get(newest?.id ?? "")?.sent ?? "";
        // 案D = 案C ＋ 最新の面談 txt を主要書類4件の枠と別に必ず入れる（要約なしの人）。枠外の面談は本文未保存のため推定字数で足す
        const outside = newest && !p.hasDigest && !inKey.has(newest.id) ? estChars(newest) + newest.fileName.length + 12 : 0;
        const addD = Math.max(0, add) + outside;
        dExtra.addChars.push(addD);
        if (changed || outside > 0) {
          dExtra.changed++;
          dExtra.reevalFiles += bmCount.get(cid) ?? 0;
        }
        const tokD = addD * TOK_PER_CHAR;
        dExtra.tokSends += tokD * (sendsM + sendsA);
        dExtra.costUsd30 += (tokD / 1e6) * (runsM * P55.cacheWrite5m + Math.max(0, sendsM - runsM) * P55.cacheRead + sendsA * P55.cacheWrite5m * P55.batchFactor);
      }
    });
    rows.push(row);
    meetingsAll.forEach((m, idx) => {
      const d = base.delivered.get(m.id);
      meetingRows.push({
        candidateNumber: p.candidate.candidateNumber,
        candidateFileId: m.id,
        fileName: m.fileName,
        createdAtJst: jst(m.createdAt),
        orderNewest: idx + 1,
        archived: !!m.archivedAt,
        mimeType: m.mimeType,
        rawChars: (m.parsedText ?? "").length,
        fileSize: m.fileSize,
        estChars: estChars(m),
        charsKnown: !!m.parsedText,
        inKeyFiles: inKey.has(m.id),
        sentChars: d?.sent ?? 0,
        cutChars: Math.max(0, (m.parsedText ?? "").length - (d?.sent ?? 0)),
        ingestedToDigest: !!m.advisorIngestedAt,
      });
      estRows.push({ est: estChars(m), known: !!m.parsedText });
    });
  }
  writeCsv(path.join(OUT_DIR, "part2-candidates.csv"), rows);
  writeCsv(path.join(OUT_DIR, "part2-meetings.csv"), meetingRows);

  const n = rows.length;
  const R = (k: string) => rows.map((r) => r[k]);
  md.push(`- 対象: 直近30日に評価（手動・自動配信）された求職者 ${n}人（大野テスト除く）。手動 run ${[...manualRuns.values()].reduce((a, b) => a + b, 0)}回・手動送信 ${[...manualSends.values()].reduce((a, b) => a + b, 0)}・自動配信送信 ${[...autoSends.values()].reduce((a, b) => a + b, 0)}`);
  md.push(`- 再現の検証: 切り替え後に評価された ${verifyTried}人のうち ${verified}人で、再現した求職者情報（ブックマーク行を除く）が job_eval_parts の最新 context_core とハッシュ一致（不一致は評価後にメモ・書類等が更新された人、または年齢等の日付要素）`);
  md.push(`- 主要書類に parsedText が無い（再現では長さ0として扱った）求職者: ${unknownParsedCands}人`, "");

  const withDigest = rows.filter((r) => r.hasDigest).length;
  const withMeeting = rows.filter((r) => (r.meetingTxtCount as number) > 0);
  const multi = withMeeting.filter((r) => (r.meetingTxtCount as number) >= 2);
  md.push("## 2-2 どれくらい切られているか", "");
  md.push("| 項目 | 人数 | 割合 |", "|--|--:|--:|");
  md.push(`| 対象の求職者 | ${n} | 100% |`);
  md.push(`| 面談ログの要約（advisorLogDigest）あり＝面談 txt 本文は送らない | ${withDigest} | ${pct(withDigest, n)} |`);
  md.push(`| 面談 txt が1件以上ある | ${withMeeting.length} | ${pct(withMeeting.length, n)} |`);
  md.push(`| 面談 txt が2件以上ある | ${multi.length} | ${pct(multi.length, n)} |`);
  const over8 = rows.filter((r) => (r.meetingTxtOver8000 as number) > 0);
  const over8Sent = rows.filter((r) => !r.hasDigest && (r.meetingCharsRawInKey as number) > (r.meetingCharsDelivered as number));
  md.push(`| 8,000字を超える面談 txt を持つ | ${over8.length} | ${pct(over8.length, n)} |`);
  md.push(`| 要約なしで、送った面談 txt が切られている（8,000字 or 全体20,000字） | ${over8Sent.length} | ${pct(over8Sent.length, n)} |`);
  const over20 = rows.filter((r) => r.contextOver20000);
  md.push(`| 評価用の求職者情報が全体20,000字を超える | ${over20.length} | ${pct(over20.length, n)} |`, "");

  const cutPerCand = over8Sent.map((r) => (r.meetingCharsRawInKey as number) - (r.meetingCharsDelivered as number));
  const perFileCut = meetingRows.filter((m) => m.inKeyFiles && (m.cutChars as number) > 0).map((m) => m.cutChars as number);
  md.push(`- 切られた字数（求職者ごと・送った面談 txt の合計）: 中央値 ${median(cutPerCand).toLocaleString()}字・最大 ${Math.max(0, ...cutPerCand).toLocaleString()}字`);
  md.push(`- 切られた字数（面談 txt 1件ごと）: ${perFileCut.length}件・中央値 ${median(perFileCut).toLocaleString()}字・最大 ${Math.max(0, ...perFileCut).toLocaleString()}字`);
  const rawAll = meetingRows.map((m) => m.rawChars as number).filter((x) => x > 0);
  const estAll = estRows.map((e) => e.est).filter((x) => x > 0);
  md.push(`- 面談 txt 1件の長さ（推定込み・全 ${estRows.length}件）: 中央値 ${median(estAll).toLocaleString()}字・最大 ${Math.max(0, ...estAll).toLocaleString()}字・8,000字超 ${estAll.filter((x) => x > 8000).length}件（${pct(estAll.filter((x) => x > 8000).length, estAll.length)}）。うち字数が確定（parsedText 保存済み）${estRows.filter((e) => e.known).length}件`);
  const over8Est = new Set(meetingRows.filter((m) => (m.estChars as number) > 8000).map((m) => m.candidateNumber));
  md.push(`- 8,000字を超える面談 txt を持つ人（推定込み）: ${over8Est.size}人（${pct(over8Est.size, n)}）`);
  md.push(`- 面談 txt 1件の長さ（parsedText 保存済みのみ）: ${rawAll.length}件・中央値 ${median(rawAll).toLocaleString()}字・最大 ${Math.max(0, ...rawAll).toLocaleString()}字・8,000字超 ${rawAll.filter((x) => x > 8000).length}件（${pct(rawAll.filter((x) => x > 8000).length, rawAll.length)}）`, "");

  md.push("### 最新の面談（面談 txt が1件以上ある人）の届き方", "");
  const st: Record<string, number> = {};
  const stMulti: Record<string, number> = {};
  for (const r of withMeeting) st[r.newestMeetingState as string] = (st[r.newestMeetingState as string] ?? 0) + 1;
  for (const r of multi) stMulti[r.newestMeetingState as string] = (stMulti[r.newestMeetingState as string] ?? 0) + 1;
  md.push("| 最新の面談 txt | 全体 | うち面談2件以上 | 最新の面談の長さ 中央値（推定込み） | 届かなかった字数 中央値 |", "|--|--:|--:|--:|--:|");
  for (const k of Object.keys(st).sort()) {
    const rs = withMeeting.filter((r) => r.newestMeetingState === k);
    const len = rs.map((r) => r.newestMeetingEstChars as number);
    const miss = rs.map((r) => Math.max(0, (r.newestMeetingEstChars as number) - (r.newestMeetingSentChars as number)));
    md.push(`| ${k} | ${st[k]} | ${stMulti[k] ?? 0} | ${median(len).toLocaleString()} | ${k.includes("取り込み済み") ? "（要約で代替）" : median(miss).toLocaleString()} |`);
  }
  md.push("");

  md.push("### ほかの上限を超えている件数", "");
  const kfOver = rows.filter((r) => (r.keyFilesEligible as number) > KEY_FILES_TAKE).length;
  const jeOver = rows.filter((r) => (r.jobEntries as number) > JOB_ENTRIES_TAKE).length;
  const evaluatedJobs = await prisma.candidateFile.findMany({
    where: { candidateId: { in: candIds }, category: "BOOKMARK", aiAnalyzedAt: { gte: since30 } },
    select: { extractedText: true },
  });
  const jobOver = evaluatedJobs.filter((f) => (f.extractedText ?? "").length > JOB_TEXT_MAX_CHARS);
  const jobCut = jobOver.map((f) => (f.extractedText ?? "").length - JOB_TEXT_MAX_CHARS);
  md.push("| 上限 | 超えている | 補足 |", "|--|--:|--|");
  md.push(`| 主要書類 最大${KEY_FILES_TAKE}件 | ${kfOver}人（${pct(kfOver, n)}） | 対象書類（原本・BS作成書類・面談の pdf/txt）が5件以上 |`);
  md.push(`| 応募履歴 最大${JOB_ENTRIES_TAKE}件 | ${jeOver}人（${pct(jeOver, n)}） | |`);
  md.push(`| 全体 ${MAX_CONTEXT_CHARS.toLocaleString()}字 | ${over20.length}人（${pct(over20.length, n)}） | 超過分は末尾（古い書類→応募履歴）から落ちる |`);
  md.push(`| 求人本文 ${JOB_TEXT_MAX_CHARS.toLocaleString()}字 | ${jobOver.length}件 / ${evaluatedJobs.length}件（${pct(jobOver.length, evaluatedJobs.length)}） | 切られた字数 中央値 ${median(jobCut).toLocaleString()}字・最大 ${Math.max(0, ...jobCut).toLocaleString()}字 |`);
  const secLen = (k: string) => rows.map((r) => r[k] as number).filter((x) => x > 0);
  md.push("", `- 20,000字の中で面談より前に置かれる部分の長さ（中央値/最大）: 面談要約 ${median(secLen("digestChars")).toLocaleString()}/${Math.max(0, ...secLen("digestChars")).toLocaleString()}字・職務経歴書解析 ${median(secLen("resumeChars")).toLocaleString()}/${Math.max(0, ...secLen("resumeChars")).toLocaleString()}字・CAメモ ${median(secLen("notesChars")).toLocaleString()}/${Math.max(0, ...secLen("notesChars")).toLocaleString()}字・ファイル一覧 ${median(secLen("fileListChars")).toLocaleString()}/${Math.max(0, ...secLen("fileListChars")).toLocaleString()}字`);
  md.push(`- 評価用の求職者情報の全長（切り詰め前）: 中央値 ${median(R("contextFullChars") as number[]).toLocaleString()}字・最大 ${Math.max(...(R("contextFullChars") as number[])).toLocaleString()}字`, "");

  md.push("## 2-3 直す場合の費用の見込み（試算・Opus 5.5 料金）", "");
  md.push(`前提: 入力増は「シナリオで組み立てた評価用の求職者情報 − 現行」の字数 × ${TOK_PER_CHAR.toFixed(3)} トークン/字。候補者情報ブロックは手動では run の先頭で5分キャッシュ書込（$${P55.cacheWrite5m}/100万）・2バッチ目以降は読込（$${P55.cacheRead}/100万）、自動配信は Batch 半額の書込として計算。月額は直近30日の run・送信数に、各求職者の現在のデータを当てはめたもの。評価1件あたりは 30日の月額増 ÷ 30日の評価件数（${[...filesEval.values()].reduce((a, b) => a + b, 0)}件）。一時費用 = 求職者情報が変わる人の有効ブックマーク数 × Opus 5.5 の手動1件あたり ${yen(perFile55)}（次の全件分析で全件評価し直しになる上限見積もり）。`, "");
  md.push("| 案 | 求職者情報が変わる人 | 1人あたり入力増（中央値/最大 字） | 評価1件あたり入力増（全体平均トークン） | 月額の増加 | 評価1件あたり費用増 | 全件評価し直しの一時費用（上限） |", "|--|--:|--:|--:|--:|--:|--:|");
  const totalFiles30 = [...filesEval.values()].reduce((a, b) => a + b, 0);
  scenarios.forEach((sc, k) => {
    if (k === 0) return;
    const s = scStats[k];
    const pos = s.addChars.filter((x) => x !== 0);
    md.push(`| ${sc.name} | ${s.changed}人 | ${median(pos).toLocaleString()} / ${Math.max(0, ...s.addChars).toLocaleString()} | ${Math.round(s.tokSends / Math.max(1, totalFiles30)).toLocaleString()} | ${yen(s.costUsd30)} | ${yen(s.costUsd30 / Math.max(1, totalFiles30))} | ${yen(s.reevalFiles * perFile55)}（${s.reevalFiles}件） |`);
  });
  {
    const pos = dExtra.addChars.filter((x) => x !== 0);
    md.push(`| D（案C ＋ 最新の面談 txt を主要書類4件の枠と別に必ず入れる・枠外分は推定字数） | ${dExtra.changed}人 | ${median(pos).toLocaleString()} / ${Math.max(0, ...dExtra.addChars).toLocaleString()} | ${Math.round(dExtra.tokSends / Math.max(1, totalFiles30)).toLocaleString()} | ${yen(dExtra.costUsd30)} | ${yen(dExtra.costUsd30 / Math.max(1, totalFiles30))} | ${yen(dExtra.reevalFiles * perFile55)}（${dExtra.reevalFiles}件） |`);
  }
  md.push("");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ro = await pool.query("show default_transaction_read_only");
  if (ro.rows[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用で接続できていません");
  console.error(`default_transaction_read_only=${ro.rows[0].default_transaction_read_only}`);
  const md: string[] = [];
  await part1(md);
  await part2(md);
  const out = md.join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), out, "utf8");
  console.log(out);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
