/**
 * T-159 Phase 4: 求職者1人分の OneDrive 即時同期（画面の「同期」ボタンの中身）。
 *
 * ★なぜ要るか
 *   夜間処理（JST 02:00）は全件を対象にした「取りこぼしを翌朝までに拾う」仕組み。
 *   CA が OneDrive にフォルダを作った直後に確かめる手段が無く、
 *   「本当に動いているのか」が分からないまま翌朝まで待つことになっていた。
 *   本ファイルは同じ仕組みを**対象1人に絞って即座に**走らせる。
 *
 * ★夜間処理のロジックは変えない。共有するのは
 *     - フォルダ走査          scanOneDriveCandidateFolders（selectCaFolders で範囲だけ絞る）
 *     - 突合と登録            registerOneDriveFolderUrlForCandidate（突合ルールは同一）
 *     - 1ファイルのコピー      runOneDriveSyncForFile
 *     - 再試行制御の後始末     decideRetryBookkeeping
 *   の4つで、**抽出条件だけ別**にしている（buildOneDriveRetryWhere は触らない）。
 *
 * ★夜間処理との唯一の違いは「待ち時間を飛ばす」こと。
 *   人が意図してボタンを押しているので、SKIPPED の24時間クールダウンと FAILED の
 *   指数バックオフは待たない。一方 attemptCount の上限（GIVEN_UP）は**維持する** —
 *   これは「待てば直るか」ではなく「何度やっても無駄」の判定であり、
 *   連打で無限に Graph を叩ける穴を空けないため。
 *
 * ★OneDrive にフォルダは作らない（読み取りと、既存フォルダへのファイル PUT のみ）。
 */

import type { Prisma } from "@prisma/client";
import { OneDriveSyncSkipReason, OneDriveSyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type OneDriveFolderScanResult,
  isScopedScanTrustworthy,
  matchCandidateFolder,
  scanOneDriveCandidateFolders,
  selectCaFoldersForEmployee,
} from "@/lib/onedrive-folder-scan";
import {
  LEDGER_SOURCE,
  applyFolderUrlRelocation,
  isAutoManagedFolderUrl,
  registerOneDriveFolderUrlForCandidate,
  resolveOwnerSegment,
} from "@/lib/onedrive-folder-url-sync";
import {
  ONEDRIVE_SUBFOLDER_BY_CATEGORY,
  ONEDRIVE_SYNC_MAX_ATTEMPTS,
  isOneDriveSyncEnabled,
  restoreDrivePathFromFolderUrl,
  runOneDriveSyncForFile,
} from "@/lib/onedrive-sync";
import {
  ONEDRIVE_RETRYABLE_SKIP_REASONS,
  decideRetryBookkeeping,
} from "@/lib/onedrive-sync-retry";
import { getDriveItemByPath } from "@/lib/microsoft-graph";

// ============================================================
// 実行制御の定数
// ============================================================

/**
 * 1回の実行に使う実時間の上限（ミリ秒）。超えたら新しい件を取り出さずに打ち切る。
 * ボタンを押した人を待たせ続けないための上限であり、残りは翌朝の夜間処理が拾う
 * （状態はすべて DB 側にあるので取りこぼさない）。
 */
export const ONEDRIVE_SYNC_NOW_BUDGET_MS = 30_000;

/** 1回で処理するファイル数の上限。超えた分は翌朝の夜間処理に回す。 */
export const ONEDRIVE_SYNC_NOW_FILE_LIMIT = 100;

/** 同時に走らせる件数。夜間処理と同じく Graph の 429 を誘発しない範囲。 */
export const ONEDRIVE_SYNC_NOW_CONCURRENCY = 3;

/**
 * 走査で1フォルダの中を何本まで並行に降りるか。
 *
 * ★1 だと本番実測で 37.5秒かかりボタンとして成立しなかった（担当CA 4.安藤 の配下だけで
 *   listChildren が200回超。夜間処理は CA フォルダ単位で3本並行にしているが、
 *   1人分に絞ると対象が1 CA しか無いので並行の余地がそこに無い）。
 *   中を6本並行にして畳む。夜間処理は既定の直列のままで、この値は即時同期だけに効く。
 */
