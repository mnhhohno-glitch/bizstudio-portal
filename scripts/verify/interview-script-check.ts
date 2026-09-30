/**
 * T-208 step2〜4: 初回面談の面談スクリプトの AI を呼ばない確認。DB も使わない。
 *
 *   npx tsx scripts/verify/interview-script-check.ts
 *
 * 確かめること:
 *   1. 台本の全場面で、ボタンの保存する値が入れ先の欄の選択肢に実在する（付録B の対応・付録C で足した選択肢を含む）
 *      退職理由の大・中・小は resign-reason-hierarchy.ts の実際の値、働き方は WORK_STYLE_OPTIONS
 *   2. 自動計算（月給・手取り・残業の月↔日・希望残業の選択肢・次回面談とスケジュールの目安）が決まりどおり
 *   3. 入れ方の決まり（空欄だけ入れる／値があれば替えない＝提案／押し直しで台本が入れた値だけ差し替える／メモの追記と重複防止）
 *   4. 場面の答え → 欄への書き込み（Word・PowerPoint の2欄、退職理由の大中小、残業の自動選択、転勤のメモ、働き方のチェック）
 *   5. 差し込み（時刻が無いときは「本日〇時から」を省く・会社名が無いときの言い換え・〔CA名〕は名字だけ＝T-207 の〔CA姓〕と同じ取り方）
 *   6. T-208 step4: 画面の文言に「台本」が残っていない／メモの印とチャットの見出しが新しい言葉／
 *      サーバー側の入れ方（apply-plan: 空欄だけ入れる・違う値は提案・［替える］でその欄だけ・押し直しの差し替えと CA が直した欄・メモの追記と重複防止）
 * 出力は OK / NG と数値だけ。
 */
import fs from "node:fs";
import path from "node:path";
import {
  RESIGN_REASON_LARGE_OPTIONS,
  getMediumOptions,
  getSmallOptions,
} from "@/constants/resign-reason-hierarchy";
import { acceptProposal, decideApply, LEGACY_SCRIPT_MEMO_PREFIX, nextApplied, SCRIPT_MEMO_PREFIX } from "@/lib/interview-script/apply";
import {
  applyPlanToState,
  currentValueAt,
  planAcceptProposal,
  planDismissProposal,
  planSceneApply,
  type ProposalMap,
} from "@/lib/interview-script/apply-plan";
import { SCRIPT_FACTS_HEADER } from "@/lib/interview-script/facts";
import {
  calcSalary,
  nextInterviewGuide,
  overtimeDayToMonth,
  overtimeMonthToDay,
  overtimeOptionFor,
  scheduleOutlook,
} from "@/lib/interview-script/calc";
import { DESIRED_OVERTIME_OPTIONS, DETAIL_SELECT_OPTIONS, WORK_STYLE_OPTIONS } from "@/lib/interview-script/field-options";
import { allButtons, buildContext, expandScenes, renderScene, runtimeSceneOfKey, sceneWrites, sceneWritesWithClears, scriptStats } from "@/lib/interview-script/runtime";
import { DERIVED_TARGETS, RESIGN_REASON_BUTTONS, SCRIPT_SCENES, SCRIPT_VERSION } from "@/lib/interview-script/script-v1";
import { caFamilyNameOf } from "@/lib/candidate-mail/templates";
import type { AppliedMap, FieldTarget, RuntimeScene } from "@/lib/interview-script/types";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "OK" : "NG"}: ${label}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed++;
}

/* ---------- 1. ボタンの値が選択肢に実在する ---------- */
const WH_SELECT: Record<string, (v: string) => boolean> = {
  resignReasonLarge: (v) => (RESIGN_REASON_LARGE_OPTIONS as readonly string[]).includes(v),
  resignReasonMedium: (v) => RESIGN_REASON_LARGE_OPTIONS.some((l) => getMediumOptions(l).includes(v)),
  resignReasonSmall: (v) => RESIGN_REASON_LARGE_OPTIONS.some((l) => getMediumOptions(l).some((m) => getSmallOptions(m).includes(v))),
};

