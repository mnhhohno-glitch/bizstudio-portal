// T-197: 配信条件の作成を1か所に集約する（レコード番号の採番＋状態の自動決定）。
//
// - レコード番号: 号機ごとの通し番号 seq_no（表示は「1-001」）。号機内の MAX+1 を号機ロックの中で採る。
//   一度振った番号は変更しない（削除しても詰めない）。同一号機内の重複は @@unique([machineId, seqNo]) が最後の砦。
// - 状態の自動決定: その号機に RUNNING が1件も無ければ RUNNING（配信が止まらないようにする）、
//   既にあれば QUEUED で予約列の末尾（queueOrder = MAX+1）。画面からの作成・複製・シード・外部経路のすべてがここを通る。
// - 排他: 号機単位の pg_advisory_xact_lock。キーは runs.ts（T-195 の枯渇→予約消化）と同じ `scout-runs:<machineId>` を使い、
//   「作成で RUNNING にする」と「枯渇で予約を RUNNING に切り替える」が同時に走っても直列化されるようにする。
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { jstTodayYmd, ymdToDbDate } from "./dates";
import { conditionInclude } from "./server";

type Client = Prisma.TransactionClient;

/** runs.ts と同じ号機ロック（キー文字列を変えないこと） */
export async function lockMachine(t: Client, machineId: string): Promise<void> {
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scout-runs:${machineId}`})::bigint)`;
}

async function nextSeqNo(t: Client, machineId: string): Promise<number> {
  const max = await t.scoutCondition.aggregate({ where: { machineId }, _max: { seqNo: true } });
  return (max._max.seqNo ?? 0) + 1;
}

async function nextQueueOrder(t: Client, machineId: string): Promise<number> {
  const max = await t.scoutCondition.aggregate({ where: { machineId, status: "QUEUED" }, _max: { queueOrder: true } });
  return (max._max.queueOrder ?? 0) + 1;
}

/** 状態を自動で決める（RUNNING が無ければ RUNNING、あれば QUEUED の末尾） */
export async function decideInitialStatus(
  t: Client,
  machineId: string,
): Promise<{ status: "RUNNING" | "QUEUED"; queueOrder: number }> {
  const running = await t.scoutCondition.count({ where: { machineId, status: "RUNNING" } });
  if (running === 0) return { status: "RUNNING", queueOrder: 0 };
  return { status: "QUEUED", queueOrder: await nextQueueOrder(t, machineId) };
}

/** 作成入力（status / queueOrder / seqNo はここで決めるので受け取らない） */
export type CreateConditionData = Omit<Prisma.ScoutConditionUncheckedCreateInput, "status" | "queueOrder" | "seqNo" | "id">;

export type CreatedCondition = Prisma.ScoutConditionGetPayload<{ include: typeof conditionInclude }>;

/**
 * 配信条件を1件作成する。状態・並び順・レコード番号はサーバー側で決める。
 * 自動で RUNNING になり配信日が空のときは当日（JST）を入れる（T-195 の枯渇切替と同じ扱い）。
 */
export async function createScoutCondition(data: CreateConditionData): Promise<CreatedCondition> {
  return prisma.$transaction(
    async (t) => {
      await lockMachine(t, data.machineId);
      const decided = await decideInitialStatus(t, data.machineId);
      const seqNo = await nextSeqNo(t, data.machineId);
      const deliveryDate =
        decided.status === "RUNNING" && data.deliveryDate == null ? ymdToDbDate(jstTodayYmd()) : data.deliveryDate;
      return t.scoutCondition.create({
        data: { ...data, deliveryDate, status: decided.status, queueOrder: decided.queueOrder, seqNo },
        include: conditionInclude,
      });
    },
    { timeout: 20000 },
  );
}

/**
 * seq_no が空の行に番号を振る（旧コードが動いていた窓で作られた行の救済。通常は0件で何もしない）。
 * 号機ごとに作成日時の古い順で既存の MAX の後ろへ続ける。
 */
export async function ensureSeqNos(): Promise<number> {
  const missing = await prisma.scoutCondition.findMany({
    where: { seqNo: null },
    select: { id: true, machineId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (missing.length === 0) return 0;
  const machineIds = [...new Set(missing.map((m) => m.machineId))];
  let assigned = 0;
  for (const machineId of machineIds) {
    await prisma.$transaction(async (t) => {
      await lockMachine(t, machineId);
      const rows = await t.scoutCondition.findMany({
        where: { machineId, seqNo: null },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      let seq = await nextSeqNo(t, machineId);
      for (const r of rows) {
        await t.scoutCondition.update({ where: { id: r.id }, data: { seqNo: seq++ } });
        assigned++;
      }
    });
  }
  return assigned;
}