export const ONEDRIVE_SYNC_NOW_SCAN_CONCURRENCY = 6;

/** 同一求職者に対する連打防止の間隔（ミリ秒）。 */
export const ONEDRIVE_SYNC_NOW_COOLDOWN_MS = 60_000;

// ============================================================
// 連打防止（プロセス内）
// ============================================================

/**
 * 求職者ID → 直近に受け付けた時刻。
 *
 * ★DB ではなくプロセス内メモリで持つ。守りたいのは「同じ人が続けて押したときに
 *   Graph へ二重に走らせない」ことだけで、永続化する価値のある状態ではない。
 *   portal は Railway の単一インスタンスで動いているため、これで実用上は足りる
 *   （多重化したら取りこぼす。そのときは DB か Redis に移す必要がある）。
 */
const lastAcceptedAt = new Map<string, number>();

export interface CooldownDecision {
  allowed: boolean;
  /** 次に押せるようになるまでの残り秒（allowed=false のときだけ意味がある）。 */
  retryAfterSeconds: number;
}

/** 純関数版。テストと実処理の両方がこれを使う。 */
export function decideSyncNowCooldown(params: {
  lastAcceptedAt: number | undefined;
  now: number;
  cooldownMs?: number;
}): CooldownDecision {
  const cooldownMs = params.cooldownMs ?? ONEDRIVE_SYNC_NOW_COOLDOWN_MS;
  if (params.lastAcceptedAt === undefined) return { allowed: true, retryAfterSeconds: 0 };
  const elapsed = params.now - params.lastAcceptedAt;
  if (elapsed >= cooldownMs) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.ceil((cooldownMs - elapsed) / 1000) };
}

/** 受け付けてよければ true を返し、同時に受付時刻を記録する。 */
export function tryAcquireSyncNowSlot(
  candidateId: string,
  now: number = Date.now(),
): CooldownDecision {
  const decision = decideSyncNowCooldown({
    lastAcceptedAt: lastAcceptedAt.get(candidateId),
    now,
  });
  if (decision.allowed) lastAcceptedAt.set(candidateId, now);
  return decision;
}

/** テスト・運用時の手動リセット用（本番コードからは呼ばない）。 */
export function resetSyncNowCooldown(candidateId?: string): void {
  if (candidateId) lastAcceptedAt.delete(candidateId);
  else lastAcceptedAt.clear();
}

// ============================================================
// 抽出条件（純関数・夜間処理とは別経路）
// ============================================================

/**
 * 即時同期が拾う行の条件。夜間の `buildOneDriveRetryWhere` を**変えずに**別で組む。
 *
 * 夜間との差は2点だけ:
 *   - 対象を1人に絞る（candidateId）
 *   - 時間待ち（SKIPPED の24時間クールダウン / FAILED の nextRetryAt バックオフ）を見ない
 * 変えないもの:
 *   - driveFileId が null の行は対象外（実体が無いので何度試しても NO_FILE_BODY）
 *   - attemptCount の上限（GIVEN_UP になった行は拾わない）
 *   - 拾い直してよい skipReason の集合（ONEDRIVE_RETRYABLE_SKIP_REASONS）
 */
export function buildOneDriveSyncNowWhere(candidateId: string): Prisma.OneDriveSyncLogWhereInput {
  return {
    candidateId,
    candidateFile: { driveFileId: { not: null } },
    OR: [
      { status: OneDriveSyncStatus.PENDING },
      {
        status: OneDriveSyncStatus.FAILED,
        // ★上限判定は維持する（バックオフの待ち時間だけ飛ばす）。
        attemptCount: { lt: ONEDRIVE_SYNC_MAX_ATTEMPTS },
      },
      {
        status: OneDriveSyncStatus.SKIPPED,
        skipReason: { in: ONEDRIVE_RETRYABLE_SKIP_REASONS },
        // ★24時間クールダウンは見ない（人が意図して押しているため）。
      },
    ],
  };
}

