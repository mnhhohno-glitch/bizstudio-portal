/**
 * T-205 step8: 面談準備の整理（決まった項目）の AI を呼ばない確認。DB も使わない。
 *
 *   npx tsx scripts/verify/interview-prep-summary-format-check.ts
 *
 * 確かめること:
 *   1. 見本の summary_json（架空の人物）が normalizePrepSummary の検証に通る
 *   2. 形が違う入力（必須項目なし・選択肢外・questions 0件）が null になる
 *   3. formatPrepSummaryText を2回実行して同じ結果になる（決定的処理・罠#39）
 *   4. toggleAskedQuestion で「聞いた」の保存と取り消しができる（範囲外は変えない）
 *   5. normalizeAskedQuestions が形の違うものを捨てる
 * 出力は OK / NG と数値だけ。
 */
import {
  careerTypeForRoom,
  formatPrepSummaryText,
  normalizeAskedQuestions,
  normalizePrepSummary,
  toggleAskedQuestion,
} from "@/lib/interview-prep/summary-format";

let failed = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`${ok ? "OK" : "NG"}: ${label}${extra ? ` ${extra}` : ""}`);
  if (!ok) failed++;
}

const sample = {
  summary: "県立の商業高校を卒業し、地元の食品卸の会社に正社員として就職。倉庫での入出荷と配送の仕事を7年続けてきた人（調べた情報）。",
  employmentStatus: "在職中",
  age: "26歳",
  currentIncome: "320万円",
  qualifications: ["普通自動車免許", "フォークリフト運転技能講習"],
  careerType: "一社継続型",
  careerTypeReason: "1社のみ・在籍7年5ヶ月",
  timeline: [
    { period: "2019年3月", title: "架空商業高校 卒業", detail: "商業科。簿記や情報処理など、会社の事務の基礎を学ぶ学科。", fromResearch: false },
    { period: "2019年4月〜現在（7年5ヶ月）", title: "架空食品卸株式会社 正社員", detail: "スーパー向けに冷凍食品を卸す会社。従業員約120名（調べた情報）。", fromResearch: true },
  ],
  works: [
    {
      company: "架空食品卸株式会社",
      items: [
        { term: "入出荷業務（1日約200ケース）", meaning: "届いた商品を受け取って棚に入れ、注文があった商品を出す仕事。" },
        { term: "ルート配送", meaning: "決まった取引先を順番に回って商品を届ける仕事。" },
      ],
    },
  ],
  questions: [
    { question: "職歴では2019年入社ですが、自己PRには『8年間』とあります。どちらが正しいですか？", why: "在籍年数の記載が食い違っている", reveals: "正確な経験年数", mismatch: true },
    { question: "入出荷では、何人のチームでどんな役割でしたか？", why: "担当の範囲が書かれていない", reveals: "任された範囲と役割", mismatch: false },
    { question: "配送では1日何件くらい回っていましたか？", why: "仕事の量を具体化する", reveals: "業務量と時間管理", mismatch: false },
    { question: "フォークリフトは日常的に使っていましたか？", why: "資格と実務のつながりを確かめる", reveals: "資格が実務で使えるか", mismatch: false },
  ],
  strengths: [
    { strength: "決まった量の作業を長く続けられる", basis: "同じ会社で入出荷を7年間担当", fromSelfPr: false },
    { strength: "明るく人と接するのが得意", basis: "自己PRの『人と話すことが好き』", fromSelfPr: true },
  ],
  glossary: [
    { term: "ピッキング", meaning: "注文書を見て、倉庫から該当する商品を集めること。" },
    { term: "検品", meaning: "商品の数や状態が注文どおりか確かめること。" },
    { term: "ルート配送", meaning: "毎回ほぼ同じ取引先を回る配送。" },
  ],
};

// 1. 検証に通る
const normalized = normalizePrepSummary(sample);
check("sample passes validation", normalized !== null);
if (normalized) {
  check(
    "counts",
    normalized.timeline.length === 2 && normalized.works.length === 1 && normalized.questions.length === 4 && normalized.strengths.length === 2 && normalized.glossary.length === 3,
    `timeline=${normalized.timeline.length} works=${normalized.works.length} questions=${normalized.questions.length} strengths=${normalized.strengths.length} glossary=${normalized.glossary.length}`,
  );
  check("first question is mismatch", normalized.questions[0].mismatch === true);
  check("career type for room", careerTypeForRoom(normalized) === "一社継続型");
  check("careerType 判定できない -> null", careerTypeForRoom({ ...normalized, careerType: "判定できない" }) === null);

  // 3. 決定的
  const t1 = formatPrepSummaryText(normalized);
  const t2 = formatPrepSummaryText(normalizePrepSummary(JSON.parse(JSON.stringify(sample)))!);
  check("format is deterministic (2 runs identical)", t1 === t2, `chars=${t1.length}`);
  check("format has 8 headings", (t1.match(/^### /gm) ?? []).length === 8);
  check("format has no URL", !/https?:\/\//.test(t1));
}

// 2. 形が違う入力
check("missing summary -> null", normalizePrepSummary({ ...sample, summary: "" }) === null);
check("bad employmentStatus -> null", normalizePrepSummary({ ...sample, employmentStatus: "働いている" }) === null);
check("bad careerType -> null", normalizePrepSummary({ ...sample, careerType: "転職型" }) === null);
check("no questions -> null", normalizePrepSummary({ ...sample, questions: [] }) === null);
check("question without text -> null", normalizePrepSummary({ ...sample, questions: [{ question: "", why: "a", reveals: "b", mismatch: false }] }) === null);
check("non-object -> null", normalizePrepSummary("text") === null);
check("timeline missing fromResearch defaults false", normalizePrepSummary({ ...sample, timeline: [{ period: "", title: "x", detail: "" }] })?.timeline[0].fromResearch === false);
check("strengths capped at 3", (normalizePrepSummary({ ...sample, strengths: [...sample.strengths, ...sample.strengths] })?.strengths.length ?? 0) === 3);

// 4. 聞いたの保存と取り消し
const now = new Date("2026-09-28T04:00:00.000Z");
const a1 = toggleAskedQuestion({}, 0, true, "user-1", now, 4);
check("asked: mark index 0", a1["0"]?.userId === "user-1" && a1["0"]?.askedAt === now.toISOString());
const a2 = toggleAskedQuestion(a1, 2, true, "user-1", now, 4);
check("asked: mark index 2 keeps index 0", Object.keys(a2).length === 2 && !!a2["0"] && !!a2["2"]);
const a3 = toggleAskedQuestion(a2, 0, false, "user-1", now, 4);
check("asked: unmark index 0", Object.keys(a3).length === 1 && !a3["0"] && !!a3["2"]);
const a4 = toggleAskedQuestion(a3, 9, true, "user-1", now, 4);
check("asked: out of range unchanged", a4 === a3);
check("asked: previous object not mutated", Object.keys(a1).length === 1);

// 5. 形の違うものを捨てる
const na = normalizeAskedQuestions({ "0": { askedAt: "2026-09-28T04:00:00.000Z", userId: "u" }, x: { askedAt: 1 }, "1": "bad", "2": { askedAt: "t" } });
check("normalizeAskedQuestions keeps only valid entries", Object.keys(na).length === 1 && !!na["0"]);
check("normalizeAskedQuestions null -> {}", Object.keys(normalizeAskedQuestions(null)).length === 0);

console.log(failed === 0 ? "ALL OK" : `FAILED: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
