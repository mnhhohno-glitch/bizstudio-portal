// T-206: 面接対策ページの共通処理（読み込み・一覧行への変換・slug 付き作成・閲覧記録・入力ミスの回数制限）。
//   内部 API（/api/mensetsu-pages/…）と外部 API（/api/external/mensetsu/…）の両方から使う。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CLOSABLE_ENTRY_SELECT, VERIFY_LOCK } from "./constants";
import { jstYmd, lastViewableDayYmd } from "./dates";
import { buildGuideMessage } from "./guide-message";
import { mensetsuPublicUrl } from "./public-url";
import { generateSlug } from "./slug";
import { resolveDisplayStatus, type MensetsuDisplayStatus } from "./state";

/** 一覧・詳細・外部 API で共通に読む関連 */
export const PAGE_INCLUDE = {
  entry: { select: CLOSABLE_ENTRY_SELECT },
  candidate: { select: { id: true, name: true, birthday: true } },
  createdBy: { select: { id: true, name: true } },
  versions: { select: { id: true, versionNo: true, note: true, createdAt: true, uploadedBy: { select: { name: true } } }, orderBy: { versionNo: "desc" as const } },
} satisfies Prisma.InterviewPrepPageInclude;

export type PageWithRelations = Prisma.InterviewPrepPageGetPayload<{ include: typeof PAGE_INCLUDE }>;

export async function loadPageById(pageId: string): Promise<PageWithRelations | null> {
  return prisma.interviewPrepPage.findUnique({ where: { id: pageId }, include: PAGE_INCLUDE });
}

export async function loadPageBySlug(slug: string): Promise<PageWithRelations | null> {
  return prisma.interviewPrepPage.findUnique({ where: { slug }, include: PAGE_INCLUDE });
}

/** 現在の版（最大 versionNo）の HTML。版が無ければ null */
export async function loadCurrentHtml(pageId: string): Promise<{ versionNo: number; html: string } | null> {
  const v = await prisma.interviewPrepPageVersion.findFirst({
    where: { pageId },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true, html: true },
  });
  return v;
}

/** 画面の一覧行 */
export type PageRow = {
  id: string;
  slug: string;
  stage: string;
  title: string;
  entryId: string | null;
  companyName: string | null;
  interviewDate: string | null; // "YYYY-MM-DD"
  status: string;
  displayStatus: MensetsuDisplayStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  lastViewableDay: string | null; // "YYYY-MM-DD"
  stoppedAt: string | null;
  stoppedReason: string | null;
  useWrapper: boolean;
  requireBirthdate: boolean;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  verifyLockedUntil: string | null; // ロック中のときだけ
  verifyFailCount: number;
  versionCount: number;
  currentVersionNo: number;
  createdAt: string;
  createdByName: string;
  publicUrl: string;
  guideMessage: string | null; // 公開（期限あり）のときだけ
  guideMessageUpdated: string | null; // 差し替え後用
};

export function toPageRow(page: PageWithRelations, now: Date = new Date()): PageRow {
  const displayStatus = resolveDisplayStatus(page, now);
  const lastDay = page.expiresAt ? lastViewableDayYmd(page.expiresAt) : null;
  const url = mensetsuPublicUrl(page.slug);
  const currentVersionNo = page.versions[0]?.versionNo ?? 0;
  const guideBase = lastDay
    ? {
        candidateName: page.candidate.name,
        companyName: page.entry?.companyName ?? null,
        stage: page.stage,
        url,
        lastViewableDayYmd: lastDay,
        requireBirthdate: page.requireBirthdate,
      }
    : null;
  const locked = page.verifyLockedUntil && page.verifyLockedUntil.getTime() > now.getTime() ? page.verifyLockedUntil : null;
  return {
    id: page.id,
    slug: page.slug,
    stage: page.stage,
    title: page.title,
    entryId: page.entryId,
    companyName: page.entry?.companyName ?? null,
    interviewDate: page.interviewDate ? page.interviewDate.toISOString().slice(0, 10) : null,
    status: page.status,
    displayStatus,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    expiresAt: page.expiresAt?.toISOString() ?? null,
    lastViewableDay: lastDay,
    stoppedAt: page.stoppedAt?.toISOString() ?? null,
    stoppedReason: page.stoppedReason,
    useWrapper: page.useWrapper,
    requireBirthdate: page.requireBirthdate,
    firstViewedAt: page.firstViewedAt?.toISOString() ?? null,
    lastViewedAt: page.lastViewedAt?.toISOString() ?? null,
    viewCount: page.viewCount,
    verifyLockedUntil: locked?.toISOString() ?? null,
    verifyFailCount: page.verifyFailCount,
    versionCount: page.versions.length,
    currentVersionNo,
    createdAt: page.createdAt.toISOString(),
    createdByName: page.createdBy.name,
    publicUrl: url,
    guideMessage: guideBase ? buildGuideMessage(guideBase) : null,
    guideMessageUpdated: guideBase ? buildGuideMessage({ ...guideBase, updated: true }) : null,
  };
}

export type VersionRow = {
  id: string;
  versionNo: number;
  note: string | null;
  createdAt: string;
  uploadedByName: string;
};

