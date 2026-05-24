/**
 * T-064 Phase A: 配信数取り込み API（OneDrive エクセル — multipart/form-data 版）
 *
 * POST /api/scout/import/daily-excel
 *   認証: x-rpa-secret ヘッダ
 *   リクエスト: multipart/form-data
 *     - file: エクセル（xlsx）
 *     - targetDate: "YYYY-MM-DD"
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
    const form = await req.formData();
    const file = form.get("file");
    const targetDateRaw = form.get("targetDate");

    if (!(file instanceof File)) {
      throw new Error("file は必須です（multipart/form-data）");
    }
    if (typeof targetDateRaw !== "string" || !targetDateRaw.trim()) {
      throw new Error("targetDate は必須です（YYYY-MM-DD）");
    }

    const arrayBuffer = await file.arrayBuffer();

    const result = await importDailyScoutExcel({
      fileBuffer: arrayBuffer,
      targetDate: targetDateRaw.trim(),
      fileName: file.name,
      importType: "DAILY_EXCEL",
    });

    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
