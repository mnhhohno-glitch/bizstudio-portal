// T-208 step2: 台本の実行（純粋関数）。画面（InterviewScriptMode）と確認スクリプトで共有する。
// - buildContext: 面談記録・求職者・面談準備の整理・送信者から差し込み用の情報を組み立てる
// - expandScenes: 会社ごとにくり返す場面を展開し、条件で飛ばす場面を除く
//   T-208 不具合修正: 職歴の場面は会社を外側にして一周ずつ（#1）・空白期間の場面を会社の間に出す（#2）・
//   最終学歴は一番新しい学校（#3）・「次へ」は押した答えで並べ直してから決める（nextSceneOf・#4）
// - deriveValues / deriveFlags: 答えから決まる差し込み（〔内容〕〔時期の目安〕…）と条件（line / mail / hurry …）
// - sceneWrites: 1つの場面の答えから「どの欄に何を入れるか」を作る（メモ欄は場面ごとに1つの文にまとめる）

import { PREP_QUESTION_ALL, companyMatches, questionsForCompany, questionsUnassigned } from "@/lib/interview-prep/summary-format";
import { fieldPath } from "./apply";
import {
  calcSalary,
  firstYearMonth,
  formatHours,
  formatMan,
  formatMonthsJa,
  lastYearMonth,
  monthsBetween,
  nextInterviewGuide,
  overtimeDayToMonth,
  overtimeMonthToDay,
  parseNumber,
  periodEnd,
  scheduleOutlook,
  type YearMonth,
} from "./calc";
import { baseFlags, baseValues, inputOf, renderSay, type DerivedValues, type Flags } from "./render";
import {
  DERIVED_TARGETS,
  SCRIPT_PARTS,
  SCRIPT_SCENES,
  agentOf,
  choiceValueOf,
  contactOf,
  derivedWrites,
  docsOf,
  employedOf,
  hasSelectionOf,
  nextInterviewDateOf,
  nextToolOf,
  retireMonthsOf,
  timelineOf,
} from "./script-v1";
import type {
  AnswerMap,
  FieldTarget,
  PartId,
  PrepQuestionView,
  RuntimeScene,
  SceneAnswer,
  ScriptCompany,
  ScriptContext,
  ScriptGap,
  ScriptMeta,
  ScriptScene,
} from "./types";
import { META_KEY } from "./types";

/* ---------- 実行時の情報 ---------- */

export type WorkHistoryLike = {
  order: number;
  companyName: string | null;
  jobTypeFlag: string | null;
  jobTypeMemo: string | null;
  hireDate?: string | null;
  leaveDate?: string | null;
};

export type PrepSummaryLike = {
  timeline?: Array<{ period: string; title: string; detail: string }>;
  works?: Array<{ company: string }>;
  /** company は T-208 step3 で足した項目。無い古い整理は「全体」扱い */
  questions?: Array<{ question: string; why: string; mismatch: boolean; company?: string }>;
} | null;

export type BuildContextInput = {
  candidateName: string;
  candidateEmail: string | null;
  caName: string;
  caFamilyName: string;
  startTime: string;
  tool: string;
  detail: Record<string, unknown>;
  workHistories: WorkHistoryLike[];
  prepSummary: PrepSummaryLike;
  askedQuestions: Record<string, unknown>;
  today?: Date;
};

const SCHOOL_RE = /(大学院|大学|高校|高等学校|専門学校|短期大学|短大|高専|学校|学園|スクール)/;

/* ---------- T-208 不具合修正 #2: 整理の時系列の項目の種類（学校／会社／空白期間） ---------- */

