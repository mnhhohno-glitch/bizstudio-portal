/**
 * T-182 AI求人評価 第4回精度検証（読み取り専用・集計のみ）
 *
 * 実行環境: Railway 本番コンテナ（cwd=/app）
 *   railway ssh --service bizstudio-portal -- 'cd /app && node t182_verification4.cjs'
 *
 * 出力: stdout に JSON（<<<T182_JSON>>> 〜 <<<END>>> で囲う）
 *
 * 第3回（2026-07-16）と同一ロジック:
 *   - 3軸ランクは CandidateFile.aiAnalysisComment の正規表現抽出（aiMatchRating は使わない）
 *   - 母数は送信済み（lastExportedAt 非null）
 *   - 応募到達 = 同一 candidateId の job_entries で company_name / file_name の
 *     正規化値が双方向 substring 一致する行が1件以上
 *   - 正規化 = stripFileMetadata -> stripCorpSuffixes -> NFKC -> toLowerCase
 *   - 最深到達ステージは日付列の非 null で判定
 *   - JobEntry は isActive / archivedAt でフィルタしない
 *
 * 第3回スクリプトは repo に残っていないため再現実装。
 * 正規化は src/lib/normalize-filename.ts の実装をそのまま移植している。
 */
const { Pool } = require("pg");

// ===== 期間定義（JST基準・UTCで表現） =====
const PERIOD_START = "2026-05-13T15:00:00Z"; // JST 2026-05-14 00:00
const PERIOD_END = "2026-08-28T15:00:00Z"; // JST 2026-08-29 00:00（8/28 24:00）
const MATURE_CUTOFF = new Date("2026-08-07T15:00:00Z"); // JST 2026-08-08 00:00 未満 = 送信から3週間以上
const ENTRY_SETTLED_CUTOFF = new Date("2026-07-17T15:00:00Z"); // 応募から6週間以上経過
// 章の境界（createdAt / JST）
const SEG1_END = new Date("2026-07-16T15:00:00Z"); // JST 7/17 00:00
const T146_BOUNDARY = new Date("2026-07-28T15:00:00Z"); // JST 7/29 00:00（B+ 新設 801eecd 7/28 18:29）
const T180_BOUNDARY = new Date("2026-08-24T15:00:00Z"); // JST 8/25 00:00（T-180 反映 1707068）

// ===== 正規化（src/lib/normalize-filename.ts より移植） =====
function stripFileMetadata(fileName) {
  return fileName
    .replace(/\.pdf$/i, "")
    .replace(/^求人票[_]?/, "")
    .replace(/^\d+_/, "")
    .replace(/_\d{10,}$/, "")
    .replace(/[：:]\d+$/, "")
    .replace(/_No\d+$/i, "")
    .trim();
}
const CORP_SUFFIXES = /株式会社|有限会社|合同会社|一般財団法人|公益財団法人|一般社団法人|合資会社/g;
function stripCorpSuffixes(name) {
  return name.replace(CORP_SUFFIXES, "").trim();
}
function norm(s) {
  if (!s) return "";
  return stripCorpSuffixes(stripFileMetadata(String(s))).normalize("NFKC").toLowerCase().trim();
}

// ===== 3軸抽出 =====
function stripBold(c) {
  return c.replace(/\*\*/g, "");
}
function axWish(c) {
  const m = stripBold(c).match(/■\s*本人希望[：:\s]*([ABCD])/);
  return m ? m[1] : null;
}
function axPass(c) {
  const m = stripBold(c).match(/■\s*通過率[：:\s]*([ABCD])/);
  return m ? m[1] : null;
}
function axPassLoose(c) {
  const m = stripBold(c).match(/(?:■\s*)?通過率[：:\s]*([ABCD])/);
  return m ? m[1] : null;
}
// 総合は T-146(2026-07-28) 以降 B+ が存在する。B+ を先に試す（[ABCD] だと B と誤読）
function axOverall(c) {
  const m = stripBold(c).match(/■\s*総合[：:\s]*(B\+|[ABCD])/);
  return m ? m[1] : null;
}

