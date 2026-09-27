// T-205 step4: 下調べ（会社と学校のウェブ検索）の結果の形・検証・書式。
// 画面（クライアント）からも読むため、Anthropic SDK を読み込む research.ts とは分けている。
//
// - parseCompanyResearchJson / parseSchoolResearchJson: AI が返した文字から JSON を取り出し、形を検証して正規化する
//   （形が違えば null＝その部分は調べられなかった）。
// - formatResearchBlock: 保存済みの research_json から、整理・質問のときに system に入れる文字を組み立てる。
//   決定的な処理だけで組み立てる（同じ JSON なら毎回同じ byte になる＝プロンプトキャッシュが効く・罠#39）。
//   出典 URL はこのブロックに入れない（本文に URL を書かせないため。出典は画面側で表示する）。
// - step5: research_json に版番号（RESEARCH_VERSION）を入れる。「作り直す」でレジュメの文字が前の部屋と同じ・版も同じなら
//   下調べを使い回す。下調べの指示や JSON の形を変えたら版を上げる（次の作り直しで必ず調べ直す）。
// - step6: 会社と学校を別々の呼び出しで同時に調べる。research_json に部分ごとの状態（companiesStatus / schoolStatus）を持ち、
//   失敗した部分は［調べた情報］に「今回は調べられなかった（時間切れ／エラー）」と書く（「特定できなかった」は ok で
//   見つからなかったときだけ）。使い回しも部分ごと（reusableResearchParts）。

/** 下調べの版。指示（RESEARCH_COMPANY.md / RESEARCH_SCHOOL.md）や JSON の形を変えたら上げる。 */
export const RESEARCH_VERSION = 3;

