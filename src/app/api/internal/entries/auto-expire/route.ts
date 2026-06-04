import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateInternalApiKey } from "@/lib/internal-auth";
import { recalculateSubStatusIfAuto } from "@/lib/support-sub-status";

const CHUNK_SIZE = 50;

// 暦1ヶ月前を JST 基準で算出し、その JST 日付の終わり（= 翌JST日 00:00 = 同日UTC 15:00）を
// 排他的上限として返す。entryDate < この値 のレコードは「JST 暦日が1ヶ月以上前」と判定できる。
// Railway 本番は UTC タイムゾーンのため、`new Date()` のローカル月計算は使わない（Pitfall #17）。
function getOneMonthAgoCutoffJst(now: Date): Date {
  const jstYmd = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const [y, m, d] = jstYmd.split("-").map(Number);
  // m は 1-indexed。1ヶ月前の月インデックス（Date.UTC は 0-indexed）は m - 2。
  // 月オーバーフロー（例: 5/31 - 1月 → 4/31 = 5/1）は Date.UTC が自動で繰り上げる。
  return new Date(Date.UTC(y, m - 2, d, 15, 0, 0, 0));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get("dry_run") === "true";
  const confirmed = sp.get("confirm") === "true";
  // 二段ガード: 本番書き換えは dry_run=false かつ confirm=true の両方が揃った時のみ
  const willExecute = !dryRun && confirmed;

  const cutoff = getOneMonthAgoCutoffJst(new Date());

  const targets = await prisma.jobEntry.findMany({
    where: {
      entryFlag: "求人紹介",
      isActive: true,
      entryDate: { lt: cutoff },
    },
    select: {
      id: true,
      candidateId: true,
      companyName: true,
      entryDate: true,
      candidate: { select: { name: true, candidateNumber: true } },
    },
    orderBy: { entryDate: "asc" },
  });

  const totalChecked = targets.length;
  const toExpire = targets.filter((t) => t.entryDate !== null);
  const skipped = totalChecked - toExpire.length;

  let expired = 0;
  const chunkLog: { chunkIndex: number; size: number; durationMs: number }[] = [];
  const startedAt = Date.now();

  if (willExecute && toExpire.length > 0) {
    const chunks = chunk(toExpire, CHUNK_SIZE);
    for (let i = 0; i < chunks.length; i++) {
      const cStart = Date.now();
      const ids = chunks[i].map((t) => t.id);
      // 「未応募」化: entryFlagDetail のみ更新し isActive=false で一覧から外す。
      // 「本人辞退」系の companyFlag / personFlag は実態（応募に至っていない）と合わないためセットしない。
      const result = await prisma.jobEntry.updateMany({
        where: { id: { in: ids } },
        data: {
          entryFlagDetail: "未応募",
          isActive: false,
        },
      });
      expired += result.count;
      chunkLog.push({ chunkIndex: i + 1, size: ids.length, durationMs: Date.now() - cStart });
    }

    // recalculateSubStatusIfAuto は candidateId 単位で重複排除してから呼ぶ
    const uniqueCandidateIds = [...new Set(toExpire.map((t) => t.candidateId))];
    for (const candidateId of uniqueCandidateIds) {
      try {
        await recalculateSubStatusIfAuto(candidateId);
      } catch (e) {
        console.error("[auto-expire] recalculateSubStatusIfAuto failed:", e);
      }
    }
  } else {
    // dry-run / 計算のみ（confirm=true が無い場合も含む）。DB は触らない。
    expired = toExpire.length;
  }

  const totalDurationMs = Date.now() - startedAt;

  for (const t of toExpire) {
    console.log(
      `[AUTO-EXPIRE] ${willExecute ? "" : "[CALC-ONLY] "}Entry ${t.id} | ${t.candidate.name} (${t.candidate.candidateNumber}) | ${t.companyName} | entryDate=${t.entryDate?.toISOString()}`
    );
  }

  const samples = toExpire.slice(0, 10).map((t) => ({
    id: t.id,
    candidateName: t.candidate.name,
    candidateNumber: t.candidate.candidateNumber,
    companyName: t.companyName,
    entryDate: t.entryDate?.toISOString() ?? null,
  }));

  return NextResponse.json({
    expired,
    skipped,
    total_checked: totalChecked,
    dry_run: dryRun,
    confirmed,
    executed: willExecute,
    cutoff: cutoff.toISOString(),
    oldest_entry_date: toExpire[0]?.entryDate?.toISOString() ?? null,
    newest_target_entry_date: toExpire[toExpire.length - 1]?.entryDate?.toISOString() ?? null,
    chunk_size: CHUNK_SIZE,
    chunks_run: chunkLog.length,
    chunk_log: chunkLog,
    total_duration_ms: totalDurationMs,
    samples,
    timestamp: new Date().toISOString(),
  });
}