/** 雇用形態・在籍の言葉（取り除いて、勤め先の名前が残るかを見る） */
const EMPLOYMENT_WORD_RE = /(正社員|契約社員|派遣社員|派遣|アルバイト|パート|嘱託|業務委託|フリーランス|個人事業主|自営業|公務員|職員|入社|在籍中|現在|社員|勤務|在籍|中退|卒業|修了)/g;
/** 働いていたことを示す言葉。これがあれば、名前に学校の言葉（「〇〇スクール運営会社」「〇〇学園 職員」）を含んでいても学校ではない */
const WORKED_WORD_RE = /(正社員|契約社員|派遣社員|派遣|アルバイト|パート|嘱託|業務委託|フリーランス|個人事業主|自営業|公務員|職員|入社|在籍中|在籍|勤務)/;
/** 勤め先の名前が無い期間の言葉 */
const GAP_WORD_RE = /(受験|浪人|予備校|療養|休養|休職|静養|闘病|転職活動|求職|就職活動|家事|育児|子育て|介護|留学|ワーキングホリデー|ワーホリ|無職|離職|退職後|空白|ブランク|フリーター|ニート|専業主婦|専業主夫|資格の?勉強|勉強|準備|充電|休憩|休み)/;
/** 勤め先の名前の印（これがあれば、空白の言葉を含んでいても会社のまま） */
const COMPANY_MARK_RE = /(株式会社|有限会社|合同会社|合資会社|㈱|\(株\)|（株）|会社|法人|病院|クリニック|医院|薬局|銀行|信用金庫|組合|塾|店|工場|事務所|センター|グループ|ホールディングス|カンパニー|商事|工業|産業|建設|不動産|運輸|サービス|システム|自衛隊|役所|役場|県庁|庁|省|署|局|Inc\.?|Co\.|Ltd\.?|LLC|Corp\.?)/i;

export type TimelineItemKind = "school" | "company" | "gap";

/**
 * 整理の時系列の1項目の種類。整理には種類の項目が無いので、画面側で見分ける（AIへの指示は変えない）。
 * - 学校の言葉があり、働いていたことを示す言葉（正社員・派遣・職員…）が無ければ school
 *   （「英会話スクール運営会社 正社員」「〇〇学園 職員」は会社。前は学校扱いで会社から落ちていた）
 * - 雇用形態・在籍の言葉を取り除いて何も残らなければ gap（勤め先の名前が無い。「アルバイト」だけ、「自営業」だけ等）
 * - 勤め先の名前の印があれば company（「〇〇病院 休職」のように空白の言葉を含んでいても）
 * - 空白期間の言葉があれば gap（「受験勉強」「転職活動」「療養」等）。それ以外は company
 */
export function timelineItemKind(title: string): TimelineItemKind {
  const t = (title ?? "").trim();
  if (!t) return "gap";
  if (SCHOOL_RE.test(t) && !WORKED_WORD_RE.test(t)) return "school";
  const stripped = t.replace(EMPLOYMENT_WORD_RE, "").replace(/[\s()（）・,，、/／〜~-]+/g, "").trim();
  if (!stripped) return "gap";
  if (COMPANY_MARK_RE.test(t)) return "company";
  if (GAP_WORD_RE.test(stripped)) return "gap";
  return "company";
}

/** T-208 不具合修正 #3: 高校か（名前に「高等学校」「高校」。「高等専門学校」「高等専修学校」「高専」は高校ではない） */
export function isHighSchoolName(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (/高等専門学校|高等専修学校|高専/.test(n)) return false;
  return /高等学校|高校/.test(n);
}

type PrepTimelineLike = { period: string; title: string; detail: string };

function schoolNameOf(title: string): string {
  return title.replace(/\s*(卒業|中退|修了|卒).*$/, "").trim();
}

function companyNameOf(title: string): string {
  return title.replace(/\s*(正社員|契約社員|派遣|アルバイト|パート|入社|在籍中|現在).*$/, "").trim();
}

function formatYearMonth(ym: YearMonth | null, fallback: string): string {
  return ym ? `${ym.y}年${ym.m}月` : fallback;
}

/**
 * 登録情報（面談準備の整理）の経歴の流れから、最終学歴の学校名・卒業年月を取る。
 * T-208 不具合修正 #3: 卒業（中退）の年月が読めれば一番新しい学校、読めなければ時系列で最後の学校（前は最初に見つかった＝一番古い学校だった）。
 */
