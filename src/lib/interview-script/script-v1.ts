// T-208 step2: 初回面談の台本 v1（docs/interview-script/initial-interview-script.md を元に、付録A〜F を反映）。
// - ボタンの保存する値は入力画面の選択肢そのもの（field-options.ts）。表示名の（ ）は説明で、値には含めない。
// - 拾う一言は台本の文をそのまま使う。付録A の割り当てで複数のボタンが同じ文を使うことがある。
// - 付録H（質問の会社ごとの振り分け）は T-208 step3 で反映: 会社ごとの場面「s5-wh-prep-questions」（その会社の質問があるときだけ）
//   ＋ 経歴確認の最後の「面談準備の質問（全体）」（どの会社にも当たらない質問と「全体」）。付録G（チャットのボタン）は InterviewPrepPanel 側。
// - 台本に書いてあるが作らないもの: 職種の「提案候補」（職種提案パターン集は T-206 の後に作り直す決まり）。

import { getSmallOptions } from "@/constants/resign-reason-hierarchy";
import { questionsForCompany } from "@/lib/interview-prep/summary-format";
import {
  calcSalary,
  formatHours,
  formatMan,
  nextInterviewGuide,
  overtimeDayToMonth,
  overtimeMonthToDay,
  overtimeOptionFor,
  parseNumber,
  scheduleOutlook,
} from "./calc";
import { WORK_STYLE_OPTIONS } from "./field-options";
import { choiceOf, choicesOf, inputOf } from "./render";
import type {
  AnswerMap,
  FieldTarget,
  ScriptButton,
  ScriptContext,
  ScriptPart,
  ScriptScene,
  ScriptWrite,
  SceneAnswer,
} from "./types";

export const SCRIPT_VERSION = "v1";

export const SCRIPT_PARTS: ScriptPart[] = [
  { id: "p1", no: 1, title: "本人確認・挨拶" },
  { id: "p2", no: 2, title: "お礼・会社紹介・エージェント利用経験" },
  { id: "p3", no: 3, title: "サービス説明" },
  { id: "p4", no: 4, title: "転職活動状況" },
  { id: "p5", no: 5, title: "経歴確認（退職理由を含む）" },
  { id: "p6", no: 6, title: "希望条件" },
  { id: "p7", no: 7, title: "今後の流れ・クロージング" },
];

/** 新人向けの注意（台本の冒頭。畳んだ状態で置く） */
export const SCRIPT_NOTES_FOR_BEGINNERS: string[] = [
  "ほめるときは、相手が言った言葉を1つそのまま入れる（例：「〇〇まで任されていたんですね」）。",
  "「同じ方はたくさんいらっしゃいます」は、何度も言うとくどくなる。1回の面談で1〜2回まで。",
  "退職理由は否定しない。前の会社を一緒に悪く言わない。受け止めて、次の探し方につなげる。",
  "答えに自信がない質問は、その場で答えなくてよい。「確認して、改めてご連絡いたしますね」と持ち帰る。",
  "事務希望の人は、選考でExcelをよく見られる。関数まで使えるかは必ず具体的に聞く。",
];

/* ---------- 入れ先の短い書き方 ---------- */
const d = (field: string): FieldTarget => ({ kind: "detail", field });
const dm = (field: string): FieldTarget => ({ kind: "detail", field, memo: true });
const wh = (field: string): FieldTarget => ({ kind: "wh", field });
const whm = (field: string): FieldTarget => ({ kind: "wh", field, memo: true });
const ws = (item: string): FieldTarget => ({ kind: "workStyle", item });

/* ---------- 拾う一言（台本の文をそのまま） ---------- */
const PICK = {
  agentFirst: "ありがとうございます。では最初に、私たちがどんなことをするのか、簡単にご説明させていただきますね。",
  agentPast: "ちなみに、それはリクルートさんやパーソル（doda）さんのような大手のエージェントでしたか？ それとも、それ以外の会社でしたか？",
  agentParallel: "ありがとうございます。今お使いなのは、リクルートさんやパーソル（doda）さんのような大手のエージェントですか？ それとも、それ以外の会社ですか？",
  docsDone: "ぜひお送りください。拝見して整えさせていただきます。",
  docsPartial: "手書きのものや写真でも大丈夫です。こちらでデータにして、見やすく作り直せます。",
  docsNone: "マイナビに登録いただいている内容をもとに、こちらでたたき台をお作りして、ご確認いただく形もできます。",
  retireDecided: "承知しました。では〇月以降の入社を目標に、逆算して進めていきましょう。",
  retireSoon: "ありがとうございます。一般的にも1〜2ヶ月前にお伝えする方が多いので、それを前提に考えていきますね。",
  retireLong: "承知しました。応募先によっては入社日の相談が必要になるので、その点も踏まえて進めていきますね。",
  retired: "ありがとうございます。では、入社の時期は合わせやすい状況ですね。",
  tl3: "承知しました。応募から内定までは1〜2ヶ月ほどかかることが多いので、少しスピード感を持って進めていきましょう。",
  tl6: "ありがとうございます。今から動けば、無理なく間に合うスケジュールです。軸を整理しながら進めていきましょう。",
  tlLater: "承知しました。では焦らずに、良い求人を見極めながら進めていきましょう。",
  actNew: "では今は、動き始めて情報収集を進めていく段階ですね。当社からも有益な情報のご提供はもちろん、軸の整理などもしっかりサポートいたしますね。",
  act3: "ありがとうございます。ある程度、求人もご覧になってきた頃ですね。これまで見てきて感じたことも、ぜひ聞かせてください。",
  actLong: "長く頑張ってこられたんですね。これまでの進め方も振り返りながら、うまくいく形を一緒に考えていきましょう。",
  app0: "承知しました。では、応募先選びからしっかり一緒に考えていきましょう。",
  appInterview: "ありがとうございます。面接の対策も当社でお手伝いできますので、よろしければご相談ください。",
  appOffer: "おめでとうございます。ちなみに、お返事の期限はいつまででしょうか？（期限を聞いたうえで）その条件と比べながら、より良い選択ができるようにお手伝いしますね。",
  dayOffWeekend: "プライベートの時間を大事にされたいんですね。土日祝がお休みの求人を中心に探していきますね。",
  dayOffTwo: "週2日のお休みがあれば、曜日は問わない、ということですね。",
  dayOffShift: "生活のリズムを整えたいという理由で、土日休みの仕事に移られる方はたくさんいらっしゃいます。一緒に探していきましょう。",
  dayOffAny: "お休みの形にこだわりがないと、選べる求人がぐっと広がります。",
};

/* ---------- 退職理由（付録E）: ボタン → 大・中、小分類の候補 ---------- */
export type ResignReasonMap = { large: string; medium: string; smalls: string[] };
export const RESIGN_REASON_BUTTONS: Record<string, ResignReasonMap> = {
  "人間関係": { large: "過去型", medium: "個人都合", smalls: ["上司・同僚との人間関係", "ハラスメント（パワハラ・セクハラ等）"] },
  "残業・仕事量が多い": { large: "過去型", medium: "個人都合", smalls: ["長時間労働・過重労働", "残業や休日出勤が多い"] },
  "給与・評価": { large: "過去型", medium: "個人都合", smalls: ["給与・待遇が見合わない", "評価制度への不満", "昇給・昇進がない"] },
  "通勤・家庭の事情": { large: "過去型", medium: "環境要因", smalls: ["通勤時間が長い・転居により通勤困難", "家庭の事情（育児・介護）"] },
  "将来が見えない・成長できない": { large: "未来型", medium: "キャリア志向", smalls: ["より成長できる環境を求めて"] },
  "仕事内容が合わない": { large: "過去型", medium: "個人都合", smalls: ["仕事内容が合わない・ギャップがある"] },
};
const RESIGN_PICKUP: Record<string, string> = {
  "人間関係": "それは毎日のことですし、本当にお辛かったですよね。実は、人間関係をきっかけに転職される方はとても多くて、環境を変えたことでのびのび働けるようになった方もたくさんいらっしゃいます。ご安心ください。次は、職場の雰囲気もしっかり見ながら一緒に探していきましょう。",
  "残業・仕事量が多い": "その量を毎日こなしてこられたのは、本当に大変だったと思います。働き方を見直したいという理由で転職される方は多く、無理のない環境に移って活躍されている方もたくさんいらっしゃいます。働き方もしっかり条件に入れて探していきましょう。",
  "給与・評価": "頑張っているのに、それがきちんと評価されないのは本当にもどかしいですよね。同じ理由で転職を考える方はとても多く、評価の仕組みが整った会社に移って、納得して働けるようになった方もたくさんいらっしゃいます。評価のされ方も一緒に見ながら、求人を選んでいきましょう。",
  "通勤・家庭の事情": "ご家庭のことを考えると、本当に大事なポイントですよね。生活の変化をきっかけに転職される方は多く、家庭と両立しながら働ける職場に移られた方もたくさんいらっしゃいます。ご安心ください。無理なく続けられる環境を一緒に探しましょう。",
  "将来が見えない・成長できない": "今のうちから先のことまでしっかり考えていらっしゃるのは、素晴らしいと思います。同じように将来を考えて一歩踏み出される方は多く、新しい環境でキャリアを広げている方もたくさんいらっしゃいます。その先まで見据えて、一緒に選んでいきましょう。",
  "仕事内容が合わない": "実際にやってみたからこそ分かったことですよね。合わないと感じて仕事を変える方は多いですし、その経験を生かして次の仕事で活躍されている方もたくさんいらっしゃいます。今回の経験は、次の仕事選びの大事なヒントになりますよ。",
  "言いにくそう": "もちろん、話せる範囲で大丈夫ですよ。どんな理由であっても、同じような思いで転職される方はたくさんいらっしゃいますので、ご安心ください。面接で聞かれたときの伝え方は、また一緒に考えましょう。",
};