function valueExists(target: FieldTarget, value: string): { checked: boolean; ok: boolean } {
  if (target.kind === "workStyle") return { checked: true, ok: WORK_STYLE_OPTIONS.includes(target.item) };
  if (target.kind === "detail") {
    if (target.memo) return { checked: false, ok: true };
    const opts = DETAIL_SELECT_OPTIONS[target.field];
    if (!opts) return { checked: false, ok: true };
    return { checked: true, ok: value === "" || opts.includes(value) };
  }
  if (target.memo) return { checked: false, ok: true };
  const f = WH_SELECT[target.field];
  if (!f) return { checked: false, ok: true };
  return { checked: true, ok: value === "" || f(value) };
}

const stats = scriptStats();
console.log(`script ${SCRIPT_VERSION}: parts=${stats.parts} scenes=${stats.scenes} (repeated per company: ${stats.repeatedScenes}) buttons=${stats.buttons} inputs=${stats.inputs}`);

let checkedButtons = 0;
let badButtons = 0;
for (const b of allButtons()) {
  const targets: Array<{ target: FieldTarget; value: string }> = [];
  if (b.target) targets.push({ target: b.target, value: b.value });
  for (const w of b.writes) targets.push(w);
  for (const t of targets) {
    const r = valueExists(t.target, t.value);
    if (!r.checked) continue;
    checkedButtons++;
    if (!r.ok) {
      badButtons++;
      console.log(`   NG value: scene=${b.sceneId} button=${b.label} -> ${JSON.stringify(t.target)} = ${t.value}`);
    }
  }
}
check("all button values exist in field options", badButtons === 0, `checked=${checkedButtons} bad=${badButtons}`);

// 小分類の候補（付録E）が実際の階層に全部ある
let smallOk = true;
for (const [label, map] of Object.entries(RESIGN_REASON_BUTTONS)) {
  if (!getMediumOptions(map.large).includes(map.medium)) smallOk = false;
  for (const s of map.smalls) if (!getSmallOptions(map.medium).includes(s)) { smallOk = false; console.log(`   NG small: ${label} -> ${s}`); }
}
check("resign reason large/medium/small candidates exist in hierarchy", smallOk, `buttons=${Object.keys(RESIGN_REASON_BUTTONS).length}`);

// 自動で決まる値（希望残業の選択肢・次回面談「設定済」）も選択肢にある
check("overtimeOptionFor outputs are all in DESIRED_OVERTIME_OPTIONS", [0, 5, 10, 11, 20, 21, 30, 31, 45, 46, 100].every((h) => DESIRED_OVERTIME_OPTIONS.includes(overtimeOptionFor(h) ?? "")));
check("derived targets are select fields with options", Object.values(DERIVED_TARGETS).flat().every((t) => t.kind === "detail" && !!DETAIL_SELECT_OPTIONS[t.field]));
check("付録C added options present", DETAIL_SELECT_OPTIONS.driverLicenseFlag.includes("取得(AT限定)") && DETAIL_SELECT_OPTIONS.desiredOvertimeMax.includes("45時間超も可"));

/* ---------- 2. 自動計算 ---------- */
const s1 = calcSalary({ annualMan: 400, bonusIncluded: true, bonusAnnualMan: 60 });
check("salary: (400-60)/12", Math.abs((s1.monthlyMan ?? 0) - 340 / 12) < 1e-9 && Math.abs((s1.takeHomeMan ?? 0) - (340 / 12) * 0.8) < 1e-9, `monthly=${s1.monthlyMan?.toFixed(2)} takeHome=${s1.takeHomeMan?.toFixed(2)}`);
const s2 = calcSalary({ annualMan: 400, bonusIncluded: false, bonusAnnualMan: null });
check("salary: bonus not included -> 400/12", Math.abs((s2.monthlyMan ?? 0) - 400 / 12) < 1e-9);
const s3 = calcSalary({ annualMan: 400, bonusIncluded: true, bonusAnnualMan: null });
check("salary: included but bonus unknown -> null", s3.monthlyMan === null && s3.takeHomeMan === null);
check("salary: unanswered -> null", calcSalary({ annualMan: 400, bonusIncluded: null, bonusAnnualMan: null }).monthlyMan === null);

