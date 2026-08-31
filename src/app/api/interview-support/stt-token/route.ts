// T-183 Phase 4: Deepgram 文字起こし用の一時トークン発行API。
// ブラウザから Deepgram の WebSocket へ直接接続するため、永続キー（DEEPGRAM_API_KEY）は
// サーバー側にのみ置き、短時間有効のアクセストークン（JWT）だけをクライアントへ返す。
// - DEEPGRAM_API_KEY 未設定 or 発行失敗時は { available: false } を返し、
//   クライアントは Chrome 内蔵の Web Speech API（useSpeechTranscription）へフォールバックする。
// - 画面起動時のエンジン判定と、接続断からの再接続のたびに呼ばれる（トークンは接続時のみ必要）。

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

// 発行するトークンの有効期間(秒)。WebSocket の初回接続時にだけ有効なら足りるため短くする。
const TOKEN_TTL_SECONDS = 60;
// Deepgram 側の応答待ちの上限(ms)。遅い時は内蔵方式に倒して面談開始を待たせない。
const GRANT_TIMEOUT_MS = 5_000;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return NextResponse.json({ available: false });

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[stt-token] Deepgram auth/grant failed: ${res.status}`);
      return NextResponse.json({ available: false });
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      console.error("[stt-token] Deepgram auth/grant returned no access_token");
      return NextResponse.json({ available: false });
    }
    return NextResponse.json({
      available: true,
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? TOKEN_TTL_SECONDS,
    });
  } catch (e) {
    console.error("[stt-token] Deepgram auth/grant error:", e);
    return NextResponse.json({ available: false });
  }
}