// ===== 選考分析 新形式（T-180）の × 個数 =====
const CA_MARK_CLASS = "[〇○◯▲△×✕✖]";
const ITEM_LINE_RE = new RegExp(`^\\s*【([^】]+)】\\s*(${CA_MARK_CLASS})\\s*$`);
function caMarks(comment) {
  let items = 0;
  let ng = 0;
  for (const raw of comment.split("\n")) {
    const m = raw.replace(/\*\*/g, "").match(ITEM_LINE_RE);
    if (!m) continue;
    items++;
    if (m[2] === "×" || m[2] === "✕" || m[2] === "✖") ng++;
  }
  return { items, ng };
}

// ===== ステージ =====
const STAGE_NAMES = ["エントリーのみ", "書類通過", "一次", "二次", "最終", "内定", "承諾"];
function stageOf(e) {
  if (e.acceptance_date) return 6;
  if (e.offer_date) return 5;
  if (e.final_interview_date) return 4;
  if (e.second_interview_date) return 3;
  if (e.first_interview_date) return 2;
  if (e.document_pass_date) return 1;
  return 0;
}

// ===== 集計ヘルパ =====
const RANKS = ["A", "B", "C", "D"];
const RANKS_OVERALL = ["A", "B+", "B", "C", "D"];

function rateTable(rows, rankKey, ranks) {
  const out = {};
  for (const r of ranks) out[r] = { n: 0, applied: 0 };
  let tot = { n: 0, applied: 0 };
  for (const b of rows) {
    const k = b[rankKey];
    if (!k || !out[k]) continue;
    out[k].n++;
    tot.n++;
    if (b.applied) {
      out[k].applied++;
      tot.applied++;
    }
  }
  out.__total = tot;
  return out;
}

function progressTable(rows, rankKey, ranks) {
  // rows: 応募到達のみ
  const out = {};
  for (const r of ranks) out[r] = { n: 0, prog: 0 };
  let tot = { n: 0, prog: 0 };
  for (const b of rows) {
    const k = b[rankKey];
    if (!k || !out[k]) continue;
    out[k].n++;
    tot.n++;
    if (b.stage >= 1) {
      out[k].prog++;
      tot.prog++;
    }
  }
  out.__total = tot;
  return out;
}

