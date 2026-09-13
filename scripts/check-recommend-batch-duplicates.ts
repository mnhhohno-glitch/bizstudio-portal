// T-189 修正: AI評価バッチの二重投入チェック。
//
// 目的: 同一 CandidateFile が複数のバッチ（batch_id）へ投入されていないことを確認する。
//   2026-09-03 11:52 の「今すぐ探す」で、同一15ファイルが 0.355秒差で2バッチに投入され
//   ¥59 が無駄になった。投入経路の一本化＋台帳の事前予約（RESERVED）で再発しないことを、
//   このスクリプトで日次・随時に検算する。
//
// 使い方（本番DBは railway ssh 経由）:
//   npx tsx --env-file=.env scripts/check-recommend-batch-duplicates.ts           # 本日(JST)分
//   npx tsx --env-file=.env scripts/check-recommend-batch-duplicates.ts --days 7  # 直近7日
//   npx tsx --env-file=.env scripts/check-recommend-batch-duplicates.ts --all     # 全期間
//   npx tsx --env-file=.env scripts/check-recommend-batch-duplicates.ts --since "2026-09-03T14:00:00+09:00"
//
// 判定: 同じ fileId が「異なる batch_id」の台帳行に2回以上現れたら重複。
//   RESERVED（batch_id が未確定の placeholder）と、投入に至らなかった FAILED / EXPIRED は
//   費用が発生していないので重複としては数えない（ただし件数だけ表示する）。
// 終了コード: 重複0なら 0、重複ありなら 1。
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const RESERVED_BATCH_PLACEHOLDER = "reserved";
/** 実際に Anthropic へ投入された（＝費用が発生しうる）台帳ステータス。 */
const SUBMITTED_STATUSES = ["SUBMITTED", "COLLECTING", "COMPLETED", "FAILED", "EXPIRED"];

function parseArgs() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const di = argv.indexOf("--days");
  const si = argv.indexOf("--since");
  const sinceArg = si >= 0 ? new Date(argv[si + 1] ?? "") : null;
  const days = di >= 0 ? Number.parseInt(argv[di + 1] ?? "", 10) : NaN;
  return {
    all,
    days: Number.isFinite(days) && days > 0 ? days : null,
    sinceArg: sinceArg && !Number.isNaN(sinceArg.getTime()) ? sinceArg : null,
  };
}

/** JST の「今日の 00:00」を UTC の Date で返す（JST = UTC+9）。 */
function jstTodayStartUtc(): Date {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = nowJst.getUTCFullYear();
  const m = nowJst.getUTCMonth();
  const d = nowJst.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 9 * 60 * 60 * 1000);
}

function jst(dt: Date): string {
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

async function main() {
  const { all, days, sinceArg } = parseArgs();
  const since = all
    ? null
    : (sinceArg ?? (days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : jstTodayStartUtc()));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const rows = await prisma.recommendAnalyzeBatch.findMany({
      where: since ? { submittedAt: { gte: since } } : {},
      select: {
        id: true,
        batchId: true,
        candidateId: true,
        fileIds: true,
        status: true,
        submittedAt: true,
      },
      orderBy: { submittedAt: "asc" },
    });

    const scope = all ? "全期間" : since ? `${jst(since)} JST 以降` : "本日(JST)";
    console.log(`対象: ${scope} / 台帳行 ${rows.length}件`);

    const reserved = rows.filter((r) => r.batchId === RESERVED_BATCH_PLACEHOLDER);
    if (reserved.length > 0) {
      console.log(
        `  うち投入前の予約(RESERVED相当) ${reserved.length}行: ` +
          reserved.map((r) => `${r.id.slice(0, 8)}/${r.status}`).join(", "),
      );
    }

    // fileId → それが載った batchId の集合（実投入された行のみ）
    const batchesByFile = new Map<string, Map<string, { rowId: string; status: string; at: Date }>>();
    let submittedRows = 0;
    for (const r of rows) {
      if (r.batchId === RESERVED_BATCH_PLACEHOLDER) continue;
      if (!SUBMITTED_STATUSES.includes(r.status)) continue;
      submittedRows++;
      const fileIds = Array.isArray(r.fileIds)
        ? r.fileIds.filter((v): v is string => typeof v === "string")
        : [];
      for (const fid of fileIds) {
        const m = batchesByFile.get(fid) ?? new Map();
        // 同一バッチ内の重複（あり得ないが念のため）は1回として数える
        if (!m.has(r.batchId)) m.set(r.batchId, { rowId: r.id, status: r.status, at: r.submittedAt });
        batchesByFile.set(fid, m);
      }
    }
    console.log(`  うち実投入された行 ${submittedRows}件 / 対象ファイル延べ ${batchesByFile.size}件（ユニーク）`);

    const dupFiles = [...batchesByFile.entries()].filter(([, m]) => m.size > 1);
    if (dupFiles.length === 0) {
      console.log("\n✅ 重複投入なし（同一ファイルが2つ以上のバッチに入っている例は0件）");
      return 0;
    }

    // 重複を「バッチの組み合わせ」でまとめて表示する
    const byPair = new Map<string, { files: string[]; detail: string }>();
    for (const [fid, m] of dupFiles) {
      const key = [...m.keys()].sort().join(" + ");
      const entry = byPair.get(key) ?? {
        files: [],
        detail: [...m.entries()]
          .map(([bid, v]) => `${bid} (${v.status} ${jst(v.at)} JST)`)
          .join("\n      "),
      };
      entry.files.push(fid);
      byPair.set(key, entry);
    }

    console.log(`\n❌ 重複投入 ${dupFiles.length}ファイル / ${byPair.size}組`);
    for (const [key, v] of byPair) {
      console.log(`\n  組: ${key}`);
      console.log(`      ${v.detail}`);
      console.log(`      重複ファイル ${v.files.length}件: ${v.files.slice(0, 5).join(", ")}${v.files.length > 5 ? " …" : ""}`);
    }
    return 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
