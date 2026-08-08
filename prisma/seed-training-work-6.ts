// 記述式ワーク⑥（求職者に伝える言葉を書く）の定義（TrainingWorkSet 1件）と設問（TrainingWorkItem 5件）を投入する
// 実行: npx tsx prisma/seed-training-work-6.ts
// workKey / [workKey, itemCode] で upsert するため再実行しても重複しない。
// 既存のワーク⓪〜⑤と TrainingWorkAnswer には一切触れない
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const WORK_KEY = "work6-tsutaeru-kotoba";

// 既存ワーク。この seed から触れてはいけない
const PROTECTED_WORK_KEYS = [
  "work0-shokushu-gyoshu",
  "work1-eigyo-3jiku",
  "work2-jimu-bunrui",
  "work3-gyoshu-bunrui",
  "work4-challenge-senbiki",
  "work5-sougou-enshu",
];

type FieldLabel = { key: string; label: string; placeholder: string; rows: number };

const FIELD_LABELS: FieldLabel[] = [
  {
    key: "answerCompany",
    label: "① 求職者に言う言葉（そのまま話せる文章で書く）",
    placeholder: "例：「〇〇さん、ひとつ確認させてください。…」",
    rows: 6,
  },
  {
    key: "answerHelp",
    label: "② なぜその言い方にしたか",
    placeholder: "1〜2行で",
    rows: 3,
  },
];

const DESCRIPTION = [
  "面談で、実際にその場で口に出す言葉を書いてください。",
  "「〜を説明する」「〜を伝える」ではなく、話し言葉でそのまま書きます。",
  "",
  "書いたあとに、必ず声に出して読んでください。",
  "書けても言えないことがあります。読んでみて言いにくければ、書き直してください。",
  "",
  "正解はありません。ただし「専門用語を使わず、その人の生活のイメージに翻訳できているか」を見ます。",
].join("\n");

type Item = { itemCode: string; title: string; jobContent: string };

// jobContent は「／」区切りで記述し、投入時に改行へ変換する（下の toLines を参照）
const ITEMS: Item[] = [
  {
    itemCode: "S-01",
    title: "「営業は苦手です」と言われた",
    jobContent:
      "【場面】初回面談。26歳・接客経験5年の求職者。希望職種を聞いたところ「事務職がいいです。営業は苦手なので」と言われました。／【あなたの状況】この方の経験を考えると、来店型の営業やルート営業なら十分に活躍できそうだと感じています。ただし本人は営業という言葉だけで拒否しています。／【書くこと】この直後に、あなたが実際に口に出す言葉を書いてください。",
  },
  {
    itemCode: "S-02",
    title: "「事務職を希望します」と言われた",
    jobContent:
      "【場面】初回面談。27歳・販売経験4年の求職者。「事務職を希望します」とだけ言われました。どの事務かは本人も決めていません。／【あなたの状況】事務には5種類あり、どれを希望するかで提案する求人がまったく変わります。ただし本人は5種類あることを知りません。／【書くこと】この直後に、あなたが実際に口に出す言葉を書いてください。専門用語は使わないこと。",
  },
  {
    itemCode: "S-03",
    title: "想定年収が高く見える求人を説明する",
    jobContent:
      "【場面】求人提案の場面。求職者は求人票を見て「年収552万まで行くんですね」と喜んでいます。／【求人の中身】想定年収 350万〜552万／月給238,000円（基本給170,000円＋固定残業手当68,000円・月35時間分）／年間休日122日／【あなたの状況】この方は「残業は月20時間くらいまでにしたい」と面談で話していました。／【書くこと】この求人を否定するのではなく、事実を正しく伝えて本人に選んでもらうための言葉を書いてください。",
  },
  {
    itemCode: "S-04",
    title: "必須条件がグレーな求人を出す",
    jobContent:
      "【場面】求人提案の場面。26歳・接客経験6年・事務職希望の求職者。Excelは表への入力のみで関数は使えません。／【求人の中身】営業事務／必須条件は「ExcelやWordを使用できる方」／歓迎要件に「営業事務の経験をお持ちの方」／【あなたの判断】必須は満たすと判断してよいが、企業が本当に欲しいのは経験者。通過率は下がる。それでも狙う価値はある。／【書くこと】この求人を出すときに、求職者へ実際に伝える言葉を書いてください。",
  },
  {
    itemCode: "S-05",
    title: "免許の有無を確認する連絡を書く",
    jobContent:
      "【場面】面談から3日後。良い求人を見つけたが、必須条件に「普通自動車第一種運転免許（AT限定可）」とあり、面談で免許の有無を聞いていませんでした。／【求職者】25歳・工場のライン作業3年→引越作業スタッフ2年。体力仕事から離れたいと希望。／【求人の中身】食品メーカーのルート営業／新規開拓なし・ノルマなし／年間休日120日・土日祝休み／【書くこと】この方へ送る連絡文を書いてください（LINEやメールで送る想定）。",
  },
];

