import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { stripFileMetadata } from "@/lib/normalize-filename";
import {
  resolveJobDbFromBookmark,
  extractJobNoFromRef,
  resolveBookmarkMedia,
} from "@/lib/constants/source-media";

// ブックマークを求人ツール（kyuujin）を経由せず JobEntry（エントリー）へ直接登録する。
// T-161 で対象を2種類に拡張:
//   (a) サイト経由行（origin="candidate" / driveFileId=null）
//       求職者本人の応募履歴。route="site-apply" を印にする（実績集計では CA紹介に数えない）。
//   (b) 紹介済み行（introducedAt != null / lastExportedAt=null / 非サイト行）
//       CAが「紹介済みにする」で出力なしに紹介した求人。route=null（通常エントリーと同格・CA実績に数える）。
// T-161: 求人情報の引き継ぎ — ブックmarkが保持する jobTitle / jobCategory / 求人URL(memo) を
//   JobEntry へそのまま写す（旧実装は jobTitle:"" 固定・jobCategory 未設定で下流の表示が空になっていた）。
// T-161: 重複判定 — externalJobRef（求人単位）で行う。旧実装の会社名一致判定は
//   同一企業の別求人を黙って捨てていた（山星屋 hl-ap-314615 の取りこぼし）。
//   ref を持たない行（旧マイページ webhook 由来等）のみ従来どおり会社名で判定する（重複作成より安全側）。
//   スキップは黙らせず、会社名と理由を skippedDetails としてクライアントへ返す。
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

  // 対象を厳格に限定: 当該候補者の有効な BOOKMARK のうち、
  //   (a) サイト経由行、または (b) 紹介済み・未出力行 のみ。
  // それ以外の id（未紹介の通常PDF行・他候補者・アーカイブ済み）が混じっていてもサーバー側で弾く。
  const files = await prisma.candidateFile.findMany({
    where: {
      id: { in: fileIds },
      candidateId,
      category: "BOOKMARK",
      archivedAt: null,
      OR: [
        { origin: "candidate", driveFileId: null },
        { introducedAt: { not: null }, lastExportedAt: null },
      ],
    },
    select: {
      id: true,
      fileName: true,
      sourceType: true,
      sourceMedia: true,
      externalJobRef: true,
      origin: true,
      driveFileId: true,
      kyuujinJobId: true,
      jobTitle: true,
      jobCategory: true,
      memo: true,
    },
  });

  // 対象外だった id 数（UI が誤って通常行を混ぜた等）。
  const rejected = fileIds.length - files.length;

  if (files.length === 0) {
    return NextResponse.json(
      { created: 0, skipped: 0, rejected, error: "登録対象の求人がありません（サイト経由または紹介済みのブックマークのみ登録できます）" },
      { status: 422 }
    );
  }

  // 二重登録防止（T-161 改訂）:
  //   ref がある行 → 同一 candidateId × externalJobRef の JobEntry があればスキップ（求人単位）。
  //   ref が無い行 → 従来どおり会社名一致でスキップ（判定材料が会社名しか無いため。重複作成より安全側）。
  const existing = await prisma.jobEntry.findMany({
    where: { candidateId },
    select: { companyName: true, externalJobRef: true },
  });
  const seenRefs = new Set(existing.map((e) => e.externalJobRef).filter(Boolean) as string[]);
  const seenCompanies = new Set(existing.map((e) => e.companyName));

  const now = new Date();
  const rows: {
    candidateId: string;
    companyName: string;
    jobTitle: string;
    jobCategory: string | null;
    originalUrl: string | null;
    externalJobId: number;
    entryDate: Date;
    introducedAt: Date;
    entryFlag: string;
    entryFlagDetail: string;
    externalJobNo: string | null;
    externalJobRef: string | null;
    jobDb: string | null;
    route: string | null;
    careerAdvisorId: string;
    createdBy: string;
  }[] = [];
  const skippedDetails: { companyName: string; reason: string }[] = [];

  for (const f of files) {
    const companyName = stripFileMetadata(f.fileName);
    if (!companyName) {
      skippedDetails.push({ companyName: f.fileName, reason: "会社名が特定できません" });
      continue;
    }
    if (f.externalJobRef) {
      if (seenRefs.has(f.externalJobRef)) {
        skippedDetails.push({ companyName, reason: "同じ求人が既にエントリー済み" });
        continue;
      }
      seenRefs.add(f.externalJobRef);
    } else {
      if (seenCompanies.has(companyName)) {
        skippedDetails.push({ companyName, reason: "同じ会社が既にエントリー済み（求人IDなしのため会社名で判定）" });
        continue;
      }
    }
    seenCompanies.add(companyName);
    // サイト経由（本人応募）か、CAの紹介済み行かで route を分ける。実績集計は route ではなく
    // ブックマーク側の introducedAt/lastExportedAt で判定するが、応募経路の表示・分離のため印を残す。
    const isSiteApply = f.origin === "candidate" && !f.driveFileId;
    // jobDb: ブックマーク一覧「DB名」列と完全一致させるため resolveBookmarkMedia を優先。
    //   sourceMedia（webhook 由来・少数）→ externalJobRef 接頭辞（circus-/hl-ap-/own-/mynavi_...）の順で判定。
    //   両方で判定不能なときのみ resolveJobDbFromBookmark の job-platform 既定 "HITO-Link" にフォールバック。
    const jobDb =
      resolveBookmarkMedia(f.sourceMedia, f.externalJobRef) ??
      resolveJobDbFromBookmark(f.sourceType, f.sourceMedia);
    // 求人URL: favorites POST は memo 列に求人URLを保存する設計。URL形式のときのみ引き継ぐ
    // （PDF行の memo は自由記入のため URL 以外は写さない）。
    const jobUrl = f.memo && /^https?:\/\//.test(f.memo.trim()) ? f.memo.trim() : null;
    rows.push({
      candidateId,
      companyName,
      // T-161: ブックマークの求人スナップショットを引き継ぐ。無い項目は捏造しない（空のまま）。
      jobTitle: f.jobTitle ?? "",
      jobCategory: f.jobCategory ?? null,
      originalUrl: jobUrl,
      // kyuujin job が判明している行（旧マイページ webhook 由来）は引き当てキーとして引き継ぐ。
      externalJobId: f.kyuujinJobId ?? 0,
      entryDate: entryDateValue,
      introducedAt: now,
      entryFlag: "エントリー",
      entryFlagDetail: "検討中",
      // T-140: extractJobNoFromRef は数字が取れない ref(circus-kiwjza 等)で null を返すよう修正済み。
      externalJobNo: extractJobNoFromRef(f.externalJobRef),
      // T-140: 企業名クリック→自社求人サイト詳細を開く SSO キー(job-platform source_job_id)。
      externalJobRef: f.externalJobRef ?? null,
      jobDb,
      route: isSiteApply ? "site-apply" : null,
      careerAdvisorId: user.id,
      createdBy: user.id,
    });
  }

  let created = 0;
  if (rows.length > 0) {
    const result = await prisma.jobEntry.createMany({ data: rows });
    created = result.count;
  }

  return NextResponse.json({
    created,
    skipped: skippedDetails.length,
    skippedDetails,
    rejected,
  });
}
