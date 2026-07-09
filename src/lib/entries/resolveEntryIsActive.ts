import { INACTIVE_TRIGGERS } from "@/lib/constants/entry-flag-rules";

/**
 * T-140: 決着済み（＝これ以上進まず無効のまま維持すべき）entryFlagDetail の一覧。
 *
 * entry-flag-rules.ts の SELECTION_ENDED_DETAILS と同じ集合。あちらは「選考終了」表示判定に
 * 使われる定数（変更禁止ファイル）で、こちらは is_active 再計算の決着判定に使う。値を同期させる。
 * - 選考落ち / 本人辞退系 … 選考が終了して決着
 * - クローズ / 求人クローズ … 案件クローズで決着
 * ※「書類見送り」は entryFlagDetail 単独では決着に含めない。決着判定は personFlag 側
 *   （CONCLUDED_PERSON_FLAGS）で行う。
 */
export const CONCLUDED_ENTRY_FLAG_DETAILS = [
  "選考落ち",
  "本人辞退",
  "本人辞退_他社決",
  "本人辞退_自社他",
  "クローズ",
  "求人クローズ",
];

/**
 * T-141: 選考が終了している personFlag（見送り通知の送信有無に関わらず終了扱い）。
 *
 * T-140 では「見送り通知未送信 は通知送信という ToDo が残るので有効」と解釈して有効化したが、
 * 実運用では見送りが決まった時点で決着であり、通知送信の有無は一覧の有効／無効を左右しない。
 * この誤解釈により終了済み39件が CA の一覧に復活した（T-141 で切り戻し）。
 * 送信済（見送り通知送信済 / 見送り通知済み）は INACTIVE_TRIGGERS.personFlags 側で無効化される。
 */
export const CONCLUDED_PERSON_FLAGS = [
  "見送り通知未送信",
];

/**
 * T-140: 現在のフラグ状態から is_active のあるべき値を「双方向」で決定する純関数。
 *
 * 従来は各更新経路が「無効化トリガーに該当したら false」の一方通行しか持たず、一度 false に
 * なったエントリーが（面接日入力など）非トリガーな更新をされても false のまま取り残される
 * "sticky false" バグがあった。この関数はトリガー非該当なら true を返すため、正しい状態へ
 * 戻せる。全更新経路（一般PATCH / フラグPATCH / 一括フラグ / 段階自動進行）で使う。
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
  // 手動で is_active を明示指定した場合は無条件で尊重する
  if (typeof input.explicitIsActive === "boolean") return input.explicitIsActive;

  // ③ 求人紹介段階は応募前のため常に無効（自動失効・書類見送り等の異常組み合わせも含めて維持）
  if (input.entryFlag === "求人紹介") return false;

  // ② 決着済みは無効のまま維持
  if (input.entryFlagDetail && CONCLUDED_ENTRY_FLAG_DETAILS.includes(input.entryFlagDetail)) return false;
  if (input.personFlag && CONCLUDED_PERSON_FLAGS.includes(input.personFlag)) return false;

  // ① 無効化トリガー該当は無効
  if (input.personFlag && INACTIVE_TRIGGERS.personFlags.includes(input.personFlag)) return false;
  if (input.companyFlag && INACTIVE_TRIGGERS.companyFlags.includes(input.companyFlag)) return false;
  if (input.entryFlagDetail && INACTIVE_TRIGGERS.entryFlagDetails.includes(input.entryFlagDetail)) return false;

  // それ以外は有効（← ここが双方向。従来は false のまま放置だった）
  return true;
}
