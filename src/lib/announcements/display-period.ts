// T-159: お知らせ新着ポップアップの表示期間判定。
//
// 表示期間 = 「公開日」〜「公開日の翌営業日」（両端含む）。
//   例) 金曜公開 → 金・土・日・月に表示、火曜から非表示。
//       月曜が祝日なら翌営業日は火曜なので火曜まで表示。
//
// 日付はすべて JST 壁時計の "YYYY-MM-DD" 文字列で扱う（罠 #17）。
// この形式は辞書順＝時系列順なので、文字列比較でそのまま前後判定できる。

import { nextBusinessDayJst } from "@/lib/dailyReport/jstDate";

/**
 * today（JST日付文字列）が「publishedAt の当日〜翌営業日」の範囲に入るか。
 * 純粋関数（現在時刻を参照しない）。
 */
export function isWithinDisplayPeriod(
  publishedAtJstDate: string,
  todayJstDate: string
): boolean {
  if (!publishedAtJstDate || !todayJstDate) return false;
  // 公開日より前は当然表示しない
  if (todayJstDate < publishedAtJstDate) return false;
  if (todayJstDate === publishedAtJstDate) return true;
  return todayJstDate <= nextBusinessDayJst(publishedAtJstDate);
}
