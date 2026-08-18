/**
 * T-169: 一次返信の送信日時が JST 壁時計値のまま UTC として保存され、
 * 真の instant より **9時間進んでいる**過去レコードを補正する。
 *
 * 原因（罠#17）: `src/app/api/rpa/mynavi/reply-sent/route.ts` の `parseDateLoose()` が
 * RPA(PAD) から届く `"2026/08/18 23:10:00"`（JSTの壁時計値）をサーバーのローカル時刻
 * （Railway 本番は TZ=UTC）として解釈していた。パーサ自体は別コミットで修正済み。
 *
 * 対象カラム:
 *   - CandidateSettingsHistory.sentAt      （基準: sentAt − createdAt）
 *   - MynaviRpaProcessingLog.replySentAt   （基準: replySentAt − processedAt）
 *   createdAt / processedAt は正しい instant（@default(now()) / サーバー時刻）。
 *
 * 判定基準（T-169 プロンプト 2-1 で数値固定。裁量で動かさない）:
 *   NORMAL  : 差が −10分 〜 +10分
 *   SHIFTED : 差が +8時間50分 〜 +9時間10分  ← これだけが補正対象
 *   UNKNOWN : 上記以外すべて（判定不能・**触らない**）
 *   対象外  : sentAt / replySentAt が NULL（母数から外す）
 *
 * 補正内容: SHIFTED と判定したレコードの当該カラムから **9時間を減算**する。
 *           他のカラムは触らない。INSERT / DELETE は行わない。
 *
 * 除外（絶対に触らない）:
 *   - T-167 検証用ダミー（処理ログ id が "t167-verify-log" 始まり / batchId = "t167-verify-20260818"）
 *   - 求職者「大野テスト」（candidateNumber = "5999999"）に紐づくレコード
 *
 * 安全装置:
 *   - `--execute` の実行直前に UNKNOWN 件数を再判定し、**1件でもあれば書き込まずに終了**する
 *     （dry-run と execute の間に新規レコードが増えても安全にするため / T-169 G3・G4）。
 *   - 変更前の値を CSV に書き出す（ロールバック用）。既存 CSV は上書きしない。
 *   - 500件チャンク・トランザクション単位で更新。
 *   - idempotent: 補正後は差が ±10分（NORMAL）に入り SHIFTED 条件から外れるため、
 *     再実行しても対象0件になる。
 *
 * 実行: npx tsx scripts/fix-sent-at-timezone-t169.ts            # DRY-RUN（既定）
 *       npx tsx scripts/fix-sent-at-timezone-t169.ts --execute  # 本実行
 *   オプション: --csv-dir=<dir>  CSV 出力先（既定 ./docs/reports）
 *              --print-csv      CSV 本文を標準出力にも出す（コンテナ実行時の回収用）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const PRINT_CSV = process.argv.includes("--print-csv");
const CSV_DIR =
  process.argv.find((a) => a.startsWith("--csv-dir="))?.slice("--csv-dir=".length) ??
  path.join(process.cwd(), "docs", "reports");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
/** 補正量。JST(+09:00) 分だけ進んでいるので減算する。 */
const SHIFT_MS = 9 * HOUR;

const NORMAL_LO = -10 * MIN;
const NORMAL_HI = 10 * MIN;
const SHIFTED_LO = 8 * HOUR + 50 * MIN;
const SHIFTED_HI = 9 * HOUR + 10 * MIN;

const CHUNK = 500;

const T167_VERIFY_BATCH_ID = "t167-verify-20260818";
const T167_VERIFY_LOG_PREFIX = "t167-verify-log";
const TEST_CANDIDATE_NUMBER = "5999999";

type Klass = "NORMAL" | "SHIFTED" | "UNKNOWN";

function classify(diffMs: number): Klass {
  if (diffMs >= NORMAL_LO && diffMs <= NORMAL_HI) return "NORMAL";
  if (diffMs >= SHIFTED_LO && diffMs <= SHIFTED_HI) return "SHIFTED";
  return "UNKNOWN";
}

