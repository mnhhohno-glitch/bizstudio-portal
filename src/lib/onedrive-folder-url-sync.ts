/**
 * T-159 Phase 3 機能1・機能2: `Candidate.oneDriveFolderUrl` の自動登録とフォルダ移動への追随。
 *
 * 機能1（自動登録）
 *   CA がいつフォルダを作るかは portal からは分からない。T-158 で一括登録した1,734人以降の
 *   求職者は、手で登録しない限り永久にコピーされない（実際に5名・53ファイルが恒久停止していた）。
 *   毎晩 Graph でフォルダの有無を見に行き、見つかったら登録する。
 *
 * 機能2（移動追随）
 *   oneDriveFolderUrl はフォルダのパスそのものを指すため、CA が別の年月へ移動・リネームすると
 *   リンクが切れる。404 のときだけ現在地を探し直して張り替える。見つからなければ**消さない**。
 *
 * ★ここが最も事故りやすい場所なので、書き換えの条件を4段に重ねている。
 *   1. 求職者番号の完全一致（氏名では突合しない）        … onedrive-folder-scan.ts
 *   2. 候補フォルダが1件だけ + 氏名照合を通る            … onedrive-folder-scan.ts
 *   3. 台帳（OneDriveFolderUrlLedger）で自動管理下と確認 … 手貼りのURLは 404 でも触らない
 *   4. 走査の信用性 + 1回の更新件数の上限               … 大規模な書き換えは自動で走らせない
 *
 * ★OneDrive にフォルダを作らない。本ファイルは listChildren / GET（読み取り）しか使わない。
 */

import type { Prisma } from "@prisma/client";
import { OneDriveSyncSkipReason, OneDriveSyncStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDriveItemByPath } from "@/lib/microsoft-graph";
import { restoreDrivePathFromFolderUrl } from "@/lib/onedrive-sync";
import {
  type FolderMatchRejection,
  type OneDriveFolderScanResult,
  ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS,
  isScanTrustworthy,
  matchCandidateFolder,
  ownerSegmentFromUpn,
  scanOneDriveCandidateFolders,
} from "@/lib/onedrive-folder-scan";

// ============================================================
// 実行制御の定数
// ============================================================

/**
 * 機能2（移動追随）の対象を絞る support_status。
 *
 * ★1,734人全員を毎晩 GET すると Graph への往復が過大になる（実測でも 1,734 往復）。
 *   一方でリンク切れが実害になるのは「CA が今このボタンを押す人」だけ。
 *   支援中（ACTIVE）と待機（WAITING）は日常的に書類を出し入れするため必ず含める。
 *   BEFORE / ENDED / ARCHIVED は下の「直近にファイルが作られた」条件で拾えば足りる。
 *   実測: URL登録済み1,734人 → この2ステータスで110人、下の条件と合わせて125人。
 */
export const ONEDRIVE_FOLDER_URL_MOVE_STATUSES = ["ACTIVE", "WAITING"] as const;

/**
 * 機能2の対象に含める「直近にファイルが作られた」期間（日）。
 *
 * ステータスが BEFORE / ENDED でも、直近で書類を入れている求職者はフォルダを開く可能性が高い。
 * 30日にしたのは、夜間処理が毎晩走る前提でリンク切れに気付くまでの許容遅れとして
 * 1か月あれば実用上十分であり、これ以上広げても対象人数が増えるだけで拾える移動が増えないため。
 */
export const ONEDRIVE_FOLDER_URL_MOVE_RECENT_FILE_DAYS = 30;

/**
 * 機能2で1回の実行に許す更新件数の上限（安全弁2）。
 *
 * これを超える更新が必要な状況は「フォルダ構成の大規模変更」か「実装の不具合」のどちらかであり、
 * どちらも自動で走らせるべきではない。超えたら**1件も更新せず**報告だけして人間の判断を待つ。
 * 部分適用にしないのは、途中まで書き換わった状態が最も切り分けにくいため。
 */