/**
 * 「／」を改行に変換する。ただし全角カッコの内側の「／」はそのまま残す。
 * （カッコ内の補足を改行で分断すると読めなくなるため。ワーク⑤の seed と同じ扱い）
 */
function toLines(text: string): string {
  let depth = 0;
  let out = "";
  for (const ch of text) {
    if (ch === "（") depth++;
    else if (ch === "）") depth = Math.max(0, depth - 1);
    if (ch === "／" && depth === 0) {
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

async function main() {
  if (PROTECTED_WORK_KEYS.includes(WORK_KEY)) {
    throw new Error(`この seed で既存ワーク ${WORK_KEY} を触ってはいけません`);
  }

  const beforeAnswers = await prisma.trainingWorkAnswer.count();
  const beforeSets = await prisma.trainingWorkSet.count();
  const beforeItems = await prisma.trainingWorkItem.count();
  console.log(`[before] sets=${beforeSets} items=${beforeItems} answers=${beforeAnswers}`);

  const setData = {
    title: "ワーク⑥ 求職者に伝える言葉を書く",
    description: DESCRIPTION,
    fieldLabels: FIELD_LABELS,
    sortOrder: 6,
    isActive: true,
  };
  const savedSet = await prisma.trainingWorkSet.upsert({
    where: { workKey: WORK_KEY },
    update: setData,
    create: { workKey: WORK_KEY, ...setData },
  });
  console.log(`  ${savedSet.workKey} : ${savedSet.title}（設問${FIELD_LABELS.length}欄）`);

  for (const [i, item] of ITEMS.entries()) {
    const data = {
      sortOrder: i + 1,
      title: item.title,
      jobContent: toLines(item.jobContent),
      isActive: true,
    };
    await prisma.trainingWorkItem.upsert({
      where: { workKey_itemCode: { workKey: WORK_KEY, itemCode: item.itemCode } },
      update: data,
      create: { workKey: WORK_KEY, itemCode: item.itemCode, ...data },
    });
  }
  console.log(`Seeded 1 training work set + ${ITEMS.length} items (${WORK_KEY})`);

  const afterAnswers = await prisma.trainingWorkAnswer.count();
  const afterSets = await prisma.trainingWorkSet.count();
  const afterItems = await prisma.trainingWorkItem.count();
  const work6Items = await prisma.trainingWorkItem.count({ where: { workKey: WORK_KEY } });
  console.log(
    `[after]  sets=${afterSets} items=${afterItems} answers=${afterAnswers} (work6 items=${work6Items})`
  );
  const byWork = await prisma.trainingWorkAnswer.groupBy({ by: ["workKey"], _count: { _all: true } });
  console.log(`[after]  answers by work: ${JSON.stringify(byWork)}`);
  if (afterAnswers !== beforeAnswers) {
    throw new Error(`回答件数が変化しました: ${beforeAnswers} -> ${afterAnswers}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