export const SCHOOL_LEVELS = ["高", "中", "低", "なし", "不明"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

/** 部分ごとの下調べの結果の状態（step6）。 */
export const RESEARCH_PART_STATUSES = ["ok", "timeout", "error"] as const;
export type ResearchPartStatus = (typeof RESEARCH_PART_STATUSES)[number];

/** 会社は新しい順に最大3社（指示本文と同じ）。 */
export const MAX_RESEARCH_COMPANIES = 3;
/** 1件あたりの出典 URL の上限（画面の出典表示用）。 */
const MAX_SOURCE_URLS = 5;
const MAX_TEXT_CHARS = 400;
/** 特定できなかったときの候補の上限。 */
const MAX_CANDIDATES = 5;

export type ResearchCompany = {
  name: string;
  found: boolean;
  business: string;
  source_urls: string[];
  /** 特定できなかったときの候補（「候補の会社名（都道府県・業種）」）。特定できたときは空。 */
  candidates: string[];
};

export type ResearchSchool = {
  name: string;
  faculty: string;
  level: SchoolLevel;
  hensachi: string;
  source_urls: string[];
};

export type ResearchResult = {
  /** 版番号（step5〜）。step4 以前の保存分には無い。 */
  version?: number;
  /** 会社の下調べの状態（step6〜）。無い保存分（step5 以前）は ok 扱い。ok 以外のとき companies は空。 */
  companiesStatus?: ResearchPartStatus;
  /** 学校の下調べの状態（step6〜）。無い保存分（step5 以前）は ok 扱い。ok 以外のとき school は null。 */
  schoolStatus?: ResearchPartStatus;
  companies: ResearchCompany[];
  school: ResearchSchool | null;
};

export const RESEARCH_BLOCK_HEADER = "【調べた情報（レジュメ外・ネット検索）】";
export const RESEARCH_NONE_TEXT = "【調べた情報】なし（調べられなかった）";

const FAILURE_LABEL: Record<Exclude<ResearchPartStatus, "ok">, string> = {
  timeout: "時間切れ",
  error: "エラー",
};

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

/** 文字列の配列（候補）。配列でなければ空。 */
function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = str(x);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function partStatus(v: unknown): ResearchPartStatus | undefined {
  return typeof v === "string" && (RESEARCH_PART_STATUSES as readonly string[]).includes(v)
    ? (v as ResearchPartStatus)
    : undefined;
}

/** 会社の配列を検証して正規化する。形が違えば null。 */
function normalizeCompanies(raw: unknown): ResearchCompany[] | null {
  if (!Array.isArray(raw)) return null;
  const companies: ResearchCompany[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") return null;
    const r = c as Record<string, unknown>;
    const name = str(r.name);
    const sourceUrls = urls(r.source_urls);
    if (!name || typeof r.found !== "boolean" || sourceUrls === null) return null;
    const business = r.found ? str(r.business) ?? "" : "";
    const found = r.found && business.length > 0;
    companies.push({
      name,
      found,
      business,
      source_urls: sourceUrls,
      candidates: found ? [] : strList(r.candidates, MAX_CANDIDATES),
    });
  }
  return companies.slice(0, MAX_RESEARCH_COMPANIES);
}

/** 学校を検証して正規化する。学歴なし（null/undefined）は { school: null }、形が違えば null。 */
function normalizeSchool(raw: unknown): { school: ResearchSchool | null } | null {
  if (raw === null || raw === undefined) return { school: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const name = str(s.name);
  const level = str(s.level);
  const sourceUrls = urls(s.source_urls);
  if (!name || !level || !(SCHOOL_LEVELS as readonly string[]).includes(level) || sourceUrls === null) return null;
  return {
    school: {
      name,
      faculty: str(s.faculty) ?? "",
      level: level as SchoolLevel,
      hensachi: str(s.hensachi) ?? "",
      source_urls: sourceUrls,
    },
  };
}

/** 保存済みの research_json の形を検証して正規化する。形が違えば null。 */
export function normalizeResearch(raw: unknown): ResearchResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const companiesStatus = partStatus(obj.companiesStatus);
  const schoolStatus = partStatus(obj.schoolStatus);
  // 失敗した部分は中身を持たない（読むときに ok と取り違えないよう空にそろえる）
  const companies = companiesStatus && companiesStatus !== "ok" ? [] : normalizeCompanies(obj.companies);
  const school = schoolStatus && schoolStatus !== "ok" ? { school: null } : normalizeSchool(obj.school);
  if (!companies || !school) return null;

  const version = typeof obj.version === "number" && Number.isInteger(obj.version) ? obj.version : undefined;
  return {
    ...(version !== undefined ? { version } : {}),
    ...(companiesStatus ? { companiesStatus } : {}),
    ...(schoolStatus ? { schoolStatus } : {}),
    companies,
    school: school.school,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 会社用の応答（{"companies": [...]}）を読む。読めない・形が違う場合は null。 */
export function parseCompanyResearchJson(text: string): ResearchCompany[] | null {
  const obj = extractJsonObject(text);
  return obj ? normalizeCompanies(obj.companies) : null;
}

/** 学校用の応答（{"school": {...} | null}）を読む。読めない・形が違う・school キーが無い場合は null。 */
export function parseSchoolResearchJson(text: string): { school: ResearchSchool | null } | null {
  const obj = extractJsonObject(text);
  return obj && "school" in obj ? normalizeSchool(obj.school) : null;
}

/** system に入れる［調べた情報］の文字。下調べなしは1行。 */
export function formatResearchBlock(research: ResearchResult | null): string {
  if (!research) return RESEARCH_NONE_TEXT;
  const lines: string[] = [RESEARCH_BLOCK_HEADER, "", "■ 会社"];
  const cs = research.companiesStatus ?? "ok";
  if (cs !== "ok") {
    lines.push(`- 会社: 今回は調べられなかった（${FAILURE_LABEL[cs]}）`);
  } else if (research.companies.length === 0) {
    lines.push("- 調べた会社なし");
  } else {
    for (const c of research.companies) {
      lines.push(`- 会社名: ${c.name}`);
      if (c.found) {
        lines.push(`  - どんな会社か: ${c.business}`);
      } else {
        lines.push("  - どんな会社か: 特定できなかった");
        if (c.candidates.length > 0) lines.push(`  - 候補: ${c.candidates.join("／")}`);
      }
    }
  }
  lines.push("", "■ 学校");
  const ss = research.schoolStatus ?? "ok";
  if (ss !== "ok") {
    lines.push(`- 学校: 今回は調べられなかった（${FAILURE_LABEL[ss]}）`);
  } else if (!research.school) {
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

/** 使い回す部分（step6）。companies / school が true の部分は research（前の部屋の結果）の該当部分をそのまま使う。 */
export type ResearchReuse = {
  companies: boolean;
  school: boolean;
  research: ResearchResult | null;
};

/**
 * 前の部屋の下調べのうち、使い回せる部分を返す（step6 で部分ごとに判定）。
 * 条件: 前の部屋に research_json がある・レジュメの文字が完全に同じ・版が RESEARCH_VERSION と同じ・その部分の状態が ok。
 * 「作り直す」と途中失敗の再送の両方で使う（再送は今の部屋自身を prev に渡す）。
 */
export function reusableResearchParts(
  prev: { resumeText: string | null; researchJson: unknown } | null | undefined,
  resumeText: string,
): ResearchReuse {
  const none: ResearchReuse = { companies: false, school: false, research: null };
  if (!prev || prev.resumeText !== resumeText) return none;
  const research = normalizeResearch(prev.researchJson);
  if (!research || research.version !== RESEARCH_VERSION) return none;
  const companies = research.companiesStatus === "ok";
  const school = research.schoolStatus === "ok";
  return companies || school ? { companies, school, research } : none;
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
