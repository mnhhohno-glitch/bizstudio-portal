// T-XXX step5B: 選考ステータスの変更記録（job_entry_status_histories）。
//
// - 対象の列: entry_flag / entry_flag_detail / company_flag / person_flag / is_active / archived_at（有無）。
//   辞退・見送り・クローズ・取消・再開（is_active の復帰、アーカイブ解除）はこれらの列の変化として残る。
// - 変わる保存のたびに 1 行追記する（追加のみ）。変わらない保存では書かない。
//   作成は event=create（from は NULL）、削除は event=delete（to は NULL）として残す。
// - 方針は step2 の担当CA履歴と同じ: **更新と同じトランザクションで書く**（記録に失敗したら本体の更新も戻る）。
// - job_entries を書き換える経路を増やしたら必ずここを呼ぶ（経路一覧は ENTRY_STATUS_ROUTES）。
//   選考ステータス以外の列だけを書く経路（sync-task の Google ToDo ID、tasks の task_requested_at、entryDate だけの PATCH）は対象外。

import type { Prisma, PrismaClient } from "@prisma/client";

export const ENTRY_STATUS_ROUTES = {
  entryUpdate: "entry_update", // PATCH /api/entries/[entryId]（エントリー詳細の編集・アーカイブ・復帰を含む）
  entryFlags: "entry_flags", // PATCH /api/entries/[entryId]/flags（エントリーボードのフラグ変更）
  bulkFlags: "bulk_flags", // PATCH /api/entries/bulk-flags（一括フラグ変更）
  autoProgress: "auto_progress", // POST /api/entries/auto-progress（日程調整などの自動進行）
  bulkArchive: "bulk_archive", // POST /api/entries/bulk-archive
  entryCreate: "entry_create", // POST /api/entries（手入力の新規エントリー）
  candidateEntriesCreate: "candidate_entries_create", // POST /api/candidates/[id]/entries（求人マイページ経由の一括作成）
  bookmarkToEntry: "bookmark_to_entry", // POST /api/candidates/[id]/bookmarks/to-entry（ブックマーク→エントリー）
  autoExpire: "auto_expire", // POST /api/internal/entries/auto-expire（1 か月放置の求人紹介を未応募化・定期処理）
  bulkImport: "bulk_import", // POST /api/internal/entries/bulk-import（FileMaker 取り込み）
  entryDelete: "entry_delete", // DELETE /api/entries/[entryId]・DELETE /api/candidates/[id]/entries/[entryId]
  bulkDelete: "bulk_delete", // POST /api/entries/bulk-delete（アーカイブ済みの完全削除）
  revertBulk: "revert_bulk", // POST /api/candidates/[id]/entries/revert-bulk（求人紹介に戻す＝エントリー行の削除）
  autoPurge: "auto_purge", // POST /api/internal/entries/auto-purge（アーカイブ後の自動削除・定期処理）
  bulkImportDelete: "bulk_import_delete", // DELETE /api/internal/entries/bulk-import
} as const;

export type EntryStatusRoute = (typeof ENTRY_STATUS_ROUTES)[keyof typeof ENTRY_STATUS_ROUTES];
export type EntryStatusEvent = "create" | "update" | "delete";

type Db = PrismaClient | Prisma.TransactionClient;

/** 記録に使う列だけの select（findUnique / findMany に渡す）。 */
export const ENTRY_STATUS_SELECT = {
  id: true,
  candidateId: true,
  entryFlag: true,
  entryFlagDetail: true,
  companyFlag: true,
  personFlag: true,
  isActive: true,
  archivedAt: true,
} as const;

export interface EntryStatusSnapshot {
  id: string;
  candidateId: string;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  companyFlag: string | null;
  personFlag: string | null;
  isActive: boolean;
  archivedAt: Date | null;
}

const norm = (v: string | null | undefined): string | null => (v == null || v === "" ? null : v);

