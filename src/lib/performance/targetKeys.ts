// 実績表の「目標」段階キー。weekly / monthly の両 API が共有する単一定義。
//
// 以前は weekly/route.ts と monthly/route.ts が同じ定義を各自コピーして持っており、
// 片方（weekly）にだけ revenue を足した結果、当月実績タブ（monthly）で決定粗利の目標が
// 出ないという不具合が起きた。定義を分けるとこの種のドリフトが再発するため、ここに集約する。

import type { WeeklyMatrix } from "@/lib/performance/weeklyMatrix";

export type TKey =
  | "interviewTotal" | "interviewFirst" | "interviewExisting"
  | "proposalUniq" | "entryUniq"
  | "documentPass" | "offer" | "acceptance"
  | "revenue" | "unitPrice";

export const TKEYS: TKey[] = [
  "interviewTotal", "interviewFirst", "interviewExisting",
  "proposalUniq", "entryUniq",
  "documentPass", "offer", "acceptance",
  "revenue", "unitPrice",
];

// 週按分する対象（面談各行・紹介・エントリーのみ）。
// 書類通過以降・決定粗利・粗利単価は月単位の目標なので週列には出さない（false）。
// false でも合計列の目標（totalTargets）は出る点に注意。
export const WEEK_ALLOCATED: Record<TKey, boolean> = {
  interviewTotal: true, interviewFirst: true, interviewExisting: true, proposalUniq: true, entryUniq: true,
  documentPass: false, offer: false, acceptance: false, revenue: false, unitPrice: false,
};

// PerformanceTarget 行 → 段階の目標値。interviewTotal=初回+既存、revenue=目標粗利、unitPrice=単価。未設定は null。
export type TargetRowLike = {
  interviewCount: number; existingInterviewCount: number | null; introductionCount: number; entryCount: number;
  documentPassCount: number; offerCount: number; acceptanceCount: number; targetRevenue: number; unitPrice: number;
};

export function targetValueOf(t: TargetRowLike, key: TKey): number | null {
  switch (key) {
    case "interviewTotal": return (t.interviewCount ?? 0) + (t.existingInterviewCount ?? 0);
    case "interviewFirst": return t.interviewCount;
    case "interviewExisting": return t.existingInterviewCount;
    case "proposalUniq": return t.introductionCount;
    case "entryUniq": return t.entryCount;
    case "documentPass": return t.documentPassCount;
    case "offer": return t.offerCount;
    case "acceptance": return t.acceptanceCount;
    case "revenue": return t.targetRevenue;
    case "unitPrice": return t.unitPrice;
  }
}

export function actualOf(m: WeeklyMatrix, key: TKey): number {
  switch (key) {
    case "interviewTotal": return m.interview.total;
    case "interviewFirst": return m.interview.first;
    case "interviewExisting": return m.interview.thirdPlus;
    case "proposalUniq": return m.proposal.total.uniq;
    case "entryUniq": return m.entry.total.uniq;
    case "documentPass": return m.selection.documentPass;
    case "offer": return m.selection.offer;
    case "acceptance": return m.selection.acceptance;
    case "revenue": return m.selection.decidedRevenue ?? 0;
    case "unitPrice": return m.selection.decidedUnitPrice ?? 0;
  }
}

// 達成率＝実績÷目標。目標が null / 0 以下なら null（画面では「—」）。
export function rate(num: number, den: number | null): number | null {
  return den == null || den <= 0 ? null : num / den;
}
