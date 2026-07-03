/**
 * T-128 Phase3-a: 気になる残骸（stale CandidateJobResponse）の掃除
 *
 * kyuujinPDF の feedback_status を「正」として、portal CandidateJobResponse の
 * 余剰レコード（kyuujin側で既にOFF/対象外なのにportalに残っているもの）を削除する。
 *
 * 正: 各候補者について by-job-seeker-id/{num}/jobs の feedback_status を解決値とし、
 *     INTERESTED/APPLY のみ「アクティブ」。それ以外（UNANSWERED/EXCLUDED/PENDING/求人消失）は
 *     portal 側の回答レコードを stale とみなし削除対象とする。
 *
 * 安全策:
 *   - dry-run（既定）で件数・候補者数・stale理由内訳を出し、rollback CSV を verify/ に書く。
 *   - 実削除は --execute 指定時のみ。削除は抽出済みの ID 限定（unscoped DELETE なし）。
 *   - 値ドリフト（両側アクティブだが値違い）は削除せず報告のみ。
 *   - 逆方向（kyuujinにありportalに無い）は削除せず件数のみ報告。
 *   - kyuujin未応答/トークン無しの候補者は skip（検証不能なので触らない）。
 *
 * Usage:
 *   npx tsx scripts/t128-cleanup-stale-responses.ts            # dry-run
 *   npx tsx scripts/t128-cleanup-stale-responses.ts --execute  # 実削除
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { writeFileSync } from "fs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXECUTE = process.argv.includes("--execute");
// 候補者feedback（気になる/応募したい）の「正」は mypage admin エンドポイントの
// resolved feedback_status（JobFeedback を反映）。
// ★注意★ projects の by-job-seeker-id/{num}/jobs が返す feedback_status は CA選考
//   パイプライン状態（UNANSWERED/IN_SELECTION/PENDING/SELECTION_ENDED/EXCLUDED）であり、
//   候補者の INTERESTED/APPLY は反映されない。3-a では使ってはいけない。
const KYUUJIN_API_URL =
  process.env.KYUUJIN_API_URL ||
  process.env.KYUUJIN_PDF_TOOL_URL ||
  "https://web-production-95808.up.railway.app";
const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;

// 候補者ごとの kyuujin 状態:
//  statusById  : job_id -> resolved feedback_status（EXCLUDED 判定・可視性用）
//  feedbackById: job_id -> JobFeedback.status（"interested"|"apply"|"none"）＝候補者の生トグル
type CandidateState = {
  statusById: Map<number, string>;
  feedbackById: Map<number, string>;
} | null;

function extractToken(url: string): string | null {
  const m = url.match(/\/v\/([^/?#]+)/);
  return m ? m[1] : null;
}

// mypage admin エンドポイントで候補者の状態を取得。
// トークン未発行・未応答は null（＝検証不能なので触らない）。
// ★候補者の「気になる/応募したい」は data.feedbacks（JobFeedback）が正。
//   resolved feedback_status は CA選考状態で候補者feedbackをマスクするため、
//   可視性（EXCLUDED か否か）判定にのみ使う。
async function fetchCandidateState(candidateNumber: string): Promise<CandidateState> {
  if (!KYUUJIN_API_SECRET) return null;
  try {
    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), 12000);
    const tokRes = await fetch(
      `${KYUUJIN_API_URL}/api/external/mypage/by-job-seeker/${encodeURIComponent(candidateNumber)}`,
      { headers: { "x-api-secret": KYUUJIN_API_SECRET }, signal: c1.signal }
    ).finally(() => clearTimeout(t1));
    if (!tokRes.ok) return null;
    const tokData = (await tokRes.json()) as { url?: string | null };
    if (!tokData.url) return null;
    const token = extractToken(tokData.url);
    if (!token) return null;

    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), 12000);
    const mpRes = await fetch(
      `${KYUUJIN_API_URL}/api/external/mypage/${token}?admin=true`,
      { headers: { "x-api-secret": KYUUJIN_API_SECRET }, signal: c2.signal }
    ).finally(() => clearTimeout(t2));
    if (!mpRes.ok) return null;
    const data = await mpRes.json();
    const jobs: { id: number; feedback_status?: string }[] = data.jobs || [];
    const statusById = new Map<number, string>();
    for (const j of jobs) statusById.set(j.id, j.feedback_status || "UNANSWERED");
    const feedbackById = new Map<number, string>();
    const fbDict = (data.feedbacks || {}) as Record<string, string>;
    for (const [k, v] of Object.entries(fbDict)) feedbackById.set(Number(k), v);
    return { statusById, feedbackById };
  } catch {
    return null;
  }
}

// 簡易並列制御
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type StaleRow = {
  id: string;
  candidateId: string;
  candidateNumber: string;
  externalJobId: number;
  response: string;
  respondedAt: string;
  createdAt: string;
  updatedAt: string;
  staleReason: string; // UNANSWERED | EXCLUDED | PENDING | MISSING
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log(`[T128-3a] Mode: ${EXECUTE ? "EXECUTE (delete)" : "DRY-RUN"}`);
  console.log(`[T128-3a] kyuujin: ${KYUUJIN_API_URL} (admin mypage resolved feedback_status)`);

  // 1. 全 CandidateJobResponse + candidateNumber
  const responses = await prisma.candidateJobResponse.findMany({
    select: {
      id: true,
      candidateId: true,
      externalJobId: true,
      response: true,
      respondedAt: true,
      createdAt: true,
      updatedAt: true,
      candidate: { select: { candidateNumber: true } },
    },
  });
  console.log(`[T128-3a] Total CandidateJobResponse: ${responses.length}`);

  // 2. 候補者ごとにグルーピング
  const byCandidate = new Map<string, typeof responses>();
  for (const r of responses) {
    const arr = byCandidate.get(r.candidateId) ?? [];
    arr.push(r);
    byCandidate.set(r.candidateId, arr);
  }
  const candidateIds = [...byCandidate.keys()];
  console.log(`[T128-3a] Distinct candidates with responses: ${candidateIds.length}`);

  // 3. 各候補者の kyuujin 状態を取得
  const stateByCandidate = new Map<string, CandidateState>();
  await mapLimit(candidateIds, 6, async (cid) => {
    const num = byCandidate.get(cid)![0].candidate?.candidateNumber ?? null;
    if (!num) {
      stateByCandidate.set(cid, null);
      return;
    }
    stateByCandidate.set(cid, await fetchCandidateState(num));
  });

  // 候補者の生 feedback（JobFeedback）→ portal response 期待値
  function feedbackToResponse(fb: string | undefined): string | null {
    if (fb === "interested") return "INTERESTED";
    if (fb === "apply") return "WANT_TO_APPLY";
    return null; // none / undefined
  }

  // 4. 分類
  //  判定: 求人が可視（非EXCLUDED・存在）かつ 候補者の生feedback が interested/apply の時のみ keep。
  //   - EXCLUDED / 求人消失 → 候補者に見えない → stale
  //   - feedback none/未設定 → 候補者がOFFにした → stale（本バグの本体）
  //   - 生feedbackはアクティブだが portal 値が違う → drift（報告のみ・削除しない）
  const stale: StaleRow[] = [];
  const drift: { candidateNumber: string; externalJobId: number; portal: string; kyuujin: string }[] = [];
  let missingInPortal = 0;
  let skippedNoToken = 0;
  let skippedFetchFail = 0;

  for (const cid of candidateIds) {
    const rows = byCandidate.get(cid)!;
    const num = rows[0].candidate?.candidateNumber ?? "";
    const state = stateByCandidate.get(cid);
    if (state === null || state === undefined) {
      if (!num) skippedNoToken++;
      else skippedFetchFail++;
      continue;
    }

    const portalJobIds = new Set(rows.map((r) => r.externalJobId));

    for (const r of rows) {
      const st = state.statusById.get(r.externalJobId);
      if (st === undefined) {
        // 求人が kyuujin 側に存在しない（削除等）→ 候補者に見えない → stale
        stale.push(toStaleRow(r, num, "MISSING"));
        continue;
      }
      if (st === "EXCLUDED") {
        // 対象外＝候補者から不可視 → stale（生feedbackが残っていても見えない）
        stale.push(toStaleRow(r, num, "EXCLUDED"));
        continue;
      }
      const fb = state.feedbackById.get(r.externalJobId);
      const expected = feedbackToResponse(fb);
      if (expected === null) {
        // 候補者がOFFにした（feedback none/未設定）→ stale。可視状態を理由に付記。
        stale.push(toStaleRow(r, num, `CLEARED(${st})`));
        continue;
      }
      if (expected !== r.response) {
        // 生feedbackはアクティブだが portal 値が違う → drift（削除しない）
        drift.push({ candidateNumber: num, externalJobId: r.externalJobId, portal: r.response, kyuujin: fb ?? "?" });
      }
      // それ以外は keep（可視・生feedbackアクティブ・値一致）
    }

    // 逆方向: 候補者の生feedbackがアクティブ かつ 非EXCLUDED だが portal に無い
    for (const [jobId, fb] of state.feedbackById.entries()) {
      const st = state.statusById.get(jobId);
      if (st === "EXCLUDED") continue;
      if (feedbackToResponse(fb) && !portalJobIds.has(jobId)) missingInPortal++;
    }
  }

  // 5. 集計
  const byReason: Record<string, number> = {};
  for (const s of stale) byReason[s.staleReason] = (byReason[s.staleReason] || 0) + 1;
  const staleCandidates = new Set(stale.map((s) => s.candidateId)).size;

  console.log("");
  console.log("=== 3-a 結果 ===");
  console.log(`  stale（削除対象）        : ${stale.length} 件 / ${staleCandidates} 候補者`);
  console.log(`  stale理由内訳            : ${JSON.stringify(byReason)}`);
  console.log(`  値ドリフト（報告のみ）    : ${drift.length} 件`);
  console.log(`  逆方向 missing（報告のみ）: ${missingInPortal} 件`);
  console.log(`  skip: token無し=${skippedNoToken} / fetch失敗=${skippedFetchFail}`);

  // 5008089 検証
  const target = stale.filter((s) => s.candidateNumber === "5008089");
  console.log(`  [検証] 5008089 の stale: ${target.length} 件 job=${target.map((t) => t.externalJobId).sort().join(",")}`);

  // 6. rollback CSV
  const stamp = "2026-07-03";
  const csvPath = `verify/t128-stale-responses-rollback-${stamp}.csv`;
  const header = "id,candidate_id,candidate_number,external_job_id,response,responded_at,created_at,updated_at,stale_reason";
  const lines = [header, ...stale.map((s) =>
    [s.id, s.candidateId, s.candidateNumber, s.externalJobId, s.response, s.respondedAt, s.createdAt, s.updatedAt, s.staleReason]
      .map(csvEscape).join(",")
  )];
  writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  console.log(`  rollback CSV: ${csvPath}（${stale.length} 行）`);

  if (drift.length > 0) {
    const driftPath = `verify/t128-stale-responses-drift-${stamp}.csv`;
    const dlines = ["candidate_number,external_job_id,portal_response,kyuujin_status",
      ...drift.map((d) => [d.candidateNumber, d.externalJobId, d.portal, d.kyuujin].map(csvEscape).join(","))];
    writeFileSync(driftPath, dlines.join("\n") + "\n", "utf8");
    console.log(`  drift CSV: ${driftPath}（${drift.length} 行・削除しない）`);
  }

  // 7. 実削除（ID限定）
  if (EXECUTE) {
    const ids = stale.map((s) => s.id);
    console.log("");
    console.log(`[T128-3a] EXECUTE: ${ids.length} 件を ID 限定で削除します...`);
    let deleted = 0;
    const BATCH = 200;
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const r = await prisma.candidateJobResponse.deleteMany({ where: { id: { in: batch } } });
      deleted += r.count;
    }
    console.log(`[T128-3a] 削除完了: ${deleted} 件（対象 ${ids.length} 件）`);
    if (deleted !== ids.length) console.warn(`[T128-3a] ⚠ 削除数と対象数が不一致（並行更新の可能性）`);
  } else {
    console.log("");
    console.log("[T128-3a] DRY-RUN のため削除は行っていません。--execute で実削除。");
  }
}

function toStaleRow(
  r: { id: string; candidateId: string; externalJobId: number; response: string; respondedAt: Date; createdAt: Date; updatedAt: Date },
  candidateNumber: string,
  reason: string
): StaleRow {
  return {
    id: r.id,
    candidateId: r.candidateId,
    candidateNumber,
    externalJobId: r.externalJobId,
    response: r.response,
    respondedAt: r.respondedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    staleReason: reason,
  };
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
