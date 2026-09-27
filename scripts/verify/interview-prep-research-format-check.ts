/**
 * T-205 step6/step7: 下調べの書式・使い回し判定の確認（AI も DB も使わない）。
 *   npx tsx scripts/verify/interview-prep-research-format-check.ts
 * step7 で学校の下調べをやめたので、会社だけを確かめる。
 * 1. ［調べた情報］ブロック: 会社 timeout／会社 ok／旧版（学校つき）の保存分
 * 2. 使い回し: ok・同じ文字・同じ版→使い回す／会社 timeout→調べ直す／版が違う→調べ直す／文字が違う→調べ直す
 */
import {
  formatResearchBlock,
  normalizeResearch,
  reusableResearch,
  RESEARCH_VERSION,
  type ResearchResult,
} from "@/lib/interview-prep/research-format";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) failures++;
}

const companies = [
  { name: "A社", found: true, business: "ゴム部品を作る会社", source_urls: ["https://example.com"], candidates: [] },
  { name: "B社", found: false, business: "", source_urls: [], candidates: [] },
];
const base: ResearchResult = { version: RESEARCH_VERSION, companiesStatus: "ok", companies };

// 1. 書式
const companyTimeout = formatResearchBlock(normalizeResearch({ ...base, companiesStatus: "timeout", companies: [] }));
check("会社 timeout: 「会社: 今回は調べられなかった（時間切れ）」", companyTimeout.includes("- 会社: 今回は調べられなかった（時間切れ）"));
check("会社 timeout: 「特定できなかった」を書かない", !companyTimeout.includes("特定できなかった"));

const ok = formatResearchBlock(normalizeResearch(base));
check("ok: 「今回は調べられなかった」を書かない", !ok.includes("今回は調べられなかった"));
check("ok: 見つかった会社の説明を書く", ok.includes("- どんな会社か: ゴム部品を作る会社"));
check("ok: 見つからない会社は「特定できなかった」", ok.includes("- どんな会社か: 特定できなかった"));
check("ok: 学校の欄を書かない", !ok.includes("学校"));
check("ok: 決定的（2回で同じ文字）", ok === formatResearchBlock(normalizeResearch(base)));

// step6 以前の保存分（学校つき）: 学校は無視して会社だけ書く
const legacySchool = { name: "C大学", faculty: "工学部", level: "中", hensachi: "52前後", source_urls: ["https://example.org"] };
const legacyJson = { version: 3, companiesStatus: "ok", schoolStatus: "ok", companies, school: legacySchool };
const legacy = normalizeResearch(legacyJson);
check("旧版（学校つき）: 読める", legacy !== null);
check("旧版（学校つき）: 学校を持たない", legacy !== null && !("school" in legacy) && !("schoolStatus" in legacy));
check("旧版（学校つき）: 書式に学校・偏差値が出ない", !/学校|偏差値/.test(formatResearchBlock(legacy)));
// 状態が無い保存分（step5 以前）は ok 扱い
check("状態なし（旧版）: ok 扱いで書く", !formatResearchBlock(normalizeResearch({ version: 2, companies })).includes("今回は調べられなかった"));

// 2. 使い回し
const resume = "レジュメの文字";
check("ok・同じ文字・同じ版 → 使い回す", reusableResearch({ resumeText: resume, researchJson: base }, resume) !== null);
check(
  "会社 timeout → 調べ直す",
  reusableResearch({ resumeText: resume, researchJson: { ...base, companiesStatus: "timeout", companies: [] } }, resume) === null,
);
check(
  "版が違う → 調べ直す",
  reusableResearch({ resumeText: resume, researchJson: { ...base, version: RESEARCH_VERSION - 1 } }, resume) === null,
);
check("旧版（step6・学校つき）→ 調べ直す", reusableResearch({ resumeText: resume, researchJson: legacyJson }, resume) === null);
check("文字が違う → 調べ直す", reusableResearch({ resumeText: resume, researchJson: base }, resume + "（更新）") === null);

console.log(failures === 0 ? "ALL OK" : `NG: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
