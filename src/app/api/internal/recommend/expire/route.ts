import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";

// T-189 Phase 2a: 自動引き当てブックマークの承認待ち期限切れ。
//
// POST /api/internal/recommend/expire?dry_run=<true|false>&confirm=<true|false>
//   - 認証: x-api-key（INTERNAL_API_KEY）。analyze-submit / analyze-collect と同一。
//   - 二段ガード: 本実行は dry_run=false かつ confirm=true の時のみ。それ以外は件数のみ返す。
//   - 対象: approvalStatus="PENDING" かつ autoSourcedAt < now - 14日 → approvalStatus="EXPIRED"。
//   - archivedAt は触らない（from-job-platform の冪等判定 archivedAt IS NULL に掛かり続けることで、
//     同じ求人が再送されても新規行が作られない＝期限切れの再出現を防ぐ。Phase 0 §1-3）。

const EXPIRE_DAYS = 14;

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRunParam = sp.get("dry_run");
  const dryRun = dryRunParam === "1" || dryRunParam === "true";
  const confirmed = sp.get("confirm") === "true";
  const willExecute = !dryRun && confirmed;

  const cutoff = new Date(Date.now() - EXPIRE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const where = {
      approvalStatus: "PENDING",
      autoSourcedAt: { not: null, lt: cutoff },
    } as const;

    if (!willExecute) {
      const count = await prisma.candidateFile.count({ where });
      return NextResponse.json({
        willExecute,
        mode: "DRY-RUN",
        cutoff: cutoff.toISOString(),
        targets: count,
      });
    }

    const result = await prisma.candidateFile.updateMany({
      where,
      data: { approvalStatus: "EXPIRED" },
    });
    console.log(`[recommend/expire] expired=${result.count} (cutoff=${cutoff.toISOString()})`);
    return NextResponse.json({
      willExecute,
      mode: "EXECUTE",
      cutoff: cutoff.toISOString(),
      expired: result.count,
    });
  } catch (e) {
    console.error("[recommend/expire] 失敗:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