export const ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES = 50;

/**
 * 機能1で1回の実行に登録する上限。
 *
 * 機能2の上限と違い、超えた分は**翌日に回す**（打ち切りではなく繰り越し）。
 * 登録は求職者ごとに独立した「新規発生」であり、件数が多いこと自体は異常ではないため
 * （フォルダを作り溜めた CA が居れば自然に増える）。
 */
export const ONEDRIVE_FOLDER_URL_REGISTER_LIMIT = 50;

/** 機能2の実在確認を並列で行う本数。Graph の 429 を誘発しない範囲。 */
export const ONEDRIVE_FOLDER_URL_CHECK_CONCURRENCY = 3;

/** 台帳の source 値。enum にしていないので唯一の定義をここに置く。 */
export const LEDGER_SOURCE = {
  /** T-158 一括登録分の遡り記録（scripts/backfill-t159-folder-url-ledger.ts） */
  T158_BACKFILL: "T158_BACKFILL",
  /** 機能1: 夜間の自動登録 */
  AUTO_SCAN: "AUTO_SCAN",
  /** 機能2: 移動追随での張り替え */
  AUTO_MOVE: "AUTO_MOVE",
} as const;

// ============================================================
// 抽出条件（純関数）
// ============================================================

/**
 * 機能1の対象: `oneDriveFolderUrl` が null で、かつ `onedrive_sync_logs` に
 * SKIPPED(NO_FOLDER_URL) の行を持つ求職者。
 *
 * ★全4,328人を毎晩走査しない。実際にコピー対象のファイルが発生した求職者だけを見れば十分で、
 *   ファイルが1件も無い求職者にURLを付けても何も起きない（コピーするものが無い）。
 *   「ログ行がある」が「同期対象として受け付けた」の唯一の判定という既存の契約に乗る。
 */
export function buildFolderUrlRegisterWhere(): Prisma.OneDriveSyncLogWhereInput {
  return {
    status: OneDriveSyncStatus.SKIPPED,
    skipReason: OneDriveSyncSkipReason.NO_FOLDER_URL,
    candidate: { oneDriveFolderUrl: null },
  };
}

/**
 * 機能2の対象: URL 登録済みのうち、支援中/待機 または 直近30日にファイルが作られた求職者。
 * 絞り込みの理由は各定数のコメントに書いてある。
 */
export function buildFolderUrlMoveWhere(now: Date): Prisma.CandidateWhereInput {
  const cutoff = new Date(
    now.getTime() - ONEDRIVE_FOLDER_URL_MOVE_RECENT_FILE_DAYS * 24 * 60 * 60 * 1000,
  );
  return {
    oneDriveFolderUrl: { not: null },
    OR: [
      { supportStatus: { in: [...ONEDRIVE_FOLDER_URL_MOVE_STATUSES] } },
      { files: { some: { createdAt: { gte: cutoff } } } },
    ],
  };
}

/**
 * 今入っている URL が「自動処理の産物のまま」か。台帳が無い／値が食い違うなら手貼り扱いで触らない。
 *
 * ★byte 一致で見る。自動登録した後に CA が手で貼り替えた場合、台帳の行は残っているが値は
 *   一致しなくなる。ここを「台帳行の有無」だけで判定すると、CA の手作業を上書きする。
 */
export function isAutoManagedFolderUrl(
  currentUrl: string | null | undefined,
  ledger: { autoUrl: string } | null | undefined,
): boolean {
  if (!currentUrl || !ledger) return false;
  return currentUrl === ledger.autoUrl;
}

export type MoveBlockReason =
  /** 走査が不完全 or 件数が異常に少ない（安全弁1） */
  | "SCAN_UNTRUSTWORTHY"
  /** 更新予定件数が上限超過（安全弁2） */
  | "TOO_MANY_UPDATES";

/**
 * 安全弁の判定。書き換えてよいか、報告のみに留めるか。
 *
 * ★どちらの安全弁も「部分適用しない」。書き換えるか、1件も書き換えないかの二択にする。
 */