function educationFromPrep(prep: PrepSummaryLike): { school: string; gradYear: string; gradYm: YearMonth | null } {
  const schools = (prep?.timeline ?? []).filter((t) => timelineItemKind(t.title) === "school");
  if (schools.length === 0) return { school: "", gradYear: "", gradYm: null };
  let found = schools[schools.length - 1];
  let foundYm = lastYearMonth(found.period);
  for (const t of schools) {
    const ym = lastYearMonth(t.period);
    if (ym && (!foundYm || monthsBetween(foundYm, ym) > 0)) {
      found = t;
      foundYm = ym;
    }
  }
  const school = schoolNameOf(found.title);
  // 卒業年月の表示: 年月が読めればそれ、年だけなら "2016年"、どちらも無ければ period そのまま（前と同じ）
  const yearOnly = found.period.match(/(\d{4})年/g);
  const gradYear = foundYm ? formatYearMonth(foundYm, "") : yearOnly ? yearOnly[yearOnly.length - 1] : found.period.trim();
  return { school, gradYear, gradYm: foundYm };
}

/**
 * 面談準備の整理から、職歴の行がまだ無いときの仮の会社一覧を作る。
 * T-208 不具合修正 #2: 勤め先の名前がある項目だけ会社にする（学校・空白期間は除く）。雇用形態は問わない。
 */
export function companiesFromPrep(prep: PrepSummaryLike): ScriptCompany[] {
  const items = (prep?.timeline ?? []).filter((t) => timelineItemKind(t.title) === "company");
  const names = items.length > 0
    ? items.map((t) => ({ name: companyNameOf(t.title), hire: t.period, desc: t.detail }))
    : (prep?.works ?? []).map((w) => ({ name: w.company, hire: "", desc: "" }));
  return names.map((n, index) => ({
    index,
    name: n.name,
    hireDate: n.hire.replace(/〜.*$/, "").trim(),
    leaveDate: formatYearMonth(periodEnd(n.hire), ""),
    jobDesc: "",
    isCurrent: index === names.length - 1,
    placeholder: true,
  }));
}

/** 空白期間と見なす間隔（か月） */
export const GAP_MIN_MONTHS = 6;

/**
 * T-208 不具合修正 #2: 空白期間の一覧。
 * 1. 整理の時系列の空白の項目（勤め先の名前が無い期間）: 次の会社の名前で会社一覧の位置に当てる（名前が合わなければ時系列での順番、次の会社が無ければ最後）
 * 2. 日付が分かる範囲で、卒業→最初の会社・会社→次の会社の間が GAP_MIN_MONTHS 以上空いていれば同じ場面を出す（1 と同じ位置には重ねない）
 *    最後の会社を辞めていて（isCurrent でない）今日まで GAP_MIN_MONTHS 以上なら、最後に「退職されてから今まで」の空白を出す
 */
export function gapsOf(input: { companies: ScriptCompany[]; timeline: PrepTimelineLike[]; school: string; gradYm: YearMonth | null; today: Date }): ScriptGap[] {
  const { companies, timeline, school, gradYm } = input;
  const found: Array<Omit<ScriptGap, "index">> = [];
  const taken = new Set<number>();

  // 1. 整理の時系列の空白の項目
  const kinds = timeline.map((t) => ({ t, kind: timelineItemKind(t.title) }));
  let companyOrdinal = 0;
  for (let i = 0; i < kinds.length; i++) {
    const { t, kind } = kinds[i];
    if (kind === "company") {
      companyOrdinal++;
      continue;
    }
    if (kind !== "gap") continue;
    const next = kinds.slice(i + 1).find((k) => k.kind === "company");
    const prev = [...kinds.slice(0, i)].reverse().find((k) => k.kind !== "gap");
    let position = companies.length;
    if (next) {
      const name = companyNameOf(next.t.title);
      const hit = companies.findIndex((c) => companyMatches(c.name, name));
      position = hit >= 0 ? hit : Math.min(companyOrdinal, companies.length);
    }
    if (taken.has(position)) continue;
    taken.add(position);
    const start = firstYearMonth(t.period);
    const end = periodEnd(t.period);
    const months = start && end ? monthsBetween(start, end) : null;
    found.push({
      position,
      before: prev ? (prev.kind === "school" ? schoolNameOf(prev.t.title) : companyNameOf(prev.t.title)) : position === 0 ? school : "",
      after: position < companies.length ? companies[position].name : "",
      length: months != null && months > 0 ? formatMonthsJa(months) : "",
      title: t.title.trim(),
      period: t.period.trim(),
      source: "timeline",
    });
  }

  // 2. 日付の間隔
  for (let p = 0; p <= companies.length; p++) {
    if (taken.has(p)) continue;
    const prevEnd: YearMonth | null = p === 0 ? gradYm : lastYearMonth(companies[p - 1].leaveDate);
    if (!prevEnd) continue;
    let nextStart: YearMonth | null;
    if (p < companies.length) {
      nextStart = firstYearMonth(companies[p].hireDate);
    } else {
      if (companies[p - 1].isCurrent) continue;
      nextStart = { y: input.today.getFullYear(), m: input.today.getMonth() + 1 };
    }
    if (!nextStart) continue;
    const months = monthsBetween(prevEnd, nextStart);
    if (months < GAP_MIN_MONTHS) continue;
    taken.add(p);
    found.push({
      position: p,
      before: p === 0 ? school : companies[p - 1].name,
      after: p < companies.length ? companies[p].name : "",
      length: formatMonthsJa(months),
      title: "",
      period: `${formatYearMonth(prevEnd, "")}〜${p < companies.length ? formatYearMonth(nextStart, "") : "現在"}`,
      source: "interval",
    });
  }

  return found
    .sort((a, b) => a.position - b.position)
    .map((g, index) => ({ ...g, index }));
}

