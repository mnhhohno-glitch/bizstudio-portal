/**
 * T-064 Phase A: 配信数取り込みエクセルのフォーマット定数
 *
 * OneDrive 上の「07.スカウトメール送信結果報告_YYYYMMDD.xlsx」を
 * 想定したフォーマット定義。将来フォーマット変更時はここを修正する。
 */

export const SCOUT_EXCEL_FORMAT = {
  sheetName: "サマリ",
  // A列=送信時間, B〜G列=1〜6号機
  timeColumnIndex: 0, // A
  // machineNumber -> 列インデックス
  machineColumnMap: {
    1: 1, // B
    2: 2, // C
    3: 3, // D
    4: 4, // E
    5: 5, // F
    6: 6, // G
  } as Record<number, number>,
  // ヘッダ1行スキップ → データは row index 1 から
  dataStartRowIndex: 1,
  // 8:00 〜 19:00 の 12 行
  dataRowCount: 12,
  // 時間文字列パース（"8:00" → 8）
  parseHour: (raw: unknown): number | null => {
    if (typeof raw === "number") return Math.trunc(raw);
    if (typeof raw === "string") {
      const m = raw.match(/^(\d{1,2})(?::|時)/);
      if (m) return parseInt(m[1], 10);
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  },
};
