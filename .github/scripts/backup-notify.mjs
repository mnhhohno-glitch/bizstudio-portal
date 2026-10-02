// T-XXX step3: バックアップ／復元テストの結果を LINE WORKS に送る（GitHub Actions から実行）。
//
// 送り方は死活監視の .github/scripts/uptime-notify.mjs と同じ（Bot → 大野将幸ひとりへの DM、
// LINE WORKS API 2.0 / JWT Bearer を node:crypto で自前生成）。uptime-notify.mjs は MODE が
// down / up 固定なので、本文を環境変数で渡せる形に分けた。uptime-notify.mjs 自体は変えていない。
//
// 環境変数:
//   NOTIFY_TITLE  … 1行目（例: 【バックアップ失敗】portal 本番DB）
//   NOTIFY_BODY   … 2行目以降（改行区切り。秘密情報を含めないこと）
//   LW_CLIENT_ID / LW_CLIENT_SECRET / LW_SERVICE_ACCOUNT / LW_PRIVATE_KEY / LW_BOT_ID / LW_USER_ID
//
// 罠 #17: 時刻は必ず JST。

import crypto from "node:crypto";

const TOKEN_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";
const API_BASE = "https://www.worksapis.com/v1.0";

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が未設定です`);
  return v;
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jstStamp(date = new Date()) {
  const d = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const t = date.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false, hour: "2-digit", minute: "2-digit" });
  return `${d} ${t}`;
}

async function getAccessToken() {
  const clientId = required("LW_CLIENT_ID");
  const clientSecret = required("LW_CLIENT_SECRET");
  const serviceAccount = required("LW_SERVICE_ACCOUNT");
  const privateKey = required("LW_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "bot",
    }),
  });
  if (!res.ok) throw new Error(`LINE WORKS token取得失敗: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function sendDirectMessage(text) {
  const botId = required("LW_BOT_ID");
  const userId = required("LW_USER_ID");
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/bots/${botId}/users/${encodeURIComponent(userId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: { type: "text", text } }),
  });
  if (!res.ok) throw new Error(`LINE WORKS メッセージ送信失敗: HTTP ${res.status} ${await res.text()}`);
}

const title = required("NOTIFY_TITLE");
const body = (process.env.NOTIFY_BODY ?? "").trim();
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : "";
const message = [title, `時刻: ${jstStamp()}（JST）`, body, runUrl ? `ログ: ${runUrl}` : ""].filter(Boolean).join("\n");

console.log("--- 送信する本文 ---");
console.log(message);
console.log("--------------------");
await sendDirectMessage(message);
console.log("LINE WORKS への送信に成功しました");
