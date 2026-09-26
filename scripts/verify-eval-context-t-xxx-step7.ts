/**
 * T-XXX step7: 評価に送る求職者情報の組み立て（buildAnalyzeCandidateContext）の変更前後の比較。
 * 読み取りのみ（default_transaction_read_only=on）・AI に送らない・書き込まない。
 *
 * - 対象: step6 の明細 scripts/output/t-xxx-truncation/part2-candidates.csv の求職者（直近30日に評価された171人）
 * - 変更前 = getCandidateContext(mode="chat") → 評価一覧/求人票の除去 → 20,000字（step7 前の buildAnalyzeCandidateContext と同じ処理）
 *   変更後 = buildAnalyzeCandidateContext（mode="evaluation"・50,000字）
 * - 本文の読み方は差し替える: parsedText があればそれ、無い txt はファイルサイズから長さを推定した仮文字（Drive も読まない）、
 *   無い PDF は OCR せず「（未解析PDF）」にする（AI 費用 0）
 * - 変わったかどうかは、変更なしスキップと同じく splitCandidateContext(...).core のハッシュで比べる
 *
 * 実行（master worktree・本番 DB 読み取り）:
 *   npx tsx --env-file=.env scripts/verify-eval-context-t-xxx-step7.ts
 * 出力: 標準出力に集計（ID のみ）。明細 CSV は scripts/output/t-xxx-step7/（個人情報を含む・コミットしない）
 */
import fs from "fs";
import path from "path";

// @/lib/prisma を読み込む前に、接続を読み取り専用にする
{
  const u = new URL(process.env.DATABASE_URL!);
  u.searchParams.set("options", "-c default_transaction_read_only=on");
  process.env.DATABASE_URL = u.toString();
}

