/**
 * T-064 Phase A 補強: 配信数取り込み API（Base64 JSON 版）
 *
 * POST /api/scout/import/daily-excel-base64
 *   認証: x-rpa-secret ヘッダ
 *   Content-Type: application/json
 *   リクエスト:
 *     { "fileBase64": "...", "targetDate": "YYYY-MM-DD", "fileName": "xxx.xlsx" }
 *
 * Power Automate Cloud Flow から multipart/form-data を組み立てるのが
 * 複雑なため、Base64 文字列で送れる派生 API として追加。
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRpaSecret } from "@/lib/mynavi-rpa/auth";
import { importDailyScoutExcel } from "@/lib/scout/daily-excel-importer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!verifyRpaSecret(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { fileBase64, targetDate, fileName } = body as {
      fileBase64?: string;
      targetDate?: string;
      fileName?: string;
    };

    if (!fileBase64 || typeof fileBase64 !== "string") {
      return NextResponse.json(
        { error: "fileBase64 は必須です（Base64 エンコード済み xlsx）" },
        { status: 400 },
      );
    }
    if (!targetDate || typeof targetDate !== "string" || !targetDate.trim()) {
      return NextResponse.json(
        { error: "targetDate は必須です（YYYY-MM-DD）" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(fileBase64, "base64");
    const arrayBuffer = new Uint8Array(buffer).buffer;

    const result = await importDailyScoutExcel({
      fileBuffer: arrayBuffer,
      targetDate: targetDate.trim(),
      fileName: fileName ?? "upload.xlsx",
      importType: "DAILY_EXCEL_BASE64",
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
