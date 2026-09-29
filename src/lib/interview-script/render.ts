// T-208 step2: 読むセリフの差し込みと条件分岐（純粋関数）。
// - 〔氏名〕〔CA名〕〔CA姓〕〔時刻〕〔直近の会社〕〔学校名〕〔学部学科〕〔卒業年〕〔会社名〕〔入社年月〕〔仕事内容〕〔頭の文字〕
//   ＋ 場面の答えから決まる 〔内容〕〔時期の目安〕〔内定の目安〕〔入社の目安〕〔転職時期〕〔LINE／メール〕〔電話／オンライン〕〔日時〕
// - {{if:条件}}…{{else}}…{{/if}}（入れ子なし）。条件は値の有無・手法・答えの分岐。
// 値が無いときは、台本に書いてある代わりの言い方を使う（例: 会社名が読めないときは「現在は、お仕事をされていますか？」）。

import type { AnswerMap, ScriptContext } from "./types";

export type DerivedValues = Record<string, string>;
export type Flags = Record<string, boolean>;

const PLACEHOLDER_RE = /〔([^〔〕]+)〕/g;
/** 中に別の {{if:}} を含まない（一番内側の）ブロック。外側は内側を解いてから順に解く＝入れ子に対応 */
const INNER_IF_RE = /\{\{if:([a-zA-Z0-9_-]+)\}\}((?:(?!\{\{if:)[\s\S])*?)\{\{\/if\}\}/;

function resolveIfBlocks(text: string, flags: Flags): string {
  let out = text;
  for (let guard = 0; guard < 200; guard++) {
    const m = INNER_IF_RE.exec(out);
    if (!m) break;
    const [whole, key, body] = m;
    const elseAt = body.indexOf("{{else}}");
    const yes = elseAt >= 0 ? body.slice(0, elseAt) : body;
    const no = elseAt >= 0 ? body.slice(elseAt + "{{else}}".length) : "";
    out = out.slice(0, m.index) + (flags[key] ? yes : no) + out.slice(m.index + whole.length);
  }
  return out;
}

export function baseValues(ctx: ScriptContext): DerivedValues {
  const company = ctx.companyIndex != null ? ctx.companies[ctx.companyIndex] : undefined;
  return {
    "氏名": ctx.candidateName,
    "CA名": ctx.caName,
    "CA姓": ctx.caFamilyName || ctx.caName,
    "時刻": ctx.startTime,
    "直近の会社": ctx.latestCompany,
    "学校名": ctx.school,
    "学部学科": ctx.department,
    "卒業年": ctx.gradYear,
    "会社名": company?.name ?? "",
    "入社年月": company?.hireDate ?? "",
    "仕事内容": company?.jobDesc ?? "",
    "頭の文字": ctx.emailHead,
  };
}

export function baseFlags(ctx: ScriptContext, values: DerivedValues): Flags {
  const company = ctx.companyIndex != null ? ctx.companies[ctx.companyIndex] : undefined;
  const online = ctx.tool === "オンライン";
  return {
    time: !!values["時刻"],
    company: !!values["直近の会社"],
    phone: !online,
    online,
    school: !!values["学校名"],
    dept: !!values["学部学科"],
    gradYear: !!values["卒業年"],
    hireDate: !!values["入社年月"],
    jobDesc: !!values["仕事内容"],
    companyName: !!values["会社名"],
    first: (ctx.companyIndex ?? 0) === 0,
    currentCompany: !!company?.isCurrent,
    emailHead: !!values["頭の文字"],
  };
}

/** セリフの差し込みと条件分岐を解決する。values に無い〔〕は空文字にする */
export function renderSay(text: string, values: DerivedValues, flags: Flags): string {
  return resolveIfBlocks(text, flags)
    .replace(PLACEHOLDER_RE, (_m, key: string) => values[key] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 答えの中から「押した値」を取る（無ければ ""） */
export function choiceOf(answers: AnswerMap, sceneKey: string, groupKey: string): string {
  const v = answers[sceneKey]?.choices?.[groupKey];
  return typeof v === "string" ? v : "";
}

export function choicesOf(answers: AnswerMap, sceneKey: string, groupKey: string): string[] {
  const v = answers[sceneKey]?.choices?.[groupKey];
  if (Array.isArray(v)) return v;
  return typeof v === "string" && v ? [v] : [];
}

export function inputOf(answers: AnswerMap, sceneKey: string, inputKey: string): string {
  return answers[sceneKey]?.inputs?.[inputKey] ?? "";
}
