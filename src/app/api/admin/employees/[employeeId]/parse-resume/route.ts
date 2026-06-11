import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { parseEmployeeResumeWithGemini } from "@/lib/employee-resume-parser";

// T-098: 履歴書・入社書類をAIで読み取り、社員詳細タブのstateキーに合わせた仮入力用JSONを返す。
// admin 限定。DB/Drive 保存はしない（読み捨て）。

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // employeeId は permission/監査の意味合い（処理自体は employee に依存しない）
  await params;

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "AI機能が設定されていません" }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: "対応形式: PDF / Word / 画像（PNG/JPEG/WebP/HEIC）" },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "ファイルサイズは10MB以下にしてください" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseEmployeeResumeWithGemini(buffer, file.type);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[admin/employees/parse-resume] error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `AI解析に失敗しました: ${msg}` },
      { status: 500 },
    );
  }
}
