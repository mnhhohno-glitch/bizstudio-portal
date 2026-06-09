// T-069/T-092：求人検索の行動量・精度（当日・担当 uploadedByUserId）。
// ⚠️ グラフ/AI専用集計：archivedAt 条件を**付けない**。当日BM（bmCount）＝紹介保留含む全BOOKMARK。
//    既存 metrics.ts の jobSearched/jobIntroduced（archivedAt=null）とは別物。
//
// T-092 選定率の定義変更：
//   選定率 ＝ 出力数 ÷ (BM数 + 紹介保留数)
//          ＝ 出力数 ÷ 当日の全BOOKMARK（archived問わず）＝ exportCount ÷ bmCount
//   - 分子 exportCount：lastExportedAt 当日の出力数。D評価でも出力するため aiMatchRating で絞らない。
//   - 分母 bmCount：createdAt 当日の全BOOKMARK。archivedAt=null（BM数）＋ archivedAt≠null（紹介保留数）の合計。
//     （bmCount は archivedAt 無条件なので、その値が BM数+紹介保留数 と一致する＝SQL検証済み・一致=true）
//   旧定義は (A+B+C)÷合計BM（aiMatchRating ベース・D/未評価を分子から除外）だった。
//   aiMatchRating の構成比（ratings）は ABCD 円グラフ用に従来どおり返す（円の表示は不変）。

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
  const bmCount = counts[0]?.bm ?? 0;       // 当日の全BOOKMARK（BM数＋紹介保留数）＝分母
  const exportCount = counts[0]?.exp ?? 0;  // 当日の出力数（D含む全出力）＝分子
  // T-092: 選定率＝出力数÷(BM数+紹介保留数)。分母0（当日BMなし）は null で安全に。
  const selectionRate = bmCount > 0 ? exportCount / bmCount : null;
  return { bmCount, exportCount, ratings, selectionRate };
}
