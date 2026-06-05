// T-073: 目標逆算（下から上へ）。クライアント・サーバ共用の純関数。
// 起点：承諾数 = 目標売上 ÷ 売上単価。
// 各段階の率（隣接段の比、0〜1）を手入力すると上段の必要数を算出。
//   内定 = 承諾 / 承諾率、書類通過 = 内定 / 内定率、エントリー = 書類通過 / 書類通過率、
//   紹介 = エントリー / エントリー率、面談 = 紹介 / 紹介率。
// 小数はそのまま保持する（整数に丸めない）。除数 0/未満は null（未確定）。

export interface ReverseCalcInput {
  targetRevenue: number;
  unitPrice: number;
  acceptanceRate: number; // 内定→承諾
  offerRate: number; // 書類通過→内定
  documentPassRate: number; // エントリー→書類通過
  entryRate: number; // 紹介→エントリー
  introductionRate: number; // 面談→紹介
}

export interface ReverseCalcResult {
  acceptanceCount: number | null;
  offerCount: number | null;
  documentPassCount: number | null;
  entryCount: number | null;
  introductionCount: number | null;
  interviewCount: number | null;
}

function divUp(numerator: number | null, rate: number): number | null {
  if (numerator === null || !Number.isFinite(numerator)) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return numerator / rate;
}

export function reverseCalc(input: ReverseCalcInput): ReverseCalcResult {
  const acceptanceCount =
    Number.isFinite(input.unitPrice) && input.unitPrice > 0 && Number.isFinite(input.targetRevenue)
      ? input.targetRevenue / input.unitPrice
      : null;
  const offerCount = divUp(acceptanceCount, input.acceptanceRate);
  const documentPassCount = divUp(offerCount, input.offerRate);
  const entryCount = divUp(documentPassCount, input.documentPassRate);
  const introductionCount = divUp(entryCount, input.entryRate);
  const interviewCount = divUp(introductionCount, input.introductionRate);
  return { acceptanceCount, offerCount, documentPassCount, entryCount, introductionCount, interviewCount };
}

/** すべての段階数が有限の数値として確定しているか（保存可能か）。 */
export function isComplete(r: ReverseCalcResult): boolean {
  return [
    r.acceptanceCount,
    r.offerCount,
    r.documentPassCount,
    r.entryCount,
    r.introductionCount,
    r.interviewCount,
  ].every((v) => v !== null && Number.isFinite(v));
}