check("overtime: day 2 -> month 40", overtimeDayToMonth(2) === 40);
check("overtime: month 30 -> day 1.5", overtimeMonthToDay(30) === 1.5);
check(
  "overtime option mapping",
  overtimeOptionFor(0) === "絶対不可" &&
    overtimeOptionFor(10) === "10時間以内" &&
    overtimeOptionFor(11) === "20時間以内" &&
    overtimeOptionFor(20) === "20時間以内" &&
    overtimeOptionFor(30) === "30時間以内" &&
    overtimeOptionFor(45) === "45時間以内" &&
    overtimeOptionFor(46) === "45時間超も可" &&
    overtimeOptionFor(null) === null,
);

const g1 = nextInterviewGuide("すぐにでも", false);
const g2 = nextInterviewGuide("3カ月以内", false);
const g3 = nextInterviewGuide("半年以内", false);
const g4 = nextInterviewGuide("1年以内", false);
const g5 = nextInterviewGuide("未定", false);
const g6 = nextInterviewGuide("未定", true);
check("next interview timing", g1.timing === "今週か来週" && g2.timing === "今週か来週" && g3.timing === "1〜2週間後くらい" && g4.timing === "2週間〜1ヶ月後くらい" && g5.timing === "2週間〜1ヶ月後くらい" && g6.timing === "今週か来週");
check("next interview content (急ぎ/先)", g1.hurry && g3.hurry && !g4.hurry && !g5.hurry && g6.hurry && g4.content.startsWith("職種の理解") && g1.content.startsWith("お探しした求人"));

const base = new Date(2026, 8, 30); // 2026-09-30
const o1 = scheduleOutlook({ nextInterviewDate: base, employed: true, retireMonths: 3 });
const o2 = scheduleOutlook({ nextInterviewDate: base, employed: false, retireMonths: null });
const o3 = scheduleOutlook({ nextInterviewDate: base, employed: true, retireMonths: null });
check("schedule outlook: offer = next+1〜2 months", o1.offerLabel === "2026年10月〜11月", o1.offerLabel);
check("schedule outlook: employed, retire 3 months -> join = offer+3", o1.joinLabel === "2027年1月〜2月", o1.joinLabel);
check("schedule outlook: retired -> join = offer+1", o2.joinLabel === "2026年11月〜12月", o2.joinLabel);
check("schedule outlook: employed, months unknown -> join = offer+1〜2", o3.joinLabel === "2026年11月〜2027年1月", o3.joinLabel);

/* ---------- 3. 入れ方の決まり ---------- */
const sel: FieldTarget = { kind: "detail", field: "jobChangeTimeline" };
const memo: FieldTarget = { kind: "detail", field: "jobChangeTimelineMemo", memo: true };

const a1 = decideApply(sel, undefined, null, undefined, "3カ月以内");
check("empty field -> set", a1.action === "set" && a1.nextValue === "3カ月以内");
let applied = nextApplied({}, a1);
check("applied records value", applied["d.jobChangeTimeline"] === "3カ月以内");

const a2 = decideApply(sel, undefined, "半年以内", undefined, "3カ月以内");
check("existing value (not from script) -> propose, not overwrite", a2.action === "propose" && a2.nextValue === "3カ月以内");
check("propose does not change applied", Object.keys(nextApplied(applied, a2)).length === 1);

const a3 = decideApply(sel, undefined, "3カ月以内", applied["d.jobChangeTimeline"], "半年以内");
check("re-press: field still holds script value -> replace", a3.action === "set" && a3.nextValue === "半年以内");
applied = nextApplied(applied, a3);

const a4 = decideApply(sel, undefined, "1年以内", applied["d.jobChangeTimeline"], "未定");
check("re-press: CA changed the field by hand -> propose (do not touch)", a4.action === "propose");

const a5 = decideApply(sel, undefined, "半年以内", applied["d.jobChangeTimeline"], "");
check("re-press with no answer: script value cleared", a5.action === "set" && a5.nextValue === "" && Object.keys(nextApplied(applied, a5)).length === 0);

const acc = acceptProposal({}, "d.jobChangeTimeline", "3カ月以内");
check("accept proposal records applied", acc["d.jobChangeTimeline"] === "3カ月以内");

