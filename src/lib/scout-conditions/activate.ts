// T-209: 配信日が来た予約（QUEUED）を自動で「有効」（RUNNING）にする。
//
// これまで予約が有効に上がるのは「枯渇したとき」（runs.ts の予約消化）だけで、日付が変わっても上がらなかった。
// そのため翌日以降の条件を仕込んでも、その日の朝に人が手で有効にしなければ配信が止まる（連休前にまとめて
// 仕込む運用ができない）。ここでは日付だけを見る別経路を足す。枯渇消化（runs.ts）のしきい値・順序は変えない。
//
// 判定（号機ごと）:
//   1. その号機に RUNNING が1件も無い（あるときは何もしない。既存の有効を上書き・完了にはしない）
//   2. QUEUED のうち配信日が当日（JST）以前のものがある
//   → 配信日が一番古いもの（同日なら ▲▼ の並び順が上＝queueOrder 昇順→登録順）を1件だけ RUNNING にする
//
// 配信日が未来（翌日以降）の予約は上げない。配信日が null の予約も上げない（「配信日が来ていない」扱い＝安全側。
// 日付で判断できない行を勝手に配信し始めないため）。配信日が過去の予約は対象に含める（仕込み忘れて日をまたいだ救済）。
//
// 呼び出し口は2か所: RPA の GET /api/external/scout-conditions/current（external.ts）と、
// 配信条件一覧の GET /api/scout/conditions（人が画面を開いたとき）。どちらも判定はここ1か所を通る。
//
// 排他: create.ts / runs.ts と同じ号機ロック（pg_advisory_xact_lock）。RPA の結果送信による枯渇切替と
// 同時に走っても直列化され、実行中が2件になることはない。
import { prisma } from "@/lib/prisma";
import { demoteOtherRunning, lockMachine } from "./create";
import { jstTodayYmd, ymdToDbDate } from "./dates";

/**
 * 1号機ぶんの判定と切替。上げたら条件 id、何もしなければ null。
 * 判定はロックの中でやり直すので、呼ぶ前の下読み（RUNNING が無さそう等）が古くなっていても安全。
 */
export async function activateDueCondition(machineId: string): Promise<string | null> {
  const today = ymdToDbDate(jstTodayYmd());
  return prisma.$transaction(
    async (t) => {
      await lockMachine(t, machineId);
      // 有効がすでにあるなら何もしない（上書き・完了にしない）
      const running = await t.scoutCondition.count({ where: { machineId, status: "RUNNING" } });
      if (running > 0) return null;

      const next = await t.scoutCondition.findFirst({
        // deliveryDate は @db.Date（UTC 0時に載せる）。当日 JST を同じ形に直して比べる（罠#17）。
        // not: null は SQL の比較でも落ちるが、「配信日が無い行は対象外」という意図を残すため明示する
        where: { machineId, status: "QUEUED", deliveryDate: { not: null, lte: today } },
        orderBy: [{ deliveryDate: "asc" }, { queueOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!next) return null;

      // queueOrder は触らない（枯渇消化 runs.ts と同じ扱い。有効は号機に1件なので並び順は使われない）
      await t.scoutCondition.update({ where: { id: next.id }, data: { status: "RUNNING" } });
      // T-198: 実行中は号機ごとに1件。上で0件を確認しているので通常は0件だが、念のため畳んでおく
      await demoteOtherRunning(t, machineId, next.id);
      return next.id;
    },
    { timeout: 20000 },
  );
}

/**
 * 稼働中の号機をまとめて判定する（一覧を開いたとき用）。
 * 先に「配信日が来た予約があり、かつ有効が無い号機」だけを読みで絞ってからロックを取る
 * （毎回全号機ぶんのロックを取らないため）。実際の判定は activateDueCondition がロックの中でやり直す。
 */
export async function activateDueConditionsForActiveMachines(): Promise<string[]> {
  const today = ymdToDbDate(jstTodayYmd());
  const due = await prisma.scoutCondition.findMany({
    where: { status: "QUEUED", deliveryDate: { not: null, lte: today }, machine: { isActive: true } },
    select: { machineId: true },
    distinct: ["machineId"],
  });
  if (due.length === 0) return [];
  const machineIds = due.map((d) => d.machineId);
  const running = await prisma.scoutCondition.findMany({
    where: { machineId: { in: machineIds }, status: "RUNNING" },
    select: { machineId: true },
    distinct: ["machineId"],
  });
  const busy = new Set(running.map((r) => r.machineId));
  const activated: string[] = [];
  for (const machineId of machineIds) {
    if (busy.has(machineId)) continue;
    const id = await activateDueCondition(machineId);
    if (id) activated.push(id);
  }
  return activated;
}