/** 表示用の JST 文字列。罠#17 のため toISOString().slice() 系は使わない。 */
function jst(d: Date | null | undefined): string {
  return d ? `${d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" })} JST` : "—";
}

/** ファイル名用の JST タイムスタンプ（YYYYMMDD-HHmmss）。 */
function jstStamp(d: Date): string {
  const s = d.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD HH:MM:SS"
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}-${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}`;
}

type Row = {
  table: "CandidateSettingsHistory" | "MynaviRpaProcessingLog";
  id: string;
  column: "sentAt" | "replySentAt";
  candidateId: string | null;
  baseColumn: "createdAt" | "processedAt";
  baseValue: Date;
  oldValue: Date;
  newValue: Date;
  diffMs: number;
  klass: Klass;
  excluded: boolean;
  excludeReason: string;
};

async function loadExclusions() {
  const testCandidates = await prisma.candidate.findMany({
    where: { candidateNumber: TEST_CANDIDATE_NUMBER },
    select: { id: true, name: true, candidateNumber: true },
  });
  const dummyLogs = await prisma.mynaviRpaProcessingLog.findMany({
    where: {
      OR: [
        { id: { startsWith: T167_VERIFY_LOG_PREFIX } },
        { batchId: T167_VERIFY_BATCH_ID },
      ],
    },
    select: { id: true, candidateId: true },
  });
  const candidateIds = new Set<string>(testCandidates.map((c) => c.id));
  for (const l of dummyLogs) if (l.candidateId) candidateIds.add(l.candidateId);
  return {
    testCandidates,
    excludedCandidateIds: candidateIds,
    excludedLogIds: new Set<string>(dummyLogs.map((l) => l.id)),
  };
}

async function collect(): Promise<Row[]> {
  const { excludedCandidateIds, excludedLogIds } = await loadExclusions();
  const rows: Row[] = [];

  const histories = await prisma.candidateSettingsHistory.findMany({
    select: { id: true, candidateId: true, sentAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const h of histories) {
    if (!h.sentAt) continue; // 対象外（NULL）
    const diffMs = h.sentAt.getTime() - h.createdAt.getTime();
    const excluded = excludedCandidateIds.has(h.candidateId);
    rows.push({
      table: "CandidateSettingsHistory",
      id: h.id,
      column: "sentAt",
      candidateId: h.candidateId,
      baseColumn: "createdAt",
      baseValue: h.createdAt,
      oldValue: h.sentAt,
      newValue: new Date(h.sentAt.getTime() - SHIFT_MS),
      diffMs,
      klass: classify(diffMs),
      excluded,
      excludeReason: excluded ? "大野テスト/T-167ダミー" : "",
    });
  }

  const logs = await prisma.mynaviRpaProcessingLog.findMany({
    where: { replySentAt: { not: null } },
    select: { id: true, candidateId: true, replySentAt: true, processedAt: true },
    orderBy: { processedAt: "asc" },
  });
  for (const l of logs) {
    if (!l.replySentAt) continue;
    const diffMs = l.replySentAt.getTime() - l.processedAt.getTime();
    const excluded =
      excludedLogIds.has(l.id) || (!!l.candidateId && excludedCandidateIds.has(l.candidateId));
    rows.push({
      table: "MynaviRpaProcessingLog",
      id: l.id,
      column: "replySentAt",
      candidateId: l.candidateId,
      baseColumn: "processedAt",
      baseValue: l.processedAt,
      oldValue: l.replySentAt,
      newValue: new Date(l.replySentAt.getTime() - SHIFT_MS),
      diffMs,
      klass: classify(diffMs),
      excluded,
      excludeReason: excluded ? "大野テスト/T-167ダミー" : "",
    });
  }

  return rows;
}

function summarize(rows: Row[], table: Row["table"]) {
  const t = rows.filter((r) => r.table === table);
  const by = (k: Klass) => t.filter((r) => r.klass === k);
  return {
    total: t.length,
    normal: by("NORMAL").length,
    shifted: by("SHIFTED").length,
    unknown: by("UNKNOWN").length,
    unknownRows: by("UNKNOWN"),
    excludedShifted: by("SHIFTED").filter((r) => r.excluded).length,
    targets: by("SHIFTED").filter((r) => !r.excluded),
  };
}

function histogram(rows: Row[]) {
  const map = new Map<number, number>();
  for (const r of rows) {
    const k = Math.floor(r.diffMs / (10 * MIN));
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => ({ label: `${k * 10}分 以上 ${k * 10 + 10}分 未満`, count: n }));
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildCsv(targets: Row[]): string {
  const head = [
    "table",
    "id",
    "candidate_id",
    "column",
    "base_column",
    "base_value_utc",
    "old_value_utc",
    "new_value_utc",
    "old_value_jst",
    "new_value_jst",
    "diff_minutes",
  ].join(",");
  const lines = targets.map((r) =>
    [
      r.table,
      r.id,
      r.candidateId ?? "",
      r.column,
      r.baseColumn,
      r.baseValue.toISOString(),
      r.oldValue.toISOString(),
      r.newValue.toISOString(),
      jst(r.oldValue),
      jst(r.newValue),
      (r.diffMs / MIN).toFixed(2),
    ]
      .map((c) => csvCell(String(c)))
      .join(","),
  );
  return [head, ...lines].join("\n") + "\n";
}

/** CSV を書き出す。既存ファイルは**絶対に上書きしない**（存在したら例外）。 */
function writeCsv(targets: Row[], stamp: string): string {
  fs.mkdirSync(CSV_DIR, { recursive: true });
  const file = path.join(CSV_DIR, `T-169_rollback_${MODE.toLowerCase()}_${stamp}.csv`);
  if (fs.existsSync(file)) {
    throw new Error(`既存の CSV を上書きしようとしました: ${file}`);
  }
  fs.writeFileSync(file, buildCsv(targets), { encoding: "utf8", flag: "wx" });
  return file;
}

async function applyChunk(chunk: Row[]) {
  await prisma.$transaction(
    chunk.map((r) =>
      r.table === "CandidateSettingsHistory"
        ? prisma.candidateSettingsHistory.update({
            where: { id: r.id },
            data: { sentAt: r.newValue },
          })
        : prisma.mynaviRpaProcessingLog.update({
            where: { id: r.id },
            data: { replySentAt: r.newValue },
          }),
    ),
  );
}

async function main() {
  const startedAt = new Date();
  console.log(`=== T-169 送信日時9時間ずれ補正 [${MODE}] ===`);
  console.log(`開始: ${jst(startedAt)} / container TZ = ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(
    `判定基準: NORMAL=[-10分,+10分] / SHIFTED=[8h50m,9h10m] / それ以外=UNKNOWN(触らない) / 補正=-9時間`,
  );

  const { testCandidates } = await loadExclusions();
  console.log(`除外: 大野テスト ${JSON.stringify(testCandidates)} / T-167ダミー(batch=${T167_VERIFY_BATCH_ID}, id prefix=${T167_VERIFY_LOG_PREFIX})`);

  const rows = await collect();

  const totalCsh = await prisma.candidateSettingsHistory.count();
  const totalLog = await prisma.mynaviRpaProcessingLog.count();

  const tables: Row["table"][] = ["CandidateSettingsHistory", "MynaviRpaProcessingLog"];
  const summaries = tables.map((t) => ({ table: t, ...summarize(rows, t) }));

  for (const s of summaries) {
    const tableTotal = s.table === "CandidateSettingsHistory" ? totalCsh : totalLog;
    console.log(`\n########## ${s.table} ##########`);
    console.log(`テーブル総件数: ${tableTotal} / 対象外(NULL): ${tableTotal - s.total} / 判定対象: ${s.total}`);
    console.log(`  SHIFTED(約9時間ずれ): ${s.shifted}  NORMAL(正常): ${s.normal}  UNKNOWN(判定不能): ${s.unknown}`);
    console.log(`  うち除外対象で SHIFTED: ${s.excludedShifted} / 補正対象: ${s.targets.length}`);
    console.log("  --- 差の分布（10分刻み） ---");
    for (const h of histogram(rows.filter((r) => r.table === s.table))) {
      console.log(`  | ${h.label} | ${h.count} |`);
    }
    if (s.unknownRows.length) {
      console.log("  --- UNKNOWN（判定不能・補正対象外） ---");
      for (const r of s.unknownRows) {
        console.log(
          `  id=${r.id} ${r.column}=${r.oldValue.toISOString()} ${r.baseColumn}=${r.baseValue.toISOString()} diff=${(r.diffMs / MIN).toFixed(1)}分`,
        );
      }
    }
  }

  const targets = rows.filter((r) => r.klass === "SHIFTED" && !r.excluded);
  const unknownTotal = summaries.reduce((a, s) => a + s.unknown, 0);

  console.log(`\n=== 補正対象 合計: ${targets.length} 件 ===`);
  const sample = targets.filter((_, i) => i % Math.max(1, Math.floor(targets.length / 10)) === 0).slice(0, 10);
  console.log("--- サンプル10件（現在値 → 補正後・JST） ---");
  for (const r of sample) {
    console.log(`  ${r.table}.${r.column} id=${r.id}  ${jst(r.oldValue)}  →  ${jst(r.newValue)}   (基準 ${r.baseColumn}=${jst(r.baseValue)})`);
  }

  // idempotent 性の検証: 補正後の差が全件 NORMAL に入り SHIFTED から外れるか
  const afterKlass = targets.map((r) => classify(r.diffMs - SHIFT_MS));
  const notNormal = afterKlass.filter((k) => k !== "NORMAL").length;
  const stillShifted = afterKlass.filter((k) => k === "SHIFTED").length;
  console.log(
    `\n[idempotent検証] 補正後 NORMAL: ${targets.length - notNormal}/${targets.length} / 再び SHIFTED になる件数: ${stillShifted}`,
  );
  if (stillShifted > 0) {
    console.log("  !! 再実行で再度対象になるレコードがあります（idempotent 不成立）");
  }
  if (notNormal > 0) {
    console.log(`  !! 補正後に NORMAL に入らないレコードが ${notNormal} 件あります`);
  }

  const stamp = jstStamp(startedAt);
  const csvPath = writeCsv(targets, stamp);
  console.log(`\nロールバックCSV: ${csvPath} (${targets.length} 行)`);
  if (PRINT_CSV) {
    console.log("----8<---- CSV BEGIN ----8<----");
    process.stdout.write(buildCsv(targets));
    console.log("----8<---- CSV END ----8<----");
  }

  if (!EXECUTE) {
    console.log("\nDRY-RUN のため書き込みは行いませんでした。--execute で本実行します。");
    return;
  }

  // ---- T-169 G3/G4 の実行直前 再判定 ----
  if (unknownTotal > 0) {
    console.error(
      `\n中断: 判定不能(UNKNOWN)なレコードが ${unknownTotal} 件あります（T-169 G4 違反）。書き込みは一切行いません。`,
    );
    process.exitCode = 1;
    return;
  }
  if (targets.length === 0) {
    console.log("\n補正対象が0件のため、書き込みは行いませんでした。");
    return;
  }

  console.log(`\n--- 本実行: ${targets.length} 件を ${CHUNK} 件チャンクで更新します ---`);
  let done = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    await applyChunk(chunk);
    done += chunk.length;
    console.log(`  ${done}/${targets.length} 更新完了`);
  }
  console.log(`\n完了: ${done} 件を補正しました。`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  });

export {};
