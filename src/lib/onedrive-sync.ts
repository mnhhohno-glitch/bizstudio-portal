/**
 * T-159 Phase 2-a: portal → OneDrive 一方向コピーの「記録」と「書き込み先の組み立て」。
 *
 * 本ファイルには **呼び出し側（upload route への差し込み）は含めない**。Phase 2-b で
 * 実際のコピー処理を足すときに、ここの純関数と upsert をそのまま使う。
 * したがって本ファイルを追加した時点では portal の挙動は一切変わらない。
 *
 * 責務の分担:
 *   - src/lib/microsoft-graph.ts … Graph との通信・書き込み先ガード（接続層）
 *   - 本ファイル                  … どこへ書くべきかの決定 + OneDriveSyncLog への記録（同期ロジック層）
 */

import type { Prisma } from "@prisma/client";
import {
  CandidateFileCategory,
  OneDriveSyncSkipReason,
  OneDriveSyncStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ONEDRIVE_WRITE_ROOT, assertOneDriveWritePath } from "@/lib/microsoft-graph";

// ============================================================
// カテゴリ → サブフォルダ名
// ============================================================

/**
 * コピー対象カテゴリと、求職者フォルダ直下の投入先サブフォルダ名の対応。
 * 表記は Phase 2-0 で実物を列挙して確定（半角ピリオド・スペースなし）。ここを書き換えると
 * 全件が SKIPPED(NO_SUBFOLDER) になるので、実フォルダ名を確認せずに触らないこと。
 */
export const ONEDRIVE_SUBFOLDER_BY_CATEGORY: Partial<Record<CandidateFileCategory, string>> = {
  [CandidateFileCategory.BOOKMARK]: "2.求人",
  [CandidateFileCategory.BS_DOCUMENT]: "3.BS作成書類",
};

/** 対象カテゴリなら投入先サブフォルダ名、対象外なら null。 */
export function oneDriveSubfolderForCategory(
  category: CandidateFileCategory | string,
): string | null {
  return ONEDRIVE_SUBFOLDER_BY_CATEGORY[category as CandidateFileCategory] ?? null;
}

// ============================================================
// oneDriveFolderUrl → ドライブ相対パスの復元（純関数）
// ============================================================

export type DrivePathRestoreFailure =
  | "EMPTY" // URL が未登録
  | "NOT_A_URL" // URL としてパースできない
  | "NO_ID_PARAM" // ?id= が無い
  | "UNEXPECTED_ID_FORMAT" // /personal/{owner}/Documents/... の形でない
  | "OUTSIDE_WRITE_ROOT"; // 復元できたが書き込み許可プレフィックス配下でない

export type DrivePathRestoreResult =
  | { ok: true; ownerSegment: string; folderPath: string }
  | { ok: false; reason: DrivePathRestoreFailure };

/**
 * `Candidate.oneDriveFolderUrl`（SharePoint の my?id=... 形式）からドライブ相対パスを復元する。
 *
 * Phase 1 で本番1,734件すべての復元に成功している。パスをパターンから組み立ててはいけない
 * （CAごとに階層の深さが4〜7段とばらつく）。復元したフルパスをそのまま使うこと。
 *
 * ★文字列に NFKC / toLowerCase / trim を一切かけない。percent-decode は SharePoint が掛けた
 *   エンコードを戻すだけで、文字そのものは変換しない。NFKC を通すと全角チルダ `～`(U+FF5E) や
 *   全角スペースが半角に化けて 404 になる（Phase 2-0 で実測）。
 *
 * URLSearchParams ではなく自前パースなのは、URLSearchParams が `+` をスペースとして解釈するため。
 * 実データに生の `+` は0件だが、将来フォルダ名に `+` が入ったときに黙って壊れる経路を残さない。
 *
 * 復元できなければ書かずにスキップ（フェイルクローズ）。誤ったフォルダへ書くより何もしない方がよい。
 */
export function restoreDrivePathFromFolderUrl(
  url: string | null | undefined,
): DrivePathRestoreResult {
  if (!url) return { ok: false, reason: "EMPTY" };

  let search: string;
  try {
    search = new URL(url).search;
  } catch {
    return { ok: false, reason: "NOT_A_URL" };
  }

  const rawId = search
    .replace(/^\?/, "")
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq < 0 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
    })
    .find(([key]) => key === "id")?.[1];

  if (!rawId) return { ok: false, reason: "NO_ID_PARAM" };

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    return { ok: false, reason: "UNEXPECTED_ID_FORMAT" };
  }

  // 例: /personal/masayuki_oono_bizstudio_co_jp/Documents/ビズスタジオ/6.求職者書類関連/...
  const m = decoded.match(/^\/personal\/([^/]+)\/Documents\/(.+)$/);
  if (!m) return { ok: false, reason: "UNEXPECTED_ID_FORMAT" };

  const folderPath = `/${m[2].replace(/\/$/, "")}`;

  // フェイルクローズ: 求職者書類関連の配下でない URL が貼られていたら、そこには書かない。
  if (!folderPath.startsWith(ONEDRIVE_WRITE_ROOT) || folderPath.includes("..")) {
    return { ok: false, reason: "OUTSIDE_WRITE_ROOT" };
  }

  return { ok: true, ownerSegment: m[1], folderPath };
}

