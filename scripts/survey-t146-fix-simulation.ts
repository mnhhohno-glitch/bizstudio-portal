/**
 * T-146 追加調査(3): 会社名切り出しの修正案シミュレーション（読み取り専用・コード変更なし）
 *
 * 現行 extractSearchNames に「会社名コア」候補を**末尾に追加**した場合の効果を、
 * 本番の実ファイル名で測る。既存候補の順序は変えないため、現在成功している
 * 照合は先に一致して確定する＝デグレしない設計。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function normalizeSpaces(s: string) { return s.replace(/　/g, " "); }

/** 現行（逐語） */
function currentNames(fileName: string): string[] {
  const names: string[] = [];
  const name = fileName.replace(/\.pdf$/i, "");
  const p1 = name.match(/^求人票[_]?(.+?)(?:_\d{10,})?$/); if (p1) names.push(p1[1]);
  const p2 = name.match(/^\d+[_](.+?)(?:_\d{10,})?$/); if (p2) names.push(p2[1]);
  const p3 = name.match(/^(.+?)_No\d+$/i); if (p3) names.push(p3[1]);
  const pBee = name.match(/^(.+?)[：:]\d+$/); if (pBee && pBee[1]) names.push(pBee[1].trim());
  const p4 = name.match(/^求人票[_]?(.+)$/); if (p4 && !names.includes(p4[1])) names.push(p4[1]);
  if (names.length === 0) names.push(name);
  for (let i = 0; i < names.length; i++) names[i] = normalizeSpaces(names[i]);
  const expanded = [...names];
  for (const n of names) {
    const stripped = n.replace(/株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g, "").trim();
    if (stripped.length >= 2 && !expanded.includes(stripped)) expanded.push(stripped);
  }
  return expanded;
}

/* ===== 修正案 ===== */
const LEGAL = "株式会社|有限会社|合同会社|合資会社|一般財団法人|公益財団法人|一般社団法人|医療法人社団|医療法人|学校法人|社会福祉法人|特定非営利活動法人|独立行政法人|国立大学法人";
/** R1: 法人格が後置なら、その直後で切る（例: マンパワーグループ株式会社【西日本…】→ マンパワーグループ株式会社） */
function cutAfterLegalSuffix(s: string): string | null {
  const m = s.match(new RegExp(`^(.{1,40}?(?:${LEGAL}))`));
  if (m && m[1].length < s.length) return m[1];
  return null;
}
/** R2: 会社名に通常現れない区切り以降を落とす */
const DELIM = /[_＿（(【《〔\[、／/|｜※＼★◆♦☆▼●〇■□〜~]|\s\-\s/;
function cutAtDelimiter(s: string): string | null {
  const m = s.match(DELIM);
  if (m && m.index !== undefined && m.index >= 2) return s.slice(0, m.index).trim();
  return null;
}
/** R3: 末尾の `_No12345_` 形式（末尾アンダースコア付き）にも対応 */
function stripTrailingNo(s: string): string {
  return s.replace(/_No\d+_?$/i, "").trim();
}

function proposedNames(fileName: string): string[] {
  const base = currentNames(fileName);
  const extra: string[] = [];
  const seed = stripTrailingNo(
    fileName.replace(/\.pdf$/i, "").replace(/^求人票[_]?/, "").replace(/^\d+_/, "").replace(/_\d{10,}$/, "").replace(/[：:]\d+$/, "")
  );
  for (const cand of [cutAfterLegalSuffix(seed), cutAtDelimiter(seed), seed]) {
    if (!cand) continue;
    const c = normalizeSpaces(cand).trim();
    if (c.length >= 2 && !base.includes(c) && !extra.includes(c)) extra.push(c);
    const stripped = c.replace(new RegExp(LEGAL, "g"), "").trim();
    if (stripped.length >= 2 && !base.includes(stripped) && !extra.includes(stripped)) extra.push(stripped);
  }
  return [...base, ...extra]; // ★末尾に追加＝既存の一致が先に確定する
}

/** 【会社名】に収まりうるか（照合の必要条件を近似） */
function plausible(n: string): boolean {
  return n.length >= 2 && n.length <= 24 && !/[【】\n_／/|｜※＼★◆♦☆▼●〇■□、]/.test(n);
}

async function main() {
  const rows = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK" },
    select: { id: true, fileName: true, candidateId: true, driveFileId: true,
              extractedAt: true, aiAnalysisComment: true, aiAnalyzedAt: true, createdAt: true },
  });

  const lastAnalyzed = new Map<string, Date>();
  for (const r of rows) {
    if (!r.aiAnalyzedAt) continue;
    const cur = lastAnalyzed.get(r.candidateId);
    if (!cur || r.aiAnalyzedAt > cur) lastAnalyzed.set(r.candidateId, r.aiAnalyzedAt);
  }
  const skipped = rows.filter((r) => {
    if (!r.extractedAt || r.aiAnalysisComment || !r.driveFileId) return false;
    const la = lastAnalyzed.get(r.candidateId);
    return !!la && r.createdAt < la;
  });

  console.log("## 修正案の効果（スキップ疑い 全件）");
  let curOk = 0, propOk = 0;
  const rescued: { f: string; before: string; after: string }[] = [];
  for (const r of skipped) {
    const c = currentNames(r.fileName).some(plausible);
    const p = proposedNames(r.fileName).some(plausible);
    if (c) curOk++;
    if (p) propOk++;
    if (!c && p && rescued.length < 25) {
      rescued.push({
        f: r.fileName,
        before: currentNames(r.fileName)[0] ?? "",
        after: proposedNames(r.fileName).find(plausible) ?? "",
      });
    }
  }
  console.log(`対象: ${skipped.length} 件`);
  console.log(`  現行で「照合可能な候補」を持つ: ${curOk} 件`);
  console.log(`  修正案で持つ                  : ${propOk} 件  (+${propOk - curOk})`);

  console.log("\n## 期待値 vs 実際値（修正で救われるもの・最大25件）");
  console.log("| ファイル名 | 現行の第1候補 | 修正案が追加する候補 |");
  console.log("|---|---|---|");
  rescued.forEach((x) => console.log(`| ${x.f.slice(0, 62)} | ${x.before.slice(0, 40)} | **${x.after}** |`));

  // デグレ確認: 現在成功している行で、第1候補（先に試される）が変わらないこと
  console.log("\n## デグレ確認（現在コメントが付いている行）");
  const ok = rows.filter((r) => r.aiAnalysisComment);
  let sameHead = 0, changedHead = 0;
  for (const r of ok) {
    const a = currentNames(r.fileName);
    const b = proposedNames(r.fileName);
    if (a.every((v, i) => b[i] === v)) sameHead++; else changedHead++;
  }
  console.log(`既存候補列がそのまま先頭に維持: ${sameHead} / ${ok.length}`);
  console.log(`順序が変わった                : ${changedHead}  ${changedHead === 0 ? "（＝デグレなし）" : "（要確認）"}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
