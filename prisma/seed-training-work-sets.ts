// 記述式ワークの定義（TrainingWorkSet）5本を投入する
// 実行: npx tsx prisma/seed-training-work-sets.ts
// workKey で upsert するため再実行しても重複しない。TrainingWorkItem / TrainingWorkAnswer には一切触れない
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type FieldLabel = { key: string; label: string; placeholder: string; rows: number };

const SETS: {
  workKey: string;
  title: string;
  description: string;
  sortOrder: number;
  fieldLabels: FieldLabel[];
}[] = [
  {
    workKey: "work0-shokushu-gyoshu",
    title: "ワーク⓪ 職種・業種を推測する",
    description:
      "業種や会社名は書かれていません。仕事内容だけを読んで推測してください。分からなくても構いません。分からなかった言葉を④に残すことが大切です。",
    sortOrder: 0,
    fieldLabels: [
      { key: "answerCompany", label: "① この会社は何をしている会社か", placeholder: "1行程度", rows: 2 },
      { key: "answerHelp", label: "② この仕事は誰を助ける仕事か", placeholder: "1行程度", rows: 2 },
      { key: "answerDay", label: "③ 1日の動きを想像して書いてください", placeholder: "2〜3行", rows: 4 },
      { key: "answerUnknown", label: "④ 分からなかった言葉があれば書いてください", placeholder: "例: レセプト、入稿", rows: 2 },
    ],
  },
  {
    workKey: "work1-eigyo-3jiku",
    title: "ワーク① 営業の求人を3つの軸で分類する",
    description:
      "営業を分ける3つの軸（誰に売るか／どうやって売るか／何を売るか）で分類してください。最後に、その求人が1日どんな動きをするかを1行で書いてください。",
    sortOrder: 1,
    fieldLabels: [
      { key: "answerCompany", label: "① 誰に売るか（法人／個人）", placeholder: "法人 または 個人", rows: 2 },
      { key: "answerHelp", label: "② どうやって売るか（新規開拓／既存・ルート／反響・来店）", placeholder: "3つのうちどれか", rows: 2 },
      { key: "answerDay", label: "③ 何を売るか（有形／無形）とその商材", placeholder: "例: 有形（食品）", rows: 2 },
      { key: "answerUnknown", label: "④ この求人の1日の動きを1行で", placeholder: "例: 決まった取引先を6〜8件まわる", rows: 3 },
    ],
  },
  {
    workKey: "work2-jimu-bunrui",
    title: "ワーク② 事務の求人を分類する",
    description:
      "事務は「誰を助ける仕事か」で分かれます。5種類（一般事務／営業事務／経理／総務・人事／専門事務）のどれにあたるかを書いてください。",
    sortOrder: 2,
    fieldLabels: [
      { key: "answerCompany", label: "① 事務の何にあたるか", placeholder: "一般事務／営業事務／経理／総務・人事／専門事務", rows: 2 },
      { key: "answerHelp", label: "② 誰を助ける仕事か", placeholder: "1行程度", rows: 2 },
      { key: "answerDay", label: "③ 接客経験のある人に出すなら何番目か。その理由も", placeholder: "例: 1番目。人と関わりながら処理もする構造が同じだから", rows: 4 },
    ],
  },
  {
    workKey: "work3-gyoshu-bunrui",
    title: "ワーク③ 業種を分類する",
    description:
      "業界名と、その会社の立場を書いてください。判断した根拠は、必ず求人票の中から1行抜き出してください。分類が合っていても、根拠が言えなければやり直しです。",
    sortOrder: 3,
    fieldLabels: [
      { key: "answerCompany", label: "① 業界名", placeholder: "例: 建築資材", rows: 2 },
      { key: "answerHelp", label: "② メーカーか商社か／事業会社か特殊法人か", placeholder: "例: 商社・事業会社", rows: 2 },
      { key: "answerDay", label: "③ そう判断した根拠（求人票から1行抜き出す）", placeholder: "例: 「仕入先メーカーへ発注」と書かれている", rows: 4 },
    ],
  },
  {
    workKey: "work4-challenge-senbiki",
    title: "ワーク④ チャレンジ応募の線引き",
    description:
      "想定する求職者：26歳・専門卒・まつげサロン6年（うち店長3年）・事務職希望・PCは予約管理と売上入力のみ・Excelの関数は使えない。この人にこの求人を出せるかを3つに分けてください。",
    sortOrder: 4,
    fieldLabels: [
      { key: "answerCompany", label: "① 判定（①出さない／②迷わず出す／③伝えた上で出す）", placeholder: "3つのうちどれか", rows: 2 },
      { key: "answerHelp", label: "② そう判断した根拠（求人票から1行抜き出す）", placeholder: "必須条件の該当する行を書き写す", rows: 3 },
      { key: "answerDay", label: "③ ③を選んだ場合、求職者に伝える言葉を実際に書く", placeholder: "そのまま面談で言える言葉で書いてください", rows: 5 },
    ],
  },
];

async function main() {
  for (const s of SETS) {
    const data = {
      title: s.title,
      description: s.description,
      fieldLabels: s.fieldLabels,
      sortOrder: s.sortOrder,
      isActive: true,
    };
    const saved = await prisma.trainingWorkSet.upsert({
      where: { workKey: s.workKey },
      update: data,
      create: { workKey: s.workKey, ...data },
    });
    console.log(`  ${saved.workKey} : ${saved.title}（設問${s.fieldLabels.length}欄）`);
  }
  console.log(`Seeded ${SETS.length} training work sets`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