// ============================================================
// 書き込み先パスの組み立て
// ============================================================

export type OneDriveTargetResult =
  | {
      ok: true;
      /** URL に現れる所有者セグメント（例 masayuki_oono_bizstudio_co_jp）。実際の Graph 呼び出しは ONEDRIVE_OWNER_UPN を使う */
      ownerSegment: string;
      /** 求職者フォルダ本体 */
      candidateFolderPath: string;
      /** 投入先サブフォルダ（2.求人 / 3.BS作成書類） */
      folderPath: string;
      /** サブフォルダ + ファイル名。OneDriveSyncLog.targetPath に入れる値 */
      targetPath: string;
    }
  | { ok: false; skipReason: OneDriveSyncSkipReason; detail: string };

/**
 * CandidateFile の情報から、実際に書き込む OneDrive のパスを組み立てる。
 * 通信は一切しない純関数。サブフォルダが実在するかは呼び出し側が Graph で確認する。
 */
export function buildOneDriveTargetPath(params: {
  oneDriveFolderUrl: string | null | undefined;
  category: CandidateFileCategory | string;
  fileName: string;
}): OneDriveTargetResult {
  const subfolder = oneDriveSubfolderForCategory(params.category);
  if (!subfolder) {
    return {
      ok: false,
      skipReason: OneDriveSyncSkipReason.UNSUPPORTED_CATEGORY,
      detail: `対象外カテゴリ: ${String(params.category)}`,
    };
  }

  const restored = restoreDrivePathFromFolderUrl(params.oneDriveFolderUrl);
  if (!restored.ok) {
    return {
      ok: false,
      skipReason: OneDriveSyncSkipReason.NO_FOLDER_URL,
      detail: `OneDrive フォルダURLからパスを復元できません: ${restored.reason}`,
    };
  }

  const folderPath = `${restored.folderPath}/${subfolder}`;
  // 組み立て結果も接続層と同じガードに通す（ここで弾けば Graph まで届かない）。
  const targetPath = assertOneDriveWritePath(`${folderPath}/${params.fileName}`);

  return {
    ok: true,
    ownerSegment: restored.ownerSegment,
    candidateFolderPath: restored.folderPath,
    folderPath,
    targetPath,
  };
}

// ============================================================
// キルスイッチ
// ============================================================

/**
 * ONEDRIVE_SYNC_ENABLED の判定。未設定・想定外の値はすべて false（フェイルクローズ）。
 * false のときは記録だけ残して Graph へは行かない（skipReason=SYNC_DISABLED）。
 */
export function isOneDriveSyncEnabled(): boolean {
  const raw = (process.env.ONEDRIVE_SYNC_ENABLED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

// ============================================================
// OneDriveSyncLog の記録
// ============================================================

/** errorMessage の保存長。Graph のエラー本文がそのまま巨大になるのを防ぐ。 */
export const ONEDRIVE_ERROR_MESSAGE_MAX = 1000;

export function truncateErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.length <= ONEDRIVE_ERROR_MESSAGE_MAX
    ? message
    : message.slice(0, ONEDRIVE_ERROR_MESSAGE_MAX);
}

export interface OneDriveSyncLogInput {
  candidateFileId: string;
  candidateId: string;
  status: OneDriveSyncStatus;
  skipReason?: OneDriveSyncSkipReason | null;
  targetPath?: string | null;
  targetItemId?: string | null;
  /** スキップ時の兄弟フォルダ名一覧。未指定なら既存値を触らない */
  siblingFolders?: string[];
  /** Graph へ実際に行った試行として数えるか。true なら attemptCount+1 と lastAttemptedAt 更新 */
  countAttempt?: boolean;
  errorMessage?: string | null;
}

/**
 * OneDriveSyncLog を candidateFileId をキーに upsert する。
 *
 * PENDING 行は CandidateFile の作成と同一トランザクションで作る想定のため、Prisma の
 * トランザクションクライアントを受け取れるようにしてある（tx 未指定なら通常の prisma）。
 * こうしておくと「行が無い＝そもそも同期対象として受け付けていない」が保証でき、
 * 拾い直し cron は本テーブルだけを見ればよくなる。
 */
export async function upsertOneDriveSyncLog(
  input: OneDriveSyncLogInput,
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;
  const now = new Date();
  const errorMessage = truncateErrorMessage(input.errorMessage);

  const common = {
    status: input.status,
    skipReason: input.skipReason ?? null,
    targetPath: input.targetPath ?? null,
    targetItemId: input.targetItemId ?? null,
    errorMessage,
  };

  return client.oneDriveSyncLog.upsert({
    where: { candidateFileId: input.candidateFileId },
    create: {
      candidateFileId: input.candidateFileId,
      candidateId: input.candidateId,
      ...common,
      siblingFolders: input.siblingFolders ?? [],
      attemptCount: input.countAttempt ? 1 : 0,
      lastAttemptedAt: input.countAttempt ? now : null,
    },
    update: {
      ...common,
      ...(input.siblingFolders ? { siblingFolders: input.siblingFolders } : {}),
      ...(input.countAttempt
        ? { attemptCount: { increment: 1 }, lastAttemptedAt: now }
        : {}),
    },
  });
}
