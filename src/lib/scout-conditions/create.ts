// T-197: 配信条件の作成を1か所に集約する（レコード番号の採番＋状態の自動決定）。
//
// - レコード番号: 号機ごとの通し番号 seq_no（表示は「1-001」）。号機内の MAX+1 を号機ロックの中で採る。
//   一度振った番号は変更しない（削除しても詰めない）。同一号機内の重複は @@unique([machineId, seqNo]) が最後の砦。
// - 状態の自動決定（T-211 で変更）: **配信日が今日（JST）で、その号機に RUNNING が1件も無いときだけ RUNNING**。
//   それ以外（配信日が明日以降・昨日以前・空、または既に RUNNING がある）は QUEUED で予約列の末尾（queueOrder = MAX+1）。
//   画面からの作成・複製・シード・外部経路のすべてがここを通る。
//   T-197 は配信日を見ずに「RUNNING が無ければ RUNNING」にしていたため、9/21 配信予定の条件を登録した当日に
//   有効になってしまった。明日以降の配信日は予約に入り、当日の朝に activate.ts の日付切替が有効にする。
// - 排他: 号機単位の pg_advisory_xact_lock。キーは runs.ts（T-195 の枯渇→予約消化）と同じ `scout-runs:<machineId>` を使い、
//   「作成で RUNNING にする」と「枯渇で予約を RUNNING に切り替える」が同時に走っても直列化されるようにする。
//
// T-198: 実行中（RUNNING）は号機ごとに1件まで。RPA は実行中の条件を1件しか取らないため、2件あると
//   意図と違う条件・テンプレートで配信されても「成功」で終わる（2026-09-10 の2号機不具合と同じ構図）。
//   状態が RUNNING になりうる経路（作成の自動決定 / 編集での手動変更 / 枯渇時の予約消化 / 複製・シード）は
//   すべて demoteOtherRunning() を号機ロックの中で通し、他の RUNNING を DONE（完了）へ畳む。
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { dbDateToYmd, jstTodayYmd } from "./dates";
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

/**
 * 状態を自動で決める（T-211）。deliveryYmd は JST の "YYYY-MM-DD"（未設定なら null）。
 *
 *  - 配信日が今日ちょうど かつ その号機に RUNNING が無い → RUNNING
 *  - 配信日が明日以降・昨日以前・空、または既に RUNNING がある → QUEUED（予約列の末尾）
 *
 * 明日以降の配信日は予約に入れておけば、当日の朝に activate.ts の日付切替が有効にする。
 * 人が状態欄を手で「有効」に変える操作はここでは制限しない（PATCH 側で demoteOtherRunning を通す既存挙動のまま）。
 */
export async function decideInitialStatus(
  t: Client,
  machineId: string,
  deliveryYmd: string | null,
): Promise<{ status: "RUNNING" | "QUEUED"; queueOrder: number }> {
  if (deliveryYmd !== null && deliveryYmd === jstTodayYmd()) {
    const running = await t.scoutCondition.count({ where: { machineId, status: "RUNNING" } });
    if (running === 0) return { status: "RUNNING", queueOrder: 0 };
  }
  return { status: "QUEUED", queueOrder: await nextQueueOrder(t, machineId) };
}

/**
 * T-198: 実行中を号機ごとに1件に保つ。keepId 以外の RUNNING を DONE（完了）へ畳んで畳んだ件数を返す。
 * 必ず lockMachine() を取った同じトランザクションの中で呼ぶこと（同時実行で2件になるのを防ぐため）。
 */
export async function demoteOtherRunning(t: Client, machineId: string, keepId: string): Promise<number> {
  const r = await t.scoutCondition.updateMany({
    where: { machineId, status: "RUNNING", id: { not: keepId } },
    data: { status: "DONE" },
  });
  return r.count;
}

/** 作成入力（status / queueOrder / seqNo はここで決めるので受け取らない） */
export type CreateConditionData = Omit<Prisma.ScoutConditionUncheckedCreateInput, "status" | "queueOrder" | "seqNo" | "id">;

export type CreatedCondition = Prisma.ScoutConditionGetPayload<{ include: typeof conditionInclude }>;

/**
 * 配信条件を1件作成する。状態・並び順・レコード番号はサーバー側で決める。
 * T-211: RUNNING になるのは配信日が今日の行だけなので、配信日の補完（空なら当日を入れる）はしない。
 */
export async function createScoutCondition(data: CreateConditionData): Promise<CreatedCondition> {
  return prisma.$transaction(
    async (t) => {
      await lockMachine(t, data.machineId);
      // deliveryDate は Prisma の入力型上 Date | string もあり得るので Date に揃えてから JST の日付に直す
      const deliveryYmd = data.deliveryDate == null ? null : dbDateToYmd(new Date(data.deliveryDate));
      const decided = await decideInitialStatus(t, data.machineId, deliveryYmd);
      const seqNo = await nextSeqNo(t, data.machineId);
      const created = await t.scoutCondition.create({
        data: { ...data, status: decided.status, queueOrder: decided.queueOrder, seqNo },
        include: conditionInclude,
      });
      // T-198: 自動決定が RUNNING を選ぶのは「実行中が0件のとき」だけなので通常は0件だが、
      // 同時作成で取りこぼしが起きても実行中が2件にならないよう、ここでも畳んでおく
      if (decided.status === "RUNNING") await demoteOtherRunning(t, data.machineId, created.id);
      return created;
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
