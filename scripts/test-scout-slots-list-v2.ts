/**
 * T-064 v2: 配信レコード一覧 API の追加検証
 *
 * 実行: npx tsx scripts/test-scout-slots-list-v2.ts
 *
 * 確認:
 *  - 外国籍カウントが姓名カタカナ/英字判定で正しい
 *  - validApplyCount / invalidApplyCount / validApplyRate / invalidApplyRate
 *  - 〜20代（30未満）と 50代〜（50以上）の境界
 *  - 複合ソートロジック（in-memory sort と同じ手順を直接適用）
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { parseSlotDate } from "../src/lib/scout/slot-helpers";
import { generateScoutNumber } from "../src/lib/scout/scout-number";
import { isForeignNg } from "../src/lib/mynavi-rpa/judgment";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function ageAtDate(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

function isForeigner(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  const parts = n.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) {
    return isForeignNg(parts[0], parts.slice(1).join(""));
  }
  return isForeignNg(n, n);
}

async function main() {
  console.log("\n=== T-064 v2 一覧 API ロジック確認 ===\n");

  const staff = await prisma.scoutMachineMaster.findFirst({
    where: { isMachine: false, isActive: true },
  });
  if (!staff) {
    console.log("社員枠が見つかりません");
    process.exit(1);
  }

  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() - 140);
  const dateStr = baseDate.toISOString().slice(0, 10);
  const dateUtc = parseSlotDate(dateStr);

  await prisma.scoutDeliverySlot.deleteMany({
    where: { deliveryDate: dateUtc, machineId: staff.id },
  });

  const createdCandidateIds: string[] = [];

  // テスト用スロット (deliveryCount=200, openCount=80)
  const seq = await generateScoutNumber();
  const slot = await prisma.scoutDeliverySlot.create({
    data: {
      scoutNumber: seq,
      deliveryDate: dateUtc,
      hourSlot: 14,
      machineId: staff.id,
      isMachine: false,
      isStaff: true,
      deliveryCategoryLarge: "社員",
      deliveryCategoryMedium: "一斉配信",
      deliveryCategorySmall: "検索条件指定",
      mediaSource: "マイナビ転職",
      searchConditionName: "V2-LISTTEST",
      deliveryCount: 200,
      openCount: 80,
      isAggregationTarget: true,
    },
  });

  // baseDate より「前の月日」で birthday を作るため Jan 1 固定にする
  // → ageAtDate は (baseYear - birthYear) - (birthday の月日が baseDate より後なら 1) なので、
  //   Jan 1 が baseDate より前なら age = baseYear - birthYear で確定する
  async function makeCandidate(opts: { name: string; birthYear: number }) {
    const num = `T064LV2_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const c = await prisma.candidate.create({
      data: {
        candidateNumber: num,
        name: opts.name,
        applicationRoute: "スカウト",
        mediaSource: "マイナビ転職",
        birthday: new Date(Date.UTC(opts.birthYear, 0, 1)),
        createdAt: baseDate,
        scoutDeliverySlotId: slot.id,
        scoutNumber: slot.scoutNumber,
        scoutLinkedAt: baseDate,
      },
    });
    createdCandidateIds.push(c.id);
    return c;
  }

  const baseYear = baseDate.getFullYear();
  // 〜20代: 19歳, 25歳, 29歳（3人）
  await makeCandidate({ name: "テスト 太郎", birthYear: baseYear - 19 });
  await makeCandidate({ name: "テスト 一郎", birthYear: baseYear - 25 });
  await makeCandidate({ name: "テスト 次郎", birthYear: baseYear - 29 });
  // 30代: 30, 39
  await makeCandidate({ name: "テスト 三郎", birthYear: baseYear - 30 });
  await makeCandidate({ name: "テスト 四郎", birthYear: baseYear - 39 });
  // 40代: 45
  await makeCandidate({ name: "テスト 五郎", birthYear: baseYear - 45 });
  // 50代〜: 55, 65
  await makeCandidate({ name: "テスト 六郎", birthYear: baseYear - 55 });
  await makeCandidate({ name: "テスト 七郎", birthYear: baseYear - 65 });
  // 外国籍: カタカナのみ
  await makeCandidate({ name: "スミス ジョン", birthYear: baseYear - 32 });
  // 外国籍: 英字のみ
  await makeCandidate({ name: "Smith John", birthYear: baseYear - 33 });

  // 上記合計 10人。年齢別: 〜20s=3, 30s=2, 40s=1, 50s=2, foreign=2

  const slotWithCands = await prisma.scoutDeliverySlot.findUnique({
    where: { id: slot.id },
    include: { linkedCandidates: { select: { id: true, name: true, birthday: true, createdAt: true } } },
  });

  const groups = { "20s": 0, "30s": 0, "40s": 0, "50s": 0, foreign: 0 };
  for (const c of slotWithCands!.linkedCandidates) {
    if (isForeigner(c.name)) {
      groups.foreign++;
      continue;
    }
    if (!c.birthday) continue;
    const age = ageAtDate(c.birthday, c.createdAt);
    if (age < 30) groups["20s"]++;
    else if (age < 40) groups["30s"]++;
    else if (age < 50) groups["40s"]++;
    else groups["50s"]++;
  }

  check("〜20代カウント=3 (19,25,29歳)", groups["20s"] === 3, String(groups["20s"]));
  check("30代カウント=2 (30,39歳)", groups["30s"] === 2, String(groups["30s"]));
  check("40代カウント=1 (45歳)", groups["40s"] === 1, String(groups["40s"]));
  check("50代〜カウント=2 (55,65歳)", groups["50s"] === 2, String(groups["50s"]));
  check("外国籍カウント=2 (カナ+英字)", groups.foreign === 2, String(groups.foreign));

  const validApplyCount = groups["20s"] + groups["30s"];
  const invalidApplyCount = groups["40s"] + groups["50s"] + groups.foreign;
  check("有効応募数=5 (〜20代3 + 30代2)", validApplyCount === 5);
  check("無効応募数=5 (40代1 + 50代2 + 外国籍2)", invalidApplyCount === 5);

  const deliveryCount = slot.deliveryCount;
  const validApplyRate = (validApplyCount / deliveryCount) * 100;
  const invalidApplyRate = (invalidApplyCount / deliveryCount) * 100;
  check("有効応募率=2.5% (5/200)", Math.abs(validApplyRate - 2.5) < 0.01, `${validApplyRate}`);
  check("無効応募率=2.5% (5/200)", Math.abs(invalidApplyRate - 2.5) < 0.01, `${invalidApplyRate}`);

  // 個別 isForeignNg 判定
  check("isForeignNg(カナ姓+カナ名)=true", isForeignNg("スミス", "ジョン") === true);
  check("isForeignNg(英字姓+英字名)=true", isForeignNg("Smith", "John") === true);
  check("isForeignNg(漢字姓+漢字名)=false", isForeignNg("田中", "太郎") === false);
  check("isForeignNg(漢字姓+カナ名)=false", isForeignNg("田中", "タロウ") === false);

  // 複合ソートロジック検証（rows をモック）
  type SortKey = "deliveryDate" | "hourSlot" | "openCount";
  type Spec = { column: SortKey; order: "asc" | "desc" };
  const rows = [
    { id: "a", deliveryDate: "2026-01-01", hourSlot: 14, openCount: 5 },
    { id: "b", deliveryDate: "2026-01-02", hourSlot: 10, openCount: 5 },
    { id: "c", deliveryDate: "2026-01-01", hourSlot: 10, openCount: 8 },
    { id: "d", deliveryDate: "2026-01-02", hourSlot: 14, openCount: 1 },
  ];
  type Row = { id: string; deliveryDate: string; hourSlot: number; openCount: number };
  function applySort(arr: Row[], specs: Spec[]): Row[] {
    const out = [...arr];
    out.sort((a, b) => {
      for (const s of specs) {
        const dir = s.order === "asc" ? 1 : -1;
        const av: string | number =
          s.column === "deliveryDate" ? `${a.deliveryDate}-${String(a.hourSlot).padStart(2, "0")}` : a[s.column];
        const bv: string | number =
          s.column === "deliveryDate" ? `${b.deliveryDate}-${String(b.hourSlot).padStart(2, "0")}` : b[s.column];
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });
    return out;
  }
  const sorted1 = applySort(rows, [{ column: "deliveryDate", order: "asc" }]);
  check("複合ソート: 配信日昇順 → a,c,b,d", sorted1.map((r) => r.id).join(",") === "c,a,b,d", sorted1.map((r) => r.id).join(","));

  const sorted2 = applySort(rows, [{ column: "openCount", order: "desc" }, { column: "deliveryDate", order: "asc" }]);
  // openCount desc: 8(c), 5(a), 5(b), 1(d) — tie 5: a (2026-01-01-14) vs b (2026-01-02-10) asc → a,b
  check("複合ソート: 開封数降順 + 配信日昇順 → c,a,b,d", sorted2.map((r) => r.id).join(",") === "c,a,b,d", sorted2.map((r) => r.id).join(","));

  // クリーンアップ
  await prisma.candidate.deleteMany({ where: { id: { in: createdCandidateIds } } });
  await prisma.scoutDeliverySlot.deleteMany({
    where: { deliveryDate: dateUtc, machineId: staff.id },
  });

  console.log(`\n=== 結果: ${pass} PASS / ${fail} FAIL ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