// ============================================================
// 結果と日本語メッセージ
// ============================================================

/** フォルダURLの扱いがどうなったか。 */
export type SyncNowFolderState =
  /** もともと登録済みだった（今回は触っていない） */
  | "ALREADY_LINKED"
  /** 今回の走査で見つけて新たに登録した */
  | "REGISTERED"
  /** 走査したが番号一致のフォルダが無い */
  | "NOT_FOUND"
  /** 番号一致が複数あり、どれが正しいか決められない */
  | "DUPLICATE"
  /** フォルダ名の氏名と portal の氏名が食い違う */
  | "NAME_MISMATCH"
  /** portal 側に求職者番号が無い */
  | "NO_CANDIDATE_NUMBER"
  /** 走査に穴があった（Graph エラー等）ので登録の判断をしなかった */
  | "SCAN_INCOMPLETE"
  /** 走査中に他所で URL が入った */
  | "RACED"
  /** 設定不備（UPN 未設定・所有者セグメント不一致）で確認できなかった */
  | "UNAVAILABLE";

export interface OneDriveSyncNowResult {
  candidateId: string;
  candidateNumber: string;
  folderState: SyncNowFolderState;
  /** 実行後の oneDriveFolderUrl（未登録なら null）。画面のボタン活性の判断に使う。 */
  folderUrl: string | null;
  /** 走査した CA フォルダ（絞り込み結果）。フォールバックしたかは scannedAllCaFolders で分かる。 */
  scannedCaFolders: string[];
  /** 担当CAで絞れず全 CA フォルダを走査したか。 */
  scannedAllCaFolders: boolean;
  /** 抽出条件に合致したファイル数（上限適用前）。 */
  eligibleFiles: number;
  /** 実際に処理したファイル数。 */
  processedFiles: number;
  /** コピーできた件数。 */
  copied: number;
  /** 同名が既にあってコピーしなかった件数。 */
  nameConflicts: number;
  /** サブフォルダが無くてコピーできなかった件数。 */
  missingSubfolder: number;
  /** 不足していたサブフォルダ名（「2.求人」等）。 */
  missingSubfolderNames: string[];
  /** 実体（PDF）が無くてコピーしなかった件数。 */
  noFileBody: number;
  /** 失敗した件数（翌朝の夜間処理が再試行する）。 */
  failed: number;
  /** 上限・時間切れで今回触らなかった件数。 */
  deferred: number;
  /** 時間内に終わらず打ち切ったか。 */
  timedOut: boolean;
  /** キルスイッチが OFF だったか。 */
  syncEnabled: boolean;
  /** 画面にそのまま出す日本語。 */
  message: string;
  durationMs: number;
}

/** メッセージ生成の入力（結果からメッセージ以外を抜いたもの）。 */
export type SyncNowMessageInput = Omit<OneDriveSyncNowResult, "message">;

/**
 * 画面に出す日本語メッセージを組み立てる（純関数）。
 *
 * ★技術用語を出さない。CA が次に何をすればよいかだけを書く。
 * ★件数・理由が複数あるときは並べて返す（「つながった」だけ出して
 *   「3件はサブフォルダが無くて入っていない」を落とすと、CA が気付けない）。
 */
