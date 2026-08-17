/**
 * T-159: portal → OneDrive 一方向コピー（同期ロジック層）。
 *
 * 責務の分担:
 *   - src/lib/microsoft-graph.ts … Graph との通信・書き込み先ガード（接続層）
 *   - 本ファイル                  … どこへ書くべきかの決定 + 実行 + OneDriveSyncLog への記録
 *
 * Phase 2-a: 書き込み先の組み立てと記録（純関数 + upsert）
 * Phase 2-b: 実行本体（enqueueOneDriveSync / runOneDriveSyncForFile / triggerOneDriveSync）
 *
 * ★呼び出し側との契約（これが崩れると既存のアップロードが壊れる）:
 *   1. PENDING 行は CandidateFile の作成と**同一トランザクション**で作る（enqueueOneDriveSync に tx を渡す）。
 *      「行が無い＝そもそも同期対象として受け付けていない」を保証するため。
 *   2. 実行は fire-and-forget（triggerOneDriveSync）。await しない。
 *   3. runOneDriveSyncForFile は**例外を投げない**。OneDrive の失敗が HTTP 500 に化けてはならない。
 */

import type { Prisma } from "@prisma/client";
import {
  CandidateFileCategory,
  OneDriveSyncSkipReason,
  OneDriveSyncStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GraphError,
  ONEDRIVE_WRITE_ROOT,
  assertOneDriveWritePath,
  getDriveItemByPath,
  listChildrenByPath,
  uploadFileByPath,
} from "@/lib/microsoft-graph";
import { downloadFileFromDrive } from "@/lib/google-drive";

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

/**
 * URL復元の失敗理由 → skipReason。
 *
 * CAに求める行動が違うので2つに分ける（Phase 2-c の画面表示がこの2値で文言を出し分ける）:
 *   EMPTY（未登録）    → NO_FOLDER_URL  「OneDriveフォルダURLを登録してください」
 *   それ以外（不正URL）→ BAD_FOLDER_URL 「OneDriveフォルダURLを貼り直してください」
 *
 * OUTSIDE_WRITE_ROOT も BAD_FOLDER_URL に寄せる。CAから見ればどちらも「貼ったURLがおかしい」であり、
 * 求職者書類関連の外を指すURLが登録されている＝貼り直してもらう以外に打つ手が無いため。
 */
