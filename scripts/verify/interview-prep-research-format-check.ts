/**
 * T-205 step6/step7: 下調べの書式・使い回し判定の確認（AI も DB も使わない）。
 *   npx tsx scripts/verify/interview-prep-research-format-check.ts
 * step7 で学校の下調べをやめたので、会社だけを確かめる。
 * 1. ［調べた情報］ブロック: 会社 timeout／会社 ok／旧版（学校つき）の保存分
 * 2. 使い回し: ok・同じ文字・同じ版→使い回す／会社 timeout→調べ直す／版が違う→調べ直す／文字が違う→調べ直す
 * 3. step10 公式サイト: 検索結果に無い officialUrl は空になる／ある URL は残る／officialUrl の無い古い保存分も読めてリンクを出さない
 */
import {
  formatResearchBlock,
  keepSearchedOfficialUrls,
  officialSites,
  officialUrlForTitle,
  parseCompanyResearchJson,
  researchSources,
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
  { name: "A社", found: true, business: "ゴム部品を作る会社", source_urls: ["https://example.com"], candidates: [], officialUrl: "" },
  { name: "B社", found: false, business: "", source_urls: [], candidates: [], officialUrl: "" },
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

// 3. step10 公式サイト
const aiText = JSON.stringify({
  companies: [
    { name: "三春工業株式会社", found: true, business: "部品を作る会社", source_urls: ["https://a.example/"], officialUrl: "https://miharu.example.co.jp/", candidates: [] },
    { name: "作り話商事", found: true, business: "卸の会社", source_urls: [], officialUrl: "https://made-up.example.jp/", candidates: [] },
    { name: "不明社", found: false, business: "", source_urls: [], officialUrl: "https://unknown.example/", candidates: ["候補"] },
    { name: "危険社", found: true, business: "商社", source_urls: [], officialUrl: "javascript:alert(1)", candidates: [] },
  ],
});
const parsed = parseCompanyResearchJson(aiText);
check("公式: 応答を読める", parsed !== null && parsed.length === 3);
const kept = keepSearchedOfficialUrls(parsed ?? [], ["https://miharu.example.co.jp", "https://other.example/page"]);
check("公式: 検索結果にある URL は残す（末尾の/違いは同じ）", kept[0]?.officialUrl === "https://miharu.example.co.jp/");
check("公式: 検索結果に無い URL は空にする", kept[1]?.officialUrl === "");
check("公式: 特定できなかった会社は空", kept[2]?.officialUrl === "");
check("公式: 検索結果が空なら全部空", keepSearchedOfficialUrls(parsed ?? [], []).every((c) => c.officialUrl === ""));
const withSite: ResearchResult = { version: RESEARCH_VERSION, companiesStatus: "ok", companies: kept };
check("公式: ホームページ一覧は URL のある会社だけ", officialSites(withSite).length === 1 && officialSites(withSite)[0].name === "三春工業株式会社");
check("公式: 経歴の行（三春工業 正社員）に当たる", officialUrlForTitle(withSite, "三春工業 正社員") === "https://miharu.example.co.jp/");
check("公式: 経歴の行（（株）三春工業）に当たる", officialUrlForTitle(withSite, "（株）三春工業 契約社員") !== null);
check("公式: 学校の行には当たらない", officialUrlForTitle(withSite, "〇〇高校 卒業") === null);
check("公式: ［調べた情報］に URL を書かない", !formatResearchBlock(withSite).includes("miharu.example"));
check(
  "公式: officialUrl を足しても［調べた情報］の文字は変わらない",
  formatResearchBlock(withSite) === formatResearchBlock({ ...withSite, companies: kept.map((c) => ({ ...c, officialUrl: "" })) }),
);
// officialUrl の無い古い保存分（step9 以前・版4）
const oldRoom = normalizeResearch({
  version: 4,
  companiesStatus: "ok",
  companies: [{ name: "三春工業", found: true, business: "部品", source_urls: ["https://a.example/"], candidates: [] }],
});
check("古い部屋: 読める", oldRoom !== null && oldRoom.companies[0].officialUrl === "");
check("古い部屋: ホームページ一覧は空", officialSites(oldRoom).length === 0);
check("古い部屋: 経歴の行にリンクを出さない", officialUrlForTitle(oldRoom, "三春工業 正社員") === null);
check("古い部屋: 出典はそのまま出る", researchSources(oldRoom).length === 1);
check("古い部屋: null でもエラーにならない", officialSites(null).length === 0 && officialUrlForTitle(null, "x") === null);
check("古い部屋（版4）→ 調べ直す", reusableResearch({ resumeText: resume, researchJson: { ...base, version: 4 } }, resume) === null);

console.log(failures === 0 ? "ALL OK" : `NG: ${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