export function decideFolderUrlMoveApplication(params: {
  plannedUpdates: number;
  scanTrustworthy: boolean;
  maxUpdates?: number;
}): { apply: boolean; blocked: MoveBlockReason | null } {
  if (!params.scanTrustworthy) return { apply: false, blocked: "SCAN_UNTRUSTWORTHY" };
  const max = params.maxUpdates ?? ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES;
  if (params.plannedUpdates > max) return { apply: false, blocked: "TOO_MANY_UPDATES" };
  return { apply: true, blocked: null };
}

// ============================================================
// サマリ
// ============================================================

export interface FolderUrlScanSummary {
  complete: boolean;
  trustworthy: boolean;
  /** 走査で見つかった求職者フォルダ総数（番号なしも含む）。 */
  folders: number;
  /** 求職者番号で引ける件数（＝索引の鍵の数）。 */
  withNumber: number;
  minExpected: number;
  caFolders: string[];
  listCalls: number;
  cacheHits: number;
  errors: string[];
  durationMs: number;
}

export interface FolderUrlRegisterDetail {
  candidateNumber: string;
  /** 登録できたか、できないならなぜか。 */
  result: "REGISTERED" | "WOULD_REGISTER" | FolderMatchRejection | "RACED_MANUAL";
  drivePath?: string;
  detail?: string;
}

export interface FolderUrlRegisterSummary {
  /** 条件に合致した求職者数（limit 適用前）。 */
  targets: number;
  /** 今回見た人数（limit 適用後）。 */
  picked: number;
  /** limit で翌日に回した人数。 */
  deferred: number;
  /** 実際に登録した人数（dry-run では 0）。 */
  registered: number;
  /** 登録できる（＝dry-run で「登録予定」と判定した）人数。 */
  registrable: number;
  /** 見送った理由の内訳。 */
  byRejection: Record<string, number>;
  details: FolderUrlRegisterDetail[];
}

export interface FolderUrlMoveDetail {
  candidateNumber: string;
  result: "MOVED" | "WOULD_MOVE" | "NOT_RELOCATED";
  from?: string;
  to?: string;
  detail?: string;
}

export interface FolderUrlMoveSummary {
  /** 絞り込み後の対象人数。 */
  scoped: number;
  /** 台帳外（手貼り）で一切触らなかった人数。 */
  protectedManual: number;
  /** Graph で実在確認した人数。 */
  checked: number;
  /** フォルダが今もある人数。 */
  alive: number;
  /** 404 だった人数。 */
  missing: number;
  /** 404 のうち移動先を特定できた人数（＝更新予定）。 */
  planned: number;
  /** 実際に更新した人数（dry-run / 安全弁作動時は 0）。 */
  updated: number;
  /** 404 だが移動先を特定できず据え置いた人数（URLは消さない）。 */
  notRelocated: number;
  blocked: MoveBlockReason | null;
  maxUpdates: number;
  details: FolderUrlMoveDetail[];
}

export interface OneDriveFolderUrlSyncSummary {
  mode: "dry-run" | "execute";
  /** ONEDRIVE_OWNER_UPN / 所有者セグメントの検証で中止した場合の理由。null なら正常。 */
  abortedReason: string | null;
  ownerSegment: string | null;
  scan: FolderUrlScanSummary | null;
  register: FolderUrlRegisterSummary;
  move: FolderUrlMoveSummary;
  durationMs: number;
}

function emptyRegister(): FolderUrlRegisterSummary {
  return {
    targets: 0,
    picked: 0,
    deferred: 0,
    registered: 0,
    registrable: 0,
    byRejection: {},
    details: [],
  };
}

function emptyMove(): FolderUrlMoveSummary {
  return {
    scoped: 0,
    protectedManual: 0,
    checked: 0,
    alive: 0,
    missing: 0,
    planned: 0,
    updated: 0,
    notRelocated: 0,
    blocked: null,
    maxUpdates: ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES,
    details: [],
  };
}

