/**
 * T-159: Microsoft Graph クライアント（OneDrive 連携の接続層）。
 *
 * 方針（Phase 1 調査 `docs/reports/T-159_onedrive-file-sync-survey.md` で確定）:
 *   - ライブラリを追加しない。素の fetch で client_credentials + Graph REST を叩く。
 *     必要な呼び出しが実質数本しかなく、@azure/identity 系の依存増（30MB超）に見合わないため。
 *     同型の前例は src/lib/lineworks.ts（client_credentials を fetch で直書き）。
 *   - 本ファイルは「接続層」のみ。どのファイルをいつコピーするかという同期ロジックは持たない
 *     （Phase 2-a 以降で src/lib/onedrive/sync.ts に実装する）。
 *   - ONEDRIVE_SYNC_ENABLED はこの層では見ない。キルスイッチは同期ロジック側の責務であり、
 *     疎通確認や調査は同期停止中でも実行できる必要があるため。
 *
 * 認証: アプリケーションの許可 Files.ReadWrite.All（管理者同意済み）。
 *   この権限はテナント内の全ユーザーの OneDrive に届くため、書き込み先の絞り込みは
 *   呼び出し側（同期ロジック）の責務とする。
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const LOGIN_BASE = "https://login.microsoftonline.com";

/** Graph の simple upload（PUT :/content）の上限。これを超えたら createUploadSession を使う。 */
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** createUploadSession のチャンクサイズ。Graph の仕様上 320KiB の倍数であること。 */
const UPLOAD_CHUNK_BYTES = 5 * 320 * 1024; // 1,638,400 bytes

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 60_000;

// ============================================================
// トークン
// ============================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * client_credentials でアクセストークンを取得（プロセス内キャッシュ・期限5分前に再取得）。
 * scope は .default 固定（アプリケーションの許可は Azure 側で確定しているため個別指定しない）。
 */