export function buildContext(input: BuildContextInput): ScriptContext {
  const d = input.detail;
  const sorted = [...input.workHistories].sort((a, b) => a.order - b.order);
  const employmentStatus = typeof d.employmentStatus === "string" ? d.employmentStatus : "";
  let companies: ScriptCompany[] = sorted.map((w, index) => ({
    index,
    name: (w.companyName ?? "").trim(),
    hireDate: (w.hireDate ?? "").trim(),
    leaveDate: (w.leaveDate ?? "").trim(),
    jobDesc: ((w.jobTypeFlag ?? "") || (w.jobTypeMemo ?? "").split("\n")[0]).trim(),
    isCurrent: index === sorted.length - 1 && employmentStatus !== "離職中",
  }));
  if (companies.length === 0) companies = companiesFromPrep(input.prepSummary);
  if (companies.length === 0) companies = [{ index: 0, name: "", hireDate: "", leaveDate: "", jobDesc: "", isCurrent: employmentStatus !== "離職中", placeholder: true }];

  const eduMemo = typeof d.educationMemo === "string" ? d.educationMemo.trim() : "";
  const gradFromDetail = typeof d.graduationDate === "string" ? d.graduationDate.trim() : "";
  const fromPrep = educationFromPrep(input.prepSummary);
  const school = eduMemo || fromPrep.school;
  const gradYear = gradFromDetail || fromPrep.gradYear;
  const gaps = gapsOf({
    companies,
    timeline: input.prepSummary?.timeline ?? [],
    school,
    gradYm: lastYearMonth(gradFromDetail) ?? fromPrep.gradYm,
    today: input.today ?? new Date(),
  });

  const asked = input.askedQuestions ?? {};
  const prepQuestions: PrepQuestionView[] = (input.prepSummary?.questions ?? []).map((q, i) => ({
    index: i,
    question: q.question,
    why: q.why,
    mismatch: q.mismatch,
    asked: !!asked[String(i)],
    // T-208 step3: company が無い古い整理は「全体」
    company: (q.company ?? "").trim() || PREP_QUESTION_ALL,
  }));

  const email = (input.candidateEmail ?? "").trim();
  return {
    candidateName: input.candidateName,
    caName: input.caName,
    caFamilyName: input.caFamilyName,
    startTime: input.startTime,
    tool: input.tool,
    latestCompany: [...companies].reverse().find((c) => c.name)?.name ?? "",
    school,
    department: "",
    gradYear,
    schoolIsHighSchool: isHighSchoolName(school),
    companies,
    gaps,
    emailHead: email ? email.slice(0, 1) : "",
    employmentStatus,
    prepQuestions,
    today: input.today,
  };
}

/**
 * T-208 step3（付録H）: 「面談準備の質問」の場面に出す質問。
 * - 会社ごとの場面（companyIndex あり）: その会社に関わる質問（食い違いを先に）。会社名の突き合わせは normalizeCompanyKey と同じそろえ方
 * - 全体の場面: どの会社にも当たらない質問と「全体」の質問（元の順のまま＝今までどおり）
 */
