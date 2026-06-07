// T-069：求人検索の行動量・精度（当日・担当 uploadedByUserId）。
// ⚠️ グラフ/AI専用集計：archivedAt 条件を**付けない**（紹介保留＝BOOKMARK+archivedAt のため、
//    archivedAt=null だと D の約77% が保留に逃げて選定率が常時100%になる）。
//    既存 metrics.ts の jobSearched/jobIntroduced（archivedAt=null）とは別物。D は aiMatchRating の実値で判定。
// 選定率＝(A+B+C)÷合計BM（D・未評価は分子から除外。D は「見る目」の指標として母数に含める）。

import { prisma } from "@/lib/prisma";

export interface JobSearchDay {
  bmCount: number;
  exportCount: number;
  ratings: Record<string, number>;
  selectionRate: number | null;
}

export async function computeJobSearchDay(userId: string, dateStr: string): Promise<JobSearchDay> {
  const counts = await prisma.$queryRawUnsafe<{ bm: number; exp: number }[]>(`
    SELECT
      COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}')::int bm,
      COUNT(*) FILTER (WHERE (last_exported_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}')::int exp
    FROM candidate_files
    WHERE category = 'BOOKMARK' AND uploaded_by_user_id = '${userId}'`);
  const ratingRows = await prisma.$queryRawUnsafe<{ r: string; n: number }[]>(`
    SELECT COALESCE(NULLIF(ai_match_rating,''),'未評価') r, COUNT(*)::int n
    FROM candidate_files
    WHERE category = 'BOOKMARK' AND uploaded_by_user_id = '${userId}'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo')::date = DATE '${dateStr}'
    GROUP BY r`);
  const ratings: Record<string, number> = {};
  for (const row of ratingRows) ratings[row.r] = row.n;
  const bmCount = counts[0]?.bm ?? 0;
  const abc = (ratings["A"] ?? 0) + (ratings["B"] ?? 0) + (ratings["C"] ?? 0);
  const selectionRate = bmCount > 0 ? abc / bmCount : null;
  return { bmCount, exportCount: counts[0]?.exp ?? 0, ratings, selectionRate };
}
