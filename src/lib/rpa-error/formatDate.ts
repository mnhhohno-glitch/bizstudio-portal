/**
 * UTC日時をJST（Asia/Tokyo）に変換してフォーマットする
 * 形式: MM/DD HH:mm（例: 03/25 17:34）
 */
export function formatDateJST(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * UTC日時をJST（Asia/Tokyo）に変換してフルフォーマットする
 * 形式: YYYY/MM/DD HH:mm（例: 2026/03/25 17:34）
 */
export function formatDateTimeJST(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * UTC日時をJST（Asia/Tokyo）に変換して日付のみフォーマットする
 * 形式: YYYY/MM/DD（例: 2026/03/25）
 */
export function formatDateOnlyJST(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
