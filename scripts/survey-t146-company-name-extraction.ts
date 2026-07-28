/**
 * T-146 追加調査: ファイル名からの会社名切り出し失敗によるAI評価の欠落
 *
 * 読み取り専用（SELECT のみ）。DB への書き込みは一切行わない。
 *
 * 使い方: npx tsx scripts/survey-t146-company-name-extraction.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/* ===== 本番コードからの逐語コピー（commit 95f47f9 時点） =====
   analyze-batch/route.ts L210-253 の extractSearchNames と、その依存 normalizeSpaces。
   export されていないため調査用に複製する。ロジックは1文字も変えていない。 */
function normalizeSpaces(str: string): string {
  return str.replace(/　/g, " ");
}
function extractSearchNames(fileName: string): string[] {
  const names: string[] = [];
  const name = fileName.replace(/\.pdf$/i, "");

  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/);
  if (p1) names.push(p1[1]);
  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/);
  if (p2) names.push(p2[1]);
  const p3 = name.match(/^(.+?)_No\d+$/i);
  if (p3) names.push(p3[1]);
  const pBee = name.match(/^(.+?)[：:]\d+$/);
  if (pBee && pBee[1]) names.push(pBee[1].trim());
  const p4 = name.match(/^求人票[_]?(.+)$/);
  if (p4 && !names.includes(p4[1])) names.push(p4[1]);
  if (names.length === 0) names.push(name);

  for (let i = 0; i < names.length; i++) names[i] = normalizeSpaces(names[i]);

  const expanded: string[] = [...names];
  for (const n of names) {
    const stripped = n
      .replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "")
      .trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) expanded.push(stripped);
    const normalized = n
      .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
    if (normalized !== n && !expanded.includes(normalized)) expanded.push(normalized);
  }
  return expanded;
}
/* ===== ここまで逐語コピー ===== */

/** 「会社名として不自然な文字」を含むか＝【会社名】に収まらない見込み */
const FEATURES: { key: string; label: string; re: RegExp }[] = [
  { key: "paren_full", label: "全角括弧（）", re: /（|）/ },
  { key: "paren_half", label: "半角括弧()", re: /\(|\)/ },
  { key: "comma", label: "読点「、」", re: /、/ },
  { key: "symbol", label: "記号 ◆★／|等", re: /[◆★／/|｜▼●〇■□☆※]/ },
  { key: "catch", label: "キャッチコピー語", re: /未経験|歓迎|上場|土日|年休|年間休日|月給|年収|正社員|リモート|転勤|完全週休|急募|フレックス|残業|賞与|第二新卒|プライム/ },
  { key: "bracket", label: "【】を含む", re: /【|】/ },
];

/** AI が出力する 【会社名】 に収まりうるか（照合の必要条件） */
function isMatchable(name: string): boolean {
  // 【[^】]*NAME[^】]*】 に入るには 】【 と改行を含まないこと
  if (/[【】\n]/.test(name)) return false;
  // 会社名として明らかに長すぎるものは 【】 に収まらない
  if (name.length > 30) return false;
  return true;
}

function has3Axis(c: string | null): boolean {
  if (!c) return false;
  const V = "(?:B\\+|[ABCD])";
  return new RegExp(`■\\s*総合[：:]\\s*${V}`).test(c);
}

