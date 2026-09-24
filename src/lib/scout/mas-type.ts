/**
 * T-190 Step3-1: masType（開放日 / 通常）の判定を 1 か所に集約する。
 *
 * 判定式は `POST /api/scout/backfill-delivery-date` にあったものをそのまま移設したもので、
 * 一切変えていない:
 *   diffDays = 配信日 − マイナビ登録日（どちらも JST 暦日）
 *   0 <= diffDays <= 7 （境界含む） → "開放日" 、それ以外（<0 or >7）→ "通常"
 *
 * 片方でも欠けていたら null を返す。呼び出し側は null のとき masType を触らない
 * （＝今までどおり NULL のまま／既存値を保つ）。
 */

/** Date → "YYYY-MM-DD"（JST 暦日）。罠#17: toISOString().slice(0,10) は使わない。 */
function toJstYmd(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export function computeMasType(
  scoutDeliveryDate: Date | null | undefined,
  mynaviRegisteredDate: Date | null | undefined,
): string | null {
  if (!scoutDeliveryDate || !mynaviRegisteredDate) return null;
  const diffDays = Math.round(
    (Date.parse(toJstYmd(scoutDeliveryDate) + "T00:00:00Z")
      - Date.parse(toJstYmd(mynaviRegisteredDate) + "T00:00:00Z")) / 86_400_000,
  );
  return diffDays >= 0 && diffDays <= 7 ? "開放日" : "通常";
}