export function prepQuestionsForScene(ctx: ScriptContext, rs: RuntimeScene): PrepQuestionView[] {
  if (rs.scene.kind !== "prep-questions") return [];
  if (rs.companyIndex != null) {
    const name = ctx.companies[rs.companyIndex]?.name ?? "";
    return questionsForCompany(ctx.prepQuestions, name).map((h) => h.question);
  }
  return questionsUnassigned(ctx.prepQuestions, ctx.companies.map((c) => c.name)).map((h) => h.question);
}

/** 会社ごとの「面談準備の質問」の場面を出すか（その会社に関わる質問が1つ以上あるとき） */
export function hasPrepQuestionsForCompany(ctx: ScriptContext, companyIndex: number): boolean {
  const name = ctx.companies[companyIndex]?.name ?? "";
  return questionsForCompany(ctx.prepQuestions, name).length > 0;
}

/* ---------- 場面の展開 ---------- */

/** 場面キー。会社ごとの場面は "id#会社番号"（変えない＝途中まで進めた答えを壊さない）、空白期間の場面は "id#空白番号" */
export function sceneKeyOf(scene: ScriptScene, companyIndex?: number, gapIndex?: number): string {
  if (scene.repeat === "company") return `${scene.id}#${companyIndex ?? 0}`;
  if (scene.repeat === "gap") return `${scene.id}#${gapIndex ?? 0}`;
  return scene.id;
}

/** T-208 step4: "s5-wh-reason#1" のような場面キーから実行時の場面を戻す（サーバーの apply API が使う）。無ければ null */
export function runtimeSceneOfKey(sceneKey: string): RuntimeScene | null {
  const [id, idx] = sceneKey.split("#");
  const scene = SCRIPT_SCENES.find((s) => s.id === id);
  if (!scene) return null;
  if (scene.repeat === "company" || scene.repeat === "gap") {
    const n = Number(idx ?? "0");
    if (!Number.isInteger(n) || n < 0) return null;
    return scene.repeat === "company" ? { key: sceneKey, scene, companyIndex: n } : { key: sceneKey, scene, gapIndex: n };
  }
  return { key: scene.id, scene };
}

/**
 * 場面の展開。
 * T-208 不具合修正 #1: 連続する repeat 付きの場面（職歴のかたまり）は、会社を外側にして「1社目の全場面 → 2社目の全場面」の順に出す
 * （前は場面を外側・会社を内側で回していたので「全社の入社 → 全社の仕事の中身 → 全社の退職理由」になっていた）。
 * 1社の中の順番は script-v1.ts の定義順（入社の確認と選んだ理由 → 仕事の中身と立場・数字 → その会社の面談準備の質問 → 退職理由）。
 * T-208 不具合修正 #2: 空白期間の場面（repeat: "gap"）は、その空白の次の会社（gap.position）の前に出す。最後の会社の後の空白は最後に。
 */
export function expandScenes(ctx: ScriptContext, answers: AnswerMap): RuntimeScene[] {
  const out: RuntimeScene[] = [];
  let i = 0;
  while (i < SCRIPT_SCENES.length) {
    const scene = SCRIPT_SCENES[i];
    if (!scene.repeat) {
      if (!scene.when || scene.when(ctx, answers)) out.push({ key: scene.id, scene });
      i++;
      continue;
    }
    const block: ScriptScene[] = [];
    while (i < SCRIPT_SCENES.length && SCRIPT_SCENES[i].repeat) block.push(SCRIPT_SCENES[i++]);
    const gapScenes = block.filter((s) => s.repeat === "gap" && (!s.when || s.when(ctx, answers)));
    const companyScenes = block.filter((s) => s.repeat === "company" && (!s.when || s.when(ctx, answers)));
    const pushGaps = (position: number) => {
      for (const g of ctx.gaps.filter((x) => x.position === position)) {
        for (const s of gapScenes) out.push({ key: sceneKeyOf(s, undefined, g.index), scene: s, gapIndex: g.index });
      }
    };
    for (const c of ctx.companies) {
      pushGaps(c.index);
      for (const s of companyScenes) {
        if (s.whenCompany && !s.whenCompany(ctx, c.index, answers)) continue;
        out.push({ key: sceneKeyOf(s, c.index), scene: s, companyIndex: c.index });
      }
    }
    pushGaps(ctx.companies.length);
  }
  return out;
}

