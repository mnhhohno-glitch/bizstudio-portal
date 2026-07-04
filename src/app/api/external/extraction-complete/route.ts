import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripFileMetadata } from "@/lib/normalize-filename";

// 求人ID紐付け step1: kyuujinPDF の抽出完了通知を受け、お気に入り行(CandidateFile BOOKMARK)に
// kyuujinPDF の Job 内部ID(jobs.id・Int)を書き込む受け口。
//
// なぜ必要か: mypage「担当CAのおすすめ」は従来 会社名の文字一致で portal のお気に入りと kyuujinPDF Job を
// 突き合わせており、表記ゆれで一致失敗すると全項目 null になっていた。Job 内部IDは「抽出完了時」に確定するため
// 送信フロー内では取得できず、抽出完了時に kyuujinPDF から通知を受けて紐付ける方式にした（step2 で送信側実装）。
//
// 契約（step2 の kyuujinPDF 送信側もこの契約に従う）:
//   POST /api/external/extraction-complete
//   認証: x-api-secret ヘッダ === env KYUUJIN_API_SECRET（既存 candidate-response webhook と同一方式）
//   body: { candidateNumber: string, processingUnitId?: number, jobs: [{ id: number, company_name?: string, source_file_name?: string }] }
//   res : { matched: number, unmatched: number }

type IncomingJob = {
  id?: unknown;
  company_name?: unknown;
  source_file_name?: unknown;
};

export async function POST(request: Request) {
  const secret = request.headers.get("x-api-secret");
  const expectedSecret = process.env.KYUUJIN_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    candidateNumber?: unknown;
    processingUnitId?: unknown;
    jobs?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidateNumber =
    body.candidateNumber != null ? String(body.candidateNumber).trim() : "";
  if (!candidateNumber) {
    return NextResponse.json(
      { error: "candidateNumber is required" },
      { status: 400 }
    );
  }

  const jobs: IncomingJob[] = Array.isArray(body.jobs) ? (body.jobs as IncomingJob[]) : [];

  const candidate = await prisma.candidate.findFirst({
    where: candidateNumber.startsWith("cm")
      ? { id: candidateNumber }
      : { candidateNumber },
    select: { id: true, candidateNumber: true },
  });

  if (!candidate) {
    console.warn(
      `[EXTRACTION-COMPLETE] candidate not found: candidateNumber=${candidateNumber}`
    );
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  // 対象は当該候補者のブックマーク（お気に入り）行のみ。lastExportedAt 降順で読み、
  // 同名複数行のときに「最新エクスポート行」を選べるようにする（null は最後）。
  const files = await prisma.candidateFile.findMany({
    where: { candidateId: candidate.id, category: "BOOKMARK", archivedAt: null },
    select: {
      id: true,
      fileName: true,
      kyuujinJobId: true,
      lastExportedAt: true,
    },
    orderBy: { lastExportedAt: "desc" },
  });

  let matched = 0;
  let unmatched = 0;
  // このリクエスト内で既に割り当てたファイル行（同一通知内で1ファイルを複数Jobへ二重割当てしない）。
  const claimedFileIds = new Set<string>();

  for (const job of jobs) {
    const jobId =
      typeof job.id === "number"
        ? job.id
        : job.id != null && String(job.id).trim() !== "" && !Number.isNaN(Number(job.id))
          ? Number(job.id)
          : null;
    if (jobId == null) {
      console.warn(
        `[EXTRACTION-COMPLETE] invalid job.id skipped: candidateNumber=${candidateNumber} raw=${JSON.stringify(job.id)}`
      );
      continue;
    }

    const sourceFileName =
      job.source_file_name != null ? String(job.source_file_name).trim() : "";
    const companyName =
      job.company_name != null ? String(job.company_name).trim() : "";

    // 冪等: 既に同じ kyuujinJobId が入っている行があれば「紐付け済み」として何もしない。
    const alreadyLinked = files.some((f) => f.kyuujinJobId === jobId);
    if (alreadyLinked) {
      matched++;
      continue;
    }

    // 候補行 = kyuujinJobId 未設定 かつ このリクエストで未割当ての行。
    const available = files.filter(
      (f) => f.kyuujinJobId == null && !claimedFileIds.has(f.id)
    );

    // (1) source_file_name の完全一致（files は lastExportedAt 降順なので先頭 = 最新）。
    let target =
      sourceFileName !== ""
        ? available.find((f) => f.fileName === sourceFileName)
        : undefined;

    // (2) フォールバック: 会社名正規化での突合（既存 stripFileMetadata で拡張子・時刻・_No・Bee接尾辞を除去）。
    if (!target) {
      const jobKey = companyName ? stripFileMetadata(companyName) : "";
      if (jobKey) {
        target = available.find((f) => stripFileMetadata(f.fileName) === jobKey);
      }
    }

    if (!target) {
      unmatched++;
      console.warn(
        `[EXTRACTION-COMPLETE] unmatched: candidateNumber=${candidateNumber} job_id=${jobId} file=${sourceFileName || companyName || "(none)"}`
      );
      continue;
    }

    await prisma.candidateFile.update({
      where: { id: target.id },
      data: { kyuujinJobId: jobId },
    });
    // ローカルキャッシュも更新（同一通知内の後続 job の冪等判定・二重割当て防止に効かせる）。
    target.kyuujinJobId = jobId;
    claimedFileIds.add(target.id);
    matched++;
  }

  console.log(
    `[EXTRACTION-COMPLETE] done: candidateNumber=${candidateNumber} jobs=${jobs.length} matched=${matched} unmatched=${unmatched}`
  );

  return NextResponse.json({ matched, unmatched });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-secret",
    },
  });
}
