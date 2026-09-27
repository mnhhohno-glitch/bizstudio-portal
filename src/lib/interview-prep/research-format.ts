// T-205 step4: 下調べ（会社と学校のウェブ検索）の結果の形・検証・書式。
// 画面（クライアント）からも読むため、Anthropic SDK を読み込む research.ts とは分けている。
//
// - parseResearchJson: AI が返した文字から JSON を取り出し、形を検証して正規化する（形が違えば null＝下調べなし）。
// - formatResearchBlock: 保存済みの research_json から、整理・質問のときに system に入れる文字を組み立てる。
//   決定的な処理だけで組み立てる（同じ JSON なら毎回同じ byte になる＝プロンプトキャッシュが効く・罠#39）。
//   出典 URL はこのブロックに入れない（本文に URL を書かせないため。出典は画面側で表示する）。

export const SCHOOL_LEVELS = ["高", "中", "低", "なし", "不明"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

/** 会社は新しい順に最大3社（指示本文と同じ）。 */
export const MAX_RESEARCH_COMPANIES = 3;
/** 1件あたりの出典 URL の上限（画面の出典表示用）。 */
const MAX_SOURCE_URLS = 5;
const MAX_TEXT_CHARS = 400;

export type ResearchCompany = {
  name: string;
  found: boolean;
  business: string;
  source_urls: string[];
};

export type ResearchSchool = {
  name: string;
  faculty: string;
  level: SchoolLevel;
  hensachi: string;
  source_urls: string[];
};

export type ResearchResult = {
  companies: ResearchCompany[];
  school: ResearchSchool | null;
};

export const RESEARCH_BLOCK_HEADER = "【調べた情報（レジュメ外・ネット検索）】";
export const RESEARCH_NONE_TEXT = "【調べた情報】なし（調べられなかった）";

function str(v: unknown): string | null {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT_CHARS) : null;
}

/** http(s) の URL だけを残す（画面でリンクにするため javascript: などは落とす）。 */
function urls(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const u of v) {
    if (typeof u !== "string") continue;
    const t = u.trim();
    try {
      const parsed = new URL(t);
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !out.includes(t)) out.push(t);
    } catch {
      /* URL でないものは捨てる */
    }
    if (out.length >= MAX_SOURCE_URLS) break;
  }
  return out;
}

/** 形を検証して正規化する。形が違えば null。 */
export function normalizeResearch(raw: unknown): ResearchResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.companies)) return null;

  const companies: ResearchCompany[] = [];
  for (const c of obj.companies) {
    if (!c || typeof c !== "object") return null;
    const r = c as Record<string, unknown>;
    const name = str(r.name);
    const sourceUrls = urls(r.source_urls);
    if (!name || typeof r.found !== "boolean" || sourceUrls === null) return null;
    const business = r.found ? str(r.business) ?? "" : "";
    companies.push({ name, found: r.found && business.length > 0, business, source_urls: sourceUrls });
  }

  let school: ResearchSchool | null = null;
  if (obj.school !== null && obj.school !== undefined) {
    if (typeof obj.school !== "object" || Array.isArray(obj.school)) return null;
    const s = obj.school as Record<string, unknown>;
    const name = str(s.name);
    const level = str(s.level);
    const sourceUrls = urls(s.source_urls);
    if (!name || !level || !(SCHOOL_LEVELS as readonly string[]).includes(level) || sourceUrls === null) return null;
    school = {
      name,
      faculty: str(s.faculty) ?? "",
      level: level as SchoolLevel,
      hensachi: str(s.hensachi) ?? "",
      source_urls: sourceUrls,
    };
  }

  return { companies: companies.slice(0, MAX_RESEARCH_COMPANIES), school };
}

/** AI の応答文字から JSON を取り出して検証する。読めない・形が違う場合は null。 */
export function parseResearchJson(text: string): ResearchResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeResearch(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

/** system に入れる［調べた情報］の文字。下調べなしは1行。 */
export function formatResearchBlock(research: ResearchResult | null): string {
  if (!research) return RESEARCH_NONE_TEXT;
  const lines: string[] = [RESEARCH_BLOCK_HEADER, "", "■ 会社"];
  if (research.companies.length === 0) {
    lines.push("- 調べた会社なし");
  } else {
    for (const c of research.companies) {
      lines.push(`- 会社名: ${c.name}`);
      lines.push(c.found ? `  - どんな会社か: ${c.business}` : "  - どんな会社か: 特定できなかった");
    }
  }
  lines.push("", "■ 学校");
  if (!research.school) {
    lines.push("- 学歴の記載なし");
  } else {
    const s = research.school;
    lines.push(`- 学校名: ${s.name}`);
    if (s.faculty) lines.push(`- 学部・学科・コース: ${s.faculty}`);
    lines.push(`- 学校のレベル: ${s.level}`);
    lines.push(`- 偏差値の目安: ${s.hensachi || "なし"}`);
  }
  return lines.join("\n");
}

/** 画面の「調べた情報の出典」。URL が無いものは出さない。 */
export function researchSources(research: ResearchResult | null | undefined): { label: string; urls: string[] }[] {
  if (!research) return [];
  const out: { label: string; urls: string[] }[] = [];
  for (const c of research.companies) {
    if (c.source_urls.length > 0) out.push({ label: c.name, urls: c.source_urls });
  }
  if (research.school && research.school.source_urls.length > 0) {
    out.push({ label: research.school.name, urls: research.school.source_urls });
  }
  return out;
}

/** 固定欄のバッジに出す学校のレベル。「なし」「不明」・下調べなしは null。 */
export function schoolLevelBadge(research: ResearchResult | null | undefined): "高" | "中" | "低" | null {
  const level = research?.school?.level;
  return level === "高" || level === "中" || level === "低" ? level : null;
}
