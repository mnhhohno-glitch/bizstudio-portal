// T-205 step8: 最初の整理を「決まった項目」で受け取る（AI はツール save_prep_summary の入力として返す）。
// 画面（クライアント）からも読むため、Anthropic SDK を読み込む chat.ts とは分けている。
//
// - SUMMARY_TOOL_INPUT_SCHEMA: ツールの入力の形（JSON Schema）。AI に渡す。
// - normalizePrepSummary: AI が返した入力を検証・正規化する（形が違えば null＝作り直しの対象）。
// - formatPrepSummaryText: 保存済みの summary_json から、質問に答えるときの会話履歴に入れる文章を組み立てる。
//   決定的な処理だけで組み立てる（同じ JSON なら毎回同じ byte になる＝プロンプトキャッシュが効く・罠#39）。
// - asked_questions（聞いた質問）: 質問の番号（questions の添字）ごとに聞いた日時と userId を持つ。
//   toggleAskedQuestion は純粋関数（API とAIなしの確認スクリプトで共有）。
// - T-208 step3（付録H）: questions の各要素に company（関わる会社の名前・works の company と同じ書き方・無ければ「全体」）。
//   会社名のそろえ方は normalizeCompanyKey 1か所（整理の検証と、台本の会社ごとの差し込みの両方で使う）。
//   company が無い古い整理は normalizePrepSummary ですべて「全体」になる。

export const EMPLOYMENT_STATUSES = ["在職中", "離職中", "不明"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/** 経歴の型の選択肢（「判定できない」は部屋の career_type には null で入れる）。 */
export const CAREER_TYPE_CHOICES = ["一社継続型", "同職種転職型", "職種転換型", "判定できない"] as const;
export type CareerTypeChoice = (typeof CAREER_TYPE_CHOICES)[number];

export type PrepTimelineItem = { period: string; title: string; detail: string; fromResearch: boolean };
export type PrepWorkItem = { term: string; meaning: string };
export type PrepWork = { company: string; items: PrepWorkItem[] };
/** T-208 step3: company は works の company と同じ書き方の会社名。特定の会社に関わらなければ「全体」（PREP_QUESTION_ALL） */
export type PrepQuestion = { question: string; why: string; reveals: string; mismatch: boolean; company: string };
export type PrepStrength = { strength: string; basis: string; fromSelfPr: boolean };
export type PrepGlossaryItem = { term: string; meaning: string };

export type PrepSummary = {
  summary: string;
  employmentStatus: EmploymentStatus;
  age: string;
  currentIncome: string;
  qualifications: string[];
  careerType: CareerTypeChoice;
  careerTypeReason: string;
  timeline: PrepTimelineItem[];
  works: PrepWork[];
  questions: PrepQuestion[];
  strengths: PrepStrength[];
  glossary: PrepGlossaryItem[];
};

/** 質問ごとの「聞いた」記録。キーは questions の添字（文字列）。 */
export type AskedQuestions = Record<string, { askedAt: string; userId: string }>;

export const SUMMARY_TOOL_NAME = "save_prep_summary";

/** 特定の会社に関わらない質問の company の値（T-208 step3・付録H）。company が無い古い整理もこれになる。 */
export const PREP_QUESTION_ALL = "全体";

/**
 * 会社名を突き合わせ用にそろえる（付録H）: 全角半角（NFKC）・空白・「株式会社」「（株）」「(株)」「㈱」を取り、小文字にする。
 * 整理の検証・台本の会社ごとの差し込みの両方でこの1つを使う。
 */
export function normalizeCompanyKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/株式会社|\(株\)|（株）|㈱/g, "")
    .toLowerCase();
}

/** 2つの会社名が同じ会社を指すか（そろえた上で比べる。どちらかが空なら false） */
export function companyMatches(a: string, b: string): boolean {
  const ka = normalizeCompanyKey(a);
  const kb = normalizeCompanyKey(b);
  return ka !== "" && ka === kb;
}

/**
 * questions の company を works の会社名にそろえる。どの会社にも一致しなければ「全体」。
 * 一致した場合は works 側の書き方に置き換える（表記ゆれを吸収）。
 */