const m1 = decideApply(memo, undefined, "", undefined, "退職予定: 12月末");
check("memo empty -> set as-is (no prefix)", m1.action === "set" && m1.nextValue === "退職予定: 12月末");
const m2 = decideApply(memo, undefined, "CAのメモ", undefined, "退職予定: 12月末");
check("memo has text -> append with 【台本】", m2.action === "append" && m2.nextValue === `CAのメモ\n${SCRIPT_MEMO_PREFIX}退職予定: 12月末`);
const m3 = decideApply(memo, undefined, m2.nextValue, undefined, "退職予定: 12月末");
check("memo already contains the sentence -> skip (no duplicate)", m3.action === "skip");
const m4 = decideApply(memo, undefined, m2.nextValue, m2.appliedValue, "退職予定: 1月末");
check("memo re-press -> replace only the script chunk", m4.action === "replace" && m4.nextValue === `CAのメモ\n${SCRIPT_MEMO_PREFIX}退職予定: 1月末`);
const m5 = decideApply(memo, undefined, "CAのメモ\n手で直した", m2.appliedValue, "退職予定: 1月末");
check("memo edited by CA (chunk gone) -> append again, not overwrite", m5.action === "append" && m5.nextValue.startsWith("CAのメモ\n手で直した\n"));
const m6 = decideApply(memo, undefined, m2.nextValue, m2.appliedValue, "");
check("memo re-press with no answer -> chunk removed, CA text kept", m6.action === "replace" && m6.nextValue === "CAのメモ");

const wsT: FieldTarget = { kind: "workStyle", item: "固定残業NG" };
const w1 = decideApply(wsT, undefined, [], undefined, "1");
const w2 = decideApply(wsT, undefined, ["固定残業NG"], undefined, "1");
const w3 = decideApply(wsT, undefined, ["固定残業NG"], "1", "");
const w4 = decideApply(wsT, undefined, ["固定残業NG"], undefined, "");
check("work style: add when missing / skip when present / uncheck only script's / keep CA's", w1.action === "set" && w2.action === "skip" && w3.action === "set" && w3.nextValue === "" && w4.action === "skip");

/* ---------- 4. 場面の答え → 欄への書き込み ---------- */
const ctx = buildContext({
  candidateName: "架空 太郎",
  candidateEmail: "kakuu@example.com",
  caName: "大野 望",
  caFamilyName: "大野",
  startTime: "10:00",
  tool: "電話",
  detail: {},
  workHistories: [
    { order: 1, companyName: "架空商事株式会社", jobTypeFlag: "営業", jobTypeMemo: null, hireDate: "2019年4月" },
    { order: 2, companyName: "架空システム株式会社", jobTypeFlag: null, jobTypeMemo: "社内SE", hireDate: null },
  ],
  prepSummary: { questions: [{ question: "在籍年数は？", why: "食い違い", mismatch: true }], timeline: [], works: [] },
  askedQuestions: {},
  today: base,
});
const scenes = expandScenes(ctx, {});
const find = (id: string, idx?: number): RuntimeScene => {
  const s = scenes.find((x) => x.scene.id === id && (idx === undefined || x.companyIndex === idx));
  if (!s) throw new Error(`scene not found: ${id}`);
  return s;
};
check("expand: company scenes repeated per company", scenes.filter((s) => s.scene.id === "s5-wh-reason").length === 2 && scenes.filter((s) => s.scene.repeat === "company").length === 6);
check("context: latest company / email head / prep questions", ctx.latestCompany === "架空システム株式会社" && ctx.emailHead === "k" && ctx.prepQuestions.length === 1 && ctx.companies[1].isCurrent);

const wr1 = sceneWrites(find("s5-wh-reason", 0), { choices: { reason: "人間関係", small: "上司・同僚との人間関係" } });
const byPath = (ws: ReturnType<typeof sceneWrites>) => Object.fromEntries(ws.map((w) => [w.path, w.value]));
const p1 = byPath(wr1);
check("resign reason: large/medium auto + small chosen", p1["wh.0.resignReasonLarge"] === "過去型" && p1["wh.0.resignReasonMedium"] === "個人都合" && p1["wh.0.resignReasonSmall"] === "上司・同僚との人間関係");
const wr2 = byPath(sceneWritesWithClears(find("s5-wh-reason", 0), { choices: { reason: "言いにくそう" } }));
check("resign reason: 言いにくそう -> memo only, selects cleared", wr2["wh.0.jobChangeReasonMemo"] === "言いにくい" && wr2["wh.0.resignReasonLarge"] === "" && wr2["wh.0.resignReasonSmall"] === "");