/** 退職理由の小分類ボタン（候補は押した大枠で絞る）。小分類の文字列は resign-reason-hierarchy.ts の実際の値 */
function resignSmallButtons(): ScriptButton[] {
  const out: ScriptButton[] = [];
  const seen = new Set<string>();
  for (const [reason, map] of Object.entries(RESIGN_REASON_BUTTONS)) {
    for (const small of map.smalls) {
      if (seen.has(`${reason}:${small}`)) continue;
      seen.add(`${reason}:${small}`);
      out.push({
        label: small,
        target: wh("resignReasonSmall"),
        showIf: (sa) => sa.choices?.reason === reason && getSmallOptions(map.medium).includes(small),
      });
    }
  }
  return out;
}

/** Word・PowerPoint（付録B）: 1つの質問で2欄に入れる */
export const WORD_PPT_BUTTONS: Array<{ label: string; word: string; ppt: string }> = [
  { label: "どちらも問題ない", word: "中級", ppt: "中級" },
  { label: "Wordだけ", word: "中級", ppt: "不可" },
  { label: "PowerPointだけ", word: "不可", ppt: "中級" },
  { label: "どちらも苦手", word: "初級", ppt: "初級" },
];

/** 転勤（付録B）: 台本のボタンのまま → 転勤有無の選択肢＋メモ */
export const TRANSFER_BUTTONS: Array<{ label: string; value: string; memo?: string; pickup: string }> = [
  { label: "全国OK", value: "可", pickup: "ありがとうございます。転勤ありの求人も含めると、大手企業なども候補に入り、選べる会社がかなり広がります。" },
  { label: "エリア限定ならOK", value: "要相談", pickup: "ありがとうございます。通える範囲の異動まで広げると、候補の会社がぐっと増えます。" },
  { label: "通える範囲ならOK", value: "なし", memo: "通える範囲の異動なら可", pickup: "ありがとうございます。通える範囲の異動まで広げると、候補の会社がぐっと増えます。" },
  { label: "難しい", value: "なし", pickup: "承知しました。転勤のない求人に絞ってご案内しますね。" },
];

/* ---------- 答えを横断して使う小さな判定 ---------- */

/**
 * T-208 不具合修正 #4: 押した答えは「ボタンの表示名（label）」で保存される（画面の pressButton・sceneWrites の突き合わせもそれ）。
 * 一方、条件分岐・自動計算が比べるのは保存する値（value: 「離職中（辞めている）」→「離職中」等）。
 * 表示名のまま比べると when 付きの場面（退職の予定・退職後の期間・大手エージェント等）が出ず、賞与込みの計算も効かないので、
 * ここで表示名 → 値に直してから返す。ボタンが見つからなければそのまま（表示名＝値のボタンはどちらでも同じ）。
 */
function buttonValueOf(sceneId: string, groupKey: string, label: string): string {
  if (!label) return "";
  const group = SCRIPT_SCENES.find((s) => s.id === sceneId)?.groups?.find((g) => g.key === groupKey);
  const btn = group?.buttons.find((b) => b.label === label);
  return btn ? (btn.value ?? btn.label) : label;
}
export function choiceValueOf(a: AnswerMap, sceneId: string, groupKey: string): string {
  return buttonValueOf(sceneId, groupKey, choiceOf(a, sceneId, groupKey));
}
export function choiceValuesOf(a: AnswerMap, sceneId: string, groupKey: string): string[] {
  return choicesOf(a, sceneId, groupKey).map((label) => buttonValueOf(sceneId, groupKey, label));
}

export function timelineOf(a: AnswerMap): string {
  return choiceValueOf(a, "s4-timeline", "timeline");
}
export function hasSelectionOf(a: AnswerMap): boolean {
  return choiceValueOf(a, "s4-applications", "type") === "選考中" || choiceValuesOf(a, "s4-applications", "offer").includes("内定あり");
}
export function employedOf(a: AnswerMap, ctx: ScriptContext): boolean | null {
  const v = choiceValueOf(a, "s4-employment", "status") || ctx.employmentStatus;
  if (v === "在職中") return true;
  if (v === "離職中") return false;
  return null;
}
export function retireMonthsOf(a: AnswerMap): number | null {
  return parseNumber(inputOf(a, "s4-retire-plan", "months"));
}
export function contactOf(a: AnswerMap): string {
  return choiceValueOf(a, "s7-contact", "method");
}
export function nextToolOf(a: AnswerMap): string {
  return choiceValueOf(a, "s7-next", "tool");
}
export function docsOf(a: AnswerMap): string {
  return choiceValueOf(a, "s3-docs", "docs");
}
export function agentOf(a: AnswerMap): string {
  return choiceValueOf(a, "s2-agent", "agent");
}