// ============================================================
// 実行
// ============================================================

export interface RunOneDriveFolderUrlSyncOptions {
  /** false なら DB を一切書かない（Graph の読み取りは行い、何をするつもりだったかを返す）。 */
  execute: boolean;
  now?: Date;
  registerLimit?: number;
  maxMoveUpdates?: number;
  log?: (message: string) => void;
}

/** 並列度つき map（Graph への同時接続数を抑えるだけの小道具）。 */
async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => worker()),
  );
}

/**
 * 既に登録されているURLから所有者セグメントを1つ拾う。
 *
 * ★UPN から機械的に導いたセグメント（masayuki_oono@… → masayuki_oono_bizstudio_co_jp）が
 *   実データと1文字でも違うと、登録したURLは CA が押しても開けない「見た目は正しいゴミ」になる。
 *   1,734件の実データと突き合わせて確かめてから登録する。
 *   照合できなければ登録しない（フェイルクローズ）。
 */
async function findExistingOwnerSegment(): Promise<string | null> {
  const rows = await prisma.candidate.findMany({
    where: { oneDriveFolderUrl: { not: null } },
    select: { oneDriveFolderUrl: true },
    orderBy: { candidateNumber: "asc" },
    take: 20,
  });
  for (const r of rows) {
    const restored = restoreDrivePathFromFolderUrl(r.oneDriveFolderUrl);
    if (restored.ok) return restored.ownerSegment;
  }
  return null;
}

/**
 * 機能1 + 機能2 をまとめて実行する。走査（Graph）は**1回だけ**行い両方で共有する。
 * 例外は投げない設計にはしていない（呼び出し元の API が try/catch する）。
 */
export async function runOneDriveFolderUrlSync(
  opts: RunOneDriveFolderUrlSyncOptions,
): Promise<OneDriveFolderUrlSyncSummary> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const registerLimit = opts.registerLimit ?? ONEDRIVE_FOLDER_URL_REGISTER_LIMIT;
  const maxMoveUpdates = opts.maxMoveUpdates ?? ONEDRIVE_FOLDER_URL_MOVE_MAX_UPDATES;
  const mode = opts.execute ? "execute" : "dry-run";

  const upn = process.env.ONEDRIVE_OWNER_UPN;
  if (!upn) {
    log("[onedrive-folder-url] ONEDRIVE_OWNER_UPN が未設定のため中止");
    return {
      mode,
      abortedReason: "ONEDRIVE_OWNER_UPN が未設定です",
      ownerSegment: null,
      scan: null,
      register: emptyRegister(),
      move: { ...emptyMove(), maxUpdates: maxMoveUpdates },
      durationMs: Date.now() - startedAt,
    };
  }

  const segment = await resolveOwnerSegment(upn);
  if (!segment.ok) {
    // 既存データと食い違うセグメントで URL を作ると、開けないURLを量産する。
    log(`[onedrive-folder-url] 所有者セグメントが既存データと不一致のため中止: ${segment.reason}`);
    return {
      mode,
      abortedReason: segment.reason,
      ownerSegment: ownerSegmentFromUpn(upn),
      scan: null,
      register: emptyRegister(),
      move: { ...emptyMove(), maxUpdates: maxMoveUpdates },
      durationMs: Date.now() - startedAt,
    };
  }
  const ownerSegment = segment.ownerSegment;

  // ---------- 走査（1回だけ・機能1と機能2で共有） ----------
  const scanResult = await scanOneDriveCandidateFolders(upn);
  const trustworthy = isScanTrustworthy(scanResult);
  const scan: FolderUrlScanSummary = {
    complete: scanResult.complete,
    trustworthy,
    folders: scanResult.folders.length,
    withNumber: scanResult.byNumber.size,
    minExpected: ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS,
    caFolders: scanResult.caFolders,
    listCalls: scanResult.listCalls,
    cacheHits: scanResult.cacheHits,
    errors: scanResult.errors.slice(0, 10),
    durationMs: scanResult.durationMs,
  };
  log(
    `[onedrive-folder-url] 走査: フォルダ ${scan.folders}件（番号あり ${scan.withNumber}） ` +
      `CA ${scan.caFolders.length}件 listChildren ${scan.listCalls}回（キャッシュ ${scan.cacheHits}回） ` +
      `完走=${scan.complete} 信用可=${trustworthy} ${scan.durationMs}ms`,
  );

  const register = await runFolderUrlAutoRegister({
    execute: opts.execute,
    ownerSegment,
    scan: scanResult,
    trustworthy,
    limit: registerLimit,
    log,
  });

  const move = await runFolderUrlMoveFollow({
    execute: opts.execute,
    upn,
    ownerSegment,
    scan: scanResult,
    trustworthy,
    now,
    maxUpdates: maxMoveUpdates,
    log,
  });

  return {
    mode,
    abortedReason: null,
    ownerSegment,
    scan,
    register,
    move,
    durationMs: Date.now() - startedAt,
  };
}

