import jwt from "jsonwebtoken";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * LINE WORKS API 2.0 のアクセストークンを取得（キャッシュ付き）
 */
export async function getAccessToken(): Promise<string> {
  // キャッシュが有効ならそのまま返す（5分のマージン）
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const privateKey = process.env.LINEWORKS_PRIVATE_KEY;

  if (!clientId || !clientSecret || !serviceAccount || !privateKey) {
    throw new Error("LINE WORKS環境変数が設定されていません");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: clientId,
      sub: serviceAccount,
      iat: now,
      exp: now + 3600,
    },
    privateKey.replace(/\\n/g, "\n"),
    { algorithm: "RS256" }
  );

  const res = await fetch("https://auth.worksmobile.com/oauth2/v2.0/token", {
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
    const text = await res.text();
    throw new Error(`LINE WORKS token取得失敗: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return cachedToken.token;
}

/**
 * LINE WORKS Bot からトークルームにテキストメッセージを送信
 */
export async function sendBotMessage(
  botId: string,
  channelId: string,
  text: string
): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(
    `https://www.worksapis.com/v1.0/bots/${botId}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: { type: "text", text },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE WORKS メッセージ送信失敗: ${res.status} ${text}`);
  }
}