export async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Microsoft Graph の環境変数が未設定です（MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET）",
    );
  }

  const res = await fetch(`${LOGIN_BASE}/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    // シークレット失効（AADSTS7000222）はここに出る。値そのものはログに出さない。
    throw new Error(`Graph トークン取得失敗: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/** テスト・調査用にトークンキャッシュを捨てる。 */
export function resetGraphTokenCache(): void {
  cachedToken = null;
}

// ============================================================
// HTTP ラッパ
// ============================================================

export class GraphError extends Error {
  constructor(
    readonly status: number,
    /** Graph の error.code（"itemNotFound" / "nameAlreadyExists" / "activityLimitReached" 等）。 */
    readonly code: string,
    message: string,
    readonly body: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

function parseGraphError(status: number, body: string): GraphError {
  let code = "";
  let message = body;
  try {
    const json = JSON.parse(body) as { error?: { code?: string; message?: string } };
    code = json.error?.code ?? "";
    message = json.error?.message ?? body;
  } catch {
    /* JSON でないレスポンスはそのまま本文を message にする */
  }
  return new GraphError(status, code, `Graph ${status} ${code}: ${message}`, body);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Graph を叩く共通ラッパ。
 *   - 429 / 5xx は Retry-After を尊重して指数バックオフ再試行（既定4回）。
 *     Graph は 429 と共に待つべき秒数を返すため、これを無視すると更に強い制限を受ける。
 *   - 4xx（429 以外）は即座に GraphError を投げる。呼び出し側が code で分岐する。
 *   - url は絶対URL（createUploadSession の uploadUrl も渡せる）。
 *   - withAuth=false のときは Authorization を付けない（uploadUrl は署名済みURLのため付けてはいけない）。
 */
export async function graphFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxRetries?: number; timeoutMs?: number; withAuth?: boolean } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const withAuth = opts.withAuth !== false;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(init.headers);
    if (withAuth) headers.set("Authorization", `Bearer ${await getGraphToken()}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (e) {
      // ネットワーク断・タイムアウトも再試行対象
      lastError = e;
      clearTimeout(timer);
      if (attempt === maxRetries) throw e;
      await sleep(backoffMs(attempt, null));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res;

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = res.headers.get("retry-after");
      const body = await res.text();
      lastError = parseGraphError(res.status, body);
      if (attempt === maxRetries) throw lastError;
      await sleep(backoffMs(attempt, retryAfter));
      continue;
    }

    throw parseGraphError(res.status, await res.text());
  }

  throw lastError instanceof Error ? lastError : new Error("Graph リクエストに失敗しました");
}

/** Retry-After（秒）があればそれを優先。無ければ 2^n 秒（上限60秒）。 */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 120_000);
  }
  return Math.min(2 ** attempt * 1000, 60_000);
}

async function graphJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await graphFetch(url, init);
  return (await res.json()) as T;
}

// ============================================================
// パスのエンコードと Unicode 正規化
// ============================================================

/**
 * ドライブ相対パスを Graph のパスアドレッシング用にエンコードする。
 * セグメント単位で encodeURIComponent し、"/" は区切りとして残す。
 * （パス全体を encodeURIComponent すると "/" まで %2F になり別物になる）
 */
export function encodeDrivePath(path: string): string {
  return path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/**
 * ★ Unicode 正規化はかけない（T-159 Phase 2-0 で実測して確定）。
 *
 * 懸念していたのは、実データに含まれる 全角チルダ ～(U+FF5E) 313件・異体字 﨑(U+FA11) 1件・
 * 全角スペース　(U+3000) 33件 が、正規化方式の差で itemNotFound になることだった。
 * 本番の該当パスを1方式ずつ厳密に叩いて確かめた結果:
 *
 *   - DB が保持する文字列は既に NFC（`s === s.normalize("NFC")` が成立）
 *   - Graph 側がパス照合時に正規化を吸収する。NFD にして送っても 200 が返り、
 *     レスポンスの name は元と同一コードポイントで戻る
 *   - **NFKC をかけると壊れる**。～(U+FF5E)→~(U+007E)、全角スペース→半角 に変換され 404 になる
 *
 * したがって「DB の値をそのまま送る」のが唯一かつ正しい方式。
 * 正規化フォールバック（NFC→NFD と順に試す）は Graph 側が吸収する以上1件も救えず、
 * 逆に「フォルダが本当に無い」という最も多いケースで API 往復が方式数ぶん増えるだけなので置かない。
 *
 * 将来この層でパスを加工したくなったら、NFKC / toLowerCase / trim を挟まないこと。
 */
export function assertPathUnmodified(path: string): string {
  return path;
}

// ============================================================
// 書き込み先ガード（T-159 Phase 2-a）
// ============================================================

/**
 * 書き込みを許可する唯一のドライブ相対プレフィックス。
 *
 * アプリの権限は `Files.ReadWrite.All`＝テナント内の全 OneDrive に書ける。実装のバグや将来の
 * 改修で「求職者フォルダ以外」へ書く余地を、権限ではなくコードで塞ぐのがこの定数の役目。
 * 末尾の "/" は意図的。プレフィックス自身（`6.求職者書類関連` 直下そのもの）への書き込みは
 * 許可しない＝必ず配下のどこかであることを要求する。
 *
 * Phase 2-0 で本番の求職者フォルダ 1,734 件すべてがこのプレフィックス配下であることを確認済み。
 */
export const ONEDRIVE_WRITE_ROOT = "/ビズスタジオ/6.求職者書類関連/";

/**
 * 書き込み系（アップロード・削除）の入口で必ず通すガード。
 * 許可プレフィックス配下でなければ Graph へ 1 バイトも送らずに例外にする。
 *
 * 検証は「先頭スラッシュの有無を揃える」以外に文字列を一切加工しない。
 * NFKC / toLowerCase / trim を挟むと実データが壊れる（assertPathUnmodified の注記を参照）。
 * 先頭スラッシュの補完は文字の置換ではなく区切りの正規化であり、指す場所は変わらない。
 *
 * `..` は 1 箇所でも含まれたら拒否する。プレフィックス一致をすり抜けて上位へ抜ける経路
 * （`/ビズスタジオ/6.求職者書類関連/../他部署/`）を塞ぐため。実データのフォルダ名・ファイル名に
 * 連続ドットは存在しない。
 */
export function assertOneDriveWritePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (normalized.includes("..")) {
    throw new Error(
      `OneDrive 書き込み先ガード: パスに ".." が含まれています。意図しない場所への書き込みを防ぐため中止しました: ${normalized}`,
    );
  }

  if (!normalized.startsWith(ONEDRIVE_WRITE_ROOT)) {
    throw new Error(
      `OneDrive 書き込み先ガード: 書き込みが許可されるのは "${ONEDRIVE_WRITE_ROOT}" 配下のみです。` +
        `意図しない場所への書き込みを防ぐため中止しました: ${normalized}`,
    );
  }

  return normalized;
}

// ============================================================
// ユーザー / ドライブ
// ============================================================

export interface GraphUser {
  id: string;
  displayName: string | null;
  userPrincipalName: string;
  mail: string | null;
}

/**
 * ユーザーを検索する。OneDrive のパスに現れる "masayuki_oono_bizstudio_co_jp" は
 * 記号を "_" に潰した後の形であり、元の UPN（. か _ か）を機械的に逆算できないため、
 * 実際のディレクトリに問い合わせて確定させる用途で使う。
 */
export async function listUsers(params: { search?: string; top?: number } = {}): Promise<GraphUser[]> {
  const qs = new URLSearchParams({
    $select: "id,displayName,userPrincipalName,mail",
    $top: String(params.top ?? 100),
  });
  const init: RequestInit = {};
  if (params.search) {
    // $search は ConsistencyLevel: eventual が必須
    qs.set("$search", `"displayName:${params.search}"`);
    init.headers = { ConsistencyLevel: "eventual" };
  }
  const data = await graphJson<{ value: GraphUser[] }>(`${GRAPH_BASE}/users?${qs}`, init);
  return data.value;
}

export interface DriveInfo {
  id: string;
  driveType: string;
  owner?: { user?: { displayName?: string; email?: string } };
  quota?: { total?: number; used?: number; remaining?: number };
}

/** 指定ユーザーの既定ドライブ（個人 OneDrive）の情報。容量の残りを確認する用途も兼ねる。 */
export async function getUserDrive(upn: string): Promise<DriveInfo> {
  return graphJson<DriveInfo>(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}/drive`);
}

// ============================================================
// ドライブアイテム
// ============================================================

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  lastModifiedDateTime?: string;
  /** 親フォルダ。path は "/drive/root:/ビズスタジオ/..." または "/drives/{id}/root:/..." の形。 */
  parentReference?: { driveId?: string; id?: string; path?: string };
}

function itemUrl(upn: string, path: string, suffix = ""): string {
  const encoded = encodeDrivePath(path);
  const base = `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/drive/root`;
  // ルート直下（path が空）は ":" を挟まない形になる
  if (!encoded) return suffix ? `${base}${suffix.replace(/^:/, "")}` : base;
  return `${base}:/${encoded}${suffix}`;
}

/**
 * パス指定でドライブアイテムを1件取得する。
 * 見つからなければ null（例外にしない）。呼び出し側は「フォルダが無い＝スキップ」を素直に書ける。
 * 404 itemNotFound は「本当に存在しない」を意味する（文字コード差ではない。上の注記を参照）。
 */
export async function getDriveItemByPath(upn: string, path: string): Promise<DriveItem | null> {
  try {
    return await graphJson<DriveItem>(itemUrl(upn, assertPathUnmodified(path)));
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

/** パス指定でフォルダの子アイテムを列挙する（ページング追従）。フォルダが無ければ null。 */
export async function listChildrenByPath(upn: string, path: string): Promise<DriveItem[] | null> {
  try {
    const items: DriveItem[] = [];
    let url: string | undefined =
      `${itemUrl(upn, assertPathUnmodified(path), ":/children")}?$top=200` +
      `&$select=id,name,size,webUrl,folder,file,lastModifiedDateTime`;
    while (url) {
      const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphJson(url);
      items.push(...page.value);
      url = page["@odata.nextLink"];
    }
    return items;
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

// ============================================================
// アップロード
// ============================================================

export type ConflictBehavior = "fail" | "replace" | "rename";

/**
 * パス指定でファイルをアップロードする。
 *
 * conflictBehavior は既定 "fail"。同名があれば Graph が 409 nameAlreadyExists を返すので、
 * 「上書きせずスキップ」を存在確認との2往復にせず1往復で・競合なしに実現できる。
 *
 * 4MB を超える場合は createUploadSession によるチャンク送信に自動で切り替える。
 * 実測の最大は 2.03MB だが upload route の上限は 20MB のため、境界越えは起こりうる。
 *
 * folderPath は「親フォルダまで」のドライブ相対パス。文字列は加工しない（上の正規化の注記を参照）。
 *
 * ★書き込み先ガード: 実際に書く先が ONEDRIVE_WRITE_ROOT 配下でなければ、Graph へ通信する前に例外。
 */
export async function uploadFileByPath(params: {
  upn: string;
  folderPath: string;
  fileName: string;
  content: Buffer;
  mimeType?: string;
  conflictBehavior?: ConflictBehavior;
}): Promise<DriveItem> {
  const {
    upn,
    fileName,
    content,
    mimeType = "application/octet-stream",
    conflictBehavior = "fail",
  } = params;

  const fullPath = assertOneDriveWritePath(
    `${assertPathUnmodified(params.folderPath).replace(/\/$/, "")}/${fileName}`,
  );

  if (content.length <= SIMPLE_UPLOAD_MAX_BYTES) {
    const url = `${itemUrl(upn, fullPath, ":/content")}?@microsoft.graph.conflictBehavior=${conflictBehavior}`;
    const res = await graphFetch(url, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      // Buffer をそのまま渡すと undici が型を嫌うため Uint8Array 化する
      body: new Uint8Array(content),
    });
    return (await res.json()) as DriveItem;
  }

  return uploadLargeFile({ upn, fullPath, content, conflictBehavior });
}

/**
 * 4MB 超のアップロード。createUploadSession → uploadUrl へチャンク PUT。
 * private だが、将来ここが別経路から呼ばれても効くようガードを再掲する（多層防御）。
 */
async function uploadLargeFile(params: {
  upn: string;
  fullPath: string;
  content: Buffer;
  conflictBehavior: ConflictBehavior;
}): Promise<DriveItem> {
  const { upn, content, conflictBehavior } = params;
  const fullPath = assertOneDriveWritePath(params.fullPath);

  const session = await graphJson<{ uploadUrl: string }>(
    itemUrl(upn, fullPath, ":/createUploadSession"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": conflictBehavior },
      }),
    },
  );

  const total = content.length;
  for (let start = 0; start < total; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, total) - 1;
    const chunk = content.subarray(start, end + 1);
    // uploadUrl は署名済みURL。Authorization を付けてはいけない。
    const res = await graphFetch(
      session.uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${total}`,
        },
        body: new Uint8Array(chunk),
      },
      { withAuth: false },
    );
    // 最終チャンクで 200/201 と共に driveItem が返る。途中は 202 + nextExpectedRanges。
    if (res.status === 200 || res.status === 201) {
      return (await res.json()) as DriveItem;
    }
  }

  throw new Error(`アップロードが完了しませんでした: ${fullPath}`);
}

// ============================================================
// 削除（疎通確認で置いたテストファイルの後始末専用）
// ============================================================

/**
 * `parentReference.path`（"/drive/root:/ビズスタジオ/..." 形式）からドライブ相対パスを取り出す。
 * Graph の返却値をそのまま切り出すだけで、文字列の中身は加工しない。
 */
export function drivePathFromParentReference(parentPath: string | undefined): string | null {
  if (!parentPath) return null;
  const m = parentPath.match(/root:(.*)$/);
  if (!m) return null;
  // ルート直下のとき path は ".../root:" で終わり、m[1] は空文字になる
  if (m[1] === "") return "/";
  // Graph は parentReference.path を percent-encode して返すことがある。ここでの decode は
  // Graph が掛けたエンコードを戻すだけで、文字そのものの変換（NFKC 等）は行っていない。
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * ドライブアイテムを ID 指定で削除する。
 *
 * ★ portal → OneDrive は一方向コピーであり、portal 側の削除を OneDrive へ伝播させることは
 *   確定で対象外。この関数は疎通確認で自分が置いたテストファイルを片付ける用途にのみ使うこと。
 *
 * ★書き込み先ガード: ID 指定は「どこを消すか」がパスから読み取れないため、DELETE の前に
 *   実アイテムを1回読んで親パスを確定させ、ONEDRIVE_WRITE_ROOT 配下であることを確認する。
 *   読み取りは無制限なのでこの GET 自体はガードにかからない。
 */
export async function deleteDriveItemById(upn: string, itemId: string): Promise<void> {
  const itemBase = `${GRAPH_BASE}/users/${encodeURIComponent(upn)}/drive/items/${itemId}`;

  const item = await graphJson<DriveItem>(`${itemBase}?$select=id,name,parentReference`);
  const parentPath = drivePathFromParentReference(item.parentReference?.path);
  if (!parentPath) {
    throw new Error(
      `OneDrive 書き込み先ガード: 削除対象の親パスを特定できませんでした。意図しない削除を防ぐため中止しました（itemId=${itemId}）`,
    );
  }
  assertOneDriveWritePath(`${parentPath.replace(/\/$/, "")}/${item.name}`);

  await graphFetch(itemBase, { method: "DELETE" });
}
