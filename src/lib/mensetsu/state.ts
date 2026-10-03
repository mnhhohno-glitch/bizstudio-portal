// T-206: 記録の「今の状態」を expiresAt とエントリーの状態から計算する（保存しない）。
import { isEntryClosed, type ClosableEntry } from "./constants";

/** 表示・配信で使う状態。published 以外は公開 URL から見られない */
export type MensetsuDisplayStatus = "draft" | "published" | "expired" | "stopped" | "closed";

export const DISPLAY_STATUS_LABEL: Record<MensetsuDisplayStatus, string> = {
  draft: "下書き",
  published: "公開中",
  expired: "期限切れ",
  stopped: "公開停止",
  closed: "選考終了",
};

export type StatefulPage = {
  status: string;
  expiresAt: Date | null;
  entry?: ClosableEntry | null;
};

/**
 * 優先順: 下書き → 公開停止 → 選考終了 → 期限切れ → 公開中
 */
export function resolveDisplayStatus(page: StatefulPage, now: Date = new Date()): MensetsuDisplayStatus {
  if (page.status === "draft") return "draft";
  if (page.status === "stopped") return "stopped";
  if (isEntryClosed(page.entry)) return "closed";
  if (!page.expiresAt || now.getTime() >= page.expiresAt.getTime()) return "expired";
  return "published";
}