export function skipReasonForRestoreFailure(
  reason: DrivePathRestoreFailure,
): OneDriveSyncSkipReason {
  return reason === "EMPTY"
    ? OneDriveSyncSkipReason.NO_FOLDER_URL
    : OneDriveSyncSkipReason.BAD_FOLDER_URL;
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
      skipReason: skipReasonForRestoreFailure(restored.reason),
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
 *
 * false のときは PENDING の記録だけ残して Graph へは 1 バイトも送らない。
 * ★SKIPPED(SYNC_DISABLED) にはしない（T-159 Phase 2-b で確定）。SKIPPED にすると
 *   「再試行しない」の意味になり、有効化しても停止期間中のファイルを夜間処理が拾えなくなるため。
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

// ============================================================
// 再試行制御（列と定数のみ。実際に拾うのは Phase 2-c の夜間処理）
// ============================================================

/** 再試行の上限回数。これに達したら status=GIVEN_UP にして以後拾わない。 */
export const ONEDRIVE_SYNC_MAX_ATTEMPTS = 5;

/**
 * 指数バックオフの間隔（分）。attemptCount 回目の失敗の後に待つ時間。
 * 5分 → 15分 → 1時間 → 6時間 → 24時間。
 * ★本 Phase（2-b）では夜間処理を実装しないため、この定数はまだ使われない。
 */
export const ONEDRIVE_SYNC_BACKOFF_MINUTES = [5, 15, 60, 360, 1440] as const;

/**
 * attemptCount 回試行した後の次回再試行時刻。上限に達していれば null（＝GIVEN_UP）。
 * 呼び出すのは Phase 2-c の夜間処理。
 */
export function nextOneDriveRetryAt(attemptCount: number, from: Date): Date | null {
  if (attemptCount >= ONEDRIVE_SYNC_MAX_ATTEMPTS) return null;
  const minutes =
    ONEDRIVE_SYNC_BACKOFF_MINUTES[Math.max(0, attemptCount - 1)] ??
    ONEDRIVE_SYNC_BACKOFF_MINUTES[ONEDRIVE_SYNC_BACKOFF_MINUTES.length - 1];
  return new Date(from.getTime() + minutes * 60 * 1000);
}

// ============================================================
// 受付（CandidateFile 作成と同一トランザクションで呼ぶ）
// ============================================================

/**
 * CandidateFile を OneDrive コピーの対象として受け付け、PENDING の記録を1行作る。
 *
 * ★必ず CandidateFile を作る**同一トランザクション**の中で呼ぶこと（tx を渡す）。
 *   行の有無が「同期対象として受け付けたか」の唯一の判定であり、ここがずれると
 *   Phase 2-c の拾い直しが candidate_files（10万行超）を全走査する羽目になる。
 *
 * 対象外カテゴリ（BOOKMARK / BS_DOCUMENT 以外）では**行を作らない**。
 * 作っても永遠に SKIPPED(UNSUPPORTED_CATEGORY) にしかならず、テーブルを無駄に太らせるだけのため。
 *
 * @returns 受け付けたら true（＝呼び出し側は triggerOneDriveSync を呼んでよい）
 */
export async function enqueueOneDriveSync(
  params: {
    candidateFileId: string;
    candidateId: string;
    category: CandidateFileCategory | string;
  },
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  if (!oneDriveSubfolderForCategory(params.category)) return false;

  await upsertOneDriveSyncLog(
    {
      candidateFileId: params.candidateFileId,
      candidateId: params.candidateId,
      status: OneDriveSyncStatus.PENDING,
      skipReason: null,
    },
    tx,
  );
  return true;
}

// ============================================================
// 実行本体
// ============================================================

export interface RunOneDriveSyncParams {
  candidateFileId: string;
  /**
   * 呼び出し元が既に持っているファイル本体。渡されていれば Google Drive から取り直さない
   * （アップロード直後は必ず手元にあるため、往復を1回減らす）。
   */
  content?: Buffer | null;
  /** content を渡すときの MIME タイプ。未指定なら CandidateFile.mimeType を使う。 */
  mimeType?: string | null;
}

/**
 * 外部 I/O（Graph / Google Drive）の差し替え口。既定は実物。
 * テストから「アップロードが呼ばれないこと」を確かめるためだけに存在する差し込み点であり、
 * 本番コードから deps を渡す想定は無い。
 */
export interface OneDriveSyncDeps {
  getDriveItemByPath: typeof getDriveItemByPath;
  listChildrenByPath: typeof listChildrenByPath;
  uploadFileByPath: typeof uploadFileByPath;
  downloadFileFromDrive: typeof downloadFileFromDrive;
}

const DEFAULT_ONEDRIVE_SYNC_DEPS: OneDriveSyncDeps = {
  getDriveItemByPath,
  listChildrenByPath,
  uploadFileByPath,
  downloadFileFromDrive,
};

/** attemptOneDriveSync に渡す CandidateFile の必要項目（DB 依存を切り離すためのフラットな形）。 */
export interface OneDriveSyncFile {
  id: string;
  candidateId: string;
  category: CandidateFileCategory | string;
  fileName: string;
  mimeType: string | null;
  driveFileId: string | null;
  oneDriveFolderUrl: string | null;
}

/** attemptOneDriveSync の結果。record=false なら OneDriveSyncLog を一切触らない。 */
export interface OneDriveSyncAttempt {
  record: boolean;
  status: OneDriveSyncStatus;
  skipReason: OneDriveSyncSkipReason | null;
  targetPath: string | null;
  targetItemId: string | null;
  siblingFolders?: string[];
  countAttempt?: boolean;
  errorMessage: string | null;
}

export interface OneDriveSyncOutcome {
  status: OneDriveSyncStatus;
  skipReason: OneDriveSyncSkipReason | null;
  targetPath: string | null;
  targetItemId: string | null;
  errorMessage: string | null;
}

function outcome(
  status: OneDriveSyncStatus,
  skipReason: OneDriveSyncSkipReason | null,
  extra: Partial<OneDriveSyncOutcome> = {},
): OneDriveSyncOutcome {
  return {
    status,
    skipReason,
    targetPath: null,
    targetItemId: null,
    errorMessage: null,
    ...extra,
  };
}

/**
 * Graph の例外 → (status, skipReason) の対応。
 *
 * ★分け方の基準は「再試行すれば直る見込みがあるか」の一点。
 *   FAILED は夜間処理（Phase 2-c）が最大 ONEDRIVE_SYNC_MAX_ATTEMPTS 回まで拾い直す対象になり、
 *   SKIPPED は二度と拾わない。何度送っても同じ結果になるものを FAILED にすると、
 *   5回試して GIVEN_UP になるだけの無駄な往復を毎晩発生させる。
 *
 *   400 bad request       → SKIPPED   壊れたファイル名など。同じ入力を送る限り永遠に 400
 *   404 itemNotFound      → SKIPPED   サブフォルダが無い。フォルダは作らない（確定仕様）
 *   409 nameAlreadyExists → SKIPPED   上書きしないのが仕様。再試行しても同じ結果
 *   401 / 403             → FAILED    シークレット失効・権限剥奪。直せば通るので再試行対象
 *   429                   → FAILED    スロットリング。時間を空ければ通る
 *   その他                 → FAILED    5xx・ネットワーク断。時間を空ければ通る
 *
 *   skipReason は status と直交する（GRAPH_ERROR は SKIPPED 側にも FAILED 側にも出る）。
 *   「恒久的な Graph エラー」と「一時的な Graph エラー」の区別は status 側が持つ。
 */
function classifyGraphError(e: unknown): {
  status: OneDriveSyncStatus;
  skipReason: OneDriveSyncSkipReason;
} {
  if (e instanceof GraphError) {
    if (e.status === 400) {
      return {
        status: OneDriveSyncStatus.SKIPPED,
        skipReason: OneDriveSyncSkipReason.GRAPH_ERROR,
      };
    }
    if (e.status === 409) {
      return {
        status: OneDriveSyncStatus.SKIPPED,
        skipReason: OneDriveSyncSkipReason.NAME_ALREADY_EXISTS,
      };
    }
    if (e.status === 404) {
      return {
        status: OneDriveSyncStatus.SKIPPED,
        skipReason: OneDriveSyncSkipReason.NO_SUBFOLDER,
      };
    }
    if (e.status === 401 || e.status === 403) {
      return {
        status: OneDriveSyncStatus.FAILED,
        skipReason: OneDriveSyncSkipReason.AUTH_ERROR,
      };
    }
    if (e.status === 429) {
      return {
        status: OneDriveSyncStatus.FAILED,
        skipReason: OneDriveSyncSkipReason.RATE_LIMITED,
      };
    }
  }
  return {
    status: OneDriveSyncStatus.FAILED,
    skipReason: OneDriveSyncSkipReason.GRAPH_ERROR,
  };
}

/**
 * 求職者フォルダ直下の子フォルダ名一覧。SKIPPED(NO_SUBFOLDER) のときだけ1回取りに行く。
 * 「2.求人 が無い」と言われた CA が、ではどこへ手で入れればよいかを画面で判断できるようにするため。
 * ここで更に失敗しても本流には影響させない（空配列で返す）。
 */
async function fetchSiblingFolders(
  deps: OneDriveSyncDeps,
  upn: string,
  candidateFolderPath: string,
): Promise<string[]> {
  try {
    // 求職者フォルダ自体が無いときは listChildrenByPath が null を返す → 空配列。
    // 「フォルダ階層がまるごと無い」も NO_SUBFOLDER として、siblingFolders 空で記録する。
    const children = await deps.listChildrenByPath(upn, candidateFolderPath);
    return (children ?? []).filter((c) => c.folder).map((c) => c.name);
  } catch (e) {
    console.error("[onedrive-sync] 兄弟フォルダの列挙に失敗（記録は続行）:", e);
    return [];
  }
}

function attempt(
  record: boolean,
  status: OneDriveSyncStatus,
  skipReason: OneDriveSyncSkipReason | null,
  extra: Partial<OneDriveSyncAttempt> = {},
): OneDriveSyncAttempt {
  return {
    record,
    status,
    skipReason,
    targetPath: null,
    targetItemId: null,
    errorMessage: null,
    ...extra,
  };
}

/**
 * 1件ぶんのコピー判断と実行。DB には一切触らない（記録は呼び出し元 runOneDriveSyncForFile の責務）。
 *
 * 処理順は「通信しない判定 → キルスイッチ → **投入先フォルダの実在確認** → 本体取得 → アップロード」。
 *
 * ★フォルダ実在確認を省いてはいけない（T-159 有効化テストで判明した最重要の前提）。
 *   当初は「サブフォルダが無ければ Graph が 404 を返す」と考えていたが、これは**誤り**だった。
 *   Graph のパス指定アップロード（PUT :/content）は、**存在しない中間フォルダを暗黙に作成する**。
 *   実際に `2.求人` が無い求職者へ送ったところ、Graph が `2.求人` を新規作成してそこへ格納した
 *   （作成されたフォルダの createdBy.application.id が MS_GRAPH_CLIENT_ID と一致）。
 *   404 itemNotFound が返るのは**読み取りのみ**であり、conflictBehavior=fail は**同名ファイルにしか効かない**。
 *   したがって「送ってから 404 を見る」方式では OneDrive を汚す。必ず送る前に GET で確かめる。
 *   この確認で Graph への往復が1回増えるが、意図しないフォルダ作成を防ぐために必須とする。
 */
export async function attemptOneDriveSync(
  file: OneDriveSyncFile,
  params: { content?: Buffer | null; mimeType?: string | null } = {},
  depsOverride: Partial<OneDriveSyncDeps> = {},
): Promise<OneDriveSyncAttempt> {
  const deps: OneDriveSyncDeps = { ...DEFAULT_ONEDRIVE_SYNC_DEPS, ...depsOverride };

  // --- 1) 書き込み先の決定（通信しない） ---
  let target: OneDriveTargetResult;
  try {
    target = buildOneDriveTargetPath({
      oneDriveFolderUrl: file.oneDriveFolderUrl,
      category: file.category,
      fileName: file.fileName,
    });
  } catch (e) {
    // 書き込み先ガードに当たったケース（ファイル名に ".." が含まれる等）。Graph へは 1 バイトも送っていない。
    // ★SKIPPED にする。同じ CandidateFile を再試行しても入力（ファイル名）が変わらない以上、
    //   何度やっても同じガードに当たる。FAILED にすると夜間処理が5回無駄に拾う。
    return attempt(true, OneDriveSyncStatus.SKIPPED, OneDriveSyncSkipReason.GRAPH_ERROR, {
      errorMessage: `書き込み先ガードで中止: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  if (!target.ok) {
    return attempt(true, OneDriveSyncStatus.SKIPPED, target.skipReason, {
      errorMessage: target.detail,
    });
  }

  // --- 2) キルスイッチ ---
  // ★false のときは PENDING のまま何もしない（SKIPPED にはしない）。有効化後に夜間処理が拾えるようにするため。
  //   ここで return するので Graph へは 1 バイトも送らない。
  if (!isOneDriveSyncEnabled()) {
    return attempt(false, OneDriveSyncStatus.PENDING, null, { targetPath: target.targetPath });
  }

  const upn = process.env.ONEDRIVE_OWNER_UPN;
  if (!upn) {
    return attempt(true, OneDriveSyncStatus.FAILED, OneDriveSyncSkipReason.AUTH_ERROR, {
      targetPath: target.targetPath,
      errorMessage: "ONEDRIVE_OWNER_UPN が未設定です",
    });
  }

  // --- 3) 投入先フォルダの実在確認（アップロードより前・必須） ---
  //   本体取得より前に置く。無いと分かっているのに Google Drive から数MB落とすのは無駄なため。
  let folderItem: Awaited<ReturnType<typeof getDriveItemByPath>>;
  try {
    folderItem = await deps.getDriveItemByPath(upn, target.folderPath);
  } catch (e) {
    // 読み取りで 404 以外（401/429/5xx 等）。getDriveItemByPath は 404 だけ null に畳んでいる。
    const { status, skipReason } = classifyGraphError(e);
    return attempt(true, status, skipReason, {
      targetPath: target.targetPath,
      countAttempt: true,
      errorMessage: `投入先フォルダの確認に失敗: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  // 無い（求職者フォルダごと無い場合も含む）／同名の非フォルダがある → 書かない。フォルダは作らない。
  if (!folderItem || !folderItem.folder) {
    const siblingFolders = await fetchSiblingFolders(deps, upn, target.candidateFolderPath);
    return attempt(true, OneDriveSyncStatus.SKIPPED, OneDriveSyncSkipReason.NO_SUBFOLDER, {
      targetPath: target.targetPath,
      siblingFolders,
      countAttempt: true,
      errorMessage: folderItem
        ? `投入先パスがフォルダではありません: ${target.folderPath}`
        : `投入先フォルダが存在しません: ${target.folderPath}`,
    });
  }

  // --- 4) ファイル本体 ---
  let content = params.content ?? null;
  let mimeType = params.mimeType ?? file.mimeType ?? "application/octet-stream";
  if (!content) {
    if (!file.driveFileId) {
      return attempt(true, OneDriveSyncStatus.SKIPPED, OneDriveSyncSkipReason.NO_FILE_BODY, {
        targetPath: target.targetPath,
        errorMessage: "driveFileId が null（実体を持たない行）",
      });
    }
    try {
      const downloaded = await deps.downloadFileFromDrive(file.driveFileId);
      content = Buffer.from(downloaded.base64, "base64");
      mimeType = downloaded.mimeType || mimeType;
    } catch (e) {
      return attempt(true, OneDriveSyncStatus.SKIPPED, OneDriveSyncSkipReason.NO_FILE_BODY, {
        targetPath: target.targetPath,
        errorMessage: `Google Drive から本体を取得できません: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  if (content.length === 0) {
    return attempt(true, OneDriveSyncStatus.SKIPPED, OneDriveSyncSkipReason.NO_FILE_BODY, {
      targetPath: target.targetPath,
      errorMessage: "ファイル本体が0バイトです",
    });
  }

  // --- 5) アップロード（同名は上書きせず 409 で弾かれる） ---
  try {
    const item = await deps.uploadFileByPath({
      upn,
      folderPath: target.folderPath,
      fileName: file.fileName,
      content,
      mimeType,
      conflictBehavior: "fail",
    });
    return attempt(true, OneDriveSyncStatus.SUCCESS, null, {
      targetPath: target.targetPath,
      targetItemId: item.id,
      countAttempt: true,
    });
  } catch (e) {
    const { status, skipReason } = classifyGraphError(e);
    // 4) で実在を確かめた直後の 404 は、確認とアップロードの間にフォルダが消えた場合のみ起こる。
    const siblingFolders =
      skipReason === OneDriveSyncSkipReason.NO_SUBFOLDER
        ? await fetchSiblingFolders(deps, upn, target.candidateFolderPath)
        : undefined;
    return attempt(true, status, skipReason, {
      targetPath: target.targetPath,
      siblingFolders,
      countAttempt: true,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * CandidateFile 1件を OneDrive の求職者フォルダへコピーする。
 *
 * ★この関数は例外を投げない。すべて内部で捕捉して OneDriveSyncLog に記録し、正常終了する。
 *   呼び出し元（アップロード API）の成否に影響してはならないのが T-159 の最優先要件。
 */
export async function runOneDriveSyncForFile(
  params: RunOneDriveSyncParams,
  depsOverride: Partial<OneDriveSyncDeps> = {},
): Promise<OneDriveSyncOutcome> {
  const { candidateFileId } = params;

  try {
    const file = await prisma.candidateFile.findUnique({
      where: { id: candidateFileId },
      select: {
        id: true,
        candidateId: true,
        category: true,
        fileName: true,
        mimeType: true,
        driveFileId: true,
        candidate: { select: { oneDriveFolderUrl: true } },
      },
    });

    // 行が消えている（作成直後の削除・ロールバック）。記録先の外部キーも張れないので何もしない。
    if (!file) {
      return outcome(OneDriveSyncStatus.SKIPPED, null, {
        errorMessage: "CandidateFile が見つかりません",
      });
    }

    const result = await attemptOneDriveSync(
      {
        id: file.id,
        candidateId: file.candidateId,
        category: file.category,
        fileName: file.fileName,
        mimeType: file.mimeType,
        driveFileId: file.driveFileId,
        oneDriveFolderUrl: file.candidate.oneDriveFolderUrl,
      },
      { content: params.content, mimeType: params.mimeType },
      depsOverride,
    );

    if (result.record) {
      await upsertOneDriveSyncLog({
        candidateFileId: file.id,
        candidateId: file.candidateId,
        status: result.status,
        skipReason: result.skipReason,
        targetPath: result.targetPath,
        targetItemId: result.targetItemId,
        siblingFolders: result.siblingFolders,
        countAttempt: result.countAttempt,
        errorMessage: result.errorMessage,
      });
    }

    return outcome(result.status, result.skipReason, {
      targetPath: result.targetPath,
      targetItemId: result.targetItemId,
      errorMessage: result.errorMessage,
    });
  } catch (e) {
    // 記録そのものに失敗した場合（DB断など）。ここで throw すると呼び出し元に波及するので握り潰す。
    console.error("[onedrive-sync] 同期処理で想定外の例外（呼び出し元には影響させない）:", e);
    return outcome(OneDriveSyncStatus.FAILED, OneDriveSyncSkipReason.GRAPH_ERROR, {
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * fire-and-forget の起動口。**呼び出し側は await しないこと。**
 *
 * runOneDriveSyncForFile は例外を投げない設計だが、多層防御として catch も付ける
 * （unhandled rejection でプロセスを落とさないため）。既存の recalculateSubStatusIfAuto と同型の
 * 「失敗しても本流を止めない」扱い。
 */
export function triggerOneDriveSync(params: RunOneDriveSyncParams): void {
  void runOneDriveSyncForFile(params).catch((e) => {
    console.error("[onedrive-sync] fire-and-forget で例外（本流には影響しない）:", e);
  });
}
