/**
 * T-128 続き: 株式会社リンクスタッフ・株式会社日本ビジネスデータープロセシングセンターの
 *   マイナビJOB → HITO-Link 正値化（対象2エントリー）
 *
 * 対象（現 jobDb='マイナビJOB' AND isActive=true・番号は leading-ID 型）:
 *   #18 リンクスタッフ  entryId=cmr1m3qqb003w1dn6o7zjdoy8  externalJobNo=34232
 *   #19 日本ビジネスDPC entryId=cmqolu3g5009w1dnthlmtyhf8  externalJobNo=22169
 *
 * 背景: fix-remaining-mynavi-entries.ts の dry-run で、対応ブックマークが
 *   sourceType=null / lastExportedTo=hito-link・fileName が {leading-id}_{company}.pdf
 *   型の「要CA確認」バケットに落ちた2件。同じ candidateId の他ブックマークも同型で
 *   lastExportedTo=hito-link のため、実体は HITO-Link で確定。
 *   ただし fileName・extractedText に hl-ap-\d+ が見当たらず（本文/ファイル名からは
 *   復元不可）、番号は bizstudio-job-platform（Supabase）台帳の source_media='hito_link'
 *   を照合して復元する必要がある。
 *
 * 復元手順:
 *   (1) Supabase 接続情報（SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）が両方セットされて
 *       いる場合のみ照合。会社名を正規化（法人格除去・NFKC・空白除去）後、
 *       jobs.source_media='hito_link' AND normalized_company= キー で検索。
 *       単一ヒットのとき source_job_id 末尾連続数字を復元番号として採用。
 *   (2) URL が無い / ヒット 0 / 複数ヒット → 番号復元は不可。
 *       このときは jobDb='HITO-Link' への媒体変更のみ実施（externalJobNo は現状維持）。
 *
 * 更新（両ケース共通）:
 *   jobDb = 'HITO-Link'
 *   externalJobNo = 復元成功時のみ更新（失敗時は既存 leading-ID を維持）
 *   jobType が {DODA求人, パーソル求人} 外なら null リセット
 *
 * 冪等・失敗隔離。--dry-run（既定）/ --execute。
 * ロールバック CSV を verify/ に出力（execute でも出力）。
 *
 * 実行:
 *   npx tsx scripts/fix-t128-linkstaff-jbdpc.ts            # DRY-RUN
 *   npx tsx scripts/fix-t128-linkstaff-jbdpc.ts --execute  # 本実行
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

const TARGET_JOB_DB = "HITO-Link";
const HITO_LINK_JOB_TYPES = new Set(["DODA求人", "パーソル求人"]);

// entryId 明示・スコープ限定（fix-remaining-mynavi-entries.ts dry-run の要CA確認 3件のうち #18/#19）。
const TARGETS: Array<{ label: string; entryId: string; expectedJobNo: string }> = [
  { label: "株式会社リンクスタッフ",                             entryId: "cmr1m3qqb003w1dn6o7zjdoy8", expectedJobNo: "34232" },
  { label: "株式会社日本ビジネスデータープロセシングセンター", entryId: "cmqolu3g5009w1dnthlmtyhf8", expectedJobNo: "22169" },
];

function normalizeCompany(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function ts(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${day}-${h}${mm}`;
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type LookupResult = {
  attempted: boolean;
  connected: boolean;
  hits: number;
  recoveredNumber: string | null; // 単一ヒット時のみ非null
  sourceJobId: string | null;
  note: string;
};

async function lookupJobNumber(companyName: string): Promise<LookupResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      attempted: false, connected: false, hits: 0, recoveredNumber: null, sourceJobId: null,
      note: "SUPABASE_URL 未設定（.env）→ 台帳照合スキップ。媒体のみ HITO-Link 化する（フォールバック）",
    };
  }
  const target = normalizeCompany(companyName);
  try {
    const supa = createClient(url, key);
    // 会社名正規化列があるとは限らないので、まず生 company 列で ilike 検索し client 側で normalize 比較。
    const { data, error } = await supa
      .from("jobs")
      .select("source_job_id, company, source_media")
      .eq("source_media", "hito_link")
      .ilike("company", `%${companyName.replace(/株式会社|有限会社|合同会社/g, "").trim()}%`)
      .limit(50);
    if (error) {
      return { attempted: true, connected: false, hits: 0, recoveredNumber: null, sourceJobId: null, note: `supabase error: ${error.message}` };
    }
    const rows = data ?? [];
    const filtered = rows.filter((r: { company: string | null }) => normalizeCompany(r.company ?? "") === target);
    if (filtered.length === 0) {
      return { attempted: true, connected: true, hits: 0, recoveredNumber: null, sourceJobId: null, note: `台帳 0ヒット（source_media='hito_link'・正規化会社名一致なし）` };
    }
    if (filtered.length > 1) {
      const ids = filtered.slice(0, 5).map((r: { source_job_id: string | null }) => r.source_job_id ?? "-").join(",");
      return { attempted: true, connected: true, hits: filtered.length, recoveredNumber: null, sourceJobId: null, note: `台帳 ${filtered.length}件ヒット・一意でないため番号復元不可 (sample: ${ids})` };
    }
    const sid = String(filtered[0].source_job_id ?? "");
    const m = sid.match(/(\d+)\s*$/);
    return {
      attempted: true, connected: true, hits: 1,
      recoveredNumber: m ? m[1] : null,
      sourceJobId: sid,
      note: m ? `台帳一意ヒット・source_job_id=${sid} → 末尾数字=${m[1]}` : `台帳一意ヒット・source_job_id=${sid} に末尾数字なし（復元失敗）`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { attempted: true, connected: false, hits: 0, recoveredNumber: null, sourceJobId: null, note: `supabase connect fail: ${msg}` };
  }
}

async function main() {
  console.log(`=== T-128 リンクスタッフ / 日本ビジネスDPC HITO-Link 化 (mode=${MODE}) ===\n`);

  type Plan = {
    label: string;
    entryId: string;
    entryCompanyName: string;
    beforeJobDb: string | null;
    afterJobDb: string;
    beforeJobNo: string | null;
    afterJobNo: string | null; // null = 触らない
    beforeJobType: string | null;
    afterJobType: string | null;
    resetJobType: boolean;
    lookup: LookupResult;
  };

  const plans: Plan[] = [];

  for (const t of TARGETS) {
    const entry = await prisma.jobEntry.findUnique({
      where: { id: t.entryId },
      select: { id: true, companyName: true, jobDb: true, jobType: true, externalJobNo: true, candidateId: true },
    });
    if (!entry) {
      console.error(`  ⚠ entryId=${t.entryId} 見つからず。スキップ`);
      continue;
    }
    if (entry.jobDb !== "マイナビJOB") {
      console.log(`  ℹ entryId=${t.entryId} は既に jobDb=${entry.jobDb}（マイナビJOB でない）→ 冪等スキップ`);
      continue;
    }
    if (entry.externalJobNo !== t.expectedJobNo) {
      console.warn(`  ⚠ entryId=${t.entryId} externalJobNo=${entry.externalJobNo} が期待値=${t.expectedJobNo} と不一致。安全のためスキップ`);
      continue;
    }

    // fileName から会社名を復元（`{leading-id}_{会社名}_{任意}.pdf`）。DB の companyName にも leading-id が
    // 混入している（`22169_株式会社...`）ので、台帳照合には leading-id を除去したラベル（t.label）を使う。
    const lookup = await lookupJobNumber(t.label);

    const currentType = entry.jobType;
    const needsReset = currentType != null && !HITO_LINK_JOB_TYPES.has(currentType);
    plans.push({
      label: t.label,
      entryId: t.entryId,
      entryCompanyName: entry.companyName,
      beforeJobDb: entry.jobDb,
      afterJobDb: TARGET_JOB_DB,
      beforeJobNo: entry.externalJobNo,
      afterJobNo: lookup.recoveredNumber ?? null,
      beforeJobType: currentType,
      afterJobType: needsReset ? null : currentType,
      resetJobType: needsReset,
      lookup,
    });
  }

  console.log(`\n=== 照合結果 ===`);
  for (const p of plans) {
    console.log(`  ${p.label} entryId=${p.entryId}`);
    console.log(`    照合: ${p.lookup.note}`);
    console.log(`    jobDb:   ${p.beforeJobDb ?? "null"} → ${p.afterJobDb}`);
    console.log(`    jobNo:   ${p.beforeJobNo ?? "null"} → ${p.afterJobNo ?? "(現状維持)"}`);
    console.log(`    jobType: ${p.beforeJobType ?? "null"} → ${p.afterJobType ?? "null"}${p.resetJobType ? " (reset)" : ""}`);
  }

  // ---------- ロールバック CSV ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const rbPath = path.join(verifyDir, `t128-linkstaff-jbdpc-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  const rows: string[] = [];
  rows.push(
    [
      "label", "entryId", "entryCompanyName",
      "beforeJobDb", "beforeExternalJobNo", "beforeJobType",
      "afterJobDb", "afterExternalJobNo", "afterJobType",
      "resetJobType",
      "lookupAttempted", "lookupConnected", "lookupHits", "recoveredNumber", "sourceJobId", "lookupNote",
    ].map(csvEscape).join(","),
  );
  for (const p of plans) {
    rows.push([
      p.label, p.entryId, p.entryCompanyName,
      p.beforeJobDb, p.beforeJobNo, p.beforeJobType,
      p.afterJobDb, p.afterJobNo, p.afterJobType,
      p.resetJobType ? "1" : "0",
      p.lookup.attempted ? "1" : "0",
      p.lookup.connected ? "1" : "0",
      String(p.lookup.hits),
      p.lookup.recoveredNumber,
      p.lookup.sourceJobId,
      p.lookup.note,
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(rbPath, rows.join("\n"), "utf8");
  console.log(`\nRollback CSV: ${rbPath}`);

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN: 処理未実行。--execute を付けて再実行してください。)`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // ---------- EXECUTE ----------
  console.log(`\n=== EXECUTE ===`);
  let ok = 0;
  let err = 0;
  for (const p of plans) {
    try {
      await prisma.jobEntry.update({
        where: { id: p.entryId },
        data: {
          jobDb: p.afterJobDb,
          ...(p.afterJobNo != null ? { externalJobNo: p.afterJobNo } : {}),
          ...(p.resetJobType ? { jobType: null } : {}),
        },
      });
      ok++;
      console.log(`  ✓ ${p.label} entryId=${p.entryId} 更新完了`);
    } catch (e) {
      err++;
      console.error(`  ✗ update failed entryId=${p.entryId}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  JobEntry 更新: 成功=${ok} / 失敗=${err}`);

  // 検証: 残マイナビJOB 件数
  const remaining = await prisma.jobEntry.count({ where: { jobDb: "マイナビJOB", isActive: true } });
  console.log(`\n[検証] 残 jobDb='マイナビJOB' AND isActive=true 件数: ${remaining}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