function distTable(rows, rankKey, ranks) {
  const out = {};
  for (const r of ranks) out[r] = 0;
  let n = 0;
  for (const b of rows) {
    const k = b[rankKey];
    if (!k || !(k in out)) continue;
    out[k]++;
    n++;
  }
  out.__n = n;
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // --- ブックマーク取得 ---
  const bkRes = await pool.query(
    `SELECT id, candidate_id, file_name, ai_analysis_comment, last_exported_at, created_at, kyuujin_job_id
       FROM candidate_files
      WHERE category = 'BOOKMARK'
        AND created_at >= $1 AND created_at < $2`,
    [PERIOD_START, PERIOD_END]
  );
  const rawBk = bkRes.rows;

  const candidateIds = [...new Set(rawBk.map((b) => b.candidate_id))];

  // --- エントリー取得 ---
  const enRes = await pool.query(
    `SELECT candidate_id, company_name, entry_date, document_pass_date,
            first_interview_date, second_interview_date, final_interview_date,
            offer_date, acceptance_date
       FROM job_entries
      WHERE candidate_id = ANY($1::text[])`,
    [candidateIds]
  );
  const entriesByCand = new Map();
  for (const e of enRes.rows) {
    e.__norm = norm(e.company_name);
    e.__stage = stageOf(e);
    if (!entriesByCand.has(e.candidate_id)) entriesByCand.set(e.candidate_id, []);
    entriesByCand.get(e.candidate_id).push(e);
  }

  // --- マイページ回答取得 ---
  const cjrRes = await pool.query(
    `SELECT candidate_id, external_job_id, response
       FROM candidate_job_responses
      WHERE candidate_id = ANY($1::text[])`,
    [candidateIds]
  );
  const cjrMap = new Map();
  for (const r of cjrRes.rows) cjrMap.set(`${r.candidate_id}|${r.external_job_id}`, r.response);

  // --- 加工 ---
  const bks = [];
  let noComment = 0;
  let extractFail = 0; // コメントあり・3軸すべて未抽出
  let passOnlyLoose = 0; // ■ なしでのみ通過率が取れる件数
  const failSamples = [];

  for (const b of rawBk) {
    const c = b.ai_analysis_comment;
    if (!c || !c.trim()) {
      noComment++;
      continue;
    }
    const wish = axWish(c);
    const pass = axPass(c);
    const overall = axOverall(c);
    if (!wish && !pass && !overall) {
      extractFail++;
      if (failSamples.length < 15) failSamples.push({ id: b.id, fileName: b.file_name, head: c.slice(0, 160) });
      continue;
    }
    if (!pass && axPassLoose(c)) passOnlyLoose++;

    // 応募到達判定
    const nf = norm(b.file_name);
    let applied = false;
    let stage = -1;
    let firstEntryDate = null;
    if (nf.length >= 2) {
      for (const e of entriesByCand.get(b.candidate_id) || []) {
        const ne = e.__norm;
        if (ne.length < 2) continue;
        if (nf.includes(ne) || ne.includes(nf)) {
          applied = true;
          if (e.__stage > stage) stage = e.__stage;
          const d = e.entry_date ? new Date(e.entry_date) : null;
          if (d && (!firstEntryDate || d < firstEntryDate)) firstEntryDate = d;
        }
      }
    }

    const marks = caMarks(c);
    const exportedAt = b.last_exported_at ? new Date(b.last_exported_at) : null;
    const createdAt = new Date(b.created_at);

    bks.push({
      id: b.id,
      candidateId: b.candidate_id,
      wish,
      pass,
      overall,
      applied,
      stage,
      firstEntryDate,
      createdAt,
      exportedAt,
      exported: exportedAt !== null,
      matureExp: exportedAt !== null && exportedAt < MATURE_CUTOFF,
      matureCre: exportedAt !== null && createdAt < MATURE_CUTOFF,
      kyuujinJobId: b.kyuujin_job_id,
      structured: marks.items > 0,
      ngCount: marks.ng,
    });
  }

  const exported = bks.filter((b) => b.exported);
  const matureExp = bks.filter((b) => b.matureExp);
  const matureCre = bks.filter((b) => b.matureCre);

  const out = {};

  out.meta = {
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    rawBookmarkRows: rawBk.length,
    noComment,
    extractFail,
    passOnlyLoose,
    failSamples,
    entriesFetched: enRes.rows.length,
    cjrFetched: cjrRes.rows.length,
    candidates: candidateIds.length,
  };

  // ===== Phase 1 =====
  const phase1 = (rows, label) => ({
    label,
    n: rows.length,
    wishN: rows.filter((b) => b.wish).length,
    passN: rows.filter((b) => b.pass).length,
    overallN: rows.filter((b) => b.overall).length,
    exported: rows.filter((b) => b.exported).length,
    exportedApplied: rows.filter((b) => b.exported && b.applied).length,
  });
  out.phase1 = {
    all: phase1(bks, "全期間(ランク付き)"),
    exported: phase1(exported, "全期間・送信済み"),
    matureExp: phase1(matureExp, "成熟分(lastExportedAt基準)"),
    matureCre: phase1(matureCre, "成熟分(createdAt基準・送信済み)"),
  };

  // ===== Phase 2 =====
  out.phase2 = {
    matureExp: rateTable(matureExp, "wish", RANKS),
    matureCre: rateTable(matureCre, "wish", RANKS),
    allExported: rateTable(exported, "wish", RANKS),
  };

  // ===== Phase 3 =====
  const segOf = (d) => (d < SEG1_END ? 1 : d < T180_BOUNDARY ? 2 : 3);
  const segOf146 = (d) => (d < SEG1_END ? "1" : d < T146_BOUNDARY ? "2a" : d < T180_BOUNDARY ? "2b" : "3");
  const seg = { 1: [], 2: [], 3: [] };
  const segMature = { 1: [], 2: [], 3: [] };
  const segExported = { 1: [], 2: [], 3: [] };
  const seg146Mature = { 1: [], "2a": [], "2b": [], 3: [] };
  for (const b of bks) {
    seg[segOf(b.createdAt)].push(b);
    if (b.exported) segExported[segOf(b.createdAt)].push(b);
    if (b.matureExp) {
      segMature[segOf(b.createdAt)].push(b);
      seg146Mature[segOf146(b.createdAt)].push(b);
    }
  }
  out.phase3 = {
    boundaries: {
      seg1: "JST 2026-05-14 〜 2026-07-16",
      seg2: "JST 2026-07-17 〜 2026-08-24 (T-180反映前日)",
      seg3: "JST 2026-08-25 〜 2026-08-28 (T-180反映後)",
      note146: "T-146 B+新設 JST 2026-07-28 18:29 → 区間2 を 2a(7/17-7/28)/2b(7/29-8/24) に細分",
    },
    wishRateMature: {
      1: rateTable(segMature[1], "wish", RANKS),
      2: rateTable(segMature[2], "wish", RANKS),
      3: rateTable(segMature[3], "wish", RANKS),
    },
    wishRateExported: {
      1: rateTable(segExported[1], "wish", RANKS),
      2: rateTable(segExported[2], "wish", RANKS),
      3: rateTable(segExported[3], "wish", RANKS),
    },
    wishRateMature146: {
      1: rateTable(seg146Mature[1], "wish", RANKS),
      "2a": rateTable(seg146Mature["2a"], "wish", RANKS),
      "2b": rateTable(seg146Mature["2b"], "wish", RANKS),
      3: rateTable(seg146Mature[3], "wish", RANKS),
    },
    distAll: {
      1: { wish: distTable(seg[1], "wish", RANKS), pass: distTable(seg[1], "pass", RANKS), overall: distTable(seg[1], "overall", RANKS_OVERALL) },
      2: { wish: distTable(seg[2], "wish", RANKS), pass: distTable(seg[2], "pass", RANKS), overall: distTable(seg[2], "overall", RANKS_OVERALL) },
      3: { wish: distTable(seg[3], "wish", RANKS), pass: distTable(seg[3], "pass", RANKS), overall: distTable(seg[3], "overall", RANKS_OVERALL) },
    },
  };

  // ===== Phase 4 =====
  const appliedAll = exported.filter((b) => b.applied);
  const appliedSettled = appliedAll.filter((b) => b.firstEntryDate && b.firstEntryDate < ENTRY_SETTLED_CUTOFF);
  out.phase4 = {
    entryDateColumn: "job_entries.entry_date (DateTime NOT NULL)",
    settledCutoff: ENTRY_SETTLED_CUTOFF.toISOString(),
    all: {
      pass: progressTable(appliedAll, "pass", RANKS),
      wish: progressTable(appliedAll, "wish", RANKS),
      overall: progressTable(appliedAll, "overall", RANKS_OVERALL),
    },
    settled: {
      n: appliedSettled.length,
      pass: progressTable(appliedSettled, "pass", RANKS),
      wish: progressTable(appliedSettled, "wish", RANKS),
      overall: progressTable(appliedSettled, "overall", RANKS_OVERALL),
    },
  };

  // ===== Phase 5 =====
  const stageCross = (rows, key, ranks) => {
    const out2 = {};
    for (const r of ranks) out2[r] = new Array(7).fill(0);
    out2.__all = new Array(7).fill(0);
    for (const b of rows) {
      const s = b.stage < 0 ? 0 : b.stage;
      out2.__all[s]++;
      const k = b[key];
      if (k && out2[k]) out2[k][s]++;
    }
    return out2;
  };
  out.phase5 = {
    stageNames: STAGE_NAMES,
    passCross: stageCross(appliedAll, "pass", RANKS),
    overallCross: stageCross(appliedAll, "overall", RANKS_OVERALL),
    wishCross: stageCross(appliedAll, "wish", RANKS),
    passCrossSettled: stageCross(appliedSettled, "pass", RANKS),
  };

  // ===== Phase 6 =====
  const cells = {};
  for (const w of RANKS)
    for (const p of RANKS) cells[`${w}${p}`] = { n: 0, applied: 0, prog: 0 };
  for (const b of matureExp) {
    if (!b.wish || !b.pass) continue;
    const k = `${b.wish}${b.pass}`;
    if (!cells[k]) continue;
    cells[k].n++;
    if (b.applied) {
      cells[k].applied++;
      if (b.stage >= 1) cells[k].prog++;
    }
  }
  out.phase6 = cells;

  // ===== Phase 7 =====
  const passB = appliedAll.filter((b) => b.pass === "B");
  const passBSettled = appliedSettled.filter((b) => b.pass === "B");
  const ngBucket = (b) => (b.ngCount === 0 ? "0" : b.ngCount === 1 ? "1" : "2+");
  const byNg = { 0: { n: 0, prog: 0 }, 1: { n: 0, prog: 0 }, "2+": { n: 0, prog: 0 } };
  let structuredPassB = 0;
  for (const b of passB) {
    if (!b.structured) continue;
    structuredPassB++;
    const k = ngBucket(b);
    byNg[k].n++;
    if (b.stage >= 1) byNg[k].prog++;
  }
  out.phase7 = {
    passBApplied: passB.length,
    passBAppliedSettled: passBSettled.length,
    byOverall: progressTable(passB, "overall", RANKS_OVERALL),
    byOverallSettled: progressTable(passBSettled, "overall", RANKS_OVERALL),
    byWish: progressTable(passB, "wish", RANKS),
    byWishSettled: progressTable(passBSettled, "wish", RANKS),
    structuredN: structuredPassB,
    byNg,
  };

  // ===== Phase 8 =====
  const expWithId = exported.filter((b) => b.kyuujinJobId != null);
  const respTable = {};
  for (const r of RANKS) respTable[r] = { n: 0, interested: 0, apply: 0 };
  respTable.__total = { n: 0, interested: 0, apply: 0 };
  for (const b of expWithId) {
    const k = b.wish;
    if (!k || !respTable[k]) continue;
    const resp = cjrMap.get(`${b.candidateId}|${b.kyuujinJobId}`) || null;
    respTable[k].n++;
    respTable.__total.n++;
    if (resp === "INTERESTED") {
      respTable[k].interested++;
      respTable.__total.interested++;
    } else if (resp === "WANT_TO_APPLY") {
      respTable[k].apply++;
      respTable.__total.apply++;
    }
  }
  out.phase8 = {
    exportedN: exported.length,
    exportedWithIdN: expWithId.length,
    fillRate: exported.length ? expWithId.length / exported.length : 0,
    table: respTable,
    responseValues: [...new Set(cjrRes.rows.map((r) => r.response))],
  };

  // ===== Phase 9 =====
  const byCand = new Map();
  for (const b of matureExp) {
    if (b.wish !== "A" && b.wish !== "C") continue;
    if (!byCand.has(b.candidateId)) byCand.set(b.candidateId, { A: [], C: [] });
    byCand.get(b.candidateId)[b.wish].push(b);
  }
  let cands = 0,
    sumAn = 0,
    sumAa = 0,
    sumCn = 0,
    sumCa = 0;
  const diffs = [];
  for (const [, v] of byCand) {
    if (v.A.length === 0 || v.C.length === 0) continue;
    cands++;
    const an = v.A.length,
      aa = v.A.filter((x) => x.applied).length;
    const cn = v.C.length,
      ca = v.C.filter((x) => x.applied).length;
    sumAn += an;
    sumAa += aa;
    sumCn += cn;
    sumCa += ca;
    diffs.push((aa / an - ca / cn) * 100);
  }
  out.phase9 = {
    candidates: cands,
    A: { n: sumAn, applied: sumAa },
    C: { n: sumCn, applied: sumCa },
    pooledDiffPt: sumAn && sumCn ? (sumAa / sumAn - sumCa / sumCn) * 100 : null,
    meanPerCandidateDiffPt: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null,
  };

  console.log("<<<T182_JSON>>>");
  console.log(JSON.stringify(out));
  console.log("<<<END>>>");
  await pool.end();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
