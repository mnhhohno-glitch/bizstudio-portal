// T-208 step2: 台本の実行（純粋関数）。画面（InterviewScriptMode）と確認スクリプトで共有する。
// - buildContext: 面談記録・求職者・面談準備の整理・送信者から差し込み用の情報を組み立てる
// - expandScenes: 会社ごとにくり返す場面を展開し、条件で飛ばす場面を除く
// - deriveValues / deriveFlags: 答えから決まる差し込み（〔内容〕〔時期の目安〕…）と条件（line / mail / hurry …）
// - sceneWrites: 1つの場面の答えから「どの欄に何を入れるか」を作る（メモ欄は場面ごとに1つの文にまとめる）

import { PREP_QUESTION_ALL, questionsForCompany, questionsUnassigned } from "@/lib/interview-prep/summary-format";
import { fieldPath } from "./apply";
import {
  calcSalary,
  formatHours,
  formatMan,
  nextInterviewGuide,
  overtimeDayToMonth,
  overtimeMonthToDay,
  parseNumber,
  scheduleOutlook,
} from "./calc";
import { baseFlags, baseValues, choiceOf, inputOf, renderSay, type DerivedValues, type Flags } from "./render";
import {
  DERIVED_TARGETS,
  SCRIPT_PARTS,
  SCRIPT_SCENES,
  agentOf,
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

/** 登録情報（面談準備の整理）の経歴の流れから学校名・卒業年月を取る */
function educationFromPrep(prep: PrepSummaryLike): { school: string; gradYear: string } {
  const items = prep?.timeline ?? [];
  const found = items.find((t) => SCHOOL_RE.test(t.title));
  if (!found) return { school: "", gradYear: "" };
  const school = found.title.replace(/\s*(卒業|中退|修了|卒).*$/, "").trim();
  const m = found.period.match(/(\d{4})年\s*(\d{1,2})?月?/);
  const gradYear = m ? (m[2] ? `${m[1]}年${Number(m[2])}月` : `${m[1]}年`) : found.period.trim();
  return { school, gradYear };
}

/** 面談準備の整理から、職歴の行がまだ無いときの仮の会社一覧を作る */
export function companiesFromPrep(prep: PrepSummaryLike): ScriptCompany[] {
  const items = (prep?.timeline ?? []).filter((t) => !SCHOOL_RE.test(t.title));
  const names = items.length > 0
    ? items.map((t) => ({ name: t.title.replace(/\s*(正社員|契約社員|派遣|アルバイト|パート|入社|在籍中|現在).*$/, "").trim(), hire: t.period, desc: t.detail }))
    : (prep?.works ?? []).map((w) => ({ name: w.company, hire: "", desc: "" }));
  return names.map((n, index) => ({
    index,
    name: n.name,
    hireDate: n.hire.replace(/〜.*$/, "").trim(),
    jobDesc: "",
    isCurrent: index === names.length - 1,
    placeholder: true,
  }));
}

export function buildContext(input: BuildContextInput): ScriptContext {
  const d = input.detail;
  const sorted = [...input.workHistories].sort((a, b) => a.order - b.order);
  const employmentStatus = typeof d.employmentStatus === "string" ? d.employmentStatus : "";
  let companies: ScriptCompany[] = sorted.map((w, index) => ({
    index,
    name: (w.companyName ?? "").trim(),
    hireDate: (w.hireDate ?? "").trim(),
    jobDesc: ((w.jobTypeFlag ?? "") || (w.jobTypeMemo ?? "").split("\n")[0]).trim(),
    isCurrent: index === sorted.length - 1 && employmentStatus !== "離職中",
  }));
  if (companies.length === 0) companies = companiesFromPrep(input.prepSummary);
  if (companies.length === 0) companies = [{ index: 0, name: "", hireDate: "", jobDesc: "", isCurrent: employmentStatus !== "離職中", placeholder: true }];

  const eduMemo = typeof d.educationMemo === "string" ? d.educationMemo.trim() : "";
  const gradFromDetail = typeof d.graduationDate === "string" ? d.graduationDate.trim() : "";
  const fromPrep = educationFromPrep(input.prepSummary);
  const school = eduMemo || fromPrep.school;
  const gradYear = gradFromDetail || fromPrep.gradYear;

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
    companies,
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

export function sceneKeyOf(scene: ScriptScene, companyIndex?: number): string {
  return scene.repeat === "company" ? `${scene.id}#${companyIndex ?? 0}` : scene.id;
}

export function expandScenes(ctx: ScriptContext, answers: AnswerMap): RuntimeScene[] {
  const out: RuntimeScene[] = [];
  for (const scene of SCRIPT_SCENES) {
    if (scene.when && !scene.when(ctx, answers)) continue;
    if (scene.repeat === "company") {
      ctx.companies.forEach((c) => {
        if (scene.whenCompany && !scene.whenCompany(ctx, c.index, answers)) return;
        out.push({ key: sceneKeyOf(scene, c.index), scene, companyIndex: c.index });
      });
    } else {
      out.push({ key: scene.id, scene });
    }
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
  const bonus = sal?.choices?.bonus;
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
  flags.agentBig = choiceOf(answers, "s3-agent-kind", "kind") === "大手";
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
  const sceneCtx: ScriptContext = { ...ctx, companyIndex: rs.companyIndex };
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
