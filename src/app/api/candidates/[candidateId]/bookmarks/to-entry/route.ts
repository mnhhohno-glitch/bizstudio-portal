import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { stripFileMetadata } from "@/lib/normalize-filename";
import {
  resolveJobDbFromBookmark,
  extractJobNoFromRef,
  resolveBookmarkMedia,
} from "@/lib/constants/source-media";

// サイト経由レコード（origin="candidate" / driveFileId=null / kyuujin_job_id=null）を、
// 求人紹介タブ（kyuujin 参照）を経由せず JobEntry（エントリー）へ直接登録する。
//   - サイト応募は kyuujin 側に対応 job が無く、構造上「求人紹介」タブには出せない。
//   - CA が「紹介した」ものではなく求職者本人の応募履歴なので、求人紹介ではなくエントリーに載せる。
// 作成する JobEntry は POST /api/entries の手動作成と同じ形（externalJobId=0・kyuujin/CandidateFile 参照なし）。
// route="site-apply" を印にして、最終形の「求人応募」タブ新設時に WHERE route='site-apply' で分離できるようにする。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;
  const body = await req.json();
  const { fileIds, entryDate } = body as { fileIds?: string[]; entryDate?: string };

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: "fileIds は必須です" }, { status: 400 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: "求職者が見つかりません" }, { status: 404 });
  }

  const entryDateValue = entryDate ? new Date(entryDate) : new Date();
  if (isNaN(entryDateValue.getTime())) {
    return NextResponse.json({ error: "entryDate が不正です" }, { status: 400 });
  }

  // 対象を厳格に限定: 当該候補者の BOOKMARK かつ origin="candidate" かつ driveFileId=null のみ。
  // それ以外の id（通常PDF行・他候補者・アーカイブ済み）が混じっていてもサーバー側で弾く。
  const files = await prisma.candidateFile.findMany({
    where: {
      id: { in: fileIds },
      candidateId,
      category: "BOOKMARK",
      driveFileId: null,
      origin: "candidate",
      archivedAt: null,
    },
    select: {
      id: true,
      fileName: true,
      sourceType: true,
      sourceMedia: true,
      externalJobRef: true,
    },
  });

  // 対象外だった id 数（UI が誤って通常行を混ぜた等）。
  const rejected = fileIds.length - files.length;

  if (files.length === 0) {
    return NextResponse.json(
      { created: 0, skipped: 0, rejected, error: "登録対象のサイト経由求人がありません" },
      { status: 422 }
    );
  }

  // 二重登録防止: 同一 candidateId × companyName の JobEntry が既にあればスキップ。
  //   サイト経由は externalJobId=0 で作るため、既存の externalJobId ベース重複チェックには掛からない。
  //   そこで companyName ベースで防ぐ（バッチ内の同名重複も併せて排除）。
  const existing = await prisma.jobEntry.findMany({
    where: { candidateId },
    select: { companyName: true },
  });
  const seen = new Set(existing.map((e) => e.companyName));

  const now = new Date();
  const rows: {
    candidateId: string;
    companyName: string;
    jobTitle: string;
    externalJobId: number;
    entryDate: Date;
    introducedAt: Date;
    entryFlag: string;
    entryFlagDetail: string;
    externalJobNo: string | null;
    jobDb: string | null;
    route: string;
    careerAdvisorId: string;
    createdBy: string;
  }[] = [];
  let skipped = 0;

  for (const f of files) {
    const companyName = stripFileMetadata(f.fileName);
    if (!companyName) {
      skipped++;
      continue;
    }
    if (seen.has(companyName)) {
      skipped++;
      continue;
    }
    seen.add(companyName);
    // jobDb: sourceType="job-platform" 由来の媒体解決を優先し、無ければ externalJobRef 接頭辞で補完。
    //   （ブックマーク一覧の「DB名」列と同じ resolveBookmarkMedia でフォールバックし表示を一致させる）
    const jobDb =
      resolveJobDbFromBookmark(f.sourceType, f.sourceMedia) ??
      resolveBookmarkMedia(f.sourceMedia, f.externalJobRef);
    rows.push({
      candidateId,
      companyName,
      jobTitle: "",
      externalJobId: 0,
      entryDate: entryDateValue,
      introducedAt: now,
      entryFlag: "エントリー",
      entryFlagDetail: "検討中",
      externalJobNo: extractJobNoFromRef(f.externalJobRef),
      jobDb,
      route: "site-apply",
      careerAdvisorId: user.id,
      createdBy: user.id,
    });
  }

  let created = 0;
  if (rows.length > 0) {
    const result = await prisma.jobEntry.createMany({ data: rows });
    created = result.count;
  }

  return NextResponse.json({ created, skipped, rejected });
}
