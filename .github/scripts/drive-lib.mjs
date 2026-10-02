// T-XXX step3: Google ドライブ（共有ドライブ）への読み書きの共通部品。GitHub Actions から使う。
//
// なぜ googleapis パッケージを使わないのか:
//   Actions 側で npm install をしないで済ませるため（死活監視 uptime-notify.mjs と同じ方針）。
//   認証は portal の src/lib/google-drive.ts と同じサービスアカウント（JSON 鍵）で、
//   node:crypto で RS256 の JWT を組み立てて OAuth2 トークンに替える。
//
// 共有ドライブ上のフォルダを扱うので、全ての呼び出しに supportsAllDrives=true を付ける。
// 鍵・トークンの値はログに出さない。

import crypto from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// このワークフローが作ったファイルの目印。保持期間の整理で、この目印が無いファイルは触らない。
export const APP_PROPERTY_KEY = "bizstudioBackup";
export const APP_PROPERTY_VALUE = "db-backup-workflow";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken = null;

export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("環境変数 GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
  const creds = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${base64url(signer.sign(creds.private_key))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google トークン取得失敗: HTTP ${res.status}`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function driveFetch(url, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return res;
}

export function requireFolderId() {
  const id = process.env.BACKUP_DRIVE_FOLDER_ID;
  if (!id) throw new Error("環境変数 BACKUP_DRIVE_FOLDER_ID が未設定です");
  return id;
}

/** フォルダ直下の、このワークフローが作ったファイル一覧（名前・ID・サイズ・作成日時）。 */
export async function listBackupFiles(folderId) {
  const files = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and appProperties has { key='${APP_PROPERTY_KEY}' and value='${APP_PROPERTY_VALUE}' }`,
      fields: "nextPageToken, files(id, name, size, createdTime, md5Checksum)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await driveFetch(`${API}/files?${params}`);
    if (!res.ok) throw new Error(`Drive 一覧取得失敗: HTTP ${res.status} ${await res.text()}`);
    const json = await res.json();
    files.push(...(json.files ?? []));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

/**
 * ファイルを再開可能アップロードで置く（数十〜数百MBを想定）。
 * 同名ファイルが既にあっても上書きしない（新しいファイルとして追加される）。
 */
export async function uploadFile(folderId, localPath, name, mimeType = "application/octet-stream") {
  const size = fs.statSync(localPath).size;
  const metadata = {
    name,
    parents: [folderId],
    appProperties: { [APP_PROPERTY_KEY]: APP_PROPERTY_VALUE },
  };
  const start = await driveFetch(`${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw new Error(`Drive アップロード開始失敗: HTTP ${start.status} ${await start.text()}`);
  const session = start.headers.get("location");
  if (!session) throw new Error("Drive アップロードのセッションURLが返りませんでした");

  const body = fs.readFileSync(localPath);
  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "Content-Length": String(size) },
    body,
  });
  if (!put.ok) throw new Error(`Drive アップロード失敗: HTTP ${put.status} ${await put.text()}`);
  const json = await put.json();
  return { id: json.id, name: json.name ?? name, size };
}

/** ファイルをローカルに保存する。 */
export async function downloadFile(fileId, localPath) {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  if (!res.ok || !res.body) throw new Error(`Drive ダウンロード失敗: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(localPath, { mode: 0o600 }));
  return fs.statSync(localPath).size;
}

/**
 * ファイルを消す。サービスアカウントの権限（コンテンツ管理者）で完全削除が拒否された場合は
 * ゴミ箱に入れる（共有ドライブのゴミ箱は30日で自動的に消える）。
 */
export async function deleteFile(fileId) {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" });
  if (res.ok || res.status === 204) return "deleted";
  if (res.status !== 403) throw new Error(`Drive 削除失敗: HTTP ${res.status} ${await res.text()}`);
  const trash = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!trash.ok) throw new Error(`Drive ゴミ箱移動失敗: HTTP ${trash.status} ${await trash.text()}`);
  return "trashed";
}

/**
 * バックアップのファイル名規約。日時は JST（罠 #17）。
 *   portal-db_2026-10-01_0300.dump.gpg / railway-vars_2026-10-01_0300.json.gpg / portal-db_2026-10-01_0300.counts.json
 */
export const BACKUP_NAME_RE = /^(portal-db|railway-vars)_(\d{4})-(\d{2})-(\d{2})_(\d{4})\.(dump\.gpg|json\.gpg|counts\.json)$/;

export function parseBackupName(name) {
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return null;
  return {
    kind: m[1],
    date: `${m[2]}-${m[3]}-${m[4]}`,
    stamp: `${m[2]}-${m[3]}-${m[4]}_${m[5]}`,
    day: Number(m[4]),
    ext: m[6],
  };
}

/** JST の "YYYY-MM-DD" と "HHMM" を返す（Actions ランナーは UTC なので toISOString は使わない）。 */
export function jstParts(date = new Date()) {
  const d = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const t = date
    .toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit" })
    .replace(":", "");
  return { date: d, time: t, stamp: `${d}_${t}` };
}