/** 変わった項目名の一覧（空なら変化なし）。 */
export function entryStatusChangedFields(
  before: EntryStatusSnapshot | null,
  after: EntryStatusSnapshot | null,
): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  if (norm(before.entryFlag) !== norm(after.entryFlag)) out.push("entryFlag");
  if (norm(before.entryFlagDetail) !== norm(after.entryFlagDetail)) out.push("entryFlagDetail");
  if (norm(before.companyFlag) !== norm(after.companyFlag)) out.push("companyFlag");
  if (norm(before.personFlag) !== norm(after.personFlag)) out.push("personFlag");
  if (before.isActive !== after.isActive) out.push("isActive");
  if ((before.archivedAt != null) !== (after.archivedAt != null)) out.push("archived");
  return out;
}

export interface EntryStatusChange {
  event: EntryStatusEvent;
  /** create のときは null */
  before: EntryStatusSnapshot | null;
  /** delete のときは null */
  after: EntryStatusSnapshot | null;
  changedByUserId: string | null;
  route: EntryStatusRoute;
}

function toRow(c: EntryStatusChange): Prisma.JobEntryStatusHistoryCreateManyInput | null {
  const ref = c.after ?? c.before;
  if (!ref) return null;
  const changedFields =
    c.event === "update" ? entryStatusChangedFields(c.before, c.after) : ["entryFlag", "entryFlagDetail", "companyFlag", "personFlag", "isActive", "archived"];
  if (c.event === "update" && changedFields.length === 0) return null;
  return {
    jobEntryId: ref.id,
    candidateId: ref.candidateId,
    event: c.event,
    fromEntryFlag: norm(c.before?.entryFlag),
    toEntryFlag: norm(c.after?.entryFlag),
    fromEntryFlagDetail: norm(c.before?.entryFlagDetail),
    toEntryFlagDetail: norm(c.after?.entryFlagDetail),
    fromCompanyFlag: norm(c.before?.companyFlag),
    toCompanyFlag: norm(c.after?.companyFlag),
    fromPersonFlag: norm(c.before?.personFlag),
    toPersonFlag: norm(c.after?.personFlag),
    fromIsActive: c.before ? c.before.isActive : null,
    toIsActive: c.after ? c.after.isActive : null,
    fromArchived: c.before ? c.before.archivedAt != null : null,
    toArchived: c.after ? c.after.archivedAt != null : null,
    changedFields,
    changedByUserId: c.changedByUserId,
    route: c.route,
  };
}

/** 1 件。変化が無ければ何も書かず false を返す。 */
export async function recordJobEntryStatusChange(db: Db, change: EntryStatusChange): Promise<boolean> {
  const row = toRow(change);
  if (!row) return false;
  await db.jobEntryStatusHistory.create({ data: row });
  return true;
}

/** 複数件。変化のある行だけをまとめて追記し、追記した件数を返す。 */
export async function recordJobEntryStatusChanges(db: Db, changes: EntryStatusChange[]): Promise<number> {
  const rows = changes.map(toRow).filter((r): r is Prisma.JobEntryStatusHistoryCreateManyInput => r != null);
  if (rows.length === 0) return 0;
  const res = await db.jobEntryStatusHistory.createMany({ data: rows });
  return res.count;
}

/**
 * よく使う形: 更新前のスナップショット配列と更新後の配列（id で突き合わせ）から update の記録をまとめて書く。
 */
export async function recordJobEntryStatusUpdates(
  db: Db,
  params: { before: EntryStatusSnapshot[]; after: EntryStatusSnapshot[]; changedByUserId: string | null; route: EntryStatusRoute },
): Promise<number> {
  const afterById = new Map(params.after.map((a) => [a.id, a]));
  return recordJobEntryStatusChanges(
    db,
    params.before
      .filter((b) => afterById.has(b.id))
      .map((b) => ({ event: "update" as const, before: b, after: afterById.get(b.id)!, changedByUserId: params.changedByUserId, route: params.route })),
  );
}