export function resolveQuestionCompany(company: string | null | undefined, works: ReadonlyArray<{ company: string }>): string {
  const raw = (company ?? "").trim();
  if (!raw || raw === PREP_QUESTION_ALL) return PREP_QUESTION_ALL;
  const hit = works.find((w) => companyMatches(w.company, raw));
  return hit ? hit.company : PREP_QUESTION_ALL;
}

/** 質問に元の添字（asked_questions のキー・Q番号）を付けたもの */
export type IndexedPrepQuestion<Q = PrepQuestion> = { index: number; question: Q };

/**
 * ある会社に関わる質問（食い違い＝mismatch を先に、あとは元の順）。台本の経歴確認の会社ごとの場面に出す（付録H）。
 * 純粋関数。company が無い古い整理は「全体」扱いなので、どの会社にも当たらない。
 */
export function questionsForCompany<Q extends { mismatch: boolean; company?: string }>(
  questions: ReadonlyArray<Q>,
  companyName: string,
): IndexedPrepQuestion<Q>[] {
  const hits = questions
    .map((question, index) => ({ index, question }))
    .filter(({ question }) => companyMatches(question.company ?? "", companyName));
  return [...hits.filter((h) => h.question.mismatch), ...hits.filter((h) => !h.question.mismatch)];
}

/**
 * どの会社にも当たらない質問と「全体」の質問（元の順のまま）。経歴確認の最後にまとめて出す（今までどおり）。
 */
export function questionsUnassigned<Q extends { company?: string }>(
  questions: ReadonlyArray<Q>,
  companyNames: ReadonlyArray<string>,
): IndexedPrepQuestion<Q>[] {
  return questions
    .map((question, index) => ({ index, question }))
    .filter(({ question }) => {
      const c = (question.company ?? "").trim();
      if (!c || c === PREP_QUESTION_ALL) return true;
      return !companyNames.some((name) => companyMatches(name, c));
    });
}

const MAX_TEXT = 1000;
const MAX_LIST = 30;
const MAX_QUESTIONS = 8;
const MAX_STRENGTHS = 3;

/** AI に渡すツール入力の形。項目の説明は SKILL.md 側に書く（ここは形だけ）。 */
export const SUMMARY_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "ひとことで（2〜3文）" },
    employmentStatus: { type: "string", enum: [...EMPLOYMENT_STATUSES] },
    age: { type: "string", description: "年齢。無ければ空文字" },
    currentIncome: { type: "string", description: "今の年収。無ければ空文字" },
    qualifications: { type: "array", items: { type: "string" } },
    careerType: { type: "string", enum: [...CAREER_TYPE_CHOICES] },
    careerTypeReason: { type: "string" },
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          period: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          fromResearch: { type: "boolean" },
        },
        required: ["period", "title", "detail", "fromResearch"],
      },
    },
    works: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { term: { type: "string" }, meaning: { type: "string" } },
              required: ["term", "meaning"],
            },
          },
        },
        required: ["company", "items"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why: { type: "string" },
          reveals: { type: "string" },
          mismatch: { type: "boolean" },
          company: { type: "string", description: "関わる会社の名前（works の company と同じ書き方）。特定の会社に関わらなければ「全体」" },
        },
        required: ["question", "why", "reveals", "mismatch", "company"],
      },
    },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          strength: { type: "string" },
          basis: { type: "string" },
          fromSelfPr: { type: "boolean" },
        },
        required: ["strength", "basis", "fromSelfPr"],
      },
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, meaning: { type: "string" } },
        required: ["term", "meaning"],
      },
    },
  },
  required: [
    "summary",
    "employmentStatus",
    "age",
    "currentIncome",
    "qualifications",
    "careerType",
    "careerTypeReason",
    "timeline",
    "works",
    "questions",
    "strengths",
    "glossary",
  ],
} as const;