/** ボタンの next（場面 id）→ 展開後のキー。くり返しの場面なら今の会社（無ければ最初）へ */
export function resolveNextKey(scenes: RuntimeScene[], currentIndex: number, nextId?: string): number {
  if (nextId) {
    const found = scenes.findIndex((s) => s.scene.id === nextId);
    if (found >= 0) return found;
  }
  return Math.min(currentIndex + 1, scenes.length - 1);
}

/**
 * T-208 不具合修正 #4: 「次へ」の行き先。
 * when 付きの場面（s6-job-direction 等）は答えで出たり消えたりするので、画面に出ている並び（答えを保存する前の展開）で探すと見つからない。
 * ここでは「いまの答え」で場面を並べ直してから、今の場面の位置と次の場面を決める。画面はこの結果の scenes を使って進む。
 */
export function nextSceneOf(ctx: ScriptContext, answers: AnswerMap, nextId?: string): { scenes: RuntimeScene[]; currentIndex: number; nextIndex: number } {
  const scenes = expandScenes(ctx, answers);
  const currentKey = readMeta(answers).currentKey;
  const currentIndex = Math.max(0, scenes.findIndex((s) => s.key === currentKey));
  return { scenes, currentIndex, nextIndex: resolveNextKey(scenes, currentIndex, nextId) };
}

export function partOfIndex(scenes: RuntimeScene[], index: number): PartId {
  return scenes[index]?.scene.part ?? "p1";
}

export function firstIndexOfPart(scenes: RuntimeScene[], part: PartId): number {
  const i = scenes.findIndex((s) => s.scene.part === part);
  return i >= 0 ? i : 0;
}

export function isLastOfPart(scenes: RuntimeScene[], index: number): boolean {
  const part = scenes[index]?.scene.part;
  return !scenes[index + 1] || scenes[index + 1].scene.part !== part;
}

export function readMeta(answers: AnswerMap): ScriptMeta {
  const m = (answers as Record<string, unknown>)[META_KEY];
  return m && typeof m === "object" ? (m as ScriptMeta) : {};
}

export function writeMeta(answers: AnswerMap, meta: ScriptMeta): AnswerMap {
  return { ...answers, [META_KEY]: meta as unknown as SceneAnswer };
}

export function isSceneAnswered(sa: SceneAnswer | undefined): boolean {
  if (!sa) return false;
  const choices = Object.values(sa.choices ?? {}).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
  const inputs = Object.values(sa.inputs ?? {}).some((v) => !!v && v.trim() !== "");
  return choices || inputs;
}

/* ---------- 答えから決まる差し込みと条件 ---------- */

export function deriveValues(ctx: ScriptContext, answers: AnswerMap): DerivedValues {
  const values = baseValues(ctx);
  const guide = nextInterviewGuide(timelineOf(answers), hasSelectionOf(answers));
  values["内容"] = guide.content;
  values["時期の目安"] = guide.timing;

  const employed = employedOf(answers, ctx);
  const outlook = scheduleOutlook({
    nextInterviewDate: nextInterviewDateOf(answers, ctx),
    employed: employed !== false,
    retireMonths: retireMonthsOf(answers),
  });
  values["内定の目安"] = outlook.offerLabel;
  values["入社の目安"] = outlook.joinLabel;

  const tl = timelineOf(answers);
  const tlMonth = inputOf(answers, "s4-timeline", "month");
  values["転職時期"] = tlMonth || tl || "ご希望の時期";

  values["LINE／メール"] = contactOf(answers) || "LINE／メール";
  values["電話／オンライン"] = nextToolOf(answers) || "電話／オンライン";
  const date = inputOf(answers, "s7-next", "date");
  const time = inputOf(answers, "s7-next", "time");
  values["日時"] = date ? `${date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_m, y, mo, dd) => `${y}年${Number(mo)}月${Number(dd)}日`)}${time ? ` ${time}` : ""}` : "ご希望の日時";

  const sal = answers["s6-salary-current"];
  // T-208 不具合修正 #4: 押した答えは表示名（「含まれている」）なので、値（「年収は賞与込み」）に直してから比べる
  const bonus = choiceValueOf(answers, "s6-salary-current", "bonus");
  const r = calcSalary({
    annualMan: parseNumber(sal?.inputs?.annual),
    bonusIncluded: bonus === "年収は賞与込み" ? true : bonus === "年収は賞与別" ? false : null,
    bonusAnnualMan: parseNumber(sal?.inputs?.bonusAnnual),
  });
  values["月給"] = r.monthlyMan != null ? formatMan(r.monthlyMan) : "〇";
  values["手取り"] = r.takeHomeMan != null ? formatMan(r.takeHomeMan) : "〇";

  const ot = answers["s6-overtime"];
  const month = parseNumber(ot?.inputs?.month);
  const day = parseNumber(ot?.inputs?.day);
  values["月の時間"] = day != null ? formatHours(overtimeDayToMonth(day)) : month != null ? formatHours(month) : "〇";
  values["1日の時間"] = month != null ? formatHours(overtimeMonthToDay(month)) : day != null ? formatHours(day) : "〇";
  return values;
}

