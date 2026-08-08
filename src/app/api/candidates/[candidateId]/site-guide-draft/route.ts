import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildSiteGuideDraft } from "@/lib/site-guide-draft";

// T-158: 求人サイトURL発行モーダルの案内文「まとめた求人の説明」の自動下書き。
// 生成ロジックは src/lib/site-guide-draft.ts に集約。ここは認証と受け渡しのみ。
//
// レスポンス:
//   成功: { draft: "職種：…\n業種：\nエリア：…\n年収：…", generated: true,  isInterviewToday: boolean }
//   失敗: { draft: null, generated: false, reason: "no_jobs" 等, isInterviewToday: boolean }
// 失敗でも 200 で返す（クライアントはフォールバック固定文に差し替えるだけ）。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { candidateId } = await params;

  try {
    const result = await buildSiteGuideDraft(candidateId);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[site-guide-draft] failed:", e);
    return NextResponse.json({
      draft: null,
      generated: false,
      reason: "internal_error",
      isInterviewToday: false,
    });
  }
}