const pc = byPath(sceneWrites(find("s6-skill-pc"), { choices: { wordppt: "Wordだけ", excel: "中級（VLOOKUP・IFも使える）" } }));
check("Word・PowerPoint: Wordだけ -> Word 中級 / PPT 不可, Excel 中級", pc["d.wordFlag"] === "中級" && pc["d.pptFlag"] === "不可" && pc["d.excelFlag"] === "中級");

const ot = byPath(sceneWrites(find("s6-overtime"), { inputs: { day: "2" }, choices: { fixed: "紹介不可" } }));
check("overtime: day 2 -> month 40 -> 45時間以内 + memo + 固定残業NG", ot["d.desiredOvertimeMax"] === "45時間以内" && ot["d.desiredOvertimeMemo"] === "1日2時間まで" && ot["ws.固定残業NG"] === "1");

const tr = byPath(sceneWrites(find("s6-transfer"), { choices: { mode: "事務以外", general: "通える範囲ならOK", future: "将来ならOK" } }));
check("transfer: 通える範囲ならOK -> なし + memo joined", tr["d.desiredTransfer"] === "なし" && tr["d.desiredTransferMemo"] === "通える範囲の異動なら可／将来キャリアアップにつながる転勤なら前向き");

const wsw = byPath(sceneWrites(find("s6-workstyle"), { choices: { ws: ["フルリモート", "退職金制度"] } }));
check("work style multi -> two checks", wsw["ws.フルリモート"] === "1" && wsw["ws.退職金制度"] === "1");
const wsn = sceneWrites(find("s6-workstyle"), { choices: { ws: ["特になし"] } });
check("work style 特になし -> nothing checked", wsn.every((w) => w.target.kind !== "workStyle" || w.value === ""));

const nx = byPath(sceneWrites(find("s7-next"), { inputs: { date: "2026-10-07", time: "14:00" }, choices: { tool: "オンライン" } }));
check("next interview: date/time + 設定済 + memo", nx["d.nextInterviewDate"] === "2026-10-07" && nx["d.nextInterviewTime"] === "14:00" && nx["d.nextInterviewFlag"] === "設定済" && nx["d.nextInterviewMemo"] === "次回: オンライン");

const sal = byPath(sceneWrites(find("s6-salary-current"), { inputs: { annual: "400", bonusAnnual: "60", transport: "含まない" }, choices: { bonus: "含まれている" } }));
check("salary memo composed in one chunk", sal["d.currentSalary"] === "400" && sal["d.currentSalaryMemo"] === "年収は賞与込み／賞与年額: 60万円／交通費: 含まない");

/* ---------- 5. 差し込み ---------- */
const say1 = renderScene(find("s1-greeting"), ctx, {});
check("greeting (phone) inserts CA surname / candidate / time", say1.includes("ビズスタジオの大野と申します") && !say1.includes("大野 望") && say1.includes("架空 太郎様のお電話") && say1.includes("本日10:00から"));
// T-208 fix: 〔CA名〕は名字だけ（resolveSender と同じ caFamilyNameOf の取り方）。「大野 将幸」→「大野」、空白なしは全体
const ctxFullName = buildContext({
  candidateName: "架空 太郎",
  candidateEmail: null,
  caName: "大野 将幸",
  caFamilyName: caFamilyNameOf("大野 将幸"),
  startTime: "",
  tool: "電話",
  detail: {},
  workHistories: [],
  prepSummary: null,
  askedQuestions: {},
  today: base,
});
const sayFull = renderScene(find("s1-greeting"), ctxFullName, {});
const sayFullOnline = renderScene(find("s1-greeting"), { ...ctxFullName, tool: "オンライン" }, {});
check(
  "greeting uses CA surname only (大野 将幸 → 大野) in every 〔CA名〕",
  sayFull.includes("ビズスタジオの大野と申します") &&
    sayFull.includes("担当させていただきます大野です") &&
    !sayFull.includes("大野 将幸") &&
    sayFullOnline.includes("ビズスタジオの大野です") &&
    !sayFullOnline.includes("大野 将幸") &&
    caFamilyNameOf("大野将幸") === "大野将幸",
);
const ctxNoTime = { ...ctx, startTime: "", tool: "オンライン" };
const say2 = renderScene(find("s1-greeting"), ctxNoTime, {});
check("greeting (online) variant, no time", say2.includes("音声は聞こえておりますでしょうか") && !say2.includes("本日10:00") && !say2.includes("お電話でお間違い") && !say2.includes("〔"));
const say1b = renderScene(find("s1-greeting"), { ...ctx, startTime: "" }, {});
check("greeting (phone) without time omits 「本日〇時から」", say1b.includes("（本人と確認できたら）ご予約いただいておりました") && !say1b.includes("本日"));
const say3 = renderScene(find("s4-employment"), { ...ctx, latestCompany: "" }, {});
check("employment question falls back when no company", say3.includes("現在は、お仕事をされていますか？") && !say3.includes("〔"));
const say4 = renderScene(find("s7-schedule"), ctx, { "s4-timeline": { choices: { timeline: "3カ月以内" } }, "s4-employment": { choices: { status: "離職中" } } });
check("schedule (hurry) inserts offer/join months", say4.includes("2026年10月〜11月頃に内定") && say4.includes("2026年11月〜12月頃のご入社"));
const say5 = renderScene(find("s7-schedule"), ctx, { "s4-timeline": { choices: { timeline: "未定" }, inputs: { month: "来年4月" } } });
check("schedule (later) uses 転職時期", say5.includes("来年4月のご入社に向けて"));
const unresolved = SCRIPT_SCENES.filter((s) => {
  const rs = scenes.find((x) => x.scene.id === s.id) ?? { key: s.id, scene: s, companyIndex: 0 };
  return /\{\{|\}\}/.test(renderScene(rs, ctx, {}));
});
check("no unresolved {{if}} blocks in any scene", unresolved.length === 0, unresolved.map((s) => s.id).join(","));