// ============================================================
// 機能1の1人分（夜間の全件処理と T-159 Phase 4 の即時同期で共有する）
// ============================================================

export type RegisterFolderUrlOutcome =
  | { result: "REGISTERED"; url: string; drivePath: string }
  | { result: "RACED_MANUAL"; detail: string }
  | { result: FolderMatchRejection; detail: string };

/**
 * 走査結果から1人分の `oneDriveFolderUrl` を登録する（照合 → null限定の書き込み → 台帳）。
 *
 * ★夜間の全件処理（runFolderUrlAutoRegister）と即時同期（onedrive-sync-now.ts）の**唯一の実装**。
 *   突合ルール・手貼り保護・台帳の書き方をここ1箇所に閉じ込める。2箇所に写すと、
 *   片方だけ緩めた版が生まれて他人のフォルダを紐付ける事故につながる。
 *
 * ★`oneDriveFolderUrl: null` の行にしか書かない。既に値が入っている（手貼り・自動登録済みの）
 *   求職者の URL をこの関数が書き換えることは無い。
 */
export async function registerOneDriveFolderUrlForCandidate(params: {
  candidateId: string;
  candidateNumber: string;
  candidateName: string | null;
  ownerSegment: string;
  scan: OneDriveFolderScanResult;
  source: string;
}): Promise<RegisterFolderUrlOutcome> {
  const match = matchCandidateFolder({
    candidateNumber: params.candidateNumber,
    candidateName: params.candidateName,
    ownerSegment: params.ownerSegment,
    scan: params.scan,
  });
  if (!match.ok) return { result: match.reason, detail: match.detail };

  // ★null のときだけ書く。走査中に CA が手で貼っていたら負ける（＝手作業を上書きしない）。
  const updated = await prisma.candidate.updateMany({
    where: { id: params.candidateId, oneDriveFolderUrl: null },
    data: { oneDriveFolderUrl: match.url },
  });
  if (updated.count !== 1) {
    return { result: "RACED_MANUAL", detail: "処理中に URL が登録されたため書き込みを見送り" };
  }

  await prisma.oneDriveFolderUrlLedger.upsert({
    where: { candidateId: params.candidateId },
    create: {
      candidateId: params.candidateId,
      autoUrl: match.url,
      drivePath: match.folder.drivePath,
      source: params.source,
    },
    update: {
      autoUrl: match.url,
      drivePath: match.folder.drivePath,
      source: params.source,
    },
  });

  return { result: "REGISTERED", url: match.url, drivePath: match.folder.drivePath };
}

/**
 * 移動追随の書き込み1件分（現在値の確認 → 張り替え → 台帳更新）。
 *
 * ★呼ぶ前に **必ず** `isAutoManagedFolderUrl` で自動管理下だと確かめること。
 *   この関数自体は台帳を見ない（夜間処理は事前に一括で絞っており、二度引くのが無駄なため）。
 *   `fromUrl` と現在値が一致する間だけ書くので、途中で CA が貼り替えたら負ける。
 *
 * @returns 実際に書き換えたら true。false なら処理中に URL が変わったので見送った。
 */
