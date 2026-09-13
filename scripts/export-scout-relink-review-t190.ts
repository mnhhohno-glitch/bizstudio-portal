/**
 * T-190 Step2 ③: 枠張り替えの「要確認リスト」CSV 出力（読み取り専用・SELECT のみ）
 *
 * ②（relink-scout-slots-t190.ts）の対象 144 件を ScoutSendRecord（マイナビ会員No で突合）と
 * 照合し、次の 3 区分に分ける。
 *
 *   一致     … 求職者の配信日が、その人の送信明細の配信日のいずれかと一致する
 *   不一致   … 送信明細はあるが、どの配信日とも一致しない
 *   明細なし … その人の送信明細が 1 件も無い（会員No が無い場合を含む）
 *
 * CSV には「不一致」「明細なし」の行だけを出す（＝人が目で確認すべき行）。
 *
 * --- 実行順に注意 ---
 * 「張り替え前の枠の日付」は ② の --execute 後には DB から復元できないため、
 * **--execute の前に `--snapshot` を実行して対象を控えておく**。
 *
 *   1) （--execute の前）  npx tsx --env-file=.env scripts/export-scout-relink-review-t190.ts --snapshot
 *        → scripts/out/T-190_relink_snapshot.json を書き出す（DB は読むだけ）
 *   2) ② の --execute
 *   3) （--execute の後）  npx tsx --env-file=.env scripts/export-scout-relink-review-t190.ts
 *        → snapshot を土台に、張り替え後の実際の枠日を DB から読んで CSV を書き出す
 *
 * snapshot が無い場合は、その場の DB 状態から対象を組み立てて CSV を出す
 * （--execute 前に一発で出したいとき用。張り替え後の枠日は「予定」になる）。
 *
 * 出力: scripts/out/T-190_要確認リスト_YYYYMMDD.csv（UTF-8 BOM 付き・Excel でそのまま開ける）
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { buildRelinkPlans, type RelinkPlan } from "./relink-scout-slots-t190";

const OUT_DIR = path.join(process.cwd(), "scripts", "out");
const SNAPSHOT_PATH = path.join(OUT_DIR, "T-190_relink_snapshot.json");

/** JST 暦日 YYYY-MM-DD（罠#17） */
function jstYmd(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function csvCell(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function writeSnapshot() {
  const plans = await buildRelinkPlans();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(plans, null, 2), "utf8");
  const movable = plans.filter((p) => p.toSlotId != null).length;
  console.log(
    `[snapshot] ${plans.length} 件を控えました（移動 ${movable} / 移動不可 ${plans.length - movable}）: ${SNAPSHOT_PATH}`,
  );
}

function readSnapshot(): RelinkPlan[] | null {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as RelinkPlan[];
    return Array.isArray(raw) && raw.length > 0 ? raw : null;
  } catch (e) {
    console.warn(`[snapshot] 読み込み失敗（無視して現状から組み立てます）: ${String(e)}`);
    return null;
  }
}

async function exportCsv() {
  const snapshot = readSnapshot();
  const plans = snapshot ?? (await buildRelinkPlans());
  console.log(
    snapshot
      ? `対象 ${plans.length} 件（snapshot: ${SNAPSHOT_PATH}）`
      : `対象 ${plans.length} 件（snapshot 無し → 現在の DB 状態から組み立て）`,
  );
  if (plans.length === 0) {
    console.log("対象 0 件のため CSV は出力しません。");
    return;
  }

  // 現在の求職者・紐づき枠（＝張り替え後の実際の枠）を読み直す
  const candidates = await prisma.candidate.findMany({
    where: { id: { in: plans.map((p) => p.candidateId) } },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      mediaSource: true,
      applicationDate: true,
      scoutDeliveryDate: true,
      mynaviMemberNo: true,
      scoutDeliverySlot: { select: { deliveryDate: true } },
    },
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // 会員No → 送信明細の配信日一覧
  const memberNos = [...new Set(candidates.map((c) => c.mynaviMemberNo).filter((m): m is string => !!m))];
  const records = memberNos.length
    ? await prisma.scoutSendRecord.findMany({
        where: { memberNo: { in: memberNos } },
        select: { memberNo: true, deliveryDate: true },
        orderBy: { deliveryDate: "asc" },
      })
    : [];
  const daysByMember = new Map<string, string[]>();
  for (const r of records) {
    const list = daysByMember.get(r.memberNo) ?? [];
    const ymd = jstYmd(r.deliveryDate);
    if (!list.includes(ymd)) list.push(ymd);
    daysByMember.set(r.memberNo, list);
  }

  type Row = {
    kind: "一致" | "不一致" | "明細なし";
    cells: string[];
  };
  const rows: Row[] = [];
  let counts = { 一致: 0, 不一致: 0, 明細なし: 0 };

  for (const p of plans) {
    const c = byId.get(p.candidateId);
    if (!c) continue; // 求職者が消えている（通常ありえない）
    const deliveryYmd = jstYmd(c.scoutDeliveryDate);
    const sendDays = c.mynaviMemberNo ? (daysByMember.get(c.mynaviMemberNo) ?? []) : [];

    let kind: Row["kind"];
    if (sendDays.length === 0) kind = "明細なし";
    else if (deliveryYmd && sendDays.includes(deliveryYmd)) kind = "一致";
    else kind = "不一致";
    counts[kind]++;
    if (kind === "一致") continue; // CSV には出さない

    // 張り替え後の枠日：移動不可だった行は空欄にし、理由を区分欄に併記する
    const afterYmd = p.blockedReason ? "" : jstYmd(c.scoutDeliverySlot?.deliveryDate);
    const kindCell = p.blockedReason ? `${kind}（移動不可: ${p.blockedReason}）` : kind;

    rows.push({
      kind,
      cells: [
        c.candidateNumber,
        c.name,
        p.machineLabel,
        c.mediaSource ?? "",
        jstYmd(c.applicationDate),
        deliveryYmd,
        p.fromDay,
        afterYmd,
        kindCell,
        sendDays.slice(0, 10).join(","),
        c.mynaviMemberNo ?? "",
      ],
    });
  }

  console.log(
    `突合内訳: 一致 ${counts.一致} / 不一致 ${counts.不一致} / 明細なし ${counts.明細なし}（CSV 出力 ${rows.length} 件）`,
  );

  const header = [
    "求職者番号",
    "氏名",
    "担当RC",
    "媒体",
    "応募日",
    "ポータルの配信日",
    "張り替え前の枠の日付",
    "張り替え後の枠の日付",
    "区分",
    "送信明細の配信日一覧",
    "マイナビ会員No",
  ];
  const lines = [header, ...rows.map((r) => r.cells)].map((cells) => cells.map(csvCell).join(","));
  const ymd = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/-/g, "");
  const outPath = path.join(OUT_DIR, `T-190_要確認リスト_${ymd}.csv`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outPath, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(`CSV: ${outPath}`);
}

async function main() {
  if (process.argv.includes("--snapshot")) {
    await writeSnapshot();
  } else {
    await exportCsv();
  }
  await cleanup();
}

async function cleanup() {
  await prisma.$disconnect();
  const g = globalThis as unknown as { pool?: { end: () => Promise<void> } };
  if (g.pool) await g.pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