export function buildSyncNowMessage(r: SyncNowMessageInput): string {
  const parts: string[] = [];

  // --- 1) フォルダURLの状態 ---
  switch (r.folderState) {
    case "REGISTERED":
      parts.push("OneDriveとつながりました。");
      break;
    case "NOT_FOUND":
      return (
        "OneDriveにこの求職者のフォルダが見つかりませんでした。" +
        "フォルダ名の先頭に求職者番号が付いているかご確認ください。"
      );
    case "DUPLICATE":
      return (
        "OneDriveに同じ求職者番号のフォルダが複数見つかったため、つなげませんでした。" +
        "重複していないかご確認ください。"
      );
    case "NAME_MISMATCH":
      return (
        "OneDriveのフォルダ名と求職者の氏名が食い違うため、つなげませんでした。" +
        "フォルダ名をご確認ください。"
      );
    case "NO_CANDIDATE_NUMBER":
      return "求職者番号が未設定のため、OneDriveのフォルダを探せませんでした。";
    case "SCAN_INCOMPLETE":
      return "OneDriveを確認できませんでした。時間をおいてお試しください。";
    case "RACED":
      return "OneDriveフォルダURLが更新されました。もう一度お試しください。";
    case "UNAVAILABLE":
      return "OneDrive連携の設定が確認できませんでした。管理者にお知らせください。";
    case "ALREADY_LINKED":
      break;
  }

  if (!r.syncEnabled) {
    return `${parts.join("")}現在OneDriveへのコピーは停止中です。管理者にお知らせください。`;
  }

  // --- 2) コピーの結果 ---
  if (r.copied > 0) parts.push(`書類${r.copied}件をコピーしました。`);

  if (r.missingSubfolder > 0) {
    const names =
      r.missingSubfolderNames.length > 0
        ? r.missingSubfolderNames.map((n) => `「${n}」`).join("")
        : "「2.求人」「3.BS作成書類」";
    parts.push(`${names}フォルダが見つかりませんでした。OneDriveで作成してください。`);
  }
  if (r.nameConflicts > 0) {
    parts.push(`同じ名前のファイルが既にあるため、${r.nameConflicts}件はコピーしていません。`);
  }
  if (r.noFileBody > 0) {
    parts.push(`ファイルの実体が無いため、${r.noFileBody}件はコピーしていません。`);
  }
  if (r.failed > 0) {
    parts.push(`${r.failed}件はコピーできませんでした。翌朝の自動処理で再試行します。`);
  }

  // --- 3) 打ち切り ---
  if (r.timedOut || r.deferred > 0) {
    parts.push("処理に時間がかかっています。残りは翌朝の自動処理で反映されます。");
  }

  if (parts.length === 0) return "すべて反映済みです。";
  return parts.join("");
}

// ============================================================
// 実行
// ============================================================

export interface RunOneDriveSyncNowOptions {
  candidateId: string;
  now?: Date;
  budgetMs?: number;
  fileLimit?: number;
  log?: (message: string) => void;
}

function emptyResult(
  candidateId: string,
  candidateNumber: string,
  folderState: SyncNowFolderState,
  folderUrl: string | null,
  startedAt: number,
): SyncNowMessageInput {
  return {
    candidateId,
    candidateNumber,
    folderState,
    folderUrl,
    scannedCaFolders: [],
    scannedAllCaFolders: false,
    eligibleFiles: 0,
    processedFiles: 0,
    copied: 0,
    nameConflicts: 0,
    missingSubfolder: 0,
    missingSubfolderNames: [],
    noFileBody: 0,
    failed: 0,
    deferred: 0,
    timedOut: false,
    syncEnabled: isOneDriveSyncEnabled(),
    durationMs: Date.now() - startedAt,
  };
}

function withMessage(r: SyncNowMessageInput): OneDriveSyncNowResult {
  return { ...r, message: buildSyncNowMessage(r) };
}

