import { INACTIVE_TRIGGERS } from "@/lib/constants/entry-flag-rules";

/**
 * エントリーの is_active のあるべき値を、現在のフラグ状態から双方向に判定する。
 *
 * 無効になるのは次の4条件のみ（運用ルール・2026-07 確定）:
 *   1. personFlag が INACTIVE_TRIGGERS.personFlags に該当（本人へ通知済み）
 *   2. companyFlag が INACTIVE_TRIGGERS.companyFlags に該当（企業へ辞退報告済み）
 *   3. entryFlag が "求人紹介"（求人紹介段階は全件無効）
 *   4. entryFlag が "エントリー" かつ personFlag が "辞退受付済"（エントリー段階は
 *      企業対応が存在しないため、本人への辞退受付完了だけで無効化する）
 *
 * 上記以外はすべて有効。選考落ち・本人辞退・クローズ等の「結果」では無効化しない。
 * 本人／企業への連絡が完了して初めて無効になる。
 *
 * 双方向：トリガー非該当なら true を返すため、一度 false になったエントリーが非トリガーな
 * 更新をされても false のまま取り残される "sticky false" を起こさない。全更新経路で使う。
 *
 * @param input 更新後の最終フラグ状態（リクエスト値 ?? 既存値 でマージ済みの値を渡すこと）。
 *   explicitIsActive が boolean の場合は手動編集とみなし最優先で尊重する。
 */
export function resolveEntryIsActive(input: {
  entryFlag?: string | null;
  entryFlagDetail?: string | null;
  companyFlag?: string | null;
  personFlag?: string | null;
  explicitIsActive?: boolean; // リクエストに is_active が明示された場合のみ
}): boolean {
  // 手動で is_active を明示指定された場合は最優先で尊重
  if (typeof input.explicitIsActive === "boolean") return input.explicitIsActive;

  // 3. 求人紹介段階は全件無効
  if (input.entryFlag === "求人紹介") return false;

  // 1. 本人へ通知済み
  if (input.personFlag && INACTIVE_TRIGGERS.personFlags.includes(input.personFlag)) return false;

  // 2. 企業へ辞退報告済み
  if (input.companyFlag && INACTIVE_TRIGGERS.companyFlags.includes(input.companyFlag)) return false;

  // 4. エントリー段階の本人辞退：企業対応（連絡フロー）が存在しない段階なので、
  //    本人への辞退受付完了だけで無効化する。書類選考以降は従来どおり企業側「辞退報告済」を待つ。
  if (input.entryFlag === "エントリー" && input.personFlag === "辞退受付済") return false;

  // entry-flag-rules.ts 側で entryFlagDetail のトリガーが定義されている場合のみ従う
  if (input.entryFlagDetail && INACTIVE_TRIGGERS.entryFlagDetails.includes(input.entryFlagDetail)) return false;

  return true;
}