/* ---------- 6. T-208 step4: 名前のそろえ（「台本」→「面談スクリプト」）とサーバー側の入れ方（apply-plan） ---------- */

// 6-1. 画面に出る文言に「台本」が残っていない（コメントは除く。コードの名前＝interview_script_answers 等はそのまま）
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}
const UI_FILES = [
  "src/components/candidates/InterviewScriptMode.tsx",
  "src/components/candidates/InterviewScriptTab.tsx",
  "src/components/candidates/InterviewHistoryTab.tsx",
  "src/components/candidates/InterviewForm.tsx",
  "src/components/candidates/InterviewPrepPanel.tsx",
  "src/components/candidates/InterviewPrepSummaryCards.tsx",
  "src/components/candidates/CandidateDetailPage.tsx",
  "src/components/candidates/CandidateCompactHeader.tsx",
  "src/components/candidates/CandidateContactMailButton.tsx",
  "src/lib/interview-script/script-v1.ts",
  "src/lib/interview-script/field-labels.ts",
  "src/lib/interview-script/field-options.ts",
  "src/lib/interview-script/calc.ts",
  "src/lib/interview-script/render.ts",
  "src/lib/interview-script/apply.ts",
  "src/lib/interview-script/facts.ts",
  "src/lib/interview-prep/quick-questions.ts",
  "src/lib/interview-prep/summary-format.ts",
];
const leftovers: string[] = [];
for (const f of UI_FILES) {
  const full = path.join(process.cwd(), f);
  if (!fs.existsSync(full)) continue;
  const body = stripComments(fs.readFileSync(full, "utf8"));
  // LEGACY_SCRIPT_MEMO_PREFIX（押し直しの判定用に残す旧い印）だけは許す
  const lines = body.split("\n").filter((l) => l.includes("台本") && !l.includes("LEGACY_SCRIPT_MEMO_PREFIX"));
  if (lines.length > 0) leftovers.push(`${f}: ${lines.length}`);
}
check("no 「台本」 left in UI strings (comments excluded)", leftovers.length === 0, leftovers.join(" / "));
check("memo prefix is 【スクリプト】", SCRIPT_MEMO_PREFIX === "【スクリプト】");
check("chat facts header is 【面談スクリプトで分かったこと】", SCRIPT_FACTS_HEADER === "【面談スクリプトで分かったこと】");
const skill = fs.readFileSync(path.join(process.cwd(), "src/skills/interview-prep/SKILL.md"), "utf8");
check("SKILL.md uses the new header and has no 「台本」", skill.includes("【面談スクリプトで分かったこと】") && !skill.includes("台本"));
// 旧い印で入っていたメモの押し直し: 新しい印で差し替わる（保存済みの文字は、押し直すまで書き換えない）
const legacyMemo = `CAのメモ\n${LEGACY_SCRIPT_MEMO_PREFIX}退職予定: 12月末`;
const lm = decideApply(memo, undefined, legacyMemo, `${LEGACY_SCRIPT_MEMO_PREFIX}退職予定: 12月末`, "退職予定: 1月末");
check("legacy 【台本】 chunk re-press -> replaced with 【スクリプト】 chunk", lm.action === "replace" && lm.nextValue === `CAのメモ\n${SCRIPT_MEMO_PREFIX}退職予定: 1月末`);

