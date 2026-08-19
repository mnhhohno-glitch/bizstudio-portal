/**
 * T-159 Phase 3: OneDrive 上の求職者フォルダを Graph 経由で走査し、求職者番号で引ける索引にする。
 *
 * ★T-158 との違い（ここが本ファイルの存在理由）:
 *   T-158 の突合（scripts/t158_scan_onedrive.py）は**ローカルPCの OneDrive 同期フォルダ**を
 *   os.walk で歩いていた。将幸さんのPCが起動していないと動かないため、毎晩の自動処理には使えない。
 *   本ファイルは同じ判定ロジックを **Microsoft Graph の listChildren** に載せ替えたもの。
 *   判定規則（何を求職者フォルダとみなすか・氏名照合・URL形式）は T-158 と同一に保つこと。
 *   規則が食い違うと、同じフォルダに対して T-158 と本処理が別のURLを作る。
 *
 * ★フォルダは作らない・書き込まない。本ファイルは listChildren（読み取り）だけを使う。
 *
 * ★階層を {年}/{年月} に固定しない。T-158 の実測で CA ごとに構造が違うことが判明している:
 *     1.大野 = {年}/{年月}/求職者 / 2.小野 = 直下に求職者 / 3.岡田 = 混在 /
 *     4.安藤 = {年月}/求職者 + 2024～/{年}年/... / 5.南條・6.奥村 = {年月}/求職者
 *   したがって CA フォルダ配下を再帰で降り、名前が求職者番号で始まるフォルダを拾う方式にする。
 *
 * ★求職者フォルダの中は見ない。中には `2.求人/0609` のような日付フォルダがあり、
 *   これを求職者番号 0609 と誤認するため（T-158 で踏んだ罠）。
 */

import {
  type DriveItem,
  ONEDRIVE_WRITE_ROOT,
  listChildrenByPath,
} from "@/lib/microsoft-graph";
import { restoreDrivePathFromFolderUrl } from "@/lib/onedrive-sync";

// ============================================================
// 走査範囲と安全弁の定数
// ============================================================

/** 走査の起点。書き込み許可プレフィックスと同一（末尾スラッシュだけ落とす）。 */
export const ONEDRIVE_SCAN_ROOT = ONEDRIVE_WRITE_ROOT.replace(/\/$/, "");

/** CA フォルダからの相対深さの上限。暴走防止（T-158 の MAX_DEPTH=6 と同値）。 */
export const ONEDRIVE_SCAN_MAX_DEPTH = 6;

/**
 * 走査で得られた求職者フォルダ数の下限（安全弁1）。
 *
 * これを下回ったら「Graph が一部しか返していない」「フォルダ構成が大きく変わった」のどちらかであり、
 * 索引が信用できない。URL の登録・更新を一切行わず報告のみに切り替える。
 * T-158 の実測は 1,734 件。その約 6 割を閾値に置いた（CA の整理で数百件減ることは実際にありうるため
 * 厳しすぎる閾値にはしない。一方「数十件しか返ってこなかった」は明確な異常）。
 */
export const ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS = 1000;

/** CA フォルダ単位で並列に降りる本数。Graph の 429 を誘発しない範囲に留める。 */
export const ONEDRIVE_SCAN_CONCURRENCY = 3;

// ============================================================
// フォルダ名の解釈（T-158 scripts/t158_scan_onedrive.py の移植・規則を変えない）
// ============================================================

/** 求職者フォルダ: 先頭が 4〜10 桁の連続数字。 */
const RE_CANDIDATE_NUMBER = /^(\d{4,10})/;
/** 番号に続く区切り文字（_ / 半角空白 / 全角空白 / -）。氏名内の空白は残す。 */
const RE_NUMBER_SEPARATOR = /^[_\s　-]+/;
/** CA フォルダ: {数字}.{名前} */
const RE_CA_FOLDER = /^\d+\./;
/** 年フォルダ: 2024 / 2024年 / 2024～ など */
const RE_YEAR_FOLDER = /^(19|20)\d{2}\s*[年~～]?$/;
/** 年月フォルダ: 202607 */
const RE_YYYYMM_FOLDER = /^(19|20)\d{4}$/;

