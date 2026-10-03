// T-206: 生年月日の照合。
//   - ポータル内に求人マイページ用の照合処理は無い（照合は kyuujinPDF 側が birthday hash を持って行い、
//     portal は update-birthday API へ同期を投げるだけ）ため、ここで独立に実装する。
//   - 入力のゆれを吸収: 全角数字→半角、/・-・.・空白・「年月日」を除去して 8 桁（YYYYMMDD）にそろえる。
//   - 求職者側は Candidate.birthday（UTC 00:00 または 12:00 で保存されている）を JST の暦日で取り出す（罠#17）。

/** 全角数字→半角 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 入力文字列を "YYYYMMDD" に正規化する。できなければ null。
 *   "1990/4/15" "1990-04-15" "1990.04.15" "１９９００４１５" "1990年4月15日" "1990 04 15" → "19900415"
 */
export function normalizeBirthdateInput(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = toHalfWidthDigits(input).trim();
  if (!s) return null;
  // 区切りをすべて "-" にそろえる（年月日・/／・-－ー・.．・半角/全角空白）
  s = s.replace(/[年月日\/／\-－ー\.．\s　]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[0-9-]+$/.test(s)) return null;
  const parts = s.split("-").filter((p) => p.length > 0);
  let ymd: string | null = null;
  if (parts.length === 1) {
    if (parts[0].length === 8) ymd = parts[0];
  } else if (parts.length === 3) {
    const [y, m, d] = parts;
    if (y.length === 4 && m.length >= 1 && m.length <= 2 && d.length >= 1 && d.length <= 2) {
      ymd = `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}`;
    }
  }
  if (!ymd) return null;
  const mm = Number(ymd.slice(4, 6));
  const dd = Number(ymd.slice(6, 8));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return ymd;
}

/** Candidate.birthday → JST 暦日の "YYYYMMDD"。未登録は null */
export function candidateBirthdayYmd(birthday: Date | null | undefined): string | null {
  if (!birthday) return null;
  return birthday.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/-/g, "");
}

/** 入力と登録済み生年月日が一致するか */
export function birthdateMatches(input: unknown, birthday: Date | null | undefined): boolean {
  const a = normalizeBirthdateInput(input);
  const b = candidateBirthdayYmd(birthday);
  return !!a && !!b && a === b;
}
