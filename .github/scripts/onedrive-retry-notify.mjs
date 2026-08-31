// T-159 Phase 2-c: OneDrive 夜間拾い直しが「失敗した」ことを知らせる LINE WORKS 通知
// （GitHub Actions から実行）。
//
// ★CA 向けの結果通知はここではない。処理結果（コピー完了件数・対応が必要な件数）は
//   portal 側 src/lib/onedrive-sync-notify.ts が CA チャンネルへ送る。
//   このスクリプトは「夜間処理そのものが動かなかった」を大野将幸ひとりの DM に流す運用アラート。
//   CA チャンネルに HTTP エラーを流しても誰も打つ手が無いため宛先を分ける。
//
// 認証・送信方式は .github/scripts/uptime-notify.mjs と同一（LINE WORKS API 2.0 / JWT Bearer /
// Bot → 個人 DM）。死活監視と同じ Secrets・同じ Bot・同じ宛先を使う。
//
// 罠 #17: 時刻は必ず JST。Actions ランナーは UTC なので toISOString() 系は使わない。

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

/** JST の "YYYY-MM-DD HH:MM"。uptime-notify.mjs と同じ流儀。 */
function jstStamp(date = new Date()) {
  const d = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const t = date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${d} ${t}`;
}

async function getAccessToken() {
  const clientId = required("LW_CLIENT_ID");
  const clientSecret = required("LW_CLIENT_SECRET");
  const serviceAccount = required("LW_SERVICE_ACCOUNT");
  const privateKey = required("LW_PRIVATE_KEY").replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 3600 }),
  );
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

  if (!res.ok) {
    throw new Error(`LINE WORKS メッセージ送信失敗: HTTP ${res.status} ${await res.text()}`);
  }
}

const message = [
  "【失敗】OneDrive 夜間コピーの拾い直しが実行できませんでした",
  `検知時刻: ${jstStamp()}（JST）`,
  `応答: ${process.env.HTTP_STATUS || "不明"}`,
  `実行: ${process.env.RUN_URL || "(不明)"}`,
  "",
  "書類のコピーが今夜は行われていません。次回の実行で拾い直されますが、",
  "続く場合は portal / Microsoft Graph 側を確認してください。",
].join("\n");

console.log("--- 送信する本文 ---");
console.log(message);
console.log("--------------------");

await sendDirectMessage(message);
console.log("LINE WORKS への送信に成功しました");
