// T-207: 配信テンプレートの CSV 取り込み（プレビュー / 実行）
// execute=false … 何件が新規・上書き・エラーかを返すだけ（DB は触らない）
// execute=true  … プレビューと同じ計画をそのまま書き込む
// 突き合わせのキーは「テンプレート名」。一致すれば上書き（テンプレート番号は維持）、一致しなければ新規採番。
// 1行でもエラーがあっても他の正常な行は取り込む（全体を止めない）。
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { formatTemplateNo } from "@/lib/scout-conditions/constants";
import { applyImportPlan, buildImportPlan, ensureTemplateSeqNos } from "@/lib/scout-conditions/templates";
import type { TemplateImportResponse } from "@/lib/scout-conditions/types";

export async function POST(request: NextRequest) {
  const actor = await getSessionUser();
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "リクエストボディが不正です" }, { status: 400 });
  const csv = typeof (body as Record<string, unknown>).csv === "string" ? ((body as Record<string, unknown>).csv as string) : "";
  const execute = (body as Record<string, unknown>).execute === true;
  if (!csv.trim()) return NextResponse.json({ error: "CSV が空です" }, { status: 400 });

  if (execute) await ensureTemplateSeqNos();

  const existing = await prisma.scoutTemplate.findMany({ select: { id: true, name: true, seqNo: true } });
  const plan = buildImportPlan(csv, existing);

  const result = execute ? await applyImportPlan(plan) : null;

  const res: TemplateImportResponse = {
    executed: execute,
    rows: plan.rows.map((r) => ({
      lineNo: r.lineNo,
      name: r.name,
      kind: r.kind ?? "",
      subject: r.subject,
      body: r.body,
      action: r.action,
      templateNo: formatTemplateNo(r.targetSeqNo),
    })),
    errors: result ? result.errors : plan.errors,
    createCount: plan.createCount,
    updateCount: plan.updateCount,
    created: result ? result.created : null,
    updated: result ? result.updated : null,
  };
  return NextResponse.json(res);
}