/**
 * 求職者フォルダではないと分かっているテンプレ用フォルダ（年月フォルダ配下に同居している）。
 * T-158 の TEMPLATE_DIR_NAMES と同一。
 */
const TEMPLATE_DIR_NAMES = new Set(["【原本】番号氏名"]);

/**
 * フォルダ名を (求職者番号, 氏名部分) に分解する。番号が無ければ number="" 。
 * 「202607」は6桁で本正規表現にも当たるため、呼び出し側で**年月コンテナ判定を先に**行うこと
 * （求職者番号は7桁で先頭が5、年月は先頭が 19/20 の6桁なので実データでは衝突しない）。
 */
export function splitCandidateFolderName(folderName: string): {
  number: string;
  namePart: string;
} {
  const m = RE_CANDIDATE_NUMBER.exec(folderName);
  if (!m) return { number: "", namePart: folderName.trim() };
  const rest = folderName.slice(m[0].length).replace(RE_NUMBER_SEPARATOR, "");
  return { number: m[1], namePart: rest.trim() };
}

/**
 * 氏名照合用の正規化。**照合のためだけに使う。ここで作った文字列を Graph へ送ってはいけない。**
 *
 * NFKC を通しているのは、フォルダ名側に全角英数字・全角スペースが混ざるため
 * （T-158 の norm_name と同一規則にしないと、同じフォルダで判定が食い違う）。
 * microsoft-graph.ts の注記どおり **パスに NFKC をかけると 404 になる** が、こちらは
 * メモリ上の比較専用であり、パスは常に Graph が返した生の name を連結して組む。
 *
 * 規則: NFKC（全角英数→半角・全角空白→半角空白）→ 空白/タブ除去 → 中黒除去。
 * 長音「ー」は氏名に含まれうるので落とさない。
 */
export function normalizeNameForMatch(s: string | null | undefined): string {
  if (!s) return "";
  let out = s.normalize("NFKC").replace(/\s+/g, "");
  for (const ch of ["・", "･", "·"]) out = out.split(ch).join("");
  return out;
}

/**
 * portal の氏名が、フォルダ名の氏名部分に含まれるか。
 *
 * 完全一致にしないのは、フォルダ名末尾に `_close` / クローズ / 支援終了 / 様 等の付記が
 * 付くケースが実在するため（T-158 name_matches と同一）。
 * どちらかが空文字なら false（照合できないものは登録しない）。
 */
export function folderNameMatchesCandidate(
  portalName: string | null | undefined,
  folderNamePart: string | null | undefined,
): boolean {
  const p = normalizeNameForMatch(portalName);
  const f = normalizeNameForMatch(folderNamePart);
  if (!p || !f) return false;
  return f.includes(p);
}

// ============================================================
// URL の組み立て（T-158 build_url と byte 一致させる）
// ============================================================

export const ONEDRIVE_FOLDER_URL_BASE = "https://bizstudio-my.sharepoint.com/my?id=";

/**
 * SharePoint の `id` パラメータ用エンコード。
 *
 * ★T-158（Python）の `quote(path, safe="") + _ . - ~ の追加変換` と**1バイトも違わない**結果に
 *   すること。既に 1,734 件がこの形式で入っており、形式が変わると
 *   「同じフォルダを指すのに文字列が違うURL」が生まれる。台帳（OneDriveFolderUrlLedger）は
 *   保存済みURLとの byte 一致で自動登録か手貼りかを判別するため、ここがずれると全件が
 *   「手貼り」に見えて移動追随が止まる。
 *
 * 差分の内訳:
 *   - encodeURIComponent が残す `!'()*` を Python の quote は変換する → 明示的に置換
 *   - encodeURIComponent が残す `_ . - ~` も T-158 は変換している → 明示的に置換
 */
export function sharePointEncodePath(path: string): string {
  return encodeURIComponent(path)
    .replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .replace(/_/g, "%5F")
    .replace(/\./g, "%2E")
    .replace(/-/g, "%2D")
    .replace(/~/g, "%7E");
}

