/**
 * T-128 続き: 残 jobDb='マイナビJOB' AND isActive=true エントリーの仕分け＋機械修正
 *
 * 背景:
 *   T-128 で job-platform 経由19件・Circus 6件・川崎3件を修正済み。残19件について、
 *   job-platform 求人は現在100% HITO-Link（マイナビJOB求人は存在しない）ため、
 *   externalJobNo が内部連番（短い数字）や leading-ID 表記の件は「マイナビJOB表示だが
 *   実体は別媒体」のズレが疑われる。本スクリプトは対応 CandidateFile（BOOKMARK）の
 *   ファイル名規則と extractedText から実体媒体・番号を判定し、確定できる分だけ機械修正する。
 *
 * 対象:
 *   JobEntry で jobDb='マイナビJOB' AND isActive=true 全件を仕分け。
 *
 * 分類ルール（優先順位: HITO-Link > Circus > Bee > 正規マイナビ > CA確認）:
 *   (A) HITO-Link: bookmark の fileName または extractedText から /hl-ap-?\d{4,8}/i が
 *       取れる。番号 = 抽出した数字。
 *   (B) Circus:    bookmark の fileName に /_No\d{4,8}/i。番号 = No 以降の数字。
 *   (C) Bee:       bookmark の fileName が /：\d+\.pdf$/（全角コロン+数字）。番号 = コロン以降。
 *   (D) 正しいマイナビJOB:
 *        - bookmark 無しで externalJobNo が /^\d+_\d+_\d+$/ （rank_id_pref 形式）
 *        - もしくは bookmark 有りで fileName が `求人票_...pdf` 型かつ externalJobNo が
 *          4桁以上（rank composed 含む）
 *      → 変更不要（対象外）
 *   (E) 要CA確認: (A)-(D) いずれにも当てはまらない。1-3桁の内部連番 / leading-ID 型で
 *      hl-ap が extractedText に無い / 不明な pattern。機械修正対象外。
 *
 *   ⚠ プロンプト原文（"本文/ファイル名から hl-ap-数字 が取れる → HITO-Link（番号=hl-ap数字）"）
 *   に忠実に従い、lastExportedTo='hito-link' 等の metadata 単独では HITO-Link 判定しない。
 *   これは番号を確定させる rule を守るため（番号未抽出の HITO-Link 化は禁）。
 *
 * 更新内容（機械修正対象のみ）:
 *   jobDb = 判定媒体
 *   externalJobNo = 規則で取れた番号
 *   jobType が新 jobDb の JOB_TYPE_BY_ROUTE 選択肢外なら null リセット
 *
 * 冪等・失敗隔離。--dry-run 既定 / --execute。
 * ロールバック CSV を verify/ に出力（execute でも出力）。
 * 「正しいマイナビJOB」「要CA確認」は対象外（DB は触らない）が CSV には全件記載。
 *
 * 実行:
 *   npx tsx scripts/fix-remaining-mynavi-entries.ts            # DRY-RUN
 *   npx tsx scripts/fix-remaining-mynavi-entries.ts --execute  # 本実行
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EXECUTE = process.argv.includes("--execute");
const MODE = EXECUTE ? "EXECUTE" : "DRY-RUN";

// lib/constants/job-types.ts JOB_TYPE_BY_ROUTE と同一。
const HITO_LINK_JOB_TYPES = new Set(["DODA求人", "パーソル求人"]);
const CIRCUS_JOB_TYPES = new Set(["自社求人", "事務局求人", "直接求人", "share求人"]);
const BEE_JOB_TYPES = new Set(["ネオキャリア求人"]);

const HL_RE = /hl-ap-?(\d{4,8})/i;
const CIRCUS_RE = /_No(\d{4,8})/i;
const BEE_RE = /：(\d+)\.pdf$/;
// マイナビJOB のランク合成 externalJobNo（rank=3_id_prefectureCode）。
const MYNAVI_COMPOSITE_RE = /^3_\d+_\d+$/;

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

type Classification = "HITO-Link" | "Circus" | "Bee" | "正しいマイナビJOB" | "要CA確認";

type Plan = {
  entryId: string;
  candidateId: string;
  companyName: string;
  beforeJobDb: string | null;
  beforeJobNo: string | null;
  beforeJobType: string | null;
  bmFileName: string | null;
  bmSourceType: string | null;
  bmSourceMedia: string | null;
  bmExternalJobRef: string | null;
  bmLastExportedTo: string | null;
  classification: Classification;
  afterJobDb: string | null; // null = 触らない
  afterJobNo: string | null; // null = 触らない
  afterJobType: string | null; // null かつ resetJobType=true のみ実際に null 書込
  resetJobType: boolean;
  extractedNumber: string | null; // 抽出した数字（記録用）
  detectionSource: string; // "fileName" / "extractedText" / "-"
  note: string;
};

function classify(entry: {
  companyName: string;
  externalJobNo: string | null;
  jobType: string | null;
}, bm: { fileName: string; extractedText: string | null } | null): {
  classification: Classification;
  afterJobDb: string | null;
  afterJobNo: string | null;
  extractedNumber: string | null;
  detectionSource: string;
  allowedJobTypes: Set<string> | null;
  note: string;
} {
  // (A) HITO-Link: fileName または extractedText に hl-ap-\d+
  if (bm) {
    const fn = bm.fileName ?? "";
    const tx = bm.extractedText ?? "";
    const mF = fn.match(HL_RE);
    if (mF) {
      return { classification: "HITO-Link", afterJobDb: "HITO-Link", afterJobNo: mF[1], extractedNumber: mF[1], detectionSource: "fileName", allowedJobTypes: HITO_LINK_JOB_TYPES, note: "" };
    }
    const mT = tx.match(HL_RE);
    if (mT) {
      return { classification: "HITO-Link", afterJobDb: "HITO-Link", afterJobNo: mT[1], extractedNumber: mT[1], detectionSource: "extractedText", allowedJobTypes: HITO_LINK_JOB_TYPES, note: "" };
    }
    // (B) Circus: _No\d+
    const mC = fn.match(CIRCUS_RE);
    if (mC) {
      return { classification: "Circus", afterJobDb: "Circus", afterJobNo: mC[1], extractedNumber: mC[1], detectionSource: "fileName", allowedJobTypes: CIRCUS_JOB_TYPES, note: "" };
    }
    // (C) Bee: ：\d+.pdf$
    const mB = fn.match(BEE_RE);
    if (mB) {
      return { classification: "Bee", afterJobDb: "Bee", afterJobNo: mB[1], extractedNumber: mB[1], detectionSource: "fileName", allowedJobTypes: BEE_JOB_TYPES, note: "" };
    }
  }

  // (D) 正しいマイナビJOB
  const no = entry.externalJobNo ?? "";
  if (MYNAVI_COMPOSITE_RE.test(no)) {
    return { classification: "正しいマイナビJOB", afterJobDb: null, afterJobNo: null, extractedNumber: null, detectionSource: "-", allowedJobTypes: null, note: "rank_id_pref 形式" };
  }
  if (bm && /^求人票[_]?/.test(bm.fileName) && /^\d{4,}$/.test(no)) {
    return { classification: "正しいマイナビJOB", afterJobDb: null, afterJobNo: null, extractedNumber: null, detectionSource: "-", allowedJobTypes: null, note: "求人票_...pdf + 4桁以上" };
  }

  // (E) 要CA確認
  const reason = !bm
    ? "bookmark 無し・externalJobNo が rank_id_pref 形式でない"
    : "fileName/extractedText から HITO-Link/Circus/Bee のいずれのパターンも取れず";
  return { classification: "要CA確認", afterJobDb: null, afterJobNo: null, extractedNumber: null, detectionSource: "-", allowedJobTypes: null, note: reason };
}

async function main() {
  console.log(`=== T-128 残マイナビJOB 仕分け＋機械修正 (mode=${MODE}) ===\n`);

  const entries = await prisma.jobEntry.findMany({
    where: { jobDb: "マイナビJOB", isActive: true },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      jobDb: true,
      jobType: true,
      externalJobNo: true,
      entryDate: true,
    },
    orderBy: [{ candidateId: "asc" }, { entryDate: "desc" }],
  });
  const candidateIds = [...new Set(entries.map((e) => e.candidateId))];

  const bookmarks = await prisma.candidateFile.findMany({
    where: { candidateId: { in: candidateIds }, category: "BOOKMARK", archivedAt: null },
    select: {
      id: true,
      candidateId: true,
      fileName: true,
      sourceType: true,
      sourceMedia: true,
      externalJobRef: true,
      lastExportedTo: true,
      extractedText: true,
    },
  });

  // candidateId × normalizedCompanyKey → bookmark（会社名一致）
  const idx = new Map<string, Map<string, typeof bookmarks[number]>>();
  for (const bm of bookmarks) {
    const stem = bm.fileName
      .replace(/\.pdf$/i, "")
      .replace(/^求人票[_]?/, "")
      .replace(/_No\d{4,8}$/i, "")
      .replace(/：\d+$/, "");
    const key = normalizeCompany(stem);
    if (!idx.has(bm.candidateId)) idx.set(bm.candidateId, new Map());
    const inner = idx.get(bm.candidateId)!;
    if (!inner.has(key)) inner.set(key, bm);
  }

  const plans: Plan[] = [];
  for (const e of entries) {
    const key = normalizeCompany(e.companyName);
    let bm = idx.get(e.candidateId)?.get(key);
    if (!bm) {
      // 部分一致フォールバック（Circus/kawasaki スクリプトと同ルール）
      const inner = idx.get(e.candidateId);
      if (inner) {
        for (const [bkey, bval] of inner) {
          if (bkey && (bkey.includes(key) || key.includes(bkey))) {
            bm = bval;
            break;
          }
        }
      }
    }

    const cls = classify(e, bm ? { fileName: bm.fileName, extractedText: bm.extractedText } : null);
    const needsReset =
      cls.classification !== "正しいマイナビJOB" &&
      cls.classification !== "要CA確認" &&
      e.jobType != null &&
      cls.allowedJobTypes != null &&
      !cls.allowedJobTypes.has(e.jobType);

    plans.push({
      entryId: e.id,
      candidateId: e.candidateId,
      companyName: e.companyName,
      beforeJobDb: e.jobDb,
      beforeJobNo: e.externalJobNo,
      beforeJobType: e.jobType,
      bmFileName: bm?.fileName ?? null,
      bmSourceType: bm?.sourceType ?? null,
      bmSourceMedia: bm?.sourceMedia ?? null,
      bmExternalJobRef: bm?.externalJobRef ?? null,
      bmLastExportedTo: bm?.lastExportedTo ?? null,
      classification: cls.classification,
      afterJobDb: cls.afterJobDb,
      afterJobNo: cls.afterJobNo,
      afterJobType: needsReset ? null : e.jobType,
      resetJobType: needsReset,
      extractedNumber: cls.extractedNumber,
      detectionSource: cls.detectionSource,
      note: cls.note,
    });
  }

  const byClass = new Map<Classification, Plan[]>();
  for (const p of plans) {
    if (!byClass.has(p.classification)) byClass.set(p.classification, []);
    byClass.get(p.classification)!.push(p);
  }

  console.log(`対象エントリー: ${entries.length}件`);
  console.log(`分類サマリ:`);
  for (const cls of ["HITO-Link", "Circus", "Bee", "正しいマイナビJOB", "要CA確認"] as Classification[]) {
    console.log(`  ${cls}: ${byClass.get(cls)?.length ?? 0}件`);
  }

  const changed = plans.filter(
    (p) =>
      p.afterJobDb !== null &&
      (p.beforeJobDb !== p.afterJobDb || (p.beforeJobNo ?? null) !== p.afterJobNo || p.resetJobType),
  );
  const resetCount = changed.filter((p) => p.resetJobType).length;
  console.log(`\n機械修正対象（差分あり）: ${changed.length}件（うち jobType リセット: ${resetCount}件）`);

  // ---------- 全件一覧表示 ----------
  console.log(`\n=== 全19件仕分け一覧 ===`);
  console.log(
    [
      "分類",
      "cid[:12]",
      "entryId[:14]",
      "会社名",
      "現jobDb",
      "現jobNo",
      "現jobType",
      "→jobDb",
      "→jobNo",
      "→jobType",
      "検出元",
      "bmFileName",
      "bmSourceType",
      "bmSourceMedia",
      "bmLastExportedTo",
      "備考",
    ].join(" | "),
  );
  for (const p of plans) {
    console.log(
      [
        p.classification,
        p.candidateId.slice(0, 12),
        p.entryId.slice(0, 14),
        p.companyName,
        p.beforeJobDb ?? "",
        p.beforeJobNo ?? "",
        p.beforeJobType ?? "",
        p.afterJobDb ?? "(no change)",
        p.afterJobNo ?? "(no change)",
        p.resetJobType ? "null(reset)" : p.afterJobType ?? "",
        p.detectionSource,
        p.bmFileName ?? "(no bookmark)",
        p.bmSourceType ?? "",
        p.bmSourceMedia ?? "",
        p.bmLastExportedTo ?? "",
        p.note,
      ].join(" | "),
    );
  }

  // ---------- 監査 / ロールバック CSV（全19件記録） ----------
  const verifyDir = path.join(process.cwd(), "verify");
  if (!fs.existsSync(verifyDir)) fs.mkdirSync(verifyDir, { recursive: true });
  const stamp = ts();
  const rbPath = path.join(verifyDir, `t128-remaining-mynavi-rollback-${MODE.toLowerCase()}-${stamp}.csv`);
  const rows: string[] = [];
  rows.push(
    [
      "classification",
      "entryId",
      "candidateId",
      "companyName",
      "beforeJobDb",
      "beforeExternalJobNo",
      "beforeJobType",
      "afterJobDb",
      "afterExternalJobNo",
      "afterJobType",
      "resetJobType",
      "extractedNumber",
      "detectionSource",
      "bmFileName",
      "bmSourceType",
      "bmSourceMedia",
      "bmExternalJobRef",
      "bmLastExportedTo",
      "note",
    ]
      .map(csvEscape)
      .join(","),
  );
  for (const p of plans) {
    rows.push(
      [
        p.classification,
        p.entryId,
        p.candidateId,
        p.companyName,
        p.beforeJobDb,
        p.beforeJobNo,
        p.beforeJobType,
        p.afterJobDb,
        p.afterJobNo,
        p.afterJobType,
        p.resetJobType ? "1" : "0",
        p.extractedNumber,
        p.detectionSource,
        p.bmFileName,
        p.bmSourceType,
        p.bmSourceMedia,
        p.bmExternalJobRef,
        p.bmLastExportedTo,
        p.note,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(rbPath, rows.join("\n"), "utf8");
  console.log(`\nRollback/Audit CSV: ${rbPath}`);

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
  for (const p of changed) {
    try {
      await prisma.jobEntry.update({
        where: { id: p.entryId },
        data: {
          jobDb: p.afterJobDb!,
          externalJobNo: p.afterJobNo!,
          ...(p.resetJobType ? { jobType: null } : {}),
        },
      });
      ok++;
    } catch (e) {
      err++;
      console.error(`  update failed entryId=${p.entryId}:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`  JobEntry 更新: 成功=${ok} / 失敗=${err}（うち jobType リセット: ${resetCount}件）`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