// 6-2. サーバー側の入れ方（apply-plan）をメモリ上のデータで通す（DB なし）
const whRows = [
  { id: "wh1", order: 1, companyName: "架空商事株式会社", jobTypeFlag: "営業", jobTypeMemo: null, resignReasonLarge: null, resignReasonMedium: null, resignReasonSmall: null, jobChangeReasonMemo: null },
  { id: "wh2", order: 2, companyName: "架空システム株式会社", jobTypeFlag: null, jobTypeMemo: "社内SE", resignReasonLarge: null, resignReasonMedium: null, resignReasonSmall: null, jobChangeReasonMemo: null },
];
// (a) 欄が空 → 入る（applied に記録・提案なし）。数値は Number・日付は Date 化
let st = { detail: { jobChangeTimelineMemo: "CAのメモ" } as Record<string, unknown>, workHistories: whRows as Array<Record<string, unknown> & { order: number }> };
let appliedS: AppliedMap = {};
let proposalsS: ProposalMap = {};
const tlScene = find("s4-timeline");
const pA = planSceneApply(sceneWritesWithClears(tlScene, { choices: { timeline: "3カ月以内" } }), st.detail, st.workHistories, appliedS, proposalsS);
check("plan: empty select -> set, memo appended with prefix", pA.detailPatch.jobChangeTimeline === "3カ月以内" && pA.applied["d.jobChangeTimeline"] === "3カ月以内" && Object.keys(pA.proposals).length === 0);
st = applyPlanToState(pA, st.detail, st.workHistories);
appliedS = pA.applied;
proposalsS = pA.proposals;
check("plan: state after apply", currentValueAt("d.jobChangeTimeline", st.detail, st.workHistories) === "3カ月以内");

const salScene = find("s6-salary-current");
const pNum = planSceneApply(sceneWrites(salScene, { inputs: { annual: "400" } }), {}, whRows, {}, {});
check("plan: number field coerced to Number", pNum.detailPatch.currentSalary === 400);
const rsgScene = runtimeSceneOfKey("s4-retired-when")!; // 離職中のときだけ出る場面なので展開せずキーから作る
const pDate = planSceneApply(sceneWrites(rsgScene, { inputs: { date: "2026-12" } }), {}, whRows, {}, {});
check("plan: month input -> resignationDate ISO of the 1st", typeof pDate.detailPatch.resignationDate === "string" && String(pDate.detailPatch.resignationDate).startsWith("2026-12-01"));

// (b) すでに違う値がある → 入れずに提案に回る（欄・applied は変わらない）
const pB = planSceneApply(sceneWritesWithClears(tlScene, { choices: { timeline: "半年以内（3〜6ヶ月）" } }), { jobChangeTimeline: "1年以内" }, whRows, {}, {});
check("plan: existing different value -> proposal only", Object.keys(pB.detailPatch).filter((k) => k !== "workStylePreferences").length === 0 && pB.proposals["d.jobChangeTimeline"]?.value === "半年以内" && !pB.applied["d.jobChangeTimeline"]);

// (c) ［替える］→ その欄だけ入り、提案から消え、applied に記録
const acc2 = planAcceptProposal("d.jobChangeTimeline", whRows, {}, pB.proposals);
check("plan: accept proposal -> only that field, removed from proposals, recorded in applied", !!acc2 && acc2.detailPatch.jobChangeTimeline === "半年以内" && Object.keys(acc2.detailPatch).length === 1 && !acc2.proposals["d.jobChangeTimeline"] && acc2.applied["d.jobChangeTimeline"] === "半年以内");
check("plan: accept unknown path -> null", planAcceptProposal("d.nothing", whRows, {}, pB.proposals) === null);
check("plan: dismiss removes the proposal only", Object.keys(planDismissProposal("d.jobChangeTimeline", pB.proposals)).length === 0);