export async function applyFolderUrlRelocation(params: {
  candidateId: string;
  fromUrl: string;
  toUrl: string;
  drivePath: string;
  now: Date;
}): Promise<boolean> {
  const updated = await prisma.candidate.updateMany({
    where: { id: params.candidateId, oneDriveFolderUrl: params.fromUrl },
    data: { oneDriveFolderUrl: params.toUrl },
  });
  if (updated.count !== 1) return false;

  await prisma.oneDriveFolderUrlLedger.update({
    where: { candidateId: params.candidateId },
    data: {
      autoUrl: params.toUrl,
      drivePath: params.drivePath,
      source: LEDGER_SOURCE.AUTO_MOVE,
      moveCount: { increment: 1 },
      lastMovedAt: params.now,
    },
  });
  return true;
}

/**
 * 既に登録されている URL から所有者セグメントを決める（未登録なら UPN から導く）。
 * 既存データと食い違ったら null を返して呼び出し側に中止させる（開けないURLを量産しないため）。
 */
export async function resolveOwnerSegment(
  upn: string,
): Promise<{ ok: true; ownerSegment: string } | { ok: false; reason: string }> {
  const derived = ownerSegmentFromUpn(upn);
  const existing = await findExistingOwnerSegment();
  if (existing && existing !== derived) {
    return {
      ok: false,
      reason: `所有者セグメントが既存URLと一致しません（derived=${derived} / existing=${existing}）`,
    };
  }
  return { ok: true, ownerSegment: existing ?? derived };
}

// ============================================================
// 機能1: URL 未登録の求職者を探して登録
// ============================================================

async function runFolderUrlAutoRegister(params: {
  execute: boolean;
  ownerSegment: string;
  scan: OneDriveFolderScanResult;
  trustworthy: boolean;
  limit: number;
  log: (m: string) => void;
}): Promise<FolderUrlRegisterSummary> {
  const summary = emptyRegister();
  const where = buildFolderUrlRegisterWhere();

  const rows = await prisma.oneDriveSyncLog.findMany({
    where,
    distinct: ["candidateId"],
    orderBy: [{ candidateId: "asc" }],
    select: {
      candidateId: true,
      candidate: { select: { id: true, candidateNumber: true, name: true } },
    },
  });

  summary.targets = rows.length;
  const picked = rows.slice(0, params.limit);
  summary.picked = picked.length;
  summary.deferred = rows.length - picked.length;

  if (picked.length === 0) {
    params.log("[onedrive-folder-url] 機能1: URL未登録で止まっている求職者はいません");
    return summary;
  }

  // 索引が信用できないときは登録もしない。走査に穴があると「候補フォルダが1件だけ」の判定が
  // 崩れ、実は2件あるのに片方しか見えていない状態で登録してしまう（＝他人のフォルダを紐付ける）。
  if (!params.trustworthy) {
    summary.byRejection["SCAN_UNTRUSTWORTHY"] = picked.length;
    params.log(
      `[onedrive-folder-url] 機能1: 走査が信用できないため登録を見送り（対象 ${picked.length}名）`,
    );
    return summary;
  }

  for (const row of picked) {
    const c = row.candidate;
    const match = matchCandidateFolder({
      candidateNumber: c.candidateNumber,
      candidateName: c.name,
      ownerSegment: params.ownerSegment,
      scan: params.scan,
    });

    if (!match.ok) {
      summary.byRejection[match.reason] = (summary.byRejection[match.reason] ?? 0) + 1;
      summary.details.push({
        candidateNumber: c.candidateNumber,
        result: match.reason,
        detail: match.detail,
      });
      params.log(`[onedrive-folder-url] 機能1 見送り ${c.candidateNumber}: ${match.reason}`);
      continue;
    }

    summary.registrable++;

    if (!params.execute) {
      summary.details.push({
        candidateNumber: c.candidateNumber,
        result: "WOULD_REGISTER",
        drivePath: match.folder.drivePath,
      });
      params.log(
        `[onedrive-folder-url] 機能1 登録予定 ${c.candidateNumber}: ${match.folder.drivePath}`,
      );
      continue;
    }

    // 照合は上で済んでいるが、書き込みは共有実装に通す（手貼り保護と台帳の書き方を1箇所に保つ）。
    const registered = await registerOneDriveFolderUrlForCandidate({
      candidateId: c.id,
      candidateNumber: c.candidateNumber,
      candidateName: c.name,
      ownerSegment: params.ownerSegment,
      scan: params.scan,
      source: LEDGER_SOURCE.AUTO_SCAN,
    });
    if (registered.result !== "REGISTERED") {
      summary.byRejection[registered.result] = (summary.byRejection[registered.result] ?? 0) + 1;
      summary.details.push({
        candidateNumber: c.candidateNumber,
        result: registered.result,
        detail: "detail" in registered ? registered.detail : undefined,
      });
      continue;
    }

    summary.registered++;
    summary.details.push({
      candidateNumber: c.candidateNumber,
      result: "REGISTERED",
      drivePath: match.folder.drivePath,
    });
    params.log(
      `[onedrive-folder-url] 機能1 登録 ${c.candidateNumber}: ${match.folder.drivePath}`,
    );
  }

  // ★SKIPPED(NO_FOLDER_URL) の行はそのまま残す。既存の再試行ロジックが24時間クールダウンを
  //   経て自動的に拾い直すため、ここで status を触る必要はない（触ると勘定が二重になる）。
  return summary;
}

