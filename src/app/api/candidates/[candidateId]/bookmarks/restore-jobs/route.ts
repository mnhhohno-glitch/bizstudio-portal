import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";
import {
  stripFileMetadata,
  stripCorpSuffixes,
  extractCompanyNameCandidates,
} from "@/lib/normalize-filename";

const API_TIMEOUT_MS = 15000;
const RESTORE_BATCH_SIZE = 50;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function normalizePortalFileName(fileName: string): string {
  return stripFileMetadata(fileName);
}

function normalizeKyuujinCompanyName(name: string): string {
  return name
    .replace(/_\d{14,}$/, "")
    .replace(/[：:]\d+$/, "")
    .trim();
}

/**
 * 会社名の「照合キー候補」集合。portal 側のファイル名・kyuujin 側の company_name の
 * どちらにも同じ処理を掛けて集合の共通部分で判定する（片側だけ正規化していたため
 *   portal "株式会社メイクスデベロップメント" vs kyuujin "株式会社メイクスデベロップメント_No402772_【…】"
 *   portal "株式会社エイブル_CM…"          vs kyuujin "22346_株式会社エイブル_CM…"
 * のような組み合わせで取りこぼしていた）。誤一致を避けるため 3 文字未満のキーは捨てる。
 */
function companyKeys(name: string): Set<string> {
  const out = new Set<string>();
  const add = (v: string) => {
    const t = v.trim();
    if (t.length >= 3) out.add(t);
  };
  add(normalizeKyuujinCompanyName(name));
  add(stripFileMetadata(name));
  for (const c of extractCompanyNameCandidates(name)) add(c);
  return out;
}

/**
 * 「同じ会社かもしれない」判定（法人格を落とした部分一致）。
 * 厳密一致に失敗した行を "kyuujin に存在しない" と断定して再送信すると
 * マイページに同じ求人が二重に出る（罠#1）。曖昧な行は再送信させず
 * CA に「要確認」として返すためだけに使う。
 */