const STEP6_CSV = path.join(__dirname, "output", "t-xxx-truncation", "part2-candidates.csv");
const OUT_DIR = path.join(__dirname, "output", "t-xxx-step7");
const OLD_MAX_CONTEXT_CHARS = 20000;
const OLD_JOB_TEXT_MAX_CHARS = 3000;
const JPY_PER_USD = 157.42;
const TOK_PER_CHAR = 0.933; // step6: 候補者情報ブロックの書込トークン ÷ 字数（Opus 5.5 実送信の中央値）
const P55 = { input: 4, cacheRead: 0.2, cacheWrite5m: 5, batchFactor: 0.5 }; // USD / 100万トークン
const PER_FILE_JPY = 6.6; // step6: Opus 5.5 手動評価 1件あたり

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const median = (a: number[]) => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const yen = (usd: number) => `¥${Math.round(usd * JPY_PER_USD).toLocaleString()}`;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getCandidateContext, RATINGS_SECTION_MARKER, EVAL_CONTEXT_MAX_CHARS } = await import("../src/lib/advisor-context");
  const { buildAnalyzeCandidateContext, JOB_TEXT_MAX_CHARS } = await import("../src/lib/analyze-bookmarks");
  const { splitCandidateContext, sha256 } = await import("../src/lib/eval-history");
  type KeyFile = import("../src/lib/advisor-context").KeyFile;

  const ro = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("show default_transaction_read_only");
  if (ro[0]?.default_transaction_read_only !== "on") throw new Error("読み取り専用で接続できていません");
  console.error("default_transaction_read_only=on");

  const step6 = readCsv(STEP6_CSV);
  console.error(`step6 対象: ${step6.length}人`);

  // 本文の読み方（書き込み・OCR なし）。同じファイルは1回だけ読む。
  const textCache = new Map<string, string>();
  let driveReads = 0;
  let unparsedPdf = 0;
  const reader = async (file: KeyFile): Promise<string> => {
    const hit = textCache.get(file.id);
    if (hit !== undefined) return hit;
    let raw = file.parsedText;
    if (!raw || raw.trim() === "") {
      if (file.mimeType === "text/plain") {
        // ローカルの .env には Drive の鍵が無いため、step6 と同じく ファイルサイズ ÷ 2.68 バイト/字 の長さの仮文字にする
        const row = await prisma.candidateFile.findUnique({ where: { id: file.id }, select: { fileSize: true } });
        raw = `（未読込txt:${file.id}）` + "あ".repeat(Math.round((row?.fileSize ?? 0) / 2.68));
        driveReads++;
      } else {
        raw = "（未解析PDF）";
        unparsedPdf++;
      }
    }
    textCache.set(file.id, raw);
    return raw;
  };

  const oldAnalyzeContext = async (candidateId: string): Promise<string> => {
    let c = await getCandidateContext(candidateId, { mode: "chat", readKeyFileText: reader });
    const ratingsIdx = c.indexOf(RATINGS_SECTION_MARKER);
    const bookmarkIdx = c.indexOf("## ブックマーク求人票");
    const cutIdx = [ratingsIdx, bookmarkIdx].filter((i) => i !== -1).sort((a, b) => a - b)[0];
    if (cutIdx !== undefined) c = c.substring(0, cutIdx).trim();
    if (c.length > OLD_MAX_CONTEXT_CHARS) c = c.substring(0, OLD_MAX_CONTEXT_CHARS) + "\n\n...（コンテキストが長いため一部省略）";
    return c;
  };

  type Row = Record<string, string | number | boolean>;
  const rows: Row[] = [];
  let i = 0;
  for (const s of step6) {
    const candidateId = s.candidateId;
    i++;
    if (i % 20 === 0) console.error(`${i}/${step6.length}`);
    const cand = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { advisorLogDigest: true, advisorLogDigestUpdatedAt: true },
    });
    const hasDigest = !!cand?.advisorLogDigest?.trim();
    const meetings = await prisma.candidateFile.findMany({
      where: { candidateId, category: "MEETING", mimeType: "text/plain" },
      orderBy: { createdAt: "desc" },
      select: { id: true, driveFileId: true, fileName: true, category: true, mimeType: true, parsedText: true, createdAt: true, advisorIngestedAt: true },
    });
    const oldCtx = await oldAnalyzeContext(candidateId);
    const newCtx = await buildAnalyzeCandidateContext(candidateId, { readKeyFileText: reader });
    const oldCore = sha256(splitCandidateContext(oldCtx).core);
    const newCore = sha256(splitCandidateContext(newCtx).core);

    // 変更前の再現が実際に送った中身と一致するか（最後の評価の context_core と比べる。以後にデータが変わった人は不一致になり得る）
    const lastRec = await prisma.jobEvalRecord.findFirst({
      where: { candidateId, status: { not: "REUSED" } },
      orderBy: { createdAt: "desc" },
      select: { contextCoreHash: true },
    });

    const newest = meetings.find((m) => m.driveFileId);
    const newestEligible = !!newest && (!hasDigest || newest.advisorIngestedAt === null);
    let newestFullInNew: boolean | "" = "";
    let newestChars = 0;
    if (newest && newestEligible) {
      const raw = await reader(newest);
      newestChars = raw.length;
      newestFullInNew = newCtx.includes(`### ${newest.fileName}（面談）\n${raw}\n\n`);
    }
    // 要約に入っていない面談（要約がある人の advisorIngestedAt=null）。最新以外は8,000字までの先頭が入っているか
    const notInDigest = hasDigest ? meetings.filter((m) => m.driveFileId && m.advisorIngestedAt === null) : [];
    let notInDigestIncluded = 0;
    for (const m of notInDigest) {
      const raw = await reader(m);
      if (newCtx.includes(`### ${m.fileName}（面談）\n${raw.substring(0, 8000)}`)) notInDigestIncluded++;
    }
    // 「要約の最終更新より後の面談」（createdAt > advisorLogDigestUpdatedAt）と advisorIngestedAt=null の食い違い
    const afterDigest = hasDigest && cand?.advisorLogDigestUpdatedAt
      ? meetings.filter((m) => m.createdAt > cand.advisorLogDigestUpdatedAt!).length
      : 0;

    rows.push({
      candidateId,
      candidateNumber: s.candidateNumber,
      step6State: s.newestMeetingState,
      hasDigest,
      manualRuns30d: Number(s.manualRuns30d),
      manualSends30d: Number(s.manualSends30d),
      autoSends30d: Number(s.autoSends30d),
      activeBookmarks: Number(s.activeBookmarks),
      oldChars: oldCtx.length,
      newChars: newCtx.length,
      changed: oldCore !== newCore,
      oldMatchesLastSent: lastRec ? lastRec.contextCoreHash === oldCore : "",
      newestEligible,
      newestChars,
      newestFullInNew,
      notInDigestCount: notInDigest.length,
      notInDigestIncluded,
      afterDigestByCreatedAt: afterDigest,
      newTruncatedAtCap: newCtx.includes("...（コンテキストが長いため一部省略）"),
      newOmittedNote: newCtx.includes("件の書類は字数の上限のため省略"),
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const head = Object.keys(rows[0]);
  fs.writeFileSync(
    path.join(OUT_DIR, "candidates.csv"),
    "﻿" + [head.join(","), ...rows.map((r) => head.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n"),
    "utf8",
  );

  const md: string[] = [];
  const n = rows.length;
  const changed = rows.filter((r) => r.changed);
  md.push(`# T-XXX step7 組み立ての比較（${n}人・AI 呼び出しなし・書き込みなし）`, "");
  md.push(`- 上限: 全体 ${OLD_MAX_CONTEXT_CHARS.toLocaleString()} → ${EVAL_CONTEXT_MAX_CHARS.toLocaleString()}字 / 求人本文 ${OLD_JOB_TEXT_MAX_CHARS.toLocaleString()} → ${JOB_TEXT_MAX_CHARS.toLocaleString()}字`);
  md.push(`- 本文の読み込み: 本文未保存の txt ${driveReads}件（サイズ÷2.68で長さを推定した仮文字）・未解析 PDF ${unparsedPdf}件（OCR せず仮文字）`);
  const withRec = rows.filter((r) => r.oldMatchesLastSent !== "");
  md.push(`- 変更前の再現と、最後に実際に送った中身（context_core）の一致: ${withRec.filter((r) => r.oldMatchesLastSent === true).length} / ${withRec.length}人（記録は 9/25 から。以後にファイル等が増えた人は不一致になる）`, "");

  md.push("## 変わる人数", "");
  md.push(`| 組み立てが変わる | 変わらない |`, `|--:|--:|`, `| ${changed.length}人 | ${n - changed.length}人 |`, "");
  const byState = new Map<string, Row[]>();
  for (const r of rows) byState.set(String(r.step6State), [...(byState.get(String(r.step6State)) ?? []), r]);
  md.push("| step6 の状態 | 人数 | 変わる | 最新の面談が全文入った（対象者） | 要約に入っていない面談が入った（件） | 全体字数 最大 / 中央値（変更後） |", "|--|--:|--:|--:|--:|--:|");
  for (const [k, rs] of [...byState.entries()].sort()) {
    const elig = rs.filter((r) => r.newestEligible);
    const nid = rs.reduce((a, r) => a + Number(r.notInDigestCount), 0);
    const nidIn = rs.reduce((a, r) => a + Number(r.notInDigestIncluded), 0);
    const nc = rs.map((r) => Number(r.newChars));
    md.push(`| ${k} | ${rs.length} | ${rs.filter((r) => r.changed).length} | ${elig.filter((r) => r.newestFullInNew === true).length} / ${elig.length} | ${nidIn} / ${nid} | ${Math.max(...nc).toLocaleString()} / ${median(nc).toLocaleString()} |`);
  }
  md.push("");
  const target = rows.filter((r) => /一部切られた|丸ごと届かない/.test(String(r.step6State)));
  const tc = target.map((r) => Number(r.newChars));
  md.push(`- step6 の 69人（一部切られた36・丸ごと届かない33）: 最新の面談が全文入った ${target.filter((r) => r.newestFullInNew === true).length}人 / ${target.length}人。全体字数 最大 ${Math.max(...tc).toLocaleString()}字・中央値 ${median(tc).toLocaleString()}字`);
  const all = rows.map((r) => Number(r.newChars));
  md.push(`- 171人全体（変更後）: 最大 ${Math.max(...all).toLocaleString()}字・中央値 ${median(all).toLocaleString()}字（変更前 最大 ${Math.max(...rows.map((r) => Number(r.oldChars))).toLocaleString()}字・中央値 ${median(rows.map((r) => Number(r.oldChars))).toLocaleString()}字）`);
  md.push(`- 50,000字の安全弁で切られた人: ${rows.filter((r) => r.newTruncatedAtCap).length}人 / 予算で古い書類を省略した人: ${rows.filter((r) => r.newOmittedNote).length}人`);
  md.push(`- 最新の面談が対象（要約なし、または未取り込み）の人: ${rows.filter((r) => r.newestEligible).length}人、うち全文が入った ${rows.filter((r) => r.newestFullInNew === true).length}人`);
  md.push(`- 要約あり・未取り込みの面談: ${rows.reduce((a, r) => a + Number(r.notInDigestCount), 0)}件（${rows.filter((r) => Number(r.notInDigestCount) > 0).length}人）、うち入った ${rows.reduce((a, r) => a + Number(r.notInDigestIncluded), 0)}件`);
  md.push(`- 判定の突き合わせ: 「要約の最終更新より後に作られた面談（createdAt > advisorLogDigestUpdatedAt）」${rows.reduce((a, r) => a + Number(r.afterDigestByCreatedAt), 0)}件 vs 「advisorIngestedAt=null」${rows.reduce((a, r) => a + Number(r.notInDigestCount), 0)}件`, "");

  // 求人本文
  const since30 = new Date("2026-08-26T08:54:00Z"); // step6 と同じ窓（2026-08-26 17:54 JST〜）
  const evalJobs = await prisma.candidateFile.findMany({
    where: { candidateId: { in: rows.map((r) => String(r.candidateId)) }, category: "BOOKMARK", aiAnalyzedAt: { gte: since30 }, extractedText: { not: null } },
    select: { id: true, candidateId: true, extractedText: true, archivedAt: true },
  });
  const jobChanged = evalJobs.filter((f) => f.extractedText!.length > OLD_JOB_TEXT_MAX_CHARS);
  const jobDeltaChars = evalJobs.map((f) => Math.min(f.extractedText!.length, JOB_TEXT_MAX_CHARS) - Math.min(f.extractedText!.length, OLD_JOB_TEXT_MAX_CHARS));
  const stillCut = evalJobs.filter((f) => f.extractedText!.length > JOB_TEXT_MAX_CHARS).length;
  const activeAll = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", archivedAt: null, extractedText: { not: null } },
    select: { id: true, candidateId: true, extractedText: true, aiAnalyzedAt: true },
  });
  const activeChanged = activeAll.filter((f) => f.extractedText!.length > OLD_JOB_TEXT_MAX_CHARS);
  md.push("## 求人本文", "");
  md.push(`- 直近30日に評価された求人 ${evalJobs.length}件のうち、中身が変わる（3,000字超）${jobChanged.length}件。新しい上限でも切られるのは ${stillCut}件`);
  md.push(`- 有効な求人（アーカイブ除く）全体 ${activeAll.length}件のうち 3,000字超 ${activeChanged.length}件（うち評価済み ${activeChanged.filter((f) => f.aiAnalyzedAt).length}件）`, "");

  // 費用
  const usdCtx = (r: Row) => {
    const dTok = Math.max(0, Number(r.newChars) - Number(r.oldChars)) * TOK_PER_CHAR;
    const runs = Number(r.manualRuns30d);
    const sends = Number(r.manualSends30d);
    const auto = Number(r.autoSends30d);
    return (dTok * (runs * P55.cacheWrite5m + Math.max(0, sends - runs) * P55.cacheRead + auto * P55.cacheWrite5m * P55.batchFactor)) / 1e6;
  };
  const ctxUsd = rows.reduce((a, r) => a + usdCtx(r), 0);
  const avgJobDeltaTok = (jobDeltaChars.reduce((a, b) => a + b, 0) / Math.max(1, evalJobs.length)) * TOK_PER_CHAR;
  const files30 = 3303; // step6: 30日の評価件数
  const jobUsd = (avgJobDeltaTok * files30 * P55.input) / 1e6;
  const changedIds = new Set(changed.map((r) => String(r.candidateId)));
  const reevalFiles = new Set<string>();
  for (const f of activeAll) {
    if (!f.aiAnalyzedAt) continue;
    if (changedIds.has(f.candidateId) || f.extractedText!.length > OLD_JOB_TEXT_MAX_CHARS) reevalFiles.add(f.id);
  }
  const ctxDelta = rows.filter((r) => r.changed).map((r) => Number(r.newChars) - Number(r.oldChars));
  md.push("## 費用の見込み（Opus 5.5・キャッシュ込み）", "");
  md.push(`- 求職者情報: 変わる人の入力増 中央値 ${median(ctxDelta).toLocaleString()}字・最大 ${Math.max(0, ...ctxDelta).toLocaleString()}字。30日の実行・送信回数に当てはめて ${yen(ctxUsd)}/月（手動は実行の先頭で5分書込・以降は読込、自動配信は Batch 半額の書込）`);
  md.push(`- 求人本文: 評価1件あたり平均 +${Math.round(avgJobDeltaTok).toLocaleString()}トークン（キャッシュされない入力 $${P55.input}/100万）× 30日 ${files30.toLocaleString()}件 = ${yen(jobUsd)}/月`);
  md.push(`- 合計 ${yen(ctxUsd + jobUsd)}/月・評価1件あたり ${yen((ctxUsd + jobUsd) / files30)}（小数: ¥${(((ctxUsd + jobUsd) / files30) * JPY_PER_USD).toFixed(2)}）`);
  md.push(`- 評価し直しの一時費用の上限: 評価済みの有効な求人のうち「求職者情報が変わる人のもの」または「求人本文が変わるもの」${reevalFiles.size.toLocaleString()}件 × ¥${PER_FILE_JPY} = ¥${Math.round(reevalFiles.size * PER_FILE_JPY).toLocaleString()}（全員が全件分析を押し直した場合）`);
  const out = md.join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), out, "utf8");
  console.log(out);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export {};