// ============================================================
// 機能2: フォルダ移動への追随
// ============================================================

async function runFolderUrlMoveFollow(params: {
  execute: boolean;
  upn: string;
  ownerSegment: string;
  scan: OneDriveFolderScanResult;
  trustworthy: boolean;
  now: Date;
  maxUpdates: number;
  log: (m: string) => void;
}): Promise<FolderUrlMoveSummary> {
  const summary = { ...emptyMove(), maxUpdates: params.maxUpdates };

  const candidates = await prisma.candidate.findMany({
    where: buildFolderUrlMoveWhere(params.now),
    select: {
      id: true,
      candidateNumber: true,
      name: true,
      oneDriveFolderUrl: true,
      oneDriveFolderUrlLedger: { select: { autoUrl: true } },
    },
    orderBy: { candidateNumber: "asc" },
  });
  summary.scoped = candidates.length;

  // 台帳外（手貼り）は Graph へ 1 往復もしない。触らないと決まっているものを確認する意味がない。
  const managed = candidates.filter((c) =>
    isAutoManagedFolderUrl(c.oneDriveFolderUrl, c.oneDriveFolderUrlLedger),
  );
  summary.protectedManual = candidates.length - managed.length;
  summary.checked = managed.length;

  params.log(
    `[onedrive-folder-url] 機能2: 対象 ${summary.scoped}名 ` +
      `（自動管理 ${managed.length}名 / 手貼りのため対象外 ${summary.protectedManual}名）`,
  );

  interface PlannedMove {
    id: string;
    candidateNumber: string;
    fromUrl: string;
    toUrl: string;
    drivePath: string;
  }
  const planned: PlannedMove[] = [];
  const notRelocated: FolderUrlMoveDetail[] = [];

  await forEachWithConcurrency(managed, ONEDRIVE_FOLDER_URL_CHECK_CONCURRENCY, async (c) => {
    const restored = restoreDrivePathFromFolderUrl(c.oneDriveFolderUrl);
    if (!restored.ok) {
      // 台帳と一致しているのに復元できない＝台帳側にも壊れた値が入っている。触らず記録だけ。
      notRelocated.push({
        candidateNumber: c.candidateNumber,
        result: "NOT_RELOCATED",
        detail: `URLからパスを復元できません: ${restored.reason}`,
      });
      return;
    }

    let item: Awaited<ReturnType<typeof getDriveItemByPath>>;
    try {
      item = await getDriveItemByPath(params.upn, restored.folderPath);
    } catch (e) {
      // 401 / 429 / 5xx。「無い」とは限らないので探し直さない（誤って張り替えないため）。
      notRelocated.push({
        candidateNumber: c.candidateNumber,
        result: "NOT_RELOCATED",
        detail: `実在確認に失敗: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    if (item && item.folder) {
      summary.alive++;
      return;
    }

    // ★404（または同名の非フォルダ）のときだけ現在地を探す。
    summary.missing++;
    const match = matchCandidateFolder({
      candidateNumber: c.candidateNumber,
      candidateName: c.name,
      ownerSegment: params.ownerSegment,
      scan: params.scan,
    });
    if (!match.ok) {
      // 見つからなければ URL はそのまま残す（消さない）。CA がゴミ箱から戻す場合もある。
      notRelocated.push({
        candidateNumber: c.candidateNumber,
        result: "NOT_RELOCATED",
        detail: `移動先を特定できません: ${match.reason}`,
      });
      return;
    }
    if (match.url === c.oneDriveFolderUrl) {
      // 走査では見えているのに GET が 404。パスの取り違えか一時的な不整合。触らない。
      notRelocated.push({
        candidateNumber: c.candidateNumber,
        result: "NOT_RELOCATED",
        detail: "走査結果が現在のURLと同一のため張り替え不要（実在確認と不整合）",
      });
      return;
    }
    planned.push({
      id: c.id,
      candidateNumber: c.candidateNumber,
      fromUrl: c.oneDriveFolderUrl!,
      toUrl: match.url,
      drivePath: match.folder.drivePath,
    });
  });

  summary.planned = planned.length;
  summary.notRelocated = notRelocated.length;
  summary.details.push(...notRelocated);

  const decision = decideFolderUrlMoveApplication({
    plannedUpdates: planned.length,
    scanTrustworthy: params.trustworthy,
    maxUpdates: params.maxUpdates,
  });
  summary.blocked = decision.blocked;

  if (decision.blocked) {
    params.log(
      `[onedrive-folder-url] 機能2: 安全弁が作動（${decision.blocked}）。` +
        `更新予定 ${planned.length}件を1件も適用せず報告のみ`,
    );
    for (const p of planned) {
      summary.details.push({
        candidateNumber: p.candidateNumber,
        result: "NOT_RELOCATED",
        from: p.fromUrl,
        to: p.toUrl,
        detail: `安全弁で見送り: ${decision.blocked}`,
      });
    }
    return summary;
  }

  for (const p of planned) {
    if (!params.execute) {
      summary.details.push({
        candidateNumber: p.candidateNumber,
        result: "WOULD_MOVE",
        from: p.fromUrl,
        to: p.toUrl,
      });
      params.log(`[onedrive-folder-url] 機能2 更新予定 ${p.candidateNumber}: → ${p.drivePath}`);
      continue;
    }

    // ★現在値が確認時と同じ間だけ書く（その間に CA が手で貼り替えていたら負ける）。
    const applied = await applyFolderUrlRelocation({
      candidateId: p.id,
      fromUrl: p.fromUrl,
      toUrl: p.toUrl,
      drivePath: p.drivePath,
      now: params.now,
    });
    if (!applied) {
      summary.details.push({
        candidateNumber: p.candidateNumber,
        result: "NOT_RELOCATED",
        detail: "処理中に URL が変更されたため張り替えを見送り",
      });
      continue;
    }

    summary.updated++;
    summary.details.push({
      candidateNumber: p.candidateNumber,
      result: "MOVED",
      from: p.fromUrl,
      to: p.toUrl,
    });
    params.log(`[onedrive-folder-url] 機能2 更新 ${p.candidateNumber}: → ${p.drivePath}`);
  }

  return summary;
}
