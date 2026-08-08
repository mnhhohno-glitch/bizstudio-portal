/**
 * AI求人評価ランクの共通定義（T-146 Phase 2-2）
 *
 * 総合評価は A / B+ / B / C / D の5段階（良い順に A > B+ > B > C > D）。
 * 本人希望・通過率の2軸は A/B/C/D の4段階（B+ は使わない）。
 *
 * ★正規表現の設計上の制約★
 * 本番DBには幅表記のデータが残存する（「■ 総合：B〜C」等・2026-07-28 時点で168件）。
 * これらは再判定しない方針のため、読み取り側が幅表記を B+ と誤読してはならない。
 *   - 「B〜C」→ 従来どおり "B"（先頭1文字）と読む … 既存挙動の維持
 *   - 「B+」  → "B+" と読む
 * そのため交替は必ず「B\+ を先に試す」順序とし、`[ABCD]\+?` のような
 * 緩い書き方はしない（`A+` `C+` まで拾ってしまうため）。
 * `+` は正規表現のメタ文字なのでエスケープ必須。
 */

/** 評価値1つにマッチする正規表現フラグメント（B+ を先に試す交替）。キャプチャなし */
export const RATING_VALUE = "(?:B\\+|[ABCD])";

/**
 * 「評価値＋幅表記」にマッチするフラグメント（「B〜C」「A〜B」等）。キャプチャなし。
 *
 * ★除去専用★ — 読み取りには絶対に使わないこと。
 * 幅表記は 2026-07-17〜27 に生成された既存データに 164 件残っており、再判定しない方針。
 * 読み取り（extractAxis 等）は従来どおり先頭1文字を返す（「B〜C」→ "B"）必要があるため、
 * 読み取り側は RATING_VALUE のままとする。
 * 一方で評価行の除去（マイページ本人向け本文の生成）で RATING_VALUE を使うと
 * 「■ 総合：B」までしか消えず「〜C」が本文冒頭に残って求職者の画面に出てしまうため、
 * 除去側だけ幅表記の末尾まで飲み込む。
 */
export const RATING_VALUE_WITH_RANGE = `${RATING_VALUE}(?:\\s*[〜~]\\s*${RATING_VALUE})?`;

/** 良い順の並び。未定義キーは呼び出し側で末尾送りにする */
export const RANK_ORDER: Record<string, number> = { A: 0, "B+": 1, B: 2, C: 3, D: 4 };

/** RANK_ORDER に無い値（未評価・幅表記など）を末尾に送るための番兵 */
export const RANK_UNRANKED = 5;

/** 3軸マーカー行から指定軸の値を取り出す。見つからなければ null */
export function extractAxis(
  comment: string | null | undefined,
  label: "本人希望" | "通過率" | "総合",
  { requireMarker = true }: { requireMarker?: boolean } = {}
): string | null {
  if (!comment) return null;
  const marker = requireMarker ? "■\\s*" : "(?:■\\s*)?";
  const m = comment.match(new RegExp(`${marker}${label}[：:]\\s*(${RATING_VALUE})`));
  return m ? m[1] : null;
}

/** kyuujinPDF へ送るマッチラベル。3ファイルにコピーされていた実装を集約したもの */
export function toMatchLabel(rating: string | null): string {
  switch (rating) {
    case "A": return "◎ 非常にマッチ";
    case "B+": return "○ マッチ";
    case "B": return "○ マッチ";
    case "C":
    case "D": return "△ チャレンジ求人";
    default: return "";
  }
}