/** 次回面談の日（入力が無ければ今日） */
export function nextInterviewDateOf(a: AnswerMap, ctx: ScriptContext): Date {
  const raw = inputOf(a, "s7-next", "date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return ctx.today ?? new Date();
}

/* ---------- 場面 ---------- */
const pickupGroup = (buttons: Array<[string, string]>) => ({
  key: "pickup",
  label: "拾う一言（相手の様子で選ぶ）",
  buttons: buttons.map(([label, pickup]) => ({ label, pickup })),
});

export const SCRIPT_SCENES: ScriptScene[] = [
  /* ===== 1. 本人確認・挨拶 ===== */
  {
    id: "s1-greeting",
    part: "p1",
    title: "本人確認・挨拶",
    say: [
      "{{if:online}}お世話になります。ビズスタジオの〔CA名〕です。〔氏名〕様でいらっしゃいますか。音声は聞こえておりますでしょうか。",
      "",
      "本日はお時間をいただきありがとうございます。担当させていただきます〔CA名〕です。よろしくお願いいたします。{{else}}お世話になります。ビズスタジオの〔CA名〕と申します。〔氏名〕様のお電話でお間違いないでしょうか。",
      "",
      "（本人と確認できたら）{{if:time}}本日〔時刻〕から{{/if}}ご予約いただいておりました、転職相談の件でお電話いたしました。担当させていただきます〔CA名〕です。よろしくお願いいたします。{{/if}}",
      "",
      "お時間は20〜30分ほど頂戴しても大丈夫でしょうか。",
    ].join("\n"),
  },

  /* ===== 2. 応募のお礼・会社紹介・エージェント利用経験 ===== */
  {
    id: "s2-agent",
    part: "p2",
    title: "お礼・会社紹介・エージェント利用経験",
    say: [
      "改めまして、このたびはマイナビ転職のスカウトにご応募いただき、ありがとうございました。",
      "",
      "当社は転職エージェントの会社でして、〔氏名〕様の転職活動をお手伝いさせていただきたく、スカウトをお送りいたしました。",
      "",
      "本日は初回のご面談ですので、今の転職活動のご状況やこれまでのご経歴、ご希望の条件をお伺いして、今後の進め方をご提案できればと思っております。",
      "",
      "はじめに1つお伺いしたいのですが、〔氏名〕様は、これまでに転職エージェントを利用されたことはございますか？",
    ].join("\n"),
    groups: [
      {
        key: "agent",
        target: d("agentUsageFlag"),
        buttons: [
          { label: "初めて利用", pickup: PICK.agentFirst, next: "s3-body" },
          { label: "利用経験あり（途中でやめた）", value: "利用経験あり", pickup: PICK.agentPast },
          { label: "他社利用中（今も並行して使っている）", value: "他社利用中", pickup: PICK.agentParallel },
        ],
      },
    ],
    targetsHint: "他AG状況",
  },

  /* ===== 3. サービス説明 ===== */
  {
    id: "s3-agent-kind",
    part: "p3",
    title: "サービス説明：答えごとの入り方",
    when: (_ctx, a) => agentOf(a) === "利用経験あり" || agentOf(a) === "他社利用中",
    say: "{{if:agentParallel}}ありがとうございます。今お使いなのは、リクルートさんやパーソル（doda）さんのような大手のエージェントですか？ それとも、それ以外の会社ですか？{{else}}ちなみに、それはリクルートさんやパーソル（doda）さんのような大手のエージェントでしたか？ それとも、それ以外の会社でしたか？{{/if}}",
    groups: [
      {
        key: "kind",
        target: dm("agentUsageMemo"),
        buttons: [{ label: "大手" }, { label: "それ以外" }],
      },
    ],
    pickup: (sa, _ctx, a) => {
      if (!sa.choices?.kind) return null;
      return agentOf(a) === "他社利用中"
        ? "ありがとうございます。当社の進め方と、違いも含めてご説明させていただきますね。"
        : "ありがとうございます。そちらでは、求人のご紹介を受けたり、応募や選考までは進まれましたか？\n\n（答えを聞いて）ありがとうございます。会社によって進め方が少しずつ違いますので、当社の流れも簡単にご説明させていただきますね。";
    },
    targetsHint: "他AG状況のメモ",
  },
  {
    id: "s3-body",
    part: "p3",
    title: "サービス説明：役目と1つ目",
    say: [
      "私たちの役目は、〔氏名〕様が行きたいと思える会社を一緒に見つけて、内定を取るところまでお手伝いすることです。そのためにやることは、大きく3つあります。",
      "",
      "1つ目は、応募前の準備です。求人のご紹介はもちろんですが、そもそもなぜ転職したいのか、ご自身の強みは何か、どんな働き方をしたいのかを最初にしっかり整理します。条件だけで選ぶと、入社後のミスマッチが起きやすいためです。当社でご紹介できる求人がない場合も、転職サイトなどでご自身で見つけた求人の応募をお手伝いできます。",
    ].join("\n"),
  },
  {
    id: "s3-docs",
    part: "p3",
    title: "サービス説明：2つ目（応募書類）",
    say: "2つ目は、応募書類のお手伝いです。ちなみに、履歴書や職務経歴書は、もう準備されていますか？",
    groups: [
      {
        key: "docs",
        target: d("documentStatusFlag"),
        buttons: [
          { label: "完成（できている）", value: "完成", pickup: PICK.docsDone },
          { label: "本人作成中（手書き・途中）", value: "本人作成中", pickup: PICK.docsPartial, writes: [{ target: dm("documentStatusMemo"), value: "手書き・途中" }] },
          { label: "未着手（まだ）", value: "未着手", pickup: PICK.docsNone },
        ],
      },
    ],
    notes: ["答えを受けたら続けて: 「作った書類は、ご自身で見つけた求人の応募にもお使いいただけます。」"],
    targetsHint: "書類状況（アクションタブ）",
  },
  {
    id: "s3-body-3",
    part: "p3",
    title: "サービス説明：3つ目（面接対策）と締め",
    say: [
      "3つ目は、面接対策です。オンラインで1時間ほどお時間をいただき、資料を使った研修のような形で、応募先の企業研究や、聞かれそうな質問への準備を一緒に進めていきます。仕上げには、本番を想定した模擬面接もやらせていただきます。",
      "",
      "これらのサポートは、各社単位で回数上限なく、すべて無料でご利用いただけます。以上が当社のサポート内容の概要となりますが、ご認識されていた内容と相違ない形で大丈夫でしょうか？",
      "{{if:agentParallel}}",
      "{{if:agentBig}}（大手のとき）大手のエージェントさんは求人の数がとても多いので、情報を集めるのにはおすすめです。一方で、たくさん送られてくる求人にたくさん応募していく進め方が多く、軸が固まらないまま進んで疲れてしまう方も少なくありません。当社は、その軸づくりや進め方をしっかりサポートしますので、大手さんの求人も見ながら並行して進めていただくのがおすすめです。",
      "{{/if}}",
      "並行して進めていただいて大丈夫です。当社からご案内する求人の中に、すでに他で応募済みのものがあれば、重ねて応募する必要はありませんので、気にせず飛ばしていただいて大丈夫です。{{/if}}",
    ].join("\n"),
  },

  /* ===== 4. 転職活動状況 ===== */
  {
    id: "s4-employment",
    part: "p4",
    title: "前置きと在職の確認",
    say: [
      "ありがとうございます。では、これからいくつかご質問をさせていただきます。事前にマイナビにご登録いただいている情報は拝見しておりますが、念のため確認の意味で、改めてお伺いする部分もございますので、ご了承ください。",
      "",
      "{{if:company}}まず、現在は〔直近の会社〕様にご在職中でしょうか？{{else}}まず、現在は、お仕事をされていますか？{{/if}}",
    ].join("\n"),
    groups: [
      {
        key: "status",
        target: d("employmentStatus"),
        buttons: [
          { label: "在職中" },
          { label: "離職中（辞めている）", value: "離職中", pickup: PICK.retired, next: "s4-retired-when" },
        ],
      },
    ],
    targetsHint: "在職状況",
  },
  {
    id: "s4-retire-plan",
    part: "p4",
    title: "退職の予定（在職中）",
    when: (ctx, a) => employedOf(a, ctx) === true,
    say: "ありがとうございます。退職の時期は、もう決まっていらっしゃいますか？",
    groups: [
      {
        key: "plan",
        buttons: [
          { label: "決まっている", pickup: PICK.retireDecided },
          { label: "決まっていない" },
        ],
      },
    ],
    inputs: [
      {
        key: "when",
        label: "いつ頃のご予定でしょうか？",
        type: "text",
        placeholder: "例: 12月末",
        target: dm("jobChangeTimelineMemo"),
        format: (v) => `退職予定: ${v}`,
        showIf: (sa) => sa.choices?.plan === "決まっている",
      },
      {
        key: "months",
        label: "内定が出て退職を伝えてから、何ヶ月くらいで退職できそうか（引き継ぎ含め目安）",
        type: "number",
        unit: "ヶ月",
        target: dm("jobChangeTimelineMemo"),
        format: (v) => `退職まで約${v}ヶ月`,
        showIf: (sa) => sa.choices?.plan === "決まっていない",
      },
    ],
    pickup: (sa) => {
      if (sa.choices?.plan !== "決まっていない") return null;
      const m = parseNumber(sa.inputs?.months);
      if (m == null) return null;
      return m >= 3 ? PICK.retireLong : PICK.retireSoon;
    },
    notes: ["決まっていないとき: 「承知しました。では、もし内定が出て、今の会社に退職をお伝えした場合、そこから何ヶ月くらいで退職できそうでしょうか？ 引き継ぎなども含めて、目安で大丈夫です。」"],
    targetsHint: "転職時期の横のメモ欄",
  },
  {
    id: "s4-retired-when",
    part: "p4",
    title: "退職した時期（離職中）",
    when: (ctx, a) => employedOf(a, ctx) === false,
    say: "ありがとうございます。ご退職されたのは、いつ頃でしょうか？",
    inputs: [{ key: "date", label: "退職した時期", type: "month", target: d("resignationDate") }],
    pickup: () => PICK.retired,
    targetsHint: "退職日",
  },
  {
    id: "s4-timeline",
    part: "p4",
    title: "転職時期",
    say: [
      "転職の時期について、何月頃までに次のお仕事を始めたい、というご希望はありますか？ ご希望で大丈夫です。",
      "",
      "（はっきりしないとき）では、良い求人があれば早めに、というイメージでよろしいですか？",
    ].join("\n"),
    groups: [
      {
        key: "timeline",
        target: d("jobChangeTimeline"),
        buttons: [
          { label: "すぐにでも", pickup: PICK.tl3 },
          { label: "3カ月以内", pickup: PICK.tl3 },
          { label: "半年以内（3〜6ヶ月）", value: "半年以内", pickup: PICK.tl6 },
          { label: "1年以内", pickup: PICK.tlLater },
          { label: "未定（良いところがあれば）", value: "未定", pickup: PICK.tlLater },
        ],
      },
    ],
    inputs: [{ key: "month", label: "希望の月（あれば）", type: "text", placeholder: "例: 12月まで", target: dm("jobChangeTimelineMemo"), format: (v) => `希望: ${v}` }],
    targetsHint: "転職時期",
  },
  {
    id: "s4-activity",
    part: "p4",
    title: "活動期間",
    say: "今回の転職活動は、求人を見たり、転職サイトに登録したりと、動き始めてからどれくらい経ちますか？",
    groups: [
      {
        key: "period",
        target: d("activityPeriod"),
        buttons: [
          { label: "1週間以内", pickup: PICK.actNew },
          { label: "1カ月以内", pickup: PICK.actNew },
          { label: "3カ月以内", pickup: PICK.act3 },
          { label: "半年以内", pickup: PICK.actLong },
          { label: "半年以上", pickup: PICK.actLong },
        ],
      },
    ],
    targetsHint: "活動期間",
  },
  {
    id: "s4-applications",
    part: "p4",
    title: "応募の状況",
    say: [
      "これまでに、何社くらい応募されましたか？ ざっくりで大丈夫です。",
      "",
      "（1社以上のとき）ありがとうございます。その中で、今も選考が続いている会社はありますか？ 書類の結果待ち、面接を控えている、内定が出ている、などです。",
      "",
      "（続いている会社があるとき）差し支えなければ、どんな業界やお仕事の会社か教えていただけますか？",
    ].join("\n"),
    inputs: [
      { key: "count", label: "応募した社数", type: "number", unit: "社", target: d("currentApplicationCount") },
      { key: "industry", label: "選考中の会社の業界・仕事", type: "text", target: dm("applicationMemo"), format: (v) => `選考中: ${v}` },
      { key: "deadline", label: "内定の返事の期限", type: "text", target: dm("applicationMemo"), format: (v) => `内定の返事期限: ${v}`, showIf: (sa) => Array.isArray(sa.choices?.offer) && sa.choices.offer.includes("内定あり") },
    ],
    groups: [
      {
        key: "type",
        target: d("applicationTypeFlag"),
        buttons: [
          { label: "検討中", pickup: PICK.app0 },
          { label: "応募中（結果待ち）", value: "応募中" },
          { label: "選考中（面接あり）", value: "選考中", pickup: PICK.appInterview },
          { label: "なし", pickup: PICK.app0 },
        ],
      },
      {
        key: "offer",
        label: "内定がある場合",
        multi: true,
        target: dm("applicationMemo"),
        buttons: [{ label: "内定あり", pickup: PICK.appOffer }],
      },
    ],
    pickup: (sa) => (parseNumber(sa.inputs?.count) === 0 && !sa.choices?.type ? PICK.app0 : null),
    targetsHint: "他社応募・社数・メモ（他AG状況は 2・3 の答え）",
  },
  {
    id: "s4-background",
    part: "p4",
    title: "相談の背景",
    say: "今回、エージェントに相談してみようと思われたのは、どんなことにお困りだったからでしょうか？",
    groups: [
      pickupGroup([
        ["合う求人が見つからない・条件が多い", "ありがとうございます。条件が多いときこそ、優先順位を一緒に整理すると探しやすくなりますので、このあと細かくお伺いしますね。"],
        ["求人が多すぎて違いが分からない", "たしかに、似た求人が多くて見分けにくいですよね。求人ごとの違いや、見るべきポイントもしっかりお伝えしていきます。"],
        ["初めてで、何から始めればいいか分からない", "初めてだと、分からないことばかりですよね。進め方から一つずつご案内しますので、ご安心ください。"],
        ["書類や面接が不安", "ありがとうございます。書類と面接の対策は、先ほどご説明したとおり、しっかりお手伝いします。"],
        ["特にない・なんとなく", "承知しました。では、今日のお話の中で気になることが出てきたら、いつでもおっしゃってください。"],
      ]),
    ],
  },

  /* ===== 5. 経歴確認 ===== */
  {
    id: "s5-education",
    part: "p5",
    title: "学歴",
    say: [
      "ありがとうございます。続いて、これまでのご経歴を確認させてください。",
      "",
      "{{if:school}}最終学歴は、〔学校名〕{{if:dept}}〔学部学科〕{{/if}}を{{if:gradYear}}〔卒業年〕に{{/if}}ご卒業、ということでお間違いないでしょうか？{{else}}最終学歴は、どちらの学校を、いつご卒業でしょうか？{{/if}}",
      "",
      // T-208 不具合修正 #3: 最終学歴が高校（高専・高等専修学校は除く）のときは学部を聞く文を出さない
      "{{if:highSchool}}{{else}}{{if:dept}}そちらでは、主にどんなことを学ばれていましたか？（普通科など、特に専攻が無いときは省く）{{else}}ちなみに、学部（学科）はどちらでしたか？{{/if}}{{/if}}",
    ].join("\n"),
    inputs: [
      { key: "school", label: "学校名", type: "text", target: dm("educationMemo") },
      { key: "dept", label: "学部学科", type: "text", target: dm("educationMemo") },
      { key: "gradYear", label: "卒業年月", type: "text", placeholder: "2016年3月", target: d("graduationDate") },
    ],
    groups: [
      pickupGroup([
        ["資格や専門の技術を身につけている", "〇〇の資格もお持ちなんですね。ありがとうございます。"],
        ["専攻が今の仕事とつながっている", "学ばれたことが、今のお仕事にもつながっているんですね。"],
        ["特に無い・覚えていない", "ありがとうございます。"],
      ]),
    ],
    targetsHint: "最終学歴（学校名・卒業年）",
  },
  {
    // T-208 不具合修正 #2: 空白期間（勤め先の名前が無い期間、または学校／会社と次の会社の間が6か月以上）。
    // その空白の次の会社の場面の前に出す（展開は runtime の expandScenes）。中身は仮（大野の面談ログ oono-handbook 5-5 から）。次の段階で整える。
    id: "s5-gap",
    part: "p5",
    title: "職歴：空白期間",
    repeat: "gap",
    say: [
      "{{if:gapAfter}}〔前の所〕から〔次の会社〕様に入社されるまでの間が{{if:gapLength}}〔空白の期間〕ぐらい{{/if}}あるんですけれども、この間はどんな感じで過ごされていましたか？{{else}}〔前の所〕を退職されてから今までの間は、どんな感じで過ごされていましたか？{{/if}}",
      "",
      "{{if:gapNote}}（面談準備の整理では「〔空白の中身〕」〔空白の時期〕）{{/if}}",
    ].join("\n"),
    inputs: [{ key: "detail", label: "この間の過ごし方（本人の言葉）", type: "text" }],
    groups: [
      pickupGroup([
        ["空白を気にしている", "退職後の空白を企業から聞かれることはたまにあるんですけれども、状況を建設的に説明すれば、だいたいの会社は理解してくれますので、そんなに深く考えなくても大丈夫です。お伝えの仕方もちゃんとレクチャーしますので"],
      ]),
    ],
    targetsHint: "（入れ先は次の段階で決める。答えはスクリプトの記録に残る）",
  },
  {
    id: "s5-wh-intro",
    part: "p5",
    title: "職歴：入社の確認と選んだ理由",
    repeat: "company",
    say: [
      "{{if:first}}ご卒業後、{{if:companyName}}〔会社名〕様{{else}}最初の会社{{/if}}にご入社、という形でしょうか？{{else}}その後、{{if:hireDate}}〔入社年月〕に{{/if}}{{if:companyName}}〔会社名〕様{{else}}次の会社{{/if}}にご入社されていますね。{{/if}}",
      "",
      "{{if:companyName}}〔会社名〕様{{else}}その会社{{/if}}を選ばれたのは、どんな理由からでしたか？",
    ].join("\n"),
    inputs: [{ key: "reason", label: "選んだ理由", type: "text", target: whm("jobTypeMemo"), format: (v) => `【選んだ理由】${v}` }],
    groups: [
      pickupGroup([
        ["選んだ理由がはっきりしている", "ご自身の軸を持って選ばれていたんですね。その軸は、今回の転職でも大事にしていきましょう。"],
      ]),
    ],
    targetsHint: "職務経歴（職種の下のテキスト欄）",
  },
  {
    id: "s5-wh-work",
    part: "p5",
    title: "職歴：仕事の中身・立場と数字",
    repeat: "company",
    say: [
      "{{if:companyName}}〔会社名〕様{{else}}その会社{{/if}}では、{{if:jobDesc}}〔仕事内容〕を担当されていた、ということでよろしいですか？{{else}}どんなお仕事を担当されていましたか？{{/if}} 1日の中では、どんなお仕事が一番多かったですか？",
      "",
      "チームは何人くらいで、〔氏名〕様はどんな立場でしたか？ 目標や実績の数字があれば、教えていただけますか？",
    ].join("\n"),
    inputs: [
      { key: "work", label: "仕事の中身", type: "text", target: whm("jobTypeMemo"), format: (v) => `【仕事の中身】${v}` },
      { key: "role", label: "立場・チームの人数", type: "text", target: whm("jobTypeMemo"), format: (v) => `【立場・人数】${v}` },
      { key: "numbers", label: "目標や実績の数字", type: "text", target: whm("jobTypeMemo"), format: (v) => `【数字】${v}` },
    ],
    groups: [
      pickupGroup([
        ["長く勤めている", "〇年も続けてこられたのは、それだけで大きな強みです。一つの会社で信頼を積み上げてこられたことは、企業側もしっかり見てくれるポイントですよ。"],
        ["仕事を具体的に話してくれた", "ありがとうございます、とても分かりやすいです。〇〇（相手の言葉）まで任されていたんですね。"],
        ["数字の実績がある", "〇〇（数字）はすごいですね。数字で成果を示せるのは大きな強みなので、書類や面接でもしっかり打ち出していきましょう。"],
        ["数字が無い・分からない", "大丈夫です。数字が無くても、任されていたことや工夫されたことは十分に強みになりますので、一緒に言葉にしていきましょう。"],
        ["リーダー・教育係の立場", "〇人のチームをまとめて、後輩の育成まで任されていたんですね。人をまとめた経験は、どの業界でも評価されやすいですよ。"],
        ["自分から工夫・改善した", "ご自身で考えて、やり方を変えていかれたんですね。言われたことだけでなく自分から動けるのは、立派な強みです。"],
        ["大変な環境だった", "その環境で〇年頑張ってこられたのは、本当に大変だったと思います。"],
      ]),
    ],
    targetsHint: "職務経歴（職種の下のテキスト欄。見出し付き）",
  },
  {
    // T-208 step3（付録H）: その会社に関わる面談準備の質問（company が一致するもの・食い違いを先に）。質問が無い会社では出さない
    id: "s5-wh-prep-questions",
    part: "p5",
    title: "職歴：面談準備の質問（この会社）",
    repeat: "company",
    kind: "prep-questions",
    say: "面談準備の「面談で聞くこと」のうち、この会社に関わるものをここで聞く（食い違いを先に）。聞いた質問は右の面談準備で「聞いた」を付ける。",
    whenCompany: (ctx, companyIndex) => questionsForCompany(ctx.prepQuestions, ctx.companies[companyIndex]?.name ?? "").length > 0,
  },
  {
    id: "s5-wh-reason",
    part: "p5",
    title: "職歴：退職理由",
    repeat: "company",
    say: [
      "{{if:currentCompany}}差し支えない範囲で構わないのですが、今回、転職を考え始めたきっかけは何だったのでしょうか？ いつ頃から考え始められましたか？{{else}}差し支えない範囲で構わないのですが、{{if:companyName}}〔会社名〕様{{else}}その会社{{/if}}を退職されたのは、どんな理由からでしたか？{{/if}}",
      "",
      "（理由がいくつか出たとき）ありがとうございます。その中で、一番大きかった理由はどれでしょうか？",
    ].join("\n"),
    groups: [
      {
        key: "reason",
        label: "一番大きかった理由",
        buttons: [
          ...Object.entries(RESIGN_REASON_BUTTONS).map(([label, map]) => ({
            label,
            pickup: RESIGN_PICKUP[label],
            target: wh("resignReasonLarge"),
            value: map.large,
            writes: [{ target: wh("resignReasonMedium"), value: map.medium }],
          })),
          { label: "言いにくそう", value: "", pickup: RESIGN_PICKUP["言いにくそう"], writes: [{ target: whm("jobChangeReasonMemo"), value: "言いにくい" }] },
        ],
      },
      {
        key: "small",
        label: "小分類（候補から1つ選ぶ）",
        buttons: resignSmallButtons(),
        showIf: (sa) => !!sa.choices?.reason && sa.choices.reason !== "言いにくそう",
      },
    ],
    inputs: [{ key: "detail", label: "退職理由の詳細（本人の言葉）", type: "text", target: whm("jobChangeReasonMemo") }],
    targetsHint: "退社理由（大・中は自動、小分類は候補から）・詳細",
  },
  {
    id: "s5-prep-questions",
    part: "p5",
    title: "面談準備の質問（全体）",
    kind: "prep-questions",
    // T-208 step3: 会社ごとの場面に出した質問は除き、どの会社にも当たらない質問と「全体」の質問をここにまとめる
    say: "面談準備の「面談で聞くこと」のうち、どの会社にも当たらない質問と「全体」の質問を、ここでまとめて聞く。聞いた質問は右の面談準備で「聞いた」を付ける。",
  },

  /* ===== 6. 希望条件 ===== */
  {
    id: "s6-job",
    part: "p6",
    title: "希望条件：入り方と職種",
    say: [
      "ありがとうございます。ここからは、ご希望の条件をお伺いさせてください。今の時点のお考えで大丈夫ですし、あとから変わっても問題ありません。",
      "",
      "まず、次のお仕事で、やってみたい職種はありますか？",
    ].join("\n"),
    groups: [
      {
        key: "has",
        buttons: [
          { label: "ある", next: "s6-job-detail" },
          { label: "まだ分からない・はっきりない", next: "s6-job-direction" },
        ],
      },
    ],
  },
  {
    id: "s6-job-detail",
    part: "p6",
    title: "職種：希望がある",
    when: (_ctx, a) => choiceValueOf(a, "s6-job", "has") !== "まだ分からない・はっきりない",
    say: [
      "ありがとうございます。ほかにも、少しでも気になっている職種はありますか？",
      "",
      "逆に、これだけは避けたい、という職種はありますか？",
    ].join("\n"),
    inputs: [
      { key: "want", label: "やってみたい職種", type: "text", target: dm("desiredJobType1Memo"), format: (v) => `希望: ${v}` },
      { key: "other", label: "気になっている職種", type: "text", target: dm("desiredJobType1Memo"), format: (v) => `気になる: ${v}` },
      { key: "avoid", label: "避けたい職種", type: "text", target: dm("desiredJobType1Memo"), format: (v) => `避けたい: ${v}` },
    ],
    groups: [
      pickupGroup([
        ["経験を生かしたい", "これまでのご経験をそのまま生かせるので、選考でも強みになりますね。"],
        ["未経験の職種に挑戦したい", "新しいことに挑戦したいというお気持ち、素敵ですね。未経験から始めて活躍されている方もたくさんいらっしゃいますので、一緒に可能性を探していきましょう。"],
        ["避けたい職種がはっきりしている", "ありがとうございます。避けたいものがはっきりしていると、求人をぐっと絞りやすくなります。"],
      ]),
    ],
    targetsHint: "希望条件タブ「職種」のメモ欄（マスタからの選択は面談後に入力画面で）",
  },
  {
    id: "s6-job-direction",
    part: "p6",
    title: "職種：まだ分からない",
    when: (_ctx, a) => choiceValueOf(a, "s6-job", "has") === "まだ分からない・はっきりない",
    say: [
      "迷われている方も多いので、大丈夫ですよ。では、これまでのご経験を生かしていきたいですか？ それとも、まったく新しいことに挑戦してみたいですか？",
      "",
      "（提案するとき）例えば、〔経験〕を生かすなら、〔職種〕のようなお仕事もあります。〔理由〕ので、〔氏名〕様のご経験がそのまま強みになりますよ。",
      "",
      "逆に、これだけは避けたい、という職種はありますか？",
    ].join("\n"),
    groups: [
      {
        key: "dir",
        target: dm("desiredJobType1Memo"),
        buttons: [
          { label: "生かしたい", value: "方向: 経験を生かしたい" },
          { label: "挑戦したい", value: "方向: 新しいことに挑戦したい" },
          { label: "どちらとも言えない", value: "方向: どちらとも言えない（両方から提案）" },
        ],
      },
    ],
    inputs: [{ key: "avoid", label: "避けたい職種", type: "text", target: dm("desiredJobType1Memo"), format: (v) => `避けたい: ${v}` }],
    notes: ["職種の提案候補（職種提案パターン集）は T-206 の後に作り直す決まりのため、この版では出ない。〔経験〕〔職種〕〔理由〕は CA が口頭で補う。"],
    targetsHint: "希望条件タブ「職種」のメモ欄",
  },
  {
    id: "s6-industry",
    part: "p6",
    title: "業種",
    say: [
      "続いて、業界についてお伺いします。働いてみたい業界や、興味のある業界はありますか？",
      "",
      "（あるとき）ありがとうございます。その業界に興味を持たれたのは、どんなところからですか？",
      "",
      "逆に、この業界は避けたい、というものはありますか？",
    ].join("\n"),
    inputs: [
      { key: "want", label: "働いてみたい業界", type: "text", target: dm("desiredIndustry1Memo"), format: (v) => `希望: ${v}` },
      { key: "why", label: "興味を持ったきっかけ", type: "text", target: dm("desiredIndustry1Memo"), format: (v) => `きっかけ: ${v}` },
      { key: "avoid", label: "避けたい業界", type: "text", target: dm("desiredIndustry1Memo"), format: (v) => `避けたい: ${v}` },
    ],
    groups: [
      pickupGroup([
        ["今と同じ業界", "業界の知識がそのまま生かせるので、選考でも大きな強みになりますね。"],
        ["違う業界に挑戦したい", "新しい業界に挑戦したいというお気持ち、素敵ですね。業界が変わっても、これまでのご経験が生きる場面はたくさんありますので、一緒に探していきましょう。"],
        ["特にこだわらない", "承知しました。業界を限定しない分、選択肢が広がりますね。"],
        ["避けたい業界がはっきりしている", "ありがとうございます。避けたい業界が分かると、求人をぐっと絞りやすくなります。"],
      ]),
    ],
    targetsHint: "希望条件タブ「業種」のメモ欄",
  },
  {
    id: "s6-area",
    part: "p6",
    title: "勤務地",
    say: [
      "次に、勤務地についてお伺いします。お仕事をする場所は、どのあたりをご希望ですか？",
      "",
      "（東京・大阪のとき／車は聞かない）ご自宅の最寄り駅はどちらですか？ 通勤時間は、片道どれくらいまでなら大丈夫そうですか？",
      "",
      "（それ以外のとき／神奈川・埼玉・千葉などの周りの県も含む）通勤は、電車とお車、どちらをお考えですか？（電車なら）ご自宅の最寄り駅はどちらですか？ 通勤時間は、片道どれくらいまでなら大丈夫そうですか？",
      "",
      "（希望の地域が今の住まいから離れているとき）ちなみに、お引っ越しをしての転職もお考えですか？",
    ].join("\n"),
    inputs: [
      { key: "want", label: "希望の勤務地", type: "text", target: dm("desiredAreaMemo"), format: (v) => `希望: ${v}` },
      { key: "station", label: "最寄り駅", type: "text", target: dm("desiredAreaMemo"), format: (v) => `最寄り駅: ${v}` },
      { key: "time", label: "通勤時間（片道）", type: "text", placeholder: "例: 45分", target: dm("desiredAreaMemo"), format: (v) => `通勤時間: ${v}` },
      { key: "move", label: "引っ越しの可否", type: "text", target: dm("desiredAreaMemo"), format: (v) => `引っ越し: ${v}` },
    ],
    groups: [
      {
        key: "commute",
        label: "通勤手段",
        target: dm("desiredAreaMemo"),
        buttons: [
          { label: "電車", value: "通勤: 電車" },
          { label: "車", value: "通勤: 車", pickup: "お車だと、駅から離れた会社も候補に入るので、選択肢が広がりますね。" },
        ],
      },
      pickupGroup([
        ["通勤時間は短め", "毎日のことなので、通勤の負担は大事ですよね。近いところを中心に探していきましょう。"],
        ["通勤時間に余裕がある", "1時間ほど見ていただけると、選べる求人がかなり広がります。"],
        ["引っ越しも考えている", "住む場所から変えるのは、大きな決断ですよね。生活面も含めて、無理のない形で一緒に考えていきましょう。"],
      ]),
    ],
    targetsHint: "希望条件タブ「エリア」のメモ欄（マスタからの選択は面談後に入力画面で）",
  },
  {
    id: "s6-salary-current",
    part: "p6",
    title: "年収：現年収",
    say: [
      "まず、今（前）のお仕事の年収は、おいくらくらいですか？ 賞与は含まれていますか？",
      "",
      "（含まれている）賞与は年2回ですか？ 年間で、賞与はいくらくらいですか？",
      "（含まれていない）賞与はありますか？（あれば）年間でいくらくらいですか？",
      "",
      "（金額がそろったら）そうしますと、月給は控除前で〔月給〕万円くらいですね。手取りですと、月〔手取り〕万円くらいでしょうか？",
      "",
      "その金額には、残業代も含まれていますか？ 含まれている場合、月に何時間分くらいですか？ 交通費は含まない金額で、よろしいですか？",
    ].join("\n"),
    inputs: [
      { key: "annual", label: "現年収", type: "number", unit: "万円", target: d("currentSalary") },
      { key: "bonusTimes", label: "賞与の回数", type: "text", placeholder: "年2回", target: dm("currentSalaryMemo"), format: (v) => `賞与: ${v}` },
      { key: "bonusAnnual", label: "賞与の年額", type: "number", unit: "万円", target: dm("currentSalaryMemo"), format: (v) => `賞与年額: ${v}万円` },
      { key: "overtimePay", label: "残業代（含む場合は月何時間分）", type: "text", placeholder: "例: 含む・月20時間分", target: dm("currentSalaryMemo"), format: (v) => `残業代: ${v}` },
      { key: "transport", label: "交通費", type: "text", placeholder: "例: 含まない", target: dm("currentSalaryMemo"), format: (v) => `交通費: ${v}` },
    ],
    groups: [
      {
        key: "bonus",
        label: "年収に賞与は",
        target: dm("currentSalaryMemo"),
        buttons: [
          { label: "含まれている", value: "年収は賞与込み" },
          { label: "含まれていない", value: "年収は賞与別" },
        ],
      },
    ],
    calc: (sa) => {
      const bonus = sa.choices?.bonus;
      const r = calcSalary({
        annualMan: parseNumber(sa.inputs?.annual),
        bonusIncluded: bonus === "年収は賞与込み" ? true : bonus === "年収は賞与別" ? false : null,
        bonusAnnualMan: parseNumber(sa.inputs?.bonusAnnual),
      });
      if (r.monthlyMan == null || r.takeHomeMan == null) return [];
      return [`月給（控除前）: 約${formatMan(r.monthlyMan)}万円`, `手取りの目安: 約${formatMan(r.takeHomeMan)}万円（月給×0.8。扶養の人数や地域で変わる）`];
    },
    targetsHint: "希望条件タブ「現年収」とそのメモ",
  },
  {
    id: "s6-salary-desired",
    part: "p6",
    title: "年収：希望年収と理想の金額",
    say: [
      "続けて、希望の年収についてです。最低でも、年収でいくらくらいはご希望ですか？ 月の手取りで、これくらいはほしい、という金額はありますか？",
      "",
      "（最低ラインが今の年収より大きく高いとき）ありがとうございます。差し支えない範囲で、その金額を大事にしたい理由を教えていただけますか？",
      "",
      "最後に、これだけもらえたら嬉しい、という金額を、年収と月給で教えていただけますか？",
    ].join("\n"),
    inputs: [
      { key: "min", label: "最低の希望年収", type: "number", unit: "万円", target: d("desiredSalaryMin") },
      { key: "minMonthly", label: "希望の月手取り", type: "text", placeholder: "例: 25万円", target: dm("desiredSalaryMinMemo"), format: (v) => `月手取り: ${v}` },
      { key: "reason", label: "その金額を大事にしたい理由", type: "text", target: dm("desiredSalaryMinMemo"), format: (v) => `理由: ${v}` },
      { key: "ideal", label: "理想の年収", type: "number", unit: "万円", target: d("desiredSalaryMax") },
      { key: "idealMonthly", label: "理想の月給", type: "text", placeholder: "例: 30万円", target: dm("desiredSalaryMaxMemo"), format: (v) => `理想の月給: ${v}` },
    ],
    groups: [
      pickupGroup([
        ["今と同じくらいでよい", "ありがとうございます。今の水準を保てる求人を中心に探していきますね。"],
        ["上げたい", "年収アップを目指して転職される方はとても多いです。ご経験がしっかり評価される求人を、一緒に探していきましょう。"],
        ["下がってもよい", "ありがとうございます。条件に幅を持たせていただけると、選べる求人がかなり広がります。"],
      ]),
    ],
    targetsHint: "希望条件タブ「希望下限」「希望年収」とそのメモ",
  },
  {
    id: "s6-holiday",
    part: "p6",
    title: "休日",
    say: [
      "お休みは、土日祝やシフト制など、ご希望はありますか？",
      "",
      "（土日祝）カレンダー通りの働き方のイメージで、よろしいですね。その場合、年間休日は120日〜125日くらいになります。",
      "（シフト制・平日休みでもよい）平日のお休みでも大丈夫、ということですね。年間のお休みは、何日くらいあると安心ですか？",
    ].join("\n"),
    groups: [
      {
        key: "dayoff",
        target: d("desiredDayOff"),
        buttons: [
          { label: "土日祝休み", pickup: PICK.dayOffWeekend },
          { label: "完全週休2日", pickup: PICK.dayOffTwo },
          { label: "シフト制（平日休みでもよい）", value: "シフト制", pickup: PICK.dayOffShift },
          { label: "曜日問わず（こだわらない）", value: "曜日問わず", pickup: PICK.dayOffAny },
        ],
      },
    ],
    inputs: [{ key: "days", label: "年間休日（何日あると安心か）", type: "text", placeholder: "例: 110日", target: d("desiredHolidayCount") }],
    targetsHint: "希望条件タブ「希望休日」「年間休日」",
  },
  {
    id: "s6-overtime",
    part: "p6",
    title: "残業・固定残業代",
    say: [
      "残業は、少なければ少ないに越したことはないと思いますが、月何時間、または1日何時間など、ご希望はありますか？",
      "",
      "（1日で答えたとき）それでは、月〔月の時間〕時間くらい、という形ですね。",
      "（月で答えたとき）1日〔1日の時間〕時間くらい、ですね。",
      "",
      "求人の中には、固定残業代が付いているものもありますが、そういった求人でもご紹介は可能ですか？",
      "",
      "（分からなそう・気にしていそうなとき）固定残業代は、残業をしてもしなくても、毎月決まった金額が支払われるものです。記載されている時間分、必ず残業があるわけではありません。実際の平均残業は、記載の時間より12時間ほど少ないくらいのイメージを持っていただければと思います。また、記載の時間を超えた分は、別途支払われます。",
    ].join("\n"),
    inputs: [
      { key: "month", label: "月の残業時間", type: "number", unit: "時間", target: dm("desiredOvertimeMemo"), format: (v) => `月${v}時間まで` },
      { key: "day", label: "1日の残業時間", type: "number", unit: "時間", target: dm("desiredOvertimeMemo"), format: (v) => `1日${v}時間まで` },
    ],
    groups: [
      {
        key: "fixed",
        label: "固定残業代の求人",
        buttons: [
          { label: "可能", writes: [{ target: dm("desiredOvertimeMemo"), value: "固定残業代: 可" }] },
          { label: "紹介不可", writes: [{ target: ws("固定残業NG"), value: "1" }] },
        ],
      },
      pickupGroup([
        ["少なめがいい", "ご自分の時間も大切にしたいですよね。残業の少ない求人を中心に見ていきますね。"],
        ["多少あっても大丈夫", "ありがとうございます。多少の残業を許容していただけると、選べる求人が広がります。"],
        ["稼ぎたいので多くてもよい", "しっかり稼ぎたいというお気持ち、分かります。残業代がきちんと出る会社かどうかも、一緒に確認していきましょう。"],
      ]),
    ],
    calc: (sa) => {
      const month = parseNumber(sa.inputs?.month);
      const day = parseNumber(sa.inputs?.day);
      const lines: string[] = [];
      let monthHours: number | null = null;
      if (month != null) {
        monthHours = month;
        lines.push(`1日あたり: 約${formatHours(overtimeMonthToDay(month))}時間（÷20日）`);
      } else if (day != null) {
        monthHours = overtimeDayToMonth(day);
        lines.push(`月あたり: 約${formatHours(monthHours)}時間（×20日）`);
      }
      const opt = overtimeOptionFor(monthHours);
      if (opt) lines.push(`希望残業の選択肢: ${opt}`);
      return lines;
    },
    targetsHint: "希望条件タブ「希望残業」（数字から自動で選ぶ）・メモ・働き方「固定残業NG」",
  },
  {
    id: "s6-transfer",
    part: "p6",
    title: "転勤",
    say: [
      "（事務希望のとき）事務のお仕事の場合、転勤はほとんどありませんが、念のためお伺いしています。転勤がある会社でも大丈夫そうですか？",
      "",
      "（事務以外のとき）転勤については、いかがですか？ 全国どこでも大丈夫、エリアを限れば大丈夫、引っ越しを伴わない通える範囲の異動なら大丈夫、転勤は難しい、のどれに近いですか？",
      "",
      "（エリア限定ならOK）どのあたりのエリアまでなら大丈夫ですか？",
      "（通える範囲ならOK・難しい）今すぐは難しくても、将来キャリアアップにつながる転勤であれば、前向きに考えられそうですか？",
    ].join("\n"),
    groups: [
      {
        key: "mode",
        label: "聞き方",
        buttons: [{ label: "事務希望" }, { label: "事務以外" }],
      },
      {
        key: "office",
        label: "事務希望のとき",
        target: d("desiredTransfer"),
        showIf: (sa) => sa.choices?.mode === "事務希望",
        buttons: [
          { label: "大丈夫", value: "可", pickup: "ありがとうございます。転勤ありの求人も含めると、大手企業なども候補に入り、選べる会社がかなり広がります。" },
          { label: "難しい", value: "なし", pickup: "承知しました。転勤のない求人に絞ってご案内しますね。" },
        ],
      },
      {
        key: "general",
        label: "事務以外のとき",
        target: d("desiredTransfer"),
        showIf: (sa) => sa.choices?.mode !== "事務希望",
        buttons: TRANSFER_BUTTONS.map((b) => ({
          label: b.label,
          value: b.value,
          pickup: b.pickup,
          writes: b.memo ? [{ target: dm("desiredTransferMemo"), value: b.memo }] : undefined,
        })),
      },
      {
        key: "future",
        label: "将来の転勤",
        target: dm("desiredTransferMemo"),
        showIf: (sa) => sa.choices?.general === "通える範囲ならOK" || sa.choices?.general === "難しい",
        buttons: [
          { label: "将来ならOK", value: "将来キャリアアップにつながる転勤なら前向き" },
          { label: "将来も難しい", value: "将来も転勤は難しい" },
        ],
      },
    ],
    inputs: [
      { key: "area", label: "大丈夫なエリア", type: "text", target: dm("desiredTransferMemo"), format: (v) => `転勤OKのエリア: ${v}`, showIf: (sa) => sa.choices?.general === "エリア限定ならOK" },
    ],
    targetsHint: "希望条件タブ「転勤有無」とそのメモ",
  },
  {
    id: "s6-skill-license",
    part: "p6",
    title: "スキル：自動車免許",
    say: [
      "次に、スキルについて確認させてください。",
      "",
      "普通自動車の免許はお持ちですか？",
      "",
      "（持っているとき）普段、運転はされていますか？",
    ].join("\n"),
    groups: [
      {
        key: "license",
        target: d("driverLicenseFlag"),
        buttons: [
          { label: "取得(AT限定)" },
          { label: "取得（MT）", value: "取得" },
          { label: "未取得（持っていない）", value: "未取得" },
          { label: "取得予定" },
        ],
      },
      {
        key: "drive",
        label: "運転の頻度",
        target: dm("driverLicenseMemo"),
        showIf: (sa) => sa.choices?.license === "取得(AT限定)" || sa.choices?.license === "取得（MT）",
        buttons: [
          { label: "日常的に運転する", pickup: "運転ができると、営業などの求人も候補に入りますね。" },
          { label: "ペーパードライバー" },
        ],
      },
    ],
    targetsHint: "希望条件タブ「自動車免許」とそのメモ",
  },
  {
    id: "s6-skill-optional",
    part: "p6",
    title: "スキル：語学・日本語・タイピング（任意）",
    skippable: true,
    say: [
      "（語学）英語など、お仕事で使える語学はありますか？",
      "",
      "（日本語が母語でない方のときだけ）日本語のレベルを確認する。",
      "",
      "（タイピング）文字の入力は、手元を見ずに打てますか？",
    ].join("\n"),
    groups: [
      {
        key: "lang",
        label: "語学",
        target: d("languageSkillFlag"),
        buttons: [
          { label: "不可（なし）", value: "不可" },
          { label: "日常会話" },
          { label: "ビジネス（ビジネスで使える）", value: "ビジネス", pickup: "英語が使えると、求人の幅がぐっと広がりますね。" },
          { label: "ネイティブ", pickup: "英語が使えると、求人の幅がぐっと広がりますね。" },
        ],
      },
      {
        key: "japanese",
        label: "日本語（母語でない方のみ）",
        target: d("japaneseSkillFlag"),
        buttons: [{ label: "ネイティブ" }, { label: "ビジネス" }, { label: "日常会話" }],
      },
      {
        key: "typing",
        label: "タイピング",
        target: d("typingFlag"),
        buttons: [
          { label: "ブラインドタッチ可（見ずに打てる）", value: "ブラインドタッチ可" },
          { label: "中級（見ながらなら打てる）", value: "中級" },
          { label: "初級（苦手）", value: "初級" },
        ],
      },
    ],
    inputs: [{ key: "langMemo", label: "何語か・資格名・点数", type: "text", placeholder: "例: 英語 TOEIC 700", target: dm("languageSkillMemo") }],
    targetsHint: "希望条件タブ「語学」「日本語」「Typing」",
  },
  {
    id: "s6-skill-pc",
    part: "p6",
    title: "スキル：パソコン（必ず聞く）",
    say: [
      "パソコンについてお伺いします。Excelは、どのくらい使えますか？ 特に、関数はどのあたりまで使えるか教えてください。例えば、合計を出すSUMや、表から探して取り出すVLOOKUPなどです。",
      "",
      "WordとPowerPointは、基本的な操作であれば問題ないでしょうか？",
    ].join("\n"),
    groups: [
      {
        key: "excel",
        label: "Excel",
        target: d("excelFlag"),
        buttons: [
          { label: "不可（ほぼ使わない）", value: "不可" },
          { label: "初級（入力だけ・SUMなど簡単な計算）", value: "初級" },
          { label: "中級（VLOOKUP・IFも使える）", value: "中級" },
          { label: "上級（ピボットテーブルも使える）", value: "上級" },
        ],
      },
      {
        key: "wordppt",
        label: "Word・PowerPoint",
        buttons: WORD_PPT_BUTTONS.map((b) => ({
          label: b.label,
          target: d("wordFlag"),
          value: b.word,
          writes: [{ target: d("pptFlag"), value: b.ppt }],
        })),
      },
      pickupGroup([
        ["パソコンが得意", "事務のお仕事でも十分に通用するスキルですね。書類でもしっかりアピールしていきましょう。"],
        ["パソコンが苦手", "大丈夫ですよ。入社してから覚えられる会社も多いですし、必要であれば事前に練習する方法もお伝えできます。"],
      ]),
    ],
    notes: [
      "VLOOKUP：表の中から、探したい情報を取り出す関数",
      "IF：条件によって、表示を変える関数",
      "ピボットテーブル：大量のデータを、集計表にまとめる機能",
    ],
    targetsHint: "希望条件タブ「Excel」「Word」「PPT」",
  },
  {
    id: "s6-workstyle",
    part: "p6",
    title: "働き方（任意）",
    skippable: true,
    say: "次の項目は、任意でお伺いします。働き方や会社について、こだわりたいことはありますか？ 必須の条件にしてしまうと、求人がかなり絞られてしまうので、「あればなお良い」という観点でお伺いしています。例えば、リモートワークやフレックス、退職金や住宅手当などです。",
    groups: [
      {
        key: "ws",
        label: "複数選択（特になしは何もチェックしない）",
        multi: true,
        buttons: [
          ...["フルリモート", "ハイブリッド", "フレックス勤務", "上場企業", "スタートアップ", "住宅手当", "退職金制度", "賞与必須", "固定残業NG", "海外勤務・出張あり", "海外常駐希望", "英語を使う仕事"]
            .filter((item) => WORK_STYLE_OPTIONS.includes(item))
            .map((item) => ({ label: item, target: ws(item) })),
          { label: "特になし", pickup: "ありがとうございます。こだわりが少ない分、幅広くご提案できます。" },
        ],
      },
      pickupGroup([
        ["リモートを希望", "リモートワークの求人は人気が高いので、見つけたら早めにご案内しますね。"],
        ["制度を重視", "長く安心して働ける環境を、大事にされたいんですね。制度面もしっかり確認しながら探していきます。"],
      ]),
    ],
    notes: ["残業のところで［紹介不可］を押していた場合は「固定残業NG」を必須の条件として自動でチェック済み。"],
    targetsHint: "希望条件タブ「働き方」のチェック",
  },
  {
    id: "s6-priority",
    part: "p6",
    title: "希望条件の締め：大事にしたい条件",
    say: "ここまでお伺いした条件の中で、特に大事にしたいものを3つ挙げるとしたら、どれになりますか？",
    inputs: [
      { key: "c1", label: "1つ目", type: "text", target: d("priorityCondition1") },
      { key: "c2", label: "2つ目", type: "text", target: d("priorityCondition2") },
      { key: "c3", label: "3つ目", type: "text", target: d("priorityCondition3") },
    ],
    targetsHint: "希望条件タブの最後「大事にしたい条件」",
  },

  /* ===== 7. 今後の流れ・クロージング ===== */
  {
    id: "s7-questions",
    part: "p7",
    title: "質問の確認",
    say: [
      "最後に、今後の流れについてご説明させていただいて終了となりますが、現時点で何かご質問や、ほかにお伝えしておきたい条件などはございますか？",
      "",
      "（質問ありで、その場で答えられないとき）確認して、改めてご連絡いたしますね。",
    ].join("\n"),
    groups: [{ key: "q", buttons: [{ label: "質問あり" }, { label: "なし" }] }],
  },
  {
    id: "s7-contact",
    part: "p7",
    title: "連絡方法（ボタンから案内メールを送る）",
    kind: "contact",
    say: [
      "ありがとうございます。それでは最後に、今後の流れについてご説明いたします。",
      "",
      "まず、連絡方法についてですが、LINEとメールでご選択いただいておりまして、〔氏名〕様は普段どちらの方が連絡とりやすいですか？",
      "",
      "{{if:line}}ありがとうございます。では、LINEのご登録のご案内を、今メールでお送りしますね。ご登録いただいているメールアドレスは、{{if:emailHead}}〔頭の文字〕から始まるアドレス{{else}}ご登録のアドレス{{/if}}でお間違いないでしょうか？",
      "",
      "（確認できたら、LINE登録案内の確認画面から［送信］）今お送りしましたので、届きましたら教えていただけますか？ 本文にあるURL、またはQRコードから、友だち追加をお願いします。",
      "",
      "（追加されたら）確認のメッセージを1通お送りしますね。……届きましたでしょうか？ ありがとうございます。今後のご連絡は、こちらのLINEで直接やり取りさせていただきます。{{/if}}",
      "{{if:mail}}承知しました。ご登録いただいているメールアドレスは、{{if:emailHead}}〔頭の文字〕から始まるアドレス{{else}}ご登録のアドレス{{/if}}でお間違いないでしょうか？",
      "",
      "（確認できたら、あいさつメールの確認画面から［送信］）今、ご挨拶のメールをお送りしましたので、届いているかご確認いただけますか？ 今後のご連絡は、こちらのアドレスからお送りいたします。{{/if}}",
      "",
      "（メールアドレスが違うと言われたとき）大変失礼いたしました。正しいアドレスを教えていただけますか？（聞いたアドレスに直してから送る）",
    ].join("\n"),
    groups: [
      {
        key: "method",
        target: d("contactMethod"),
        buttons: [{ label: "LINE" }, { label: "メール" }],
      },
    ],
    targetsHint: "連絡手段（アクションタブ）。［LINE］［メール］で案内メールの確認画面が開く",
  },
  {
    id: "s7-next",
    part: "p7",
    title: "次回面談",
    say: [
      "次回のご面談では、〔内容〕をさせていただければと思います。〔時期の目安〕で、ご都合の良い日にちとお時間はございますか？",
      "",
      "次回は、お電話とオンライン、どちらがよろしいですか？ オンラインであれば、資料を画面に映しながらご説明が可能です。カメラはオフにしていただいても問題ございません。",
      "",
      "（電話）承知しました。当日は資料をお送りいたしますので、資料を見ながらお話しさせてください。",
      "（オンライン）承知しました。それでは、後ほどURLを発行してお送りさせていただきます。",
      "",
      "ありがとうございます。では、〔日時〕に〔電話／オンライン〕でお願いいたします。詳細は、この後〔LINE／メール〕でお送りしますね。",
    ].join("\n"),
    inputs: [
      { key: "date", label: "次回の日付", type: "date", target: d("nextInterviewDate") },
      { key: "time", label: "次回の時刻", type: "time", target: d("nextInterviewTime") },
    ],
    groups: [
      {
        key: "tool",
        label: "次回の手法",
        target: dm("nextInterviewMemo"),
        buttons: [
          { label: "電話", value: "次回: 電話" },
          { label: "オンライン", value: "次回: オンライン" },
        ],
      },
    ],
    calc: (_sa, _ctx, a) => {
      const g = nextInterviewGuide(timelineOf(a), hasSelectionOf(a));
      return [`次回の内容: ${g.content}`, `時期の目安: ${g.timing}`];
    },
    targetsHint: "次回面談（日時を入れたら「設定済」）・次回面談メモ",
  },
  {
    id: "s7-docs",
    part: "p7",
    title: "応募書類・Googleフォーム・証明写真",
    say: [
      "{{if:docsNone}}続いて、応募書類についてです。履歴書と職務経歴書は、こちらでたたき台をお作りすることもできますが、お作りしてもよろしいですか？{{else}}続いて、応募書類についてです。今お持ちの履歴書と職務経歴書を、〔LINE／メール〕でお送りいただけますか？ PDFでもWordでも、形式は何でも大丈夫です。内容を確認して、ブラッシュアップしておきますね。{{/if}}",
      "",
      "（こちらで作るとき）ありがとうございます。書類をお作りするにあたって、ご経歴の詳しい内容など、マイナビの登録情報だけでは足りない部分を追加でお伺いしたいので、アンケートのような形でGoogleフォームを後ほど〔LINE／メール〕でお送りします。10分ほどで入力できますので、次回のご面談までにご入力をお願いいたします。",
      "",
      "あわせて、証明写真のデータもお願いできますか？ ご自宅でスマホで撮っていただいたもので大丈夫です。背景を青くしたり、スーツのところを整えたりと、こちらで証明写真のように綺麗に仕上げますので、わざわざお金をかけて写真機で撮っていただかなくても大丈夫です。",
      "",
      "髪の毛を少しまとめていただいて、スーツを着て撮ってください。撮るときは、スマホを手で持つと肩が上がってしまうので、どこかに置いてセルフタイマーで撮っていただくのがおすすめです。背景は何でも大丈夫です。",
    ].join("\n"),
  },
  {
    id: "s7-jobs",
    part: "p7",
    title: "求人の送り方",
    say: [
      "最後になりますが、求人のご案内の方法についてです。求人のご案内は、専用のURLを発行して、マイページという形でお送りしています。私の方で検索したおすすめの求人をマイページにお載せしますので、気になる求人があれば、ぜひ積極的に「気になる」ボタンを押してください。",
      "",
      "押したら必ず応募していただく、ということではありません。「気になる」を付けていただけると、追加の求人を探すときの大きな参考になりますので、お気軽に押していただければと思います。",
      "",
      "また、マイページでは、非公開求人も含めて10万件ほどの求人から、ご自身で検索することもできますので、普通の求人サイトとしてもお使いいただけます。どれを見ればいいか分からない、ということもあると思いますので、私の方でも随時検索をかけて、新しい求人をお送りしていきます。",
      "",
      "すぐに応募先を決めきれなくても大丈夫です。次回のご面談の前に求人をお送りしますので、軽く目を通しておいていただければと思います。",
    ].join("\n"),
  },
  {
    id: "s7-schedule",
    part: "p7",
    title: "スケジュールの見通し",
    say: [
      "{{if:hurry}}今後のスケジュールとしては、次回のご面談で応募前の準備を一緒に進めて、良い求人があれば、そこから応募を進めていきます。早ければ〔内定の目安〕頃に内定、〔入社の目安〕頃のご入社を目指していく形になります。{{else}}今後のスケジュールとしては、ご希望の〔転職時期〕のご入社に向けて逆算しながら、焦らずじっくり進めていきましょう。{{/if}}",
    ].join("\n"),
    calc: (_sa, ctx, a) => {
      const employed = employedOf(a, ctx);
      const o = scheduleOutlook({
        nextInterviewDate: nextInterviewDateOf(a, ctx),
        employed: employed !== false,
        retireMonths: retireMonthsOf(a),
      });
      return [`内定の目安: ${o.offerLabel}（次回面談の1〜2ヶ月後）`, `入社の目安: ${o.joinLabel}`];
    },
  },
  {
    id: "s7-closing",
    part: "p7",
    title: "締め",
    say: [
      "ご案内は以上になりますが、ご質問は大丈夫そうですか？",
      "",
      "（答えを聞いて）何か分からないことがあれば、いつでも〔LINE／メール〕でご連絡ください。本日はお時間をいただき、ありがとうございました。引き続き、よろしくお願いいたします。",
    ].join("\n"),
    notes: [
      "面談のあとにやること: 次回の日時の詳細を LINE かメールで送る／次回の面談日をカレンダーに入れる／面談記録を保存する",
    ],
  },
];

/** derivedWrites が入れることのある欄（押し直しで消すときの対象を静的に知るため） */
export const DERIVED_TARGETS: Record<string, FieldTarget[]> = {
  "s6-overtime": [d("desiredOvertimeMax")],
  "s7-next": [d("nextInterviewFlag")],
};

/** 場面から入る「自動で決まる書き込み」（入力の数字から選択肢を選ぶ・日時を入れたら「設定済」） */
export function derivedWrites(scene: ScriptScene, sa: SceneAnswer): ScriptWrite[] {
  if (scene.id === "s6-overtime") {
    const month = parseNumber(sa.inputs?.month);
    const day = parseNumber(sa.inputs?.day);
    const monthHours = month != null ? month : day != null ? overtimeDayToMonth(day) : null;
    const opt = overtimeOptionFor(monthHours);
    return opt ? [{ target: d("desiredOvertimeMax"), value: opt }] : [];
  }
  if (scene.id === "s7-next") {
    return sa.inputs?.date ? [{ target: d("nextInterviewFlag"), value: "設定済" }] : [];
  }
  return [];
}
