/**
 * 担当RC（スカウト配信者）表示専用フォーマッタ
 *
 * ⚠️⚠️⚠️ 表示専用（VIEW-ONLY）。⚠️⚠️⚠️
 * 「RPA ●号機」表記を画面表示するときだけ実名へ変換するためのヘルパ。
 *
 * 戻り値を以下に使ってはならない（号機表記のまま扱うこと）:
 *   - DB保存 / 更新の値（recruiterName / machineId 等への書き込み）
 *   - API リクエスト / レスポンスのデータ本体
 *   - 集計・突合・ソート・フィルタの比較キー / グルーピングキー
 *   - マスタ照合（ScoutMachineMaster の aliases 等）
 *
 * recruiterName / machineId の号機表記は配信実績の自動集計・配信枠突合の
 * キーとして現役で使われている。値を書き換えると集計が壊れる。
 * このフォーマッタは「画面に出す瞬間」だけ通すこと。
 */

// 号機番号 → 実名 の対応表（表示用）
const MACHINE_NUMBER_TO_REAL_NAME: Record<string, string> = {
  "1": "藤本 なつみ",
  "2": "岡田 かなこ",
  "3": "上原 ちはる",
  "4": "上原 千遥",
  "5": "岡田 愛子",
  "6": "安藤 嘉富",
};

// 全角数字→半角
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}

/**
 * 「●号機」表記を実名へ変換して返す（表示専用）。
 * 号機表記が含まれなければ入力をそのまま返す。
 *
 * 揺れ吸収:
 *  - 接頭辞「RPA」の有無（"RPA 1号機" / "RPA1号機" / "1号機"）
 *  - 半角/全角の数字（"1号機" / "１号機"）
 *  - 前後・途中のスペース揺れ（半角/全角スペース）
 */
export function formatRecruiterName(value: string | null | undefined): string {
  if (value == null) return value ?? "";
  const original = value;
  // 正規化: 全角数字→半角, 半角/全角スペース除去
  const normalized = toHalfWidthDigits(original).replace(/[\s　]+/g, "");
  const match = normalized.match(/([1-6])号機/);
  if (!match) return original;
  const realName = MACHINE_NUMBER_TO_REAL_NAME[match[1]];
  return realName ?? original;
}
