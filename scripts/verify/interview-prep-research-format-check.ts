/**
 * T-205 step6: 下調べの書式・使い回し判定の確認（AI も DB も使わない）。
 *   npx tsx scripts/verify/interview-prep-research-format-check.ts
 * 1. ［調べた情報］ブロック: 会社だけ timeout／学校だけ error／両方 ok の3通り
 * 2. 部分ごとの使い回し: 両方 ok・同じ文字・同じ版→両方／会社 ok・学校 timeout→学校だけ調べ直す／版が違う→両方調べ直す
 */
import {
  formatResearchBlock,
  normalizeResearch,
  reusableResearchParts,
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
const school = { name: "C大学", faculty: "工学部", level: "中" as const, hensachi: "52前後", source_urls: [] };
const base: ResearchResult = {
  version: RESEARCH_VERSION,
  companiesStatus: "ok",
  schoolStatus: "ok",
  companies,
  school,
};

// 1. 書式
const companyTimeout = formatResearchBlock(normalizeResearch({ ...base, companiesStatus: "timeout", companies: [] }));
check("会社 timeout: 「会社: 今回は調べられなかった（時間切れ）」", companyTimeout.includes("- 会社: 今回は調べられなかった（時間切れ）"));
check("会社 timeout: 会社に「特定できなかった」を書かない", !companyTimeout.split("■ 学校")[0].includes("特定できなかった"));
check("会社 timeout: 学校は ok のまま書く", companyTimeout.includes("- 学校のレベル: 中"));

const schoolError = formatResearchBlock(normalizeResearch({ ...base, schoolStatus: "error", school: null }));
check("学校 error: 「学校: 今回は調べられなかった（エラー）」", schoolError.includes("- 学校: 今回は調べられなかった（エラー）"));
check("学校 error: 「学歴の記載なし」「不明」を書かない", !schoolError.includes("学歴の記載なし") && !schoolError.split("■ 学校")[1].includes("不明"));
check("学校 error: 会社は ok のまま書く（見つからない会社は特定できなかった）", schoolError.includes("- どんな会社か: ゴム部品を作る会社") && schoolError.includes("- どんな会社か: 特定できなかった"));

const bothOk = formatResearchBlock(normalizeResearch(base));
check("両方 ok: 「今回は調べられなかった」を書かない", !bothOk.includes("今回は調べられなかった"));
check("両方 ok: 見つからない会社は「特定できなかった」", bothOk.includes("- どんな会社か: 特定できなかった"));
check("両方 ok: 決定的（2回で同じ文字）", bothOk === formatResearchBlock(normalizeResearch(base)));

// 状態が無い保存分（step5 以前）は ok 扱い
const legacy = formatResearchBlock(normalizeResearch({ version: 2, companies, school }));
check("状態なし（旧版）: ok 扱いで書く", !legacy.includes("今回は調べられなかった") && legacy.includes("- 学校のレベル: 中"));

// 2. 使い回し
const resume = "レジュメの文字";
const r1 = reusableResearchParts({ resumeText: resume, researchJson: base }, resume);
check("両方 ok・同じ文字・同じ版 → 両方使い回す", r1.companies && r1.school && r1.research !== null);

const r2 = reusableResearchParts(
  { resumeText: resume, researchJson: { ...base, schoolStatus: "timeout", school: null } },
  resume,
);
check("会社 ok・学校 timeout → 会社は使い回し、学校だけ調べ直す", r2.companies && !r2.school);

const r3 = reusableResearchParts({ resumeText: resume, researchJson: { ...base, version: RESEARCH_VERSION - 1 } }, resume);
check("版が違う → 両方調べ直す", !r3.companies && !r3.school);

const r4 = reusableResearchParts({ resumeText: resume, researchJson: base }, resume + "（更新）");
check("文字が違う → 両方調べ直す", !r4.companies && !r4.school);

console.log(failures === 0 ? "ALL OK" : `NG: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