/** 文字列（必須）。空でも可のときは allowEmpty。 */
function text(v: unknown, allowEmpty = false): string | null {
  if (typeof v !== "string") return allowEmpty && (v === null || v === undefined) ? "" : null;
  const t = v.trim().slice(0, MAX_TEXT);
  if (!t && !allowEmpty) return null;
  return t;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function strList(v: unknown): string[] | null {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    const t = text(x, true);
    if (t === null) return null;
    if (t) out.push(t);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/** 配列の各要素を normalize で正規化する。配列でない・要素の形が違えば null。 */
function list<T>(v: unknown, normalize: (item: Record<string, unknown>) => T | null, max = MAX_LIST): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const n = normalize(item as Record<string, unknown>);
    if (n === null) return null;
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * AI が返したツール入力を検証・正規化する。形が違えば null。
 * 必須: summary が空でない・employmentStatus / careerType が選択肢のどれか・questions が1つ以上。
 * その他の配列は空でもよい（レジュメが薄いときに無理に埋めさせない）。
 */
export function normalizePrepSummary(raw: unknown): PrepSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const summary = text(r.summary);
  if (!summary) return null;
  const employmentStatus = text(r.employmentStatus);
  if (!employmentStatus || !(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)) return null;
  const careerType = text(r.careerType);
  if (!careerType || !(CAREER_TYPE_CHOICES as readonly string[]).includes(careerType)) return null;
  const age = text(r.age, true);
  const currentIncome = text(r.currentIncome, true);
  const careerTypeReason = text(r.careerTypeReason, true);
  if (age === null || currentIncome === null || careerTypeReason === null) return null;
  const qualifications = strList(r.qualifications);
  if (qualifications === null) return null;

  const timeline = list<PrepTimelineItem>(r.timeline ?? [], (it) => {
    const period = text(it.period, true);
    const title = text(it.title);
    const detail = text(it.detail, true);
    const fromResearch = bool(it.fromResearch ?? false);
    if (period === null || !title || detail === null || fromResearch === null) return null;
    return { period, title, detail, fromResearch };
  });
  if (timeline === null) return null;

  const works = list<PrepWork>(r.works ?? [], (w) => {
    const company = text(w.company);
    if (!company) return null;
    const items = list<PrepWorkItem>(w.items ?? [], (it) => {
      const term = text(it.term);
      const meaning = text(it.meaning, true);
      if (!term || meaning === null) return null;
      return { term, meaning };
    });
    if (items === null) return null;
    return { company, items };
  });
  if (works === null) return null;

  const questions = list<PrepQuestion>(
    r.questions,
    (q) => {
      const question = text(q.question);
      const why = text(q.why, true);
      const reveals = text(q.reveals, true);
      const mismatch = bool(q.mismatch ?? false);
      if (!question || why === null || reveals === null || mismatch === null) return null;
      // T-208 step3: company は works の会社名にそろえる。無い（古い整理）・一致しない → 「全体」
      const company = resolveQuestionCompany(typeof q.company === "string" ? q.company : "", works);
      return { question, why, reveals, mismatch, company };
    },
    MAX_QUESTIONS,
  );
  if (questions === null || questions.length === 0) return null;

  const strengths = list<PrepStrength>(
    r.strengths ?? [],
    (s) => {
      const strength = text(s.strength);
      const basis = text(s.basis, true);
      const fromSelfPr = bool(s.fromSelfPr ?? false);
      if (!strength || basis === null || fromSelfPr === null) return null;
      return { strength, basis, fromSelfPr };
    },
    MAX_STRENGTHS,
  );
  if (strengths === null) return null;

  const glossary = list<PrepGlossaryItem>(r.glossary ?? [], (g) => {
    const term = text(g.term);
    const meaning = text(g.meaning, true);
    if (!term || meaning === null) return null;
    return { term, meaning };
  });
  if (glossary === null) return null;

  return {
    summary,
    employmentStatus: employmentStatus as EmploymentStatus,
    age,
    currentIncome,
    qualifications,
    careerType: careerType as CareerTypeChoice,
    careerTypeReason,
    timeline,
    works,
    questions,
    strengths,
    glossary,
  };
}

/** 部屋の career_type に入れる値（「判定できない」は null）。 */
export function careerTypeForRoom(summary: PrepSummary): string | null {
  return summary.careerType === "判定できない" ? null : summary.careerType;
}

/**
 * summary_json を毎回同じ書式の文章にする（質問に答えるときの会話履歴に、整理の AI 発言として入れる）。
 * 決定的な処理のみ（日時・乱数・環境依存の値を入れない）。
 */
export function formatPrepSummaryText(s: PrepSummary): string {
  const lines: string[] = [];
  lines.push("### ひとことで", `- ${s.summary}`, "");

  lines.push("### 基本情報");
  lines.push(`- 今の状況: ${s.employmentStatus}`);
  if (s.age) lines.push(`- 年齢: ${s.age}`);
  if (s.currentIncome) lines.push(`- 今の年収: ${s.currentIncome}`);
  if (s.qualifications.length > 0) lines.push(`- 資格: ${s.qualifications.join("、")}`);
  lines.push("");

  lines.push("### 経歴の型");
  lines.push(`- 経歴の型: ${s.careerType}${s.careerTypeReason ? `（根拠: ${s.careerTypeReason}）` : ""}`);
  lines.push("");

  lines.push("### 経歴の流れ");
  if (s.timeline.length === 0) lines.push("- （レジュメから読み取れる経歴なし）");
  for (const t of s.timeline) {
    lines.push(`- ${t.period ? `${t.period} ` : ""}${t.title}`);
    if (t.detail) lines.push(`  - ${t.detail}${t.fromResearch ? "（調べた情報）" : ""}`);
  }
  lines.push("");

  lines.push("### やってきた仕事と、その意味");
  if (s.works.length === 0) lines.push("- （レジュメに仕事の記載なし）");
  for (const w of s.works) {
    lines.push(`- ${w.company}`);
    for (const it of w.items) lines.push(`  - ${it.term} → ${it.meaning}`);
  }
  lines.push("- ※→の右側は一般的な意味です。本人のやり方は、レジュメからは分かりません。");
  lines.push("");

  lines.push("### 強み");
  if (s.strengths.length === 0) lines.push("- レジュメからは判断できない");
  for (const st of s.strengths) {
    lines.push(`- ${st.strength}（根拠: ${st.fromSelfPr ? "本人の自己PRより" : st.basis}）`);
  }
  lines.push("");

  lines.push("### 面談での質問アドバイス");
  s.questions.forEach((q, i) => {
    // T-208 step3: 会社に関わる質問だけ会社名を添える（「全体」は付けない＝古い整理の文章は byte が変わらない）
    const company = q.company && q.company !== PREP_QUESTION_ALL ? `［${q.company}］` : "";
    lines.push(`${i + 1}. ${q.question}${q.mismatch ? "（レジュメの食い違い）" : ""}${company}`);
    lines.push(`   - なぜ聞くか: ${q.why}`);
    lines.push(`   - 答えで分かること: ${q.reveals}`);
  });
  lines.push("");

  lines.push("### 知っておきたい言葉");
  if (s.glossary.length === 0) lines.push("- （なし）");
  for (const g of s.glossary) lines.push(`- ${g.term} → ${g.meaning}`);

  return lines.join("\n");
}

/** 保存済みの asked_questions を読む。形が違うものは捨てる。 */
export function normalizeAskedQuestions(raw: unknown): AskedQuestions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AskedQuestions = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.askedAt !== "string" || typeof o.userId !== "string") continue;
    out[k] = { askedAt: o.askedAt, userId: o.userId };
  }
  return out;
}

/**
 * 「聞いた」を付ける／外す（純粋関数）。asked=true で記録、false で削除。
 * index が questions の範囲外なら変えずに返す。
 */
export function toggleAskedQuestion(
  prev: AskedQuestions,
  index: number,
  asked: boolean,
  userId: string,
  now: Date,
  questionCount: number,
): AskedQuestions {
  if (!Number.isInteger(index) || index < 0 || index >= questionCount) return prev;
  const next: AskedQuestions = { ...prev };
  const key = String(index);
  if (asked) next[key] = { askedAt: now.toISOString(), userId };
  else delete next[key];
  return next;
}
