import { NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(request: Request) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "LINE_CHANNEL_SECRET未設定" }, { status: 500 });
  }

  // 署名検証
  const signature = request.headers.get("x-line-signature");
  const bodyText = await request.text();

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(bodyText)
    .digest("base64");

  if (signature !== expectedSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const body = JSON.parse(bodyText);

  for (const event of body.events ?? []) {
    if (event.type === "follow") {
      // 友だち追加イベント
      const lineUserId = event.source?.userId;
      if (lineUserId) {
        console.log(`LINE友だち追加: ${lineUserId}`);
        // 将来: LIFF連携またはリッチメニューで社員NOと紐付け
      }
    }
  }

  return NextResponse.json({ status: "ok" });
}
