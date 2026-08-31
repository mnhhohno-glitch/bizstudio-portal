import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * T-172 追補: 求職者の職歴（WorkHistory）を「会社名が入っている最新の面談レコード」1本から返す。
 *
 * WorkHistory は InterviewRecord にぶら下がる（面談ログ解析 analyze-with-intake / 面談入力フォームで保存済み）。
 * つまり **AI 呼び出し不要・同期のDB読み取りだけ** で会社名・在籍期間が得られる。
 * Googleフォーム作成依頼（/tasks/new）の会社カード初期表示がこれを使う。
 *
 * レコード選択: isLatest=true を最優先し、次に面談日の新しい順。
 * ただし「会社名が1件でも入っている」レコードに限る（空の下書きに引っ張られないため）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const { candidateId } = await params;

    const records = await prisma.interviewRecord.findMany({
      where: { candidateId },
      orderBy: [{ isLatest: "desc" }, { interviewDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        interviewDate: true,
        isLatest: true,
        workHistories: { orderBy: { order: "asc" } },
      },
    });

    const hasCompany = (name: string | null) => !!name && name.trim().length > 0;
    const source = records.find((r) => r.workHistories.some((w) => hasCompany(w.companyName)));

    if (!source) {
      return NextResponse.json({ interviewId: null, interviewDate: null, workHistories: [] });
    }

    const workHistories = source.workHistories
      .filter((w) => hasCompany(w.companyName))
      .map((w) => ({
        order: w.order,
        companyName: (w.companyName ?? "").trim(),
        // 在籍期間の表示文字列。入社年月があれば「2016-04〜2017-11」（在籍中は「〜現在」）、
        // 無ければ在籍年数（「1年7ヶ月」）にフォールバックする。
        period: buildPeriod(w.hireDate, w.leaveDate, w.tenureYear, w.tenureMonth),
        /** 職種のヒント（カテゴリ選択の判断材料。依頼JSONには保存しない） */
        jobTypeHint: [w.jobTypeFlag, w.jobTypeMemo]
          .map((s) => (s ?? "").trim())
          .filter(Boolean)
          .join(" / "),
      }));

    return NextResponse.json({
      interviewId: source.id,
      interviewDate: source.interviewDate.toISOString(),
      workHistories,
    });
  } catch (e) {
    console.error("[candidates/work-histories][GET] error:", e);
    return NextResponse.json(
      { error: `予期しないエラー: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

function buildPeriod(
  hireDate: string | null,
  leaveDate: string | null,
  tenureYear: number | null,
  tenureMonth: number | null,
): string {
  const hire = (hireDate ?? "").trim();
  const leave = (leaveDate ?? "").trim();
  if (hire) return `${hire}〜${leave || "現在"}`;
  const tenure = [
    tenureYear != null ? `${tenureYear}年` : null,
    tenureMonth != null ? `${tenureMonth}ヶ月` : null,
  ]
    .filter(Boolean)
    .join("");
  return tenure;
}
