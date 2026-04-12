import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "true";

  // 2週間前の日付を計算
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // 対象抽出: entryFlag=求人紹介 かつ entryDate が2週間以上前 かつ isActive=true
  const targets = await prisma.jobEntry.findMany({
    where: {
      entryFlag: "求人紹介",
      isActive: true,
      entryDate: { lte: twoWeeksAgo },
    },
    select: {
      id: true,
      companyName: true,
      entryDate: true,
      candidate: { select: { name: true, candidateNumber: true } },
    },
  });

  const totalChecked = targets.length;

  // entryDate が null のものはスキップ（select で entryDate を取ったが where で lte を使っているので null は既に除外されている）
  // 安全策として追加チェック
  const toExpire = targets.filter((t) => t.entryDate !== null);
  const skipped = totalChecked - toExpire.length;

  // Log each target for audit
  for (const t of toExpire) {
    console.log(
      `[AUTO-EXPIRE] ${dryRun ? "[DRY-RUN] " : ""}Entry ${t.id} | ${t.candidate.name} (${t.candidate.candidateNumber}) | ${t.companyName} | entryDate=${t.entryDate?.toISOString()}`
    );
  }

  let expired = 0;

  if (!dryRun && toExpire.length > 0) {
    const result = await prisma.jobEntry.updateMany({
      where: { id: { in: toExpire.map((t) => t.id) } },
      data: {
        entryFlagDetail: "本人辞退",
        companyFlag: "辞退報告前",
        personFlag: "辞退受付済",
        isActive: false,
      },
    });
    expired = result.count;
  } else if (dryRun) {
    expired = toExpire.length;
  }

  return NextResponse.json({
    expired,
    skipped,
    total_checked: totalChecked,
    dry_run: dryRun,
    timestamp: new Date().toISOString(),
  });
}