/**
 * UPN（masayuki_oono@bizstudio.co.jp）→ URL に現れる所有者セグメント
 * （masayuki_oono_bizstudio_co_jp）。SharePoint は `.` と `@` を `_` に潰す。
 *
 * ★逆方向（セグメント→UPN）は機械的に復元できない（microsoft-graph.ts listUsers の注記）。
 *   こちらは順方向なので確定する。それでも登録前に「既に登録済みURLのセグメントと一致するか」を
 *   照合する（assertOwnerSegmentMatches）。1文字違えば CA がボタンを押しても開けないため。
 */
export function ownerSegmentFromUpn(upn: string): string {
  return upn.replace(/[.@]/g, "_");
}

/**
 * ドライブ相対パス（/ビズスタジオ/6.求職者書類関連/...）→ 登録するURL。
 * `viewid` は付けない（T-158 と同一形式）。
 */
export function buildOneDriveFolderUrl(ownerSegment: string, drivePath: string): string {
  const withoutTrailingSlash = drivePath.replace(/\/$/, "");
  const idValue = `/personal/${ownerSegment}/Documents${
    withoutTrailingSlash.startsWith("/") ? "" : "/"
  }${withoutTrailingSlash}`;
  return `${ONEDRIVE_FOLDER_URL_BASE}${sharePointEncodePath(idValue)}`;
}

/**
 * 組み立てたURLが、既存の復元関数で元のパスに戻るか。
 * 戻らないURLは登録しない（フェイルクローズ）。「登録したのに夜間処理が読めない」を防ぐ自己検査。
 */
export function folderUrlRoundTrips(url: string, drivePath: string): boolean {
  const restored = restoreDrivePathFromFolderUrl(url);
  return restored.ok && restored.folderPath === drivePath.replace(/\/$/, "");
}

// ============================================================
// 走査
// ============================================================

export interface ScannedCandidateFolder {
  /** フォルダ名から取れた求職者番号（空文字なら番号なしフォルダ）。 */
  candidateNumber: string;
  /** 番号と区切りを落とした残り（氏名部分）。 */
  namePart: string;
  /** フォルダ名そのもの（Graph が返した生の値）。 */
  folderName: string;
  /** ドライブ相対パス。Graph が返した name を連結しただけで、文字列は加工していない。 */
  drivePath: string;
  /** 直下の CA フォルダ名（例 4.安藤）。 */
  caFolder: string;
}

export interface OneDriveFolderScanResult {
  /**
   * 走査が完走したか。listChildren が1回でも例外になったら false。
   * false のときは索引に穴があるので、URL の登録・更新をしてはいけない
   * （「フォルダが無い」と「見に行けなかった」を区別できないため）。
   */
  complete: boolean;
  folders: ScannedCandidateFolder[];
  /** 求職者番号 → 該当フォルダ（複数ありうる。複数なら登録しない）。番号なしフォルダは入らない。 */
  byNumber: Map<string, ScannedCandidateFolder[]>;
  /** 実際に降りた CA フォルダ名（絞り込み後）。 */
  caFolders: string[];
  /** ルート直下で CA フォルダと判定できたもの全部（絞り込み前）。夜間処理では caFolders と同一。 */
  allCaFolders: string[];
  /** Graph の listChildren 実行回数（キャッシュヒットは数えない）。 */
  listCalls: number;
  /** キャッシュで省けた listChildren の回数。 */
  cacheHits: number;
  errors: string[];
  durationMs: number;
}

export interface OneDriveFolderScanDeps {
  listChildrenByPath: typeof listChildrenByPath;
}

export interface OneDriveFolderScanOptions {
  /**
   * ルート直下で見つけた CA フォルダのうち、実際に降りるものを選ぶ（T-159 Phase 4）。
   *
   * ★夜間処理は渡さない（＝全 CA フォルダを降りる）。渡すのは求職者1人分の即時同期だけで、
   *   全走査 34秒をボタンの待ち時間にしないための絞り込み専用。
   *   絞り込むと「別 CA のフォルダ配下にある同番号のフォルダ」が見えなくなるため、
   *   `matchCandidateFolder` の DUPLICATE_FOLDER 判定は走査範囲内でしか効かない。
   */
  selectCaFolders?: (allCaFolders: string[]) => string[];
}

/** 並列度つき map。Graph への同時接続数を抑えるためだけの小道具。 */
async function mapWithConcurrency<T>(
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
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );
}

