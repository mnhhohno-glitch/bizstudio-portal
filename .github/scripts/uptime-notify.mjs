// T-160: 死活監視の LINE WORKS 通知送信スクリプト（GitHub Actions から実行）。
//
// なぜ portal の API を呼ばずここで直接送るのか:
//   portal が落ちている時に鳴らすための通知なので、portal 経由にすると
//   肝心の障害時に通知が飛ばない。認証からメッセージ送信まで自己完結させる。
//
// 認証は portal の src/lib/lineworks.ts と同一方式（LINE WORKS API 2.0 / JWT Bearer）。
// ただし jsonwebtoken に依存すると Actions 側で npm install が要るため、
// node:crypto で RS256 の JWT を直接組み立てている（署名内容は同じ）。
//
// 送信先はトークルームではなく「Bot → 個人ユーザーの DM」。
//   POST /v1.0/bots/{botId}/users/{userId}/messages
// 障害アラートを CA 全員のトークルームに流すと通常業務のノイズになるため、
// 宛先は大野将幸ひとりに固定する（userId は GitHub Secrets で渡す）。
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

/**
 * JST の "YYYY-MM-DD HH:MM" を返す。
 * 罠 #17: toISOString() は UTC 基準で9時間ずれるので使わない。
 * 日付は sv-SE ロケール（= YYYY-MM-DD 形式）、時刻は en-GB（= 24時間表記）で取る。
 * これは portal 側 src/lib/dailyReport/jstDate.ts と同じ流儀。
 */
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
  // Railway 側の値は改行が \n 文字列で入っているため復元する（portal 側と同じ処理）。
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

  if (!res.ok) {
    // レスポンス本文には assertion 等の秘密情報は含まれないが、
    // 念のためステータスコードのみをエラーにする。
    throw new Error(`LINE WORKS token取得失敗: HTTP ${res.status}`);
  }
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

function buildMessage() {
  const mode = required("MODE");
  const url = process.env.TARGET_URL ?? "";

  if (mode === "down") {
    return [
      "【障害検知】bizstudio-portal が応答していません",
      `発生時刻: ${jstStamp()}（JST）`,
      `状態: ${process.env.STATUS_TEXT || "応答なし"}`,
      `URL: ${url}`,
    ].join("\n");
  }

  if (mode === "up") {
    const minutes = Number(process.env.DOWN_MINUTES);
    const duration = Number.isFinite(minutes) && minutes > 0 ? `約${minutes}分` : "不明";
    return [
      "【復旧】bizstudio-portal が正常に戻りました",
      `復旧時刻: ${jstStamp()}（JST）`,
      `停止していた時間: ${duration}`,
    ].join("\n");
  }

  throw new Error(`MODE は down か up のみ: ${mode}`);
}

const message = buildMessage();
// 本文には秘密情報を含めないので、Actions のログに出して後から追跡できるようにする。
console.log("--- 送信する本文 ---");
console.log(message);
console.log("--------------------");

await sendDirectMessage(message);
console.log("LINE WORKS への送信に成功しました");
