// T-170: 「最終接触日 / 放置日数 / 求人紹介（配信）数」の定義を1箇所に集約する。
//
// これまで定義は求職者ダッシュボード（src/app/api/candidates/[candidateId]/dashboard/route.ts）の
// 中にだけ存在していた。求職者管理一覧（/admin/master）にも同じ指標を出すにあたり、
// 一覧側で定義を再発明すると両画面の数値が食い違うため、共通関数としてここへ切り出した。
// ダッシュボード route はこのモジュールを呼ぶだけに置き換えており、表示値・挙動は不変。
//
// 罠#17: JST 日付は toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'}) で作る。
//        toISOString().slice(0,10) は UTC 基準で 9 時間ずれるため禁止。

import type { Prisma } from "@prisma/client";
import { todayJstDateString, toJstDateString } from "@/lib/dailyReport/jstDate";

/**
 * 「求人紹介数（＝ダッシュボードの求人配信数）」としてカウントする CandidateFile の条件。
 *
 * T-161 R2 の定義そのまま:
 *   BOOKMARK かつ「本人応募（origin=candidate かつ PDF 無し）」を除き、
 *   「出力済み（lastExportedAt）∪ 出力なし紹介済み（introducedAt）」のいずれかを持つ行。
 *
 * 使う側で candidateId / candidateId:{in:[...]} を足して使う。
 */
export const DELIVERED_BOOKMARK_FILTER: Prisma.CandidateFileWhereInput = {
  category: "BOOKMARK",
  NOT: { origin: "candidate", driveFileId: null },
  OR: [{ lastExportedAt: { not: null } }, { introducedAt: { not: null } }],
};

/** 渡された日時のうち最も新しいものを返す（全て null なら null）。 */
export function maxDate(...ds: (Date | null | undefined)[]): Date | null {
  let m: Date | null = null;
  for (const d of ds) if (d && (!m || d > m)) m = d;
  return m;
}

/** JST 日付文字列（YYYY-MM-DD）同士の日数差（a - b）。JST 0:00 基準。 */
export function diffJstDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00+09:00`).getTime();
  const db = new Date(`${b}T00:00:00+09:00`).getTime();
  return Math.round((da - db) / 86_400_000);
}

/**
 * 最終接触日 = 面談実施 / 連絡メモ(CandidateNote) / 連絡記録(ContactLog) / 求人提案（送信・紹介）の最新。
 * タスク完了は含めない（ダッシュボードの定義と同一）。
 */
export function computeLastContact(src: {
  latestInterviewAt?: Date | null;
  latestNoteAt?: Date | null;
  latestContactLogAt?: Date | null;
  /** DELIVERED_BOOKMARK_FILTER 対象の max(lastExportedAt, introducedAt) */
  latestDeliveryAt?: Date | null;
}): Date | null {
  return maxDate(
    src.latestInterviewAt ?? null,
    src.latestNoteAt ?? null,
    src.latestContactLogAt ?? null,
    src.latestDeliveryAt ?? null,
  );
}

/**
 * 放置日数 = 今日(JST) − 最終接触日(JST) の日数差。最終接触が無ければ null。
 * 一括計算では todayStr を呼び出し側で1回だけ作って渡す（全行で同じ「今日」を使うため）。
 */
export function idleDaysFrom(lastContact: Date | null, todayStr: string = todayJstDateString()): number | null {
  if (!lastContact) return null;
  return diffJstDays(todayStr, toJstDateString(lastContact));
}

/** 放置日数の信号レベル。DashboardTab の idleSignal と同じ閾値: 緑 ≤7 / 黄 8〜14 / 赤 15〜 / null は無し。 */
export type IdleLevel = "ok" | "warn" | "alert";
export function idleLevelOf(days: number | null): IdleLevel | null {
  if (days === null) return null;
  if (days <= 7) return "ok";
  if (days <= 14) return "warn";
  return "alert";
}