/**
 * `6.求職者書類関連` 配下を再帰的に降りて求職者フォルダを列挙する（読み取りのみ）。
 *
 * ★1回の夜間処理で**1度しか呼ばないこと。** 結果を機能1（URL自動登録）と機能2（移動追随）で
 *   共有する。同じフォルダを二度 listChildren しないためのキャッシュも本関数内に持つ
 *   （束ねフォルダの判定で子を見た後、そこへ降りるときに再取得しない）。
 */
export async function scanOneDriveCandidateFolders(
  upn: string,
  depsOverride: Partial<OneDriveFolderScanDeps> = {},
  options: OneDriveFolderScanOptions = {},
): Promise<OneDriveFolderScanResult> {
  const deps: OneDriveFolderScanDeps = { listChildrenByPath, ...depsOverride };
  const startedAt = Date.now();

  const folders: ScannedCandidateFolder[] = [];
  const errors: string[] = [];
  let complete = true;
  let listCalls = 0;
  let cacheHits = 0;

  // パス → 子アイテム。走査中の重複取得を防ぐ（同一実行内のみ有効・持ち越さない）。
  const cache = new Map<string, DriveItem[] | null>();

  const listFolders = async (path: string): Promise<DriveItem[] | null> => {
    if (cache.has(path)) {
      cacheHits++;
      return cache.get(path) ?? null;
    }
    try {
      listCalls++;
      const children = await deps.listChildrenByPath(upn, path);
      const onlyFolders = children === null ? null : children.filter((c) => c.folder);
      cache.set(path, onlyFolders);
      return onlyFolders;
    } catch (e) {
      // 見に行けなかった。「無い」と区別できないので索引を不完全扱いにする。
      complete = false;
      errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
      cache.set(path, null);
      return null;
    }
  };

  const walk = async (
    caFolder: string,
    currentPath: string,
    containers: string[],
  ): Promise<void> => {
    if (containers.length >= ONEDRIVE_SCAN_MAX_DEPTH) return;
    const children = await listFolders(currentPath);
    if (!children) return;

    for (const child of children) {
      const name = child.name;
      if (TEMPLATE_DIR_NAMES.has(name)) continue;

      const childPath = `${currentPath}/${name}`;
      const isContainer = RE_YEAR_FOLDER.test(name) || RE_YYYYMM_FOLDER.test(name);
      const isCandidate = RE_CANDIDATE_NUMBER.test(name);

      // 年/年月フォルダは中間コンテナとして降りる。年月は6桁で求職者番号の正規表現にも
      // 当たるため、コンテナ判定を先に置く（T-158 と同じ順序）。
      if (isContainer) {
        await walk(caFolder, childPath, [...containers, name]);
        continue;
      }

      const inMonthContainer =
        containers.length > 0 && RE_YYYYMM_FOLDER.test(containers[containers.length - 1]);

      // 年月フォルダ直下の番号なしフォルダは「番号が抜けた求職者フォルダ」と
      // 「支援終了 / クローズ / ロープレ のような束ねフォルダ」の両方がありうる。
      // 子の過半が番号付きなら束ねフォルダとみなして降りる（T-158 と同一判定）。
      if (inMonthContainer && !isCandidate) {
        const kids = await listFolders(childPath);
        if (kids) {
          const numbered = kids.filter(
            (k) =>
              RE_CANDIDATE_NUMBER.test(k.name) &&
              !RE_YEAR_FOLDER.test(k.name) &&
              !RE_YYYYMM_FOLDER.test(k.name),
          );
          if (numbered.length > 0 && numbered.length * 2 >= kids.length) {
            await walk(caFolder, childPath, [...containers, name]);
            continue;
          }
        }
      }

      // 番号付きは求職者フォルダ確定。番号なしでも年月フォルダ直下なら番号欠落の求職者フォルダ。
      // ★ここで中へは降りない（2.求人/0609 を求職者番号 0609 と誤認しないため）。
      if (isCandidate || inMonthContainer) {
        const { number, namePart } = splitCandidateFolderName(name);
        folders.push({
          candidateNumber: number,
          namePart,
          folderName: name,
          drivePath: childPath,
          caFolder,
        });
        continue;
      }

      // それ以外（テンプレ・資料フォルダ等）は降りるだけ。ただし CA 直下の非数値フォルダは
      // 求職者フォルダではないので降りない（GPTメモ・面接対策 など）。
      if (containers.length > 0) {
        await walk(caFolder, childPath, [...containers, name]);
      }
    }
  };

  // --- CA フォルダの特定 ---
  const top = await listFolders(ONEDRIVE_SCAN_ROOT);
  const caFolders: string[] = [];
  for (const d of top ?? []) {
    if (!RE_CA_FOLDER.test(d.name)) continue;
    // {数字}.{名前} でも、配下に 年/年月/番号 のいずれも無いものは CA フォルダではない（T-158 と同一）。
    const kids = await listFolders(`${ONEDRIVE_SCAN_ROOT}/${d.name}`);
    if (
      (kids ?? []).some(
        (k) =>
          RE_YEAR_FOLDER.test(k.name) ||
          RE_YYYYMM_FOLDER.test(k.name) ||
          RE_CANDIDATE_NUMBER.test(k.name),
      )
    ) {
      caFolders.push(d.name);
    }
  }
  if (top === null) {
    complete = false;
    errors.push(`${ONEDRIVE_SCAN_ROOT}: 走査の起点を列挙できませんでした`);
  }

  // ★絞り込みは「どの CA フォルダへ降りるか」だけに効く。ルート直下の列挙は必ず行う
  //   （CA フォルダの実名を知らないと絞り込みようがないため）。
  const targetCaFolders = options.selectCaFolders
    ? options.selectCaFolders(caFolders).filter((n) => caFolders.includes(n))
    : caFolders;

  await mapWithConcurrency(targetCaFolders, ONEDRIVE_SCAN_CONCURRENCY, (ca) =>
    walk(ca, `${ONEDRIVE_SCAN_ROOT}/${ca}`, []),
  );

  const byNumber = new Map<string, ScannedCandidateFolder[]>();
  for (const f of folders) {
    if (!f.candidateNumber) continue;
    const list = byNumber.get(f.candidateNumber) ?? [];
    list.push(f);
    byNumber.set(f.candidateNumber, list);
  }

  return {
    complete,
    folders,
    byNumber,
    caFolders: targetCaFolders,
    allCaFolders: caFolders,
    listCalls,
    cacheHits,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

/** 索引が「URLを書き換える判断に使えるほど信用できるか」。安全弁1。 */
export function isScanTrustworthy(scan: OneDriveFolderScanResult): boolean {
  return scan.complete && scan.folders.length >= ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS;
}

/**
 * 担当CAで絞り込んだ走査（T-159 Phase 4）が信用できるか。
 *
 * ★件数の下限（ONEDRIVE_SCAN_MIN_EXPECTED_FOLDERS = 1000）は当てられない。
 *   1CA分しか降りていないので数百件で正常であり、この閾値を使うと必ず不合格になる。
 *   代わりに「完走したか」だけを見る。走査に穴があるまま登録すると
 *   「候補が1件だけ」の判定が崩れる、という懸念は全走査と同じなので complete は必須。
 */
export function isScopedScanTrustworthy(scan: OneDriveFolderScanResult): boolean {
  return scan.complete;
}

// ============================================================
// 担当CA → 走査する CA フォルダ（T-159 Phase 4）
// ============================================================

/**
 * CA フォルダ名（`4.安藤`）から `{連番}.` を落とした部分（`安藤`）。
 * CA フォルダでなければ null。
 */
export function caFolderLabel(folderName: string): string | null {
  const m = /^\d+\.(.+)$/.exec(folderName);
  if (!m) return null;
  const label = m[1].trim();
  return label ? label : null;
}

/**
 * 担当CA名（`安藤 嘉富`）と CA フォルダ名（`4.安藤`）が同一人物を指すか。
 *
 * ★姓で一致させる。フォルダ側は姓だけ（`4.安藤`）が実データだが、将来フルネームの
 *   フォルダ（`7.大野将幸`）が現れても拾えるよう「空白を除いた氏名がラベルで始まるか」で見る。
 *   照合は normalizeNameForMatch（NFKC + 空白除去）を通す — **比較用の文字列であり
 *   Graph へ送るパスには使わない**（送ると 404 になる）。
 */
export function caFolderMatchesEmployee(
  employeeName: string | null | undefined,
  caFolderName: string,
): boolean {
  const label = caFolderLabel(caFolderName);
  if (!label) return false;
  const name = normalizeNameForMatch(employeeName);
  const normalizedLabel = normalizeNameForMatch(label);
  if (!name || !normalizedLabel) return false;
  return name.startsWith(normalizedLabel);
}

/**
 * 担当CAのフォルダだけに絞る。**該当が1つも無ければ全 CA フォルダを返す（フォールバック）。**
 *
 * ★フォールバックを「0件」にしてはいけない。担当CA未設定・フォルダ名が姓と食い違うといった
 *   運用上ありふれた状態で「フォルダが見つかりません」と嘘を返すことになるため。
 *   遅くなっても正しい答えを返す側に倒す。
 */
export function selectCaFoldersForEmployee(
  employeeName: string | null | undefined,
  caFolders: string[],
): string[] {
  const matched = caFolders.filter((f) => caFolderMatchesEmployee(employeeName, f));
  return matched.length > 0 ? matched : caFolders;
}

// ============================================================
// 「このフォルダを登録してよいか」の判定（純関数）
// ============================================================

export type FolderMatchRejection =
  | "NO_CANDIDATE_NUMBER" // portal 側に求職者番号が無い
  | "NOT_FOUND" // 番号一致のフォルダが1件も無い
  | "DUPLICATE_FOLDER" // 番号一致が複数。どちらが正しいか機械判定できない
  | "NAME_MISMATCH" // フォルダ名の氏名部分と portal の氏名が食い違う
  | "URL_ROUNDTRIP_FAILED"; // 組み立てたURLを元のパスに戻せない

export type FolderMatchResult =
  | { ok: true; folder: ScannedCandidateFolder; url: string }
  | { ok: false; reason: FolderMatchRejection; detail: string };

/**
 * 求職者番号の完全一致で走査結果を引き、氏名照合を通ったものだけ「登録してよい」と返す。
 *
 * ★氏名では突合しない（求職者番号の完全一致が必須）。同姓同名で他人のフォルダを紐付けると
 *   他人の個人情報へのアクセスになる。T-158 では逆に「同じ番号のフォルダに別人の氏名」が
 *   4件実在した（フォルダ側の打ち間違い）ため、番号だけを信じることもしない。
 *   番号で引き、氏名で検証する — この二段が T-158 から引き継ぐ安全側の設計。
 *
 * ★候補が複数なら登録しない。どちらが正しいか機械では決められない。
 */
export function matchCandidateFolder(params: {
  candidateNumber: string | null | undefined;
  candidateName: string | null | undefined;
  ownerSegment: string;
  scan: OneDriveFolderScanResult;
}): FolderMatchResult {
  const number = (params.candidateNumber ?? "").trim();
  if (!number) {
    return { ok: false, reason: "NO_CANDIDATE_NUMBER", detail: "求職者番号が未設定" };
  }

  const hits = params.scan.byNumber.get(number) ?? [];
  if (hits.length === 0) {
    return { ok: false, reason: "NOT_FOUND", detail: "番号一致のフォルダなし" };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: "DUPLICATE_FOLDER",
      detail: `番号一致のフォルダが${hits.length}件: ${hits.map((h) => h.drivePath).join(" / ")}`,
    };
  }

  const folder = hits[0];
  if (!folderNameMatchesCandidate(params.candidateName, folder.namePart)) {
    return {
      ok: false,
      reason: "NAME_MISMATCH",
      detail: `portal氏名=${params.candidateName ?? ""} / フォルダ氏名=${folder.namePart}`,
    };
  }

  const url = buildOneDriveFolderUrl(params.ownerSegment, folder.drivePath);
  if (!folderUrlRoundTrips(url, folder.drivePath)) {
    return {
      ok: false,
      reason: "URL_ROUNDTRIP_FAILED",
      detail: `組み立てたURLからパスを復元できません: ${folder.drivePath}`,
    };
  }

  return { ok: true, folder, url };
}