// (d) 押し直し: 欄がスクリプトの値のままなら差し替え／CA が直していたら触らない（提案に回る）
const pC = planSceneApply(sceneWritesWithClears(tlScene, { choices: { timeline: "半年以内（3〜6ヶ月）" } }), st.detail, st.workHistories, appliedS, proposalsS);
check("plan: re-press while field still holds script value -> replaced", pC.detailPatch.jobChangeTimeline === "半年以内" && pC.applied["d.jobChangeTimeline"] === "半年以内");
const edited = { ...st.detail, jobChangeTimeline: "1年以内" }; // CA が手で直した
const pD = planSceneApply(sceneWritesWithClears(tlScene, { choices: { timeline: "未定（良いところがあれば）" } }), edited, st.workHistories, appliedS, proposalsS);
check("plan: re-press after CA edited the field -> untouched, proposal", pD.detailPatch.jobChangeTimeline === undefined && pD.proposals["d.jobChangeTimeline"]?.value === "未定");

// (e) メモ: 空なら入れ、入っていれば末尾に印つきで書き足し、同じ文があれば足さない（work_histories の行＝会社番号で）
const reasonScene = find("s5-wh-reason", 1);
const pM1 = planSceneApply(sceneWritesWithClears(reasonScene, { choices: { reason: "言いにくそう" } }), {}, whRows, {}, {});
check("plan: wh memo empty -> set as-is on the 2nd company row", pM1.whPatches[1]?.jobChangeReasonMemo === "言いにくい" && !pM1.whPatches[0]);
const whWithMemo = whRows.map((r, i) => (i === 1 ? { ...r, jobChangeReasonMemo: "CAが書いた理由" } : r));
const pM2 = planSceneApply(sceneWritesWithClears(reasonScene, { choices: { reason: "言いにくそう" } }), {}, whWithMemo, {}, {});
check("plan: wh memo has text -> appended with 【スクリプト】", pM2.whPatches[1]?.jobChangeReasonMemo === `CAが書いた理由\n${SCRIPT_MEMO_PREFIX}言いにくい`);
const whDup = whRows.map((r, i) => (i === 1 ? { ...r, jobChangeReasonMemo: pM2.whPatches[1]!.jobChangeReasonMemo } : r));
const pM3 = planSceneApply(sceneWritesWithClears(reasonScene, { choices: { reason: "言いにくそう" } }), {}, whDup, pM2.applied, {});
check("plan: same memo sentence already there -> not appended again", !pM3.whPatches[1] || pM3.whPatches[1].jobChangeReasonMemo === undefined);
const mirrored = applyPlanToState(pM1, {}, whRows);
check("plan: 1st company row is mirrored into detail (autosave-compatible)", mirrored.detail.companyName === "架空商事株式会社" && String(mirrored.detail.careerSummary).includes("【2社目】架空システム株式会社"));
// 職歴の行が無い会社番号には入れない
const pNoRow = planSceneApply(sceneWritesWithClears(reasonScene, { choices: { reason: "言いにくそう" } }), {}, [whRows[0]], {}, {});
check("plan: no work-history row for that company -> nothing written", Object.keys(pNoRow.whPatches).length === 0);

// (f) 働き方: 無ければ付ける・付いていればそのまま
const wsScene = find("s6-workstyle");
const pW = planSceneApply(sceneWritesWithClears(wsScene, { choices: { ws: ["フルリモート"] } }), { workStylePreferences: JSON.stringify(["退職金制度"]) }, whRows, {}, {});
check("plan: work style check added, existing CA check kept", pW.detailPatch.workStylePreferences === JSON.stringify(["退職金制度", "フルリモート"]) && pW.applied["ws.フルリモート"] === "1");

// (g) 場面キー → 実行時の場面（サーバーの apply API が使う）
check("runtimeSceneOfKey: plain / company / unknown", runtimeSceneOfKey("s4-timeline")?.scene.id === "s4-timeline" && runtimeSceneOfKey("s5-wh-reason#1")?.companyIndex === 1 && runtimeSceneOfKey("nope") === null && runtimeSceneOfKey("s5-wh-reason#x") === null);

console.log(failed === 0 ? "ALL OK" : `FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