/** 求職者が見つからないケースだけ null を返す（API が 404 にする）。 */
export async function runOneDriveSyncNow(
  opts: RunOneDriveSyncNowOptions,
): Promise<OneDriveSyncNowResult | null> {
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs ?? ONEDRIVE_SYNC_NOW_BUDGET_MS;
  const fileLimit = opts.fileLimit ?? ONEDRIVE_SYNC_NOW_FILE_LIMIT;
  const log = opts.log ?? (() => {});

  const candidate = await prisma.candidate.findUnique({
    where: { id: opts.candidateId },
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      oneDriveFolderUrl: true,
      employee: { select: { name: true } },
      oneDriveFolderUrlLedger: { select: { autoUrl: true } },
    },
  });
  if (!candidate) return null;

  const upn = process.env.ONEDRIVE_OWNER_UPN;
  if (!upn) {
    return withMessage(
      emptyResult(candidate.id, candidate.candidateNumber, "UNAVAILABLE", null, startedAt),
    );
  }

  // ---------- 1) フォルダURLの確認と（必要なら）登録 ----------
  const folder = await ensureFolderUrl({
    upn,
    candidate,
    now: opts.now ?? new Date(),
    log,
  });

  if (folder.state !== "ALREADY_LINKED" && folder.state !== "REGISTERED") {
    return withMessage({
      ...emptyResult(
        candidate.id,
        candidate.candidateNumber,
        folder.state,
        folder.folderUrl,
        startedAt,
      ),
      scannedCaFolders: folder.scannedCaFolders,
      scannedAllCaFolders: folder.scannedAllCaFolders,
    });
  }

  // ---------- 2) このひとのファイルを即座に処理 ----------
  const files = await processCandidateFiles({
    candidateId: candidate.id,
    startedAt,
    budgetMs,
    fileLimit,
    log,
  });

  const result: SyncNowMessageInput = {
    candidateId: candidate.id,
    candidateNumber: candidate.candidateNumber,
    folderState: folder.state,
    folderUrl: folder.folderUrl,
    scannedCaFolders: folder.scannedCaFolders,
    scannedAllCaFolders: folder.scannedAllCaFolders,
    syncEnabled: isOneDriveSyncEnabled(),
    ...files,
    durationMs: Date.now() - startedAt,
  };

  log(
    `[onedrive-sync-now] ${candidate.candidateNumber}: folder=${result.folderState} ` +
      `copied=${result.copied} skipped(sub=${result.missingSubfolder}/name=${result.nameConflicts}/body=${result.noFileBody}) ` +
      `failed=${result.failed} deferred=${result.deferred} ${result.durationMs}ms`,
  );

  return withMessage(result);
}

// ------------------------------------------------------------
// 1) フォルダURL
// ------------------------------------------------------------

interface EnsureFolderUrlResult {
  state: SyncNowFolderState;
  folderUrl: string | null;
  scannedCaFolders: string[];
  scannedAllCaFolders: boolean;
}

const LINKED = (url: string | null): EnsureFolderUrlResult => ({
  state: "ALREADY_LINKED",
  folderUrl: url,
  scannedCaFolders: [],
  scannedAllCaFolders: false,
});

/**
 * フォルダ照合の見送り理由 → 画面向けの状態。CA から見て意味の違うものだけ分ける。
 */
function folderStateForRejection(reason: string): SyncNowFolderState {
  switch (reason) {
    case "RACED_MANUAL":
      return "RACED";
    case "DUPLICATE_FOLDER":
      return "DUPLICATE";
    case "NAME_MISMATCH":
      return "NAME_MISMATCH";
    case "NO_CANDIDATE_NUMBER":
      return "NO_CANDIDATE_NUMBER";
    default:
      // NOT_FOUND / URL_ROUNDTRIP_FAILED は CA から見れば同じ「見つからなかった」
      return "NOT_FOUND";
  }
}

/**
 * URL が未登録、または登録済みだがパスが 404 の場合にフォルダを探して登録・張り替えする。
 *
 * ★見つからなくても既存の URL は消さない（夜間の機能2と同じ扱い）。
 * ★登録済みで実在が確認できたら Graph の走査そのものを省く（ボタンの応答時間を稼ぐ最大の要因）。
 * ★手貼りURLは書き換えない。
 *     - 未登録からの登録は registerOneDriveFolderUrlForCandidate（`null` の行しか触らない）
 *     - 404 からの張り替えは台帳との byte 一致（isAutoManagedFolderUrl）を確かめた場合だけ
 */