function looksRelated(a: string, b: string): boolean {
  const sa = stripCorpSuffixes(a);
  const sb = stripCorpSuffixes(b);
  if (sa.length < 2 || sb.length < 2) return false;
  return sa.includes(sb) || sb.includes(sa);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds } = body as { fileIds: string[] };

  if (!fileIds?.length) {
    return NextResponse.json({ error: "fileIds is required" }, { status: 400 });
  }

  const KYUUJIN_PDF_TOOL_URL = process.env.KYUUJIN_PDF_TOOL_URL;
  const KYUUJIN_API_SECRET = process.env.KYUUJIN_API_SECRET;
  if (!KYUUJIN_PDF_TOOL_URL || !KYUUJIN_API_SECRET) {
    return NextResponse.json({ error: "KYUUJIN_PDF_TOOL_URL / KYUUJIN_API_SECRET が未設定です" }, { status: 500 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { candidateNumber: true },
  });
  if (!candidate?.candidateNumber) {
    return NextResponse.json({ error: "求職者番号が見つかりません" }, { status: 404 });
  }

  const bookmarkFiles = await prisma.candidateFile.findMany({
    where: { id: { in: fileIds }, category: "BOOKMARK", archivedAt: null },
    select: { id: true, fileName: true, lastExportedAt: true, kyuujinJobId: true },
  });

  // kyuujinPDF から全 Job 一覧取得（feedback_status 付き）
  let externalJobs: { id: number; company_name?: string; feedback_status?: string }[] = [];
  try {
    const res = await fetchWithTimeout(
      `${KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/${candidate.candidateNumber}/jobs`
    );
    if (res.ok) {
      const data = await res.json();
      externalJobs = data.jobs || [];
    } else if (res.status !== 404) {
      // 一覧が取れないまま空配列で進むと「全件 kyuujin に無い」と誤判定し、
      // 呼び出し側の再送信で重複を生む。取得失敗はここで止める（404=プロジェクト未作成は空扱いで正しい）。
      console.error("[RestoreJobs] jobs fetch failed:", res.status);
      return NextResponse.json({ error: "求人一覧の取得に失敗しました" }, { status: 502 });
    }
  } catch (e) {
    console.error("[RestoreJobs] Failed to fetch jobs:", e);
    return NextResponse.json({ error: "kyuujinPDFとの通信に失敗しました" }, { status: 502 });
  }

  const notMatched: string[] = [];
  // 照合できなかった行のうち「kyuujin 側に確実に存在しない」＝新規送信でやり直して良いもの。
  const missingFileIds: string[] = [];
  // 似た会社名の求人はあるが厳密一致しなかった行。再送信すると重複の恐れがあるため CA へ返すのみ。
  const ambiguous: { fileName: string; candidates: string[] }[] = [];
  const notExcluded: { fileName: string; status: string }[] = [];
  const restoreJobIds: number[] = [];
  const matchedFileIds: string[] = [];
  // T-128 Phase2: 復帰した会社の正規化名（自動アーカイブしたブックマークの復帰用）。
  const restoredCompanyNames = new Set<string>();

  const jobsById = new Map(externalJobs.map((job) => [job.id, job]));
  const normalizedJobNames = externalJobs
    .filter((job) => job.company_name)
    .map((job) => ({
      job,
      name: normalizeKyuujinCompanyName(job.company_name!),
      keys: companyKeys(job.company_name!),
    }));

  for (const file of bookmarkFiles) {
    const normalized = normalizePortalFileName(file.fileName);
    // 1) kyuujinJobId 直結。会社名照合より確実で、同名会社の取り違えも起きない。
    let matched = file.kyuujinJobId ? jobsById.get(file.kyuujinJobId) : undefined;
    // 2) 会社名の厳密一致（kyuujinJobId 未充填の旧データ用）
    if (!matched) {
      matched = normalizedJobNames.find((j) => j.name === normalized)?.job;
    }
    // 3) 会社名コア候補の共通部分（両側にキャッチコピー・求人番号が混ざるケースを救う）
    if (!matched) {
      const fileKeys = companyKeys(file.fileName);
      matched = normalizedJobNames.find((j) => [...fileKeys].some((k) => j.keys.has(k)))?.job;
    }

    if (!matched) {
      notMatched.push(file.fileName);
      const related = normalizedJobNames
        .filter((j) => looksRelated(j.name, normalized))
        .map((j) => j.name);
      if (related.length > 0) {
        // 似た求人があるのに一致しない＝正規化の取りこぼしの可能性。気付けるようにログを残す。
        console.warn("[RestoreJobs] company name match failed but similar jobs exist:", {
          candidateId,
          fileName: file.fileName,
          normalized,
          related,
        });
        ambiguous.push({ fileName: file.fileName, candidates: related });
      } else {
        console.warn("[RestoreJobs] no job on kyuujinPDF for exported bookmark:", {
          candidateId,
          fileName: file.fileName,
          normalized,
          kyuujinJobId: file.kyuujinJobId,
        });
        missingFileIds.push(file.id);
      }
      continue;
    }

    const status = matched.feedback_status || "UNANSWERED";
    if (status === "EXCLUDED") {
      restoreJobIds.push(matched.id);
      matchedFileIds.push(file.id);
      if (matched.company_name) {
        restoredCompanyNames.add(normalizeKyuujinCompanyName(matched.company_name));
      }
    } else {
      notExcluded.push({ fileName: file.fileName, status });
      matchedFileIds.push(file.id);
    }
  }

  // restore API 呼び出し（バッチ分割）
  let totalRestored = 0;
  const errors: string[] = [];

  for (let i = 0; i < restoreJobIds.length; i += RESTORE_BATCH_SIZE) {
    const batch = restoreJobIds.slice(i, i + RESTORE_BATCH_SIZE);
    try {
      const res = await fetchWithTimeout(
        `${KYUUJIN_PDF_TOOL_URL}/api/external/mypage/jobs/restore`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-secret": KYUUJIN_API_SECRET,
          },
          body: JSON.stringify({
            job_ids: batch,
            job_seeker_id: candidate.candidateNumber,
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        totalRestored += data.restored ?? 0;
      } else {
        const text = await res.text().catch(() => "");
        errors.push(`restore batch failed: ${res.status} ${text.slice(0, 200)}`);
      }
    } catch (e) {
      errors.push(`restore batch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // lastExportedAt 更新（マッチした全ファイル）
  if (matchedFileIds.length > 0) {
    await prisma.candidateFile.updateMany({
      where: { id: { in: matchedFileIds } },
      data: { lastExportedAt: new Date(), lastExportedTo: "hito-link" },
    });
    try { await recalculateSubStatusIfAuto(candidateId); } catch (e) { console.error("recalculate error:", e); }
  }

  // T-128 Phase2: 復帰した会社について、対象外連動で自動アーカイブしたブックマークを復帰
  // （archivedReason="job-excluded-sync" のみ対象・best-effort）。手動アーカイブには触れない。
  let unarchived = 0;
  if (restoredCompanyNames.size > 0) {
    try {
      const archived = await prisma.candidateFile.findMany({
        where: {
          candidateId,
          category: "BOOKMARK",
          archivedAt: { not: null },
          archivedReason: "job-excluded-sync",
        },
        select: { id: true, fileName: true },
      });
      const toRestore = archived
        .filter((f) => restoredCompanyNames.has(normalizePortalFileName(f.fileName)))
        .map((f) => f.id);
      if (toRestore.length > 0) {
        await prisma.candidateFile.updateMany({
          where: { id: { in: toRestore } },
          data: { archivedAt: null, archivedReason: null, archivedById: null },
        });
        unarchived = toRestore.length;
      }
    } catch (e) {
      console.error("[RestoreJobs] bookmark un-archive (best-effort) failed:", e);
    }
  }

  return NextResponse.json({
    success: true,
    restored: totalRestored,
    unarchived,
    notMatched,
    // 呼び出し側はこの id 群を send-to-job-tool で送り直して求人紹介に出す（重複しないことは確認済み）
    missingFileIds,
    ambiguous,
    notExcluded,
    errors,
  });
}