async function main() {
  console.log("=== T-146 追加調査: 会社名切り出しとAI評価欠落 ===");
  console.log(`DB: ${(process.env.DATABASE_URL || "").match(/@([^/:]+)/)?.[1]}`);
  console.log(`実行: ${new Date().toISOString()}\n`);

  const rows = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK" },
    select: {
      id: true, fileName: true, candidateId: true, origin: true, driveFileId: true,
      extractedAt: true, aiAnalysisComment: true, aiMatchRating: true, aiAnalyzedAt: true, createdAt: true,
    },
  });

  // ---- 1. 母集団 ----
  const withText = rows.filter((r) => r.extractedAt);          // AI分析の対象になりうる
  const siteNoPdf = rows.filter((r) => r.origin === "candidate" && !r.driveFileId);
  const noComment = withText.filter((r) => !r.aiAnalysisComment);
  const commentNo3Axis = withText.filter((r) => r.aiAnalysisComment && !has3Axis(r.aiAnalysisComment));
  const nullRating = rows.filter((r) => !r.aiMatchRating);

  console.log("## 1. 母集団");
  console.log(`BOOKMARK 総数                     : ${rows.length}`);
  console.log(`  うち extractedAt あり（分析対象）: ${withText.length}`);
  console.log(`  うち サイト経由でPDF未保管       : ${siteNoPdf.length}  ← 一覧で「AI評価対象外」`);
  console.log(`分析対象のうち コメント無し        : ${noComment.length}  ★評価が空欄になる本体`);
  console.log(`分析対象のうち コメント有・総合無し: ${commentNo3Axis.length}`);
  console.log(`aiMatchRating が null             : ${nullRating.length}`);

  // ---- 2. ファイル名の特徴別 ----
  console.log("\n## 2. ファイル名の特徴 × コメント有無（extractedAt ありのみ）");
  console.log("| 特徴 | 全体 | コメント無し | 欠落率 |");
  console.log("|---|--:|--:|--:|");
  for (const f of FEATURES) {
    const all = withText.filter((r) => f.re.test(r.fileName));
    const miss = all.filter((r) => !r.aiAnalysisComment);
    const rate = all.length ? Math.round((miss.length / all.length) * 100) : 0;
    console.log(`| ${f.label} | ${all.length} | ${miss.length} | ${rate}% |`);
  }
  const clean = withText.filter((r) => !FEATURES.some((f) => f.re.test(r.fileName)));
  const cleanMiss = clean.filter((r) => !r.aiAnalysisComment);
  console.log(`| （特徴なし＝素直な会社名） | ${clean.length} | ${cleanMiss.length} | ${clean.length ? Math.round((cleanMiss.length / clean.length) * 100) : 0}% |`);

  // ---- 3. 切り出し結果が照合不能なもの ----
  console.log("\n## 3. extractSearchNames の結果が 【会社名】 に収まらない件数");
  const unmatchable = withText.filter((r) => extractSearchNames(r.fileName).every((n) => !isMatchable(n)));
  const unmatchableMiss = unmatchable.filter((r) => !r.aiAnalysisComment);
  console.log(`照合不能（全候補が 30字超 or 【】改行含み）: ${unmatchable.length} 件（うちコメント無し ${unmatchableMiss.length}）`);

  // ---- 4. 実データのサンプル（コメント無し＝失敗しているもの） ----
  console.log("\n## 4. コメント無しのファイル名サンプル（最大40件）");
  const samples = [...noComment].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 40);
  samples.forEach((r, i) => {
    const names = extractSearchNames(r.fileName);
    console.log(`\n[${i + 1}] ${r.fileName}`);
    console.log(`    候補: ${JSON.stringify(names)}`);
    console.log(`    照合可能: ${names.some(isMatchable) ? "はい" : "★いいえ★"}  origin=${r.origin ?? "-"} drive=${r.driveFileId ? "有" : "無"}`);
  });

  // ---- 5. 成功しているものでの検証（切り出し名が本文の【】に実在するか） ----
  console.log("\n## 5. コメント有りの行で、切り出し名が本文の 【】 に実在するか");
  const withComment = withText.filter((r) => r.aiAnalysisComment);
  let inHeader = 0, notInHeader = 0;
  const notInHeaderSamples: string[] = [];
  for (const r of withComment) {
    const c = r.aiAnalysisComment!;
    const header = c.match(/【([^】]*)】/)?.[1] ?? "";
    const ok = extractSearchNames(r.fileName).some((n) => header.includes(n));
    if (ok) inHeader++;
    else {
      notInHeader++;
      if (notInHeaderSamples.length < 8) notInHeaderSamples.push(`"${r.fileName}" → 本文見出し「${header}」`);
    }
  }
  console.log(`切り出し名が見出しに含まれる: ${inHeader} / ${withComment.length}`);
  console.log(`含まれない                  : ${notInHeader}（別ルートで救済されたか、見出し形式が違う）`);
  notInHeaderSamples.forEach((s) => console.log(`  ${s}`));

  // ---- 6. 影響範囲 ----
  console.log("\n## 6. 影響範囲");
  const affected = noComment.filter((r) => !(r.origin === "candidate" && !r.driveFileId));
  const candSet = new Set(affected.map((r) => r.candidateId));
  console.log(`評価が付いていない（PDF有・分析対象）: ${affected.length} 件 / 求職者 ${candSet.size} 名`);
  const withFeature = affected.filter((r) => FEATURES.some((f) => f.re.test(r.fileName)));
  console.log(`  うちファイル名に不純物あり        : ${withFeature.length} 件`);
  console.log(`  うち素直な会社名（別原因の疑い）  : ${affected.length - withFeature.length} 件`);

  // ---- 7. 大野テストの「AI評価対象外10件」の内訳 ----
  console.log("\n## 7. 大野テスト（5999999）の内訳");
  const ohno = rows.filter((r) => r.candidateId === "cmmn4jipg00011dqt23w1q3bk");
  const ohnoActive = ohno.filter((r) => true);
  const ohnoSiteNoPdf = ohno.filter((r) => r.origin === "candidate" && !r.driveFileId && !r.aiAnalysisComment);
  console.log(`BOOKMARK 総数: ${ohnoActive.length}`);
  console.log(`「AI評価対象外」条件（origin=candidate && driveFileId=null && コメント無し）: ${ohnoSiteNoPdf.length} 件`);
  ohnoSiteNoPdf.slice(0, 15).forEach((r, i) =>
    console.log(`  [${i + 1}] ${r.fileName}  extractedAt=${r.extractedAt ? "有" : "無"} origin=${r.origin}`)
  );

  console.log("\n=== 完了（読み取りのみ・書き込みなし） ===");
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