async function ensureFolderUrl(params: {
  upn: string;
  candidate: {
    id: string;
    candidateNumber: string;
    name: string;
    oneDriveFolderUrl: string | null;
    employee: { name: string } | null;
    oneDriveFolderUrlLedger: { autoUrl: string } | null;
  };
  now: Date;
  log: (m: string) => void;
}): Promise<EnsureFolderUrlResult> {
  const { upn, candidate, log } = params;
  const current = candidate.oneDriveFolderUrl;

  // ---------- 登録済み ----------
  if (current) {
    const restored = restoreDrivePathFromFolderUrl(current);
    if (!restored.ok) {
      // 貼られている URL が壊れている。ここで消したり書き換えたりはしない
      //（手貼りの可能性があり、CA に貼り直してもらう以外に打つ手が無い）。
      log(`[onedrive-sync-now] ${candidate.candidateNumber}: URLからパスを復元できません`);
      return LINKED(current);
    }

    let exists: boolean;
    try {
      const item = await getDriveItemByPath(upn, restored.folderPath);
      exists = !!(item && item.folder);
    } catch (e) {
      // 401 / 429 / 5xx。「無い」とは限らないので探し直さない（誤って張り替えないため）。
      log(
        `[onedrive-sync-now] フォルダ実在確認に失敗（URLはそのまま使う）: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return LINKED(current);
    }
    if (exists) return LINKED(current);

    // --- 404。自動管理下のURLに限り、現在地を探して張り替える ---
    if (!isAutoManagedFolderUrl(current, candidate.oneDriveFolderUrlLedger)) {
      // 手貼り。触らない。コピー自体は試す（フォルダが戻ってくることもある）。
      log(`[onedrive-sync-now] ${candidate.candidateNumber}: 手貼りURLのため張り替えない`);
      return LINKED(current);
    }

    const relocated = await findFolderByScan({ upn, candidate, log });
    if (relocated.kind !== "FOUND") {
      // 見つからなければ URL はそのまま残す（消さない）。
      return { ...LINKED(current), ...relocated.scanInfo };
    }
    if (relocated.url === current) return { ...LINKED(current), ...relocated.scanInfo };

    const applied = await applyFolderUrlRelocation({
      candidateId: candidate.id,
      fromUrl: current,
      toUrl: relocated.url,
      drivePath: relocated.drivePath,
      now: params.now,
    });
    log(
      `[onedrive-sync-now] ${candidate.candidateNumber}: 移動追随 ${
        applied ? "更新" : "見送り（処理中にURLが変わった）"
      } → ${relocated.drivePath}`,
    );
    return {
      state: "ALREADY_LINKED",
      folderUrl: applied ? relocated.url : current,
      ...relocated.scanInfo,
    };
  }

  // ---------- 未登録: 担当CAのフォルダ配下だけを走査して探す ----------
  const found = await findFolderByScan({ upn, candidate, log });
  if (found.kind === "UNAVAILABLE") {
    return { state: "UNAVAILABLE", folderUrl: null, ...found.scanInfo };
  }
  if (found.kind === "SCAN_INCOMPLETE") {
    return { state: "SCAN_INCOMPLETE", folderUrl: null, ...found.scanInfo };
  }
  if (found.kind === "REJECTED") {
    return { state: folderStateForRejection(found.reason), folderUrl: null, ...found.scanInfo };
  }

  const registered = await registerOneDriveFolderUrlForCandidate({
    candidateId: candidate.id,
    candidateNumber: candidate.candidateNumber,
    candidateName: candidate.name,
    ownerSegment: found.ownerSegment,
    scan: found.scan,
    source: LEDGER_SOURCE.AUTO_SCAN,
  });

  if (registered.result !== "REGISTERED") {
    return {
      state: folderStateForRejection(registered.result),
      folderUrl: null,
      ...found.scanInfo,
    };
  }
  log(`[onedrive-sync-now] ${candidate.candidateNumber}: 登録 → ${registered.drivePath}`);
  return { state: "REGISTERED", folderUrl: registered.url, ...found.scanInfo };
}

type ScanInfo = Pick<EnsureFolderUrlResult, "scannedCaFolders" | "scannedAllCaFolders">;

type FindFolderResult =
  | {
      kind: "FOUND";
      url: string;
      drivePath: string;
      ownerSegment: string;
      scan: OneDriveFolderScanResult;
      scanInfo: ScanInfo;
    }
  | { kind: "REJECTED"; reason: string; scanInfo: ScanInfo }
  | { kind: "SCAN_INCOMPLETE"; scanInfo: ScanInfo }
  | { kind: "UNAVAILABLE"; scanInfo: ScanInfo };

const NO_SCAN: ScanInfo = { scannedCaFolders: [], scannedAllCaFolders: false };

/**
 * 担当CAのフォルダ配下だけを走査して、この求職者のフォルダを探す。
 *
 * ★突合ルールは夜間処理と同一（matchCandidateFolder 経由）。番号の完全一致・候補1件・氏名照合。
 * ★走査範囲だけが違う。全 CA を降りると実測34秒かかり、ボタンとして成立しないため。
 */
async function findFolderByScan(params: {
  upn: string;
  candidate: {
    id: string;
    candidateNumber: string;
    name: string;
    employee: { name: string } | null;
  };
  log: (m: string) => void;
}): Promise<FindFolderResult> {
  const { upn, candidate, log } = params;

  const segment = await resolveOwnerSegment(upn);
  if (!segment.ok) {
    log(`[onedrive-sync-now] 所有者セグメント不一致のため中止: ${segment.reason}`);
    return { kind: "UNAVAILABLE", scanInfo: NO_SCAN };
  }

  const employeeName = candidate.employee?.name ?? null;
  let scan: OneDriveFolderScanResult;
  try {
    scan = await scanOneDriveCandidateFolders(
      upn,
      {},
      {
        selectCaFolders: (all) => selectCaFoldersForEmployee(employeeName, all),
        walkConcurrency: ONEDRIVE_SYNC_NOW_SCAN_CONCURRENCY,
      },
    );
  } catch (e) {
    log(`[onedrive-sync-now] 走査に失敗: ${e instanceof Error ? e.message : String(e)}`);
    return { kind: "SCAN_INCOMPLETE", scanInfo: NO_SCAN };
  }

  const scanInfo: ScanInfo = {
    scannedCaFolders: scan.caFolders,
    scannedAllCaFolders: scan.caFolders.length === scan.allCaFolders.length,
  };
  log(
    `[onedrive-sync-now] ${candidate.candidateNumber}: 走査 CA=${scan.caFolders.join(",")} ` +
      `(担当=${employeeName ?? "未設定"} 全走査=${scanInfo.scannedAllCaFolders}) ` +
      `フォルダ${scan.folders.length}件 listChildren ${scan.listCalls}回 ${scan.durationMs}ms`,
  );

  if (!isScopedScanTrustworthy(scan)) return { kind: "SCAN_INCOMPLETE", scanInfo };

  const match = matchCandidateFolder({
    candidateNumber: candidate.candidateNumber,
    candidateName: candidate.name,
    ownerSegment: segment.ownerSegment,
    scan,
  });
  if (!match.ok) return { kind: "REJECTED", reason: match.reason, scanInfo };

  return {
    kind: "FOUND",
    url: match.url,
    drivePath: match.folder.drivePath,
    ownerSegment: segment.ownerSegment,
    scan,
    scanInfo,
  };
}

// ------------------------------------------------------------
// 2) ファイルのコピー
// ------------------------------------------------------------

type FileProcessSummary = Pick<
  OneDriveSyncNowResult,
  | "eligibleFiles"
  | "processedFiles"
  | "copied"
  | "nameConflicts"
  | "missingSubfolder"
  | "missingSubfolderNames"
  | "noFileBody"
  | "failed"
  | "deferred"
  | "timedOut"
>;

async function processCandidateFiles(params: {
  candidateId: string;
  startedAt: number;
  budgetMs: number;
  fileLimit: number;
  log: (m: string) => void;
}): Promise<FileProcessSummary> {
  const where = buildOneDriveSyncNowWhere(params.candidateId);

  const eligibleFiles = await prisma.oneDriveSyncLog.count({ where });
  const rows = await prisma.oneDriveSyncLog.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    take: params.fileLimit,
    select: {
      id: true,
      candidateFileId: true,
      status: true,
      attemptCount: true,
      candidateFile: { select: { category: true, fileName: true } },
    },
  });

  const summary: FileProcessSummary = {
    eligibleFiles,
    processedFiles: 0,
    copied: 0,
    nameConflicts: 0,
    missingSubfolder: 0,
    missingSubfolderNames: [],
    noFileBody: 0,
    failed: 0,
    deferred: eligibleFiles - rows.length,
    timedOut: false,
  };

  const missingSubfolderNames = new Set<string>();
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      if (Date.now() - params.startedAt > params.budgetMs) {
        summary.timedOut = true;
        return;
      }
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];

      const fromSkipped = row.status === OneDriveSyncStatus.SKIPPED;

      const result = await runOneDriveSyncForFile({
        candidateFileId: row.candidateFileId,
        deferAttemptBookkeeping: true,
      });

      // 再試行制御の3列は夜間処理と同一の判断で確定させる（実装を2つ持たない）。
      const book = decideRetryBookkeeping({
        fromSkipped,
        previousAttemptCount: row.attemptCount,
        outcomeStatus: result.status,
        graphAttempted: result.countAttempt,
        now: new Date(),
      });

      try {
        await prisma.oneDriveSyncLog.update({
          where: { id: row.id },
          data: {
            attemptCount: book.attemptCount,
            lastAttemptedAt: new Date(),
            nextRetryAt: book.nextRetryAt,
            ...(book.statusOverride ? { status: book.statusOverride } : {}),
          },
        });
      } catch (e) {
        params.log(
          `[onedrive-sync-now] 記録の更新に失敗（続行）: ${row.candidateFileId} ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      const finalStatus = book.statusOverride ?? result.status;
      summary.processedFiles++;

      if (finalStatus === OneDriveSyncStatus.SUCCESS) {
        summary.copied++;
      } else if (finalStatus === OneDriveSyncStatus.SKIPPED) {
        switch (result.skipReason) {
          case OneDriveSyncSkipReason.NAME_ALREADY_EXISTS:
            summary.nameConflicts++;
            break;
          case OneDriveSyncSkipReason.NO_SUBFOLDER: {
            summary.missingSubfolder++;
            const sub = ONEDRIVE_SUBFOLDER_BY_CATEGORY[row.candidateFile.category];
            if (sub) missingSubfolderNames.add(sub);
            break;
          }
          case OneDriveSyncSkipReason.NO_FILE_BODY:
            summary.noFileBody++;
            break;
          default:
            summary.failed++;
        }
      } else if (
        finalStatus === OneDriveSyncStatus.FAILED ||
        finalStatus === OneDriveSyncStatus.GIVEN_UP
      ) {
        summary.failed++;
      }
      // PENDING（キルスイッチ OFF）はどれにも数えない。syncEnabled で文言を出し分ける。

      params.log(
        `[onedrive-sync-now] ${finalStatus}${result.skipReason ? `/${result.skipReason}` : ""} ` +
          `${row.candidateFile.fileName}`,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ONEDRIVE_SYNC_NOW_CONCURRENCY, rows.length || 1) }, () =>
      worker(),
    ),
  );

  summary.missingSubfolderNames = [...missingSubfolderNames];
  // 時間切れで触らなかった分も「翌朝に回す件数」に足す。
  summary.deferred += rows.length - summary.processedFiles;
  return summary;
}