export function deriveFlags(ctx: ScriptContext, answers: AnswerMap, values: DerivedValues): Flags {
  const flags = baseFlags(ctx, values);
  const agent = agentOf(answers);
  flags.agentPast = agent === "利用経験あり";
  flags.agentParallel = agent === "他社利用中";
  flags.agentBig = choiceValueOf(answers, "s3-agent-kind", "kind") === "大手";
  const docs = docsOf(answers);
  flags.docsNone = docs === "未着手";
  flags.docsHave = docs === "完成" || docs === "本人作成中";
  const employed = employedOf(answers, ctx);
  flags.employed = employed === true;
  flags.retired = employed === false;
  flags.hurry = nextInterviewGuide(timelineOf(answers), hasSelectionOf(answers)).hurry;
  const contact = contactOf(answers);
  flags.line = contact === "LINE";
  flags.mail = contact === "メール";
  return flags;
}

/** 場面のセリフ（差し込み済み） */
export function renderScene(rs: RuntimeScene, ctx: ScriptContext, answers: AnswerMap): string {
  const sceneCtx: ScriptContext = { ...ctx, companyIndex: rs.companyIndex, gapIndex: rs.gapIndex };
  const values = deriveValues(sceneCtx, answers);
  const flags = deriveFlags(sceneCtx, answers, values);
  return renderSay(rs.scene.say, values, flags);
}

/* ---------- 答え → 欄への書き込み ---------- */

export type SceneWrite = {
  target: FieldTarget;
  value: string;
  /** applied のキー。メモ欄は「欄のパス@場面のキー」（1場面の入力を1つの文にまとめるため） */
  appliedKey: string;
  path: string;
};

function visibleButtonsOf(scene: ScriptScene, sa: SceneAnswer) {
  return (scene.groups ?? [])
    .filter((g) => !g.showIf || g.showIf(sa))
    .map((g) => ({ group: g, buttons: g.buttons.filter((b) => !b.showIf || b.showIf(sa)) }));
}

/**
 * 1つの場面の答えから「どの欄に何を入れるか」を作る。
 * - 選択・数値・日付の欄: 押したボタンの値／入力そのまま（1欄1つ）
 * - メモ欄: その場面でその欄に向く入力・ボタンの文を「／」でつないで1つの文にする（押し直しで文ごと差し替える）
 */