export function toVersionRows(page: PageWithRelations): VersionRow[] {
  return page.versions.map((v) => ({
    id: v.id,
    versionNo: v.versionNo,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    uploadedByName: v.uploadedBy.name,
  }));
}

/** interviewDate（UTC 00:00 保存の暦日）を JST 表示用に "YYYY-MM-DD" へ。※UTC 00:00 保存なので ISO の日付部でよい */
export function interviewDateYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export type CreatePageInput = {
  candidateId: string;
  entryId: string | null;
  stage: string;
  title: string;
  interviewDate: Date | null;
  html: string;
  note: string | null;
  createdById: string;
  /** 既存移行用（岡野様）。通常は省略 */
  slug?: string;
  status?: string;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  useWrapper?: boolean;
  requireBirthdate?: boolean;
};

/** 下書き（版 1 付き）を作る。slug は衝突したら作り直す（最大 10 回） */
export async function createPageWithFirstVersion(input: CreatePageInput): Promise<PageWithRelations> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = input.slug ?? generateSlug();
    try {
      const created = await prisma.interviewPrepPage.create({
        data: {
          candidateId: input.candidateId,
          entryId: input.entryId,
          stage: input.stage,
          title: input.title,
          interviewDate: input.interviewDate,
          slug,
          status: input.status ?? "draft",
          publishedAt: input.publishedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          useWrapper: input.useWrapper ?? true,
          requireBirthdate: input.requireBirthdate ?? true,
          createdById: input.createdById,
          versions: {
            create: { versionNo: 1, html: input.html, uploadedById: input.createdById, note: input.note },
          },
        },
        include: PAGE_INCLUDE,
      });
      return created;
    } catch (e) {
      // slug の一意制約違反だけ作り直す（明示 slug のときは再試行しない）
      if (!input.slug && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("slug の生成に失敗しました（衝突が続きました）");
}

/** 版を 1 つ足す（差し替え）。versionNo は同時実行でも重複しないよう一意制約で守り、衝突時は取り直す */
export async function appendVersion(pageId: string, html: string, uploadedById: string, note: string | null): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.interviewPrepPageVersion.findFirst({ where: { pageId }, orderBy: { versionNo: "desc" }, select: { versionNo: true } });
    const versionNo = (last?.versionNo ?? 0) + 1;
    try {
      await prisma.interviewPrepPageVersion.create({ data: { pageId, versionNo, html, uploadedById, note } });
      return versionNo;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("版番号の採番に失敗しました");
}

/** 閲覧を 1 回記録する（DB 側で加算。firstViewedAt は未設定のときだけ） */
export async function recordView(pageId: string, now: Date = new Date()): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "interview_prep_pages"
       SET "view_count" = "view_count" + 1,
           "last_viewed_at" = ${now},
           "first_viewed_at" = COALESCE("first_viewed_at", ${now})
     WHERE "id" = ${pageId}`;
}

/**
 * 生年月日の不一致を 1 回記録し、ロックが必要なら verifyLockedUntil を立てて返す。
 *   - 24 時間の窓の中で数える（窓の外なら 1 から）
 *   - 窓内 20 回で 24 時間ロック、5 の倍数回（5・10・15）で 15 分ロック
 */
export async function recordVerifyFailure(pageId: string, now: Date = new Date()): Promise<{ failCount: number; lockedUntil: Date | null }> {
  const windowFloor = new Date(now.getTime() - VERIFY_LOCK.windowMs);
  const rows = await prisma.$queryRaw<{ verify_fail_count: number }[]>`
    UPDATE "interview_prep_pages"
       SET "verify_fail_count" = CASE WHEN "verify_fail_window_start" IS NULL OR "verify_fail_window_start" < ${windowFloor}
                                      THEN 1 ELSE "verify_fail_count" + 1 END,
           "verify_fail_window_start" = CASE WHEN "verify_fail_window_start" IS NULL OR "verify_fail_window_start" < ${windowFloor}
                                             THEN ${now} ELSE "verify_fail_window_start" END
     WHERE "id" = ${pageId}
     RETURNING "verify_fail_count"`;
  const failCount = Number(rows[0]?.verify_fail_count ?? 0);
  let lockedUntil: Date | null = null;
  if (failCount >= VERIFY_LOCK.longFailCount) {
    lockedUntil = new Date(now.getTime() + VERIFY_LOCK.longLockMs);
  } else if (failCount > 0 && failCount % VERIFY_LOCK.shortFailCount === 0) {
    lockedUntil = new Date(now.getTime() + VERIFY_LOCK.shortLockMs);
  }
  if (lockedUntil) {
    await prisma.interviewPrepPage.update({ where: { id: pageId }, data: { verifyLockedUntil: lockedUntil } });
  }
  return { failCount, lockedUntil };
}

/** 失敗回数とロックをリセット（一致したとき・CA の「ロック解除」） */
export async function resetVerifyFailures(pageId: string): Promise<void> {
  await prisma.interviewPrepPage.update({
    where: { id: pageId },
    data: { verifyFailCount: 0, verifyFailWindowStart: null, verifyLockedUntil: null },
  });
}

/** 今日（JST）の暦日。公開・延長の基準日 */
export function todayYmd(now: Date = new Date()): string {
  return jstYmd(now);
}
