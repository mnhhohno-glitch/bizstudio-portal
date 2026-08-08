/**
 * T-146 追加: 会社名切り出し修正の検証
 *   (1) P1〜P9 の期待値テスト（実装した本物の extractCompanyNameCandidates を import）
 *   (2) 本番実データでのデグレ確認（候補列の先頭が変化しないこと）
 * DB は読み取りのみ。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { extractCompanyNameCandidates } from "../src/lib/normalize-filename";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/* 修正前の extractSearchNames（analyze-batch/route.ts）の逐語コピー。
   この部分は今回**変更していない**ので、コピーで挙動を再現できる。 */
function normalizeSpaces(s: string) { return s.replace(/　/g, " "); }
function legacyNames(fileName: string): string[] {
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
    const normalized = n.replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
                        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
    if (normalized !== n && !expanded.includes(normalized)) expanded.push(normalized);
  }
  return expanded;
}
/** 修正後（実装と同じ合成） */
function fixedNames(fileName: string): string[] {
  const expanded = legacyNames(fileName);
  for (const core of extractCompanyNameCandidates(fileName)) {
    if (!expanded.includes(core)) expanded.push(core);
  }
  return expanded;
}

const CASES: { p: string; file: string; expect: string }[] = [
  { p: "P1", file: "34127_明治安田商事株式会社_東京【明治安田生命グループ！イベント事務局スタッフ／事務のお仕事】経験者歓迎.pdf", expect: "明治安田商事株式会社" },
  { p: "P2", file: "16848_マンパワーグループ株式会社【西日本営業本部】_営業事務.pdf", expect: "マンパワーグループ株式会社" },
  { p: "P3", file: "求人票_エム・シー・ヘルスケア株式会社（医療現場を支える総合ソリューション企業）_20260417124320496.pdf", expect: "エム・シー・ヘルスケア株式会社" },
  { p: "P4", file: "30612_株式会社サンドラッグ_【神奈川／店舗運営職（転勤なしポジション）】全国で積極採用！多彩なキャリアアプランが実現可能！.pdf", expect: "株式会社サンドラッグ" },
  { p: "P5", file: "株式会社エス・エム・エス(キャリアパートナー)_No305973.pdf", expect: "株式会社エス・エム・エス" },
  { p: "P6", file: "求人票_双日ライフワン株式会社※健康優良企業「銀の認定」取得_20260421182616084.pdf", expect: "双日ライフワン株式会社" },
  { p: "P7", file: "株式会社いうら_No137771_.pdf", expect: "株式会社いうら" },
  { p: "P8", file: "株式会社スタートライン_No170292　.pdf", expect: "株式会社スタートライン" },
  { p: "P9", file: "19604_株式会社リクルートスタッフィング【キャリアウィンク事業部】_【事務スタッフ】未経験歓迎／土日祝休み／年間休日122日.pdf", expect: "株式会社リクルートスタッフィング" },
  // 追加の実データ
  { p: "P1'", file: "池下工業株式会社_No441005_《★未経験歓迎！建築工事のプロジェクト管理☆》♦年休124日／直行直帰可／長期出張・転勤・夜勤無☆彡.pdf", expect: "池下工業株式会社" },
  { p: "P4'", file: "株式会社クラフトフィックス（ミレーヴ／ビーアル／エクストリンクHDはグループ会社です。）_No63936.pdf", expect: "株式会社クラフトフィックス" },
  { p: "P2'", file: "求人票_医療法人社団上桜会ゆうメンタルクリニック【国内最大級のメンタルクリニック】_20260423195415197.pdf", expect: "医療法人社団上桜会ゆうメンタルクリニック" },
];

/** 現状でも壊れていない形式＝挙動が変わってはいけないもの */
const REGRESSION: { file: string; expectHead: string }[] = [
  { file: "求人票_株式会社ミギナナメウエ.pdf", expectHead: "株式会社ミギナナメウエ" },
  { file: "アスフィール株式会社_No274768.pdf", expectHead: "アスフィール株式会社" },
  { file: "株式会社And+Security：133386.pdf", expectHead: "株式会社And+Security" },
  { file: "32893_株式会社オリエントコーポレーション.pdf", expectHead: "株式会社オリエントコーポレーション" },
  { file: "求人票_キャリアリンク株式会社_20260528065539373.pdf", expectHead: "キャリアリンク株式会社" },
];

async function main() {
  let ng = 0;
  console.log("## 1. パターン別 期待値テスト\n");
  console.log("| # | ファイル名 | 修正前の第1候補 | 修正後に追加される候補 | 期待値 | 判定 |");
  console.log("|---|---|---|---|---|---|");
  for (const c of CASES) {
    const before = legacyNames(c.file)[0] ?? "";
    const added = extractCompanyNameCandidates(c.file);
    const ok = added.includes(c.expect);
    if (!ok) ng++;
    const cut = (s: string) => (s.length > 34 ? s.slice(0, 34) + "…" : s);
    console.log(`| ${c.p} | ${cut(c.file)} | ${cut(before)} | ${added.slice(0, 2).join(" / ")} | ${c.expect} | ${ok ? "✅" : "★NG"} |`);
  }

  console.log("\n## 2. 既存形式の第1候補が変わらないこと\n");
  for (const r of REGRESSION) {
    const head = fixedNames(r.file)[0];
    const ok = head === r.expectHead;
    if (!ok) ng++;
    console.log(`${ok ? "OK  " : "★NG "} ${r.file} → 第1候補 "${head}"（期待 "${r.expectHead}"）`);
  }

  console.log("\n## 3. 本番実データでのデグレ確認（コメントが付いている全行）");
  const rows = await prisma.candidateFile.findMany({
    where: { category: "BOOKMARK", aiAnalysisComment: { not: null } },
    select: { fileName: true },
  });
  let same = 0, changed = 0;
  const changedSamples: string[] = [];
  for (const r of rows) {
    const a = legacyNames(r.fileName);
    const b = fixedNames(r.fileName);
    // 既存候補列がそのままの順序で先頭に維持されているか
    if (a.every((v, i) => b[i] === v)) same++;
    else { changed++; if (changedSamples.length < 5) changedSamples.push(r.fileName); }
  }
  console.log(`既存候補列が先頭でそのまま維持: ${same} / ${rows.length}`);
  console.log(`順序が変わった                : ${changed}  ${changed === 0 ? "（★デグレ0★）" : "（要確認）"}`);
  changedSamples.forEach((s) => console.log(`  ${s}`));
  if (changed > 0) ng++;

  console.log(`\n${ng === 0 ? "★全項目 OK★" : `★NG ${ng} 件★`}`);
  process.exitCode = ng === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
