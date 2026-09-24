/**
 * T-201: スカウト開封（既読）行を配信枠の「日 × 時間帯」バケットへ振り分けるルール。
 *
 * ★このルールは配信数（deliveryCount）側と完全に同一でなければならない。
 *   分子（開封数）と分母（配信数）で違うバケットを使うと開封率が壊れるため、
 *   独自ルールを足さないこと。変更するときは配信数側と同時に直す。
 *
 *   0〜7時  → その日の 8時枠（早朝送信は8時枠へ畳み込む）
 *   8〜19時 → その時間の枠（1:1）
 *   20〜23時 → 翌日の 8時枠
 *
 * 配信数側の根拠（portal 内で確認できた分）:
 *   - `scripts/restore-scout-delivery-t135.ts` の `foldToSlots()`
 *     「早朝(8時未満)を8時枠へ畳み込み、hourSlot 8〜19 の格納値を返す」
 *     → 0〜7時 → 8時枠 / 8〜19時 → 1:1 はここで確認できる。
 *   - 配信枠は `HOUR_SLOTS = [8..19]` の12枠のみ（`src/lib/scout/slot-helpers.ts`）。
 *
 *   20〜23時 → 翌日8時枠 の半分は portal 内のコードでは確認できない。
 *   夜間の配信実績集計は PAD 側の PowerShell（`06.送信結果蓄積ファイル_X号機.xlsx` を読む）が
 *   バケット済みの `{machineNumber, hourSlot, deliveryCount}` を作って
 *   `POST /api/scout/import/aggregated` へ送ってくるため、畳み込み自体が portal の外にある。
 *   portal 内で 20時以降を扱っている唯一の箇所は FM 全量入替スクリプト
 *   `scripts/replace-slots-from-fm-t135.ts:199`（`hour >= 20` を除外）で、こちらは「翌日8時枠へ送る」
 *   ではなく「捨てる」挙動。1回限りの移行スクリプトなので夜間集計の規約とは別物と判断したが、
 *   PAD 側 PowerShell の実装は未確認。
 */

/** 配信枠として存在する時間帯（開始時刻）。8〜19 の12枠のみ。 */
export const SLOT_HOUR_MIN = 8;
export const SLOT_HOUR_MAX = 19;

export type OpenBucket = {
  /** JST 暦日を UTC 00:00 で表現した Date（ScoutDeliverySlot.deliveryDate と同じ持ち方） */
  deliveryDate: Date;
  /** 8〜19 */
  hourSlot: number;
  /** 元の行が targetDate の翌日枠へ送られたか（20〜23時の行） */
  spilledToNextDay: boolean;
};

/** JST 暦日 "YYYY-MM-DD" を UTC 00:00 の Date へ */
export function jstDateFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date（UTC 00:00 表現の JST 暦日）→ "YYYY-MM-DD"。罠#17: toISOString().slice(0,10) は使わない。 */
export function ymdFromJstDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "UTC" });
}

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * JST の「暦日 + 時」を配信枠バケットへ振り分ける。
 * @param ymd  スカウト日の JST 暦日 "YYYY-MM-DD"
 * @param hour スカウト時刻の「時」(0〜23、JST)
 */
export function bucketOpenRow(ymd: string, hour: number): OpenBucket | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const day = jstDateFromYmd(ymd);
  if (isNaN(day.getTime())) return null;

  // 20〜23時 → 翌日の8時枠
  if (hour > SLOT_HOUR_MAX) {
    return { deliveryDate: addDaysUtc(day, 1), hourSlot: SLOT_HOUR_MIN, spilledToNextDay: true };
  }
  // 0〜7時 → その日の8時枠
  if (hour < SLOT_HOUR_MIN) {
    return { deliveryDate: day, hourSlot: SLOT_HOUR_MIN, spilledToNextDay: false };
  }
  // 8〜19時 → その時間の枠
  return { deliveryDate: day, hourSlot: hour, spilledToNextDay: false };
}

/**
 * "YYYY-MM-DD HH:MM" / "YYYY/MM/DD HH:MM" 等から JST の暦日と時を取り出す。
 * 時刻が無い行はバケットを決められないので null（＝skipped）にする。推測で埋めない。
 * （`scout-history` の parseScoutDate と同じ緩い区切りを受ける）
 */
export function parseScoutDateTime(raw: string): { ymd: string; hour: number } | null {
  const m = raw.match(/(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})[:：時](\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const hh = parseInt(m[4], 10);
  const mi = parseInt(m[5], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59) return null;
  // 桁溢れ（2026-02-31 等）を弾く
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const ymd = `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { ymd, hour: hh };
}
