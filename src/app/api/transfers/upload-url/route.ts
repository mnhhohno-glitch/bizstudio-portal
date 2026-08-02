// T-147: ブラウザ → Supabase 直接アップロード用の署名付きアップロードURL発行。
// ファイル本体を portal サーバー経由で流さない（Railway 転送量・メモリ対策）。
// サービスロールキーはサーバーにのみ存在し、ブラウザへは署名付きURL（バケット/パス限定・短命）だけを渡す。
//
// middleware は /api/ を素通しするため、認証はこのルートで行う（漏れ禁止）。

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { randomUUID } from "crypto";
import {
  SECURE_TRANSFER_BUCKET,
  MAX_TRANSFER_FILE_SIZE,
} from "@/lib/secure-transfer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    fileName?: string;
    fileSize?: number;
  } | null;

  const fileName = body?.fileName?.trim();
  const fileSize = body?.fileSize;

  if (!fileName) {
    return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  }
  if (typeof fileSize !== "number" || fileSize <= 0) {
    return NextResponse.json({ error: "fileSize is required" }, { status: 400 });
  }
  if (fileSize > MAX_TRANSFER_FILE_SIZE) {
    return NextResponse.json(
      { error: "ファイルサイズが1GBを超えています" },
      { status: 400 }
    );
  }

  // 元ファイル名はパスに入れない（日本語名・記号対策）。拡張子のみ英数に絞って引き継ぐ。
  const ext = (fileName.split(".").pop() || "bin")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 10) || "bin";
  const storagePath = `transfers/${randomUUID()}.${ext}`;

  const { data, error } = await getSupabase()
    .storage.from(SECURE_TRANSFER_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("[T-147] createSignedUploadUrl failed:", error);
    return NextResponse.json(
      { error: "アップロードURLの発行に失敗しました" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
  });
}