export function sceneWrites(rs: RuntimeScene, sa: SceneAnswer): SceneWrite[] {
  const { scene, companyIndex } = rs;
  const plain: SceneWrite[] = [];
  const memoParts = new Map<string, { target: FieldTarget; parts: string[] }>();
  const addMemo = (target: FieldTarget, value: string) => {
    const path = fieldPath(target, companyIndex);
    const cur = memoParts.get(path) ?? { target, parts: [] };
    if (value.trim()) cur.parts.push(value.trim());
    memoParts.set(path, cur);
  };
  const addWrite = (target: FieldTarget, value: string) => {
    if (target.kind === "workStyle") {
      const path = fieldPath(target, companyIndex);
      plain.push({ target, value: "1", appliedKey: path, path }); // チェックは「付ける」だけ
      return;
    }
    if (target.memo) {
      addMemo(target, value);
      return;
    }
    const path = fieldPath(target, companyIndex);
    plain.push({ target, value, appliedKey: path, path });
  };

  for (const { group, buttons } of visibleButtonsOf(scene, sa)) {
    const chosen = sa.choices?.[group.key];
    const chosenList = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
    for (const label of chosenList) {
      const btn = buttons.find((b) => b.label === label);
      if (!btn) continue;
      const value = btn.value ?? btn.label;
      const target = btn.target ?? group.target;
      if (target) addWrite(target, value);
      for (const w of btn.writes ?? []) addWrite(w.target, w.value);
    }
  }
  for (const input of scene.inputs ?? []) {
    if (input.showIf && !input.showIf(sa)) continue;
    if (!input.target) continue;
    const raw = (sa.inputs?.[input.key] ?? "").trim();
    if (input.target.kind !== "workStyle" && input.target.memo) {
      addMemo(input.target, raw ? (input.format ? input.format(raw) : raw) : "");
    } else {
      addWrite(input.target, raw ? (input.format ? input.format(raw) : raw) : "");
    }
  }
  for (const w of derivedWrites(scene, sa)) addWrite(w.target, w.value);

  const memoWrites: SceneWrite[] = [];
  for (const [path, { target, parts }] of memoParts) {
    memoWrites.push({ target, value: parts.join("／"), appliedKey: `${path}@${rs.key}`, path });
  }
  return [...plain, ...memoWrites];
}

/** その場面が書き込むことのある欄（showIf に関係なく全部）。押し直しで答えが無くなった欄を消すのに使う */
export function sceneAllTargets(rs: RuntimeScene): Array<{ target: FieldTarget; path: string }> {
  const { scene, companyIndex } = rs;
  const seen = new Map<string, FieldTarget>();
  const add = (t: FieldTarget | undefined) => {
    if (!t) return;
    const p = fieldPath(t, companyIndex);
    if (!seen.has(p)) seen.set(p, t);
  };
  for (const g of scene.groups ?? []) {
    add(g.target);
    for (const b of g.buttons) {
      add(b.target);
      for (const w of b.writes ?? []) add(w.target);
    }
  }
  for (const i of scene.inputs ?? []) add(i.target);
  for (const t of DERIVED_TARGETS[scene.id] ?? []) add(t);
  return [...seen.entries()].map(([path, target]) => ({ path, target }));
}

/**
 * sceneWrites に「今回は答えが無い欄を消す書き込み（value=""）」を足したもの。
 * 画面はこれを apply.ts の decideApply に通す（台本が入れた値のままなら消える・CA が直していれば触らない）。
 */
export function sceneWritesWithClears(rs: RuntimeScene, sa: SceneAnswer): SceneWrite[] {
  const writes = sceneWrites(rs, sa);
  const present = new Set(writes.map((w) => w.path));
  for (const { target, path } of sceneAllTargets(rs)) {
    if (present.has(path)) continue;
    const memo = target.kind !== "workStyle" && !!target.memo;
    writes.push({ target, value: "", path, appliedKey: memo ? `${path}@${rs.key}` : path });
  }
  return writes;
}

/** 台本の全場面のボタンを列挙（確認スクリプト用）。showIf は無視して全部数える */
export function allButtons(): Array<{ sceneId: string; groupKey: string; label: string; value: string; target?: FieldTarget; writes: Array<{ target: FieldTarget; value: string }> }> {
  const out: Array<{ sceneId: string; groupKey: string; label: string; value: string; target?: FieldTarget; writes: Array<{ target: FieldTarget; value: string }> }> = [];
  for (const scene of SCRIPT_SCENES) {
    for (const g of scene.groups ?? []) {
      for (const b of g.buttons) {
        out.push({ sceneId: scene.id, groupKey: g.key, label: b.label, value: b.value ?? b.label, target: b.target ?? g.target, writes: b.writes ?? [] });
      }
    }
  }
  return out;
}

export function scriptStats() {
  return {
    parts: SCRIPT_PARTS.length,
    scenes: SCRIPT_SCENES.length,
    repeatedScenes: SCRIPT_SCENES.filter((s) => s.repeat === "company").length,
    buttons: allButtons().length,
    inputs: SCRIPT_SCENES.reduce((n, s) => n + (s.inputs?.length ?? 0), 0),
  };
}
