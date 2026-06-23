import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { parseEmployeeResume } from "@/lib/employee-resume-parser";

// T-098: 履歴書・入社書類をAIで読み取り、社員詳細タブのstateキーに合わせた仮入力用JSONを返す。
// admin 限定。DB/Drive 保存はしない（読み捨て）。
// T-098 追補: 複数ファイル（files[]）を1リクエストでまとめて解析可能（後方互換: 単一 file も受理）。

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 1ファイルあたり10MB
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 合計30MB
const MAX_FILES = 5;

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
    // 複数ファイル（files[]）優先。空なら後方互換で単一 file を見る。
    let files = formData.getAll("files").filter((v): v is File => v instanceof File);
    if (files.length === 0) {
      const single = formData.get("file");
      if (single instanceof File) files = [single];
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `一度に解析できるのは ${MAX_FILES} ファイルまでです` },
        { status: 400 },
      );
    }

    let total = 0;
    for (const f of files) {
      if (!ALLOWED_MIME.has(f.type)) {
        return NextResponse.json(
          { error: "対応形式: PDF / Word / 画像（PNG/JPEG/WebP/HEIC）" },
          { status: 400 },
        );
      }
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: "各ファイルは10MB以下にしてください" },
          { status: 400 },
        );
      }
      total += f.size;
    }
    if (total > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        { error: "合計ファイルサイズは30MB以下にしてください" },
        { status: 400 },
      );
    }

    const inputs = await Promise.all(
      files.map(async (f) => ({
        buffer: Buffer.from(await f.arrayBuffer()),
        mimeType: f.type,
      })),
    );
    const result = await parseEmployeeResume(inputs);
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
