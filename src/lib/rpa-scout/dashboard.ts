// RPAスカウト 配信条件ダッシュボードの共有定義
// - API(集計)とクライアント(表示・プロンプト書き出し)の両方から使う純関数のみ
// - ログ→パターンの紐付けは「patternId優先、無ければパターン名の完全一致」（最終使用日時表示と同方式）

// 検索件数下降アラートの閾値（直近2回比較で -15% 超の下降を検知。調整はここだけ変える）
export const SEARCH_COUNT_DROP_THRESHOLD = 0.15;

// 予実（想定件数 vs 実績）の達成率しきい値。カレンダーのチップとダッシュボードで共用するため、
// 調整はこの2定数だけを変える
export const ACHIEVEMENT_WARN = 0.8; // これ未満で琥珀
export const ACHIEVEMENT_ALERT = 0.5; // これ未満で赤

export type AchievementLevel = "ok" | "warn" | "alert";

// 達成率の水準。想定が0以下（＝目標として意味を持たない）は判定しない
export function achievementLevel(actual: number, expected: number): AchievementLevel {
  if (expected <= 0) return "ok";
  const ratio = actual / expected;
  if (ratio < ACHIEVEMENT_ALERT) return "alert";
  if (ratio < ACHIEVEMENT_WARN) return "warn";
  return "ok";
}

// 達成率（%）。想定が0以下なら算出不能で null
export function achievementPct(actual: number, expected: number): number | null {
  return expected > 0 ? Math.round((actual / expected) * 100) : null;
}

export const UNCLASSIFIED = "未分類";

// ---- 条件分類（パターンの条件カラム → 集計軸ラベル。nullなら未分類扱い） ----

type PatternConditions = {
  sendStatus: string | null;
  registDays: number | null;
  registDirection: string | null;
  areaType: string | null;
  gradYearFrom: number | null;
  gradYearTo: number | null;
  companyCount: number | null;
};

export function areaAxisLabel(p: PatternConditions): string | null {
  switch (p.areaType) {
    case "EAST":
      return "東日本";
    case "WEST":
      return "西日本";
    case "NATIONWIDE":
      return "全国";
    case "PREFECTURES":
      return "県指定";
    default:
      return null;
  }
}

export function sendStatusAxisLabel(p: PatternConditions): string | null {
  if (p.sendStatus === "SENT") return "≪送信済≫向け";
  if (p.sendStatus === "UNSENT") return "【未送信】向け";
  return null;
}

// 登録日区分。pattern-name.ts と同じく 以内=開放日 / 以降=既登録 の2区分に統一する
// （日数別の独立バケットは作らず、どちらかに吸収する）
export function registAxisLabel(p: PatternConditions): string | null {
  if (p.registDays == null || !p.registDirection) return null;
  return p.registDirection === "WITHIN" ? "開放日" : "既登録";
}

// 卒業年度帯（下2桁レンジ文字列。pattern-name.ts と同じ表記）
export function gradYearAxisLabel(p: PatternConditions): string | null {
  if (p.gradYearFrom == null && p.gradYearTo == null) return null;
  const two = (y: number) => String(y % 100).padStart(2, "0");
  const from = p.gradYearFrom != null ? two(p.gradYearFrom) : "";
  const to = p.gradYearTo != null ? two(p.gradYearTo) : "";
  return `${from}-${to}`;
}

export function companyCountAxisLabel(p: PatternConditions): string | null {
  return p.companyCount != null ? `～${p.companyCount}社` : null;
}

// ---- APIレスポンス型 ----

export type AxisEntry = { label: string; count: number };

export type DashboardMachineRow = {
  machineNo: number;
  isActive: boolean;
  changeCount: number;
  latestPatternName: string | null;
  latestSearchCount: number | null;
  latestRecordedAt: string | null; // JST壁時計値（"....Z" 形式。slice表示）
  recent5: (number | null)[]; // 古い→新しい順の直近5回 searchCount
  prevDiffPct: number | null; // 直近2回比較。null含む場合は比較不能でnull
};

export type ContinuousUseAlert = {
  machineNos: number[];
  patternName: string;
  count: number;
  lastAt: string; // JST壁時計値
};

export type SearchDropAlert = {
  machineNo: number;
  patternName: string;
  prevCount: number;
  lastCount: number;
  dropPct: number; // 正の値（34 = -34%下降）
  lastAt: string; // JST壁時計値
};

// ---- 予実（想定件数 vs 実績） ----

export type PlanVsActualRow = {
  planId: string;
  planDate: string; // JST壁時計値
  machineNo: number;
  patternName: string;
  expected: number;
  actual: number;
  pct: number; // 達成率（%）
};

export type PlanVsActualMachineRow = {
  machineNo: number;
  planCount: number;
  expected: number;
  actual: number;
  pct: number | null; // 対象0件なら null
};

export type PlanVsActual = {
  planCount: number; // 集計対象（想定件数あり×実績あり）の計画数
  expectedTotal: number;
  actualTotal: number;
  pct: number | null; // 対象0件なら null
  missingExpectedCount: number; // 実績記録済みだが想定未入力の計画数（分母から除外）
  noActualCount: number; // 想定はあるが実績が停止記録（件数なし）で算出不能な計画数
  machineRows: PlanVsActualMachineRow[];
  worst5: PlanVsActualRow[];
};

export type DashboardData = {
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  kpi: {
    changeCount: number;
    prevChangeCount: number;
    usedPatternCount: number;
    activePatternTotal: number;
    unused30dCount: number; // 30日以上未使用の有効パターン数（全期間・全号機横断）
    searchTotal: number;
    prevSearchTotal: number | null;
    searchAvg: number | null;
    prevSearchAvg: number | null;
    continuousUseCount: number;
  };
  machineRows: DashboardMachineRow[];
  planVsActual: PlanVsActual;
  allMachines: { machineNo: number; isActive: boolean }[];
  axes: {
    area: AxisEntry[];
    sendStatus: AxisEntry[];
    regist: AxisEntry[];
    gradYear: AxisEntry[];
    companyCount: AxisEntry[];
  };
  top5: { name: string; count: number }[];
  alerts: {
    continuousUse: ContinuousUseAlert[];
    searchDrop: SearchDropAlert[];
  };
  meta: { queryCount: number; unclassifiedLogCount: number };
};

// ---- 表示用ヘルパー（UIとプロンプト書き出しで共用し、必ず同じ数値になるようにする） ----

export function axisPct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

// 動的軸（卒業年度帯）の「回数降順で上位N＋その他＋未分類」への畳み込み
export function trimTopEntries(entries: AxisEntry[], top: number): AxisEntry[] {
  const unclassified = entries.filter((e) => e.label === UNCLASSIFIED);
  const rest = entries.filter((e) => e.label !== UNCLASSIFIED);
  const head = rest.slice(0, top);
  const tailCount = rest.slice(top).reduce((s, e) => s + e.count, 0);
  return [
    ...head,
    ...(tailCount > 0 ? [{ label: "その他", count: tailCount }] : []),
    ...unclassified,
  ];
}

// JST壁時計値（"YYYY-MM-DDTHH:mm:00.000Z"）→ "M/D HH:mm"（Dateを介さない。罠#17）
export function shortJstDateTime(s: string): string {
  const [, m, d] = s.slice(0, 10).split("-");
  return `${Number(m)}/${Number(d)} ${s.slice(11, 16)}`;
}

// JST壁時計値 → "M/D"
export function shortJstDate(s: string): string {
  const [, m, d] = s.slice(0, 10).split("-");
  return `${Number(m)}/${Number(d)}`;
}

// ---- 分析用プロンプト書き出し ----

const nf = (n: number) => n.toLocaleString("ja-JP");
const signed = (n: number) => (n > 0 ? `+${nf(n)}` : n < 0 ? `${nf(n)}` : "±0");

function axisLines(entries: AxisEntry[], total: number): string {
  if (entries.every((e) => e.count === 0)) return "- データなし";
  return entries
    .filter((e) => e.count > 0 || e.label === UNCLASSIFIED)
    .map((e) => `- ${e.label}: ${axisPct(e.count, total)}%（${e.count}回）`)
    .join("\n");
}

// 現在表示中の集計値（APIレスポンス相当）を、ChatGPT/Claudeへそのまま貼れる分析用テキストに整形する。
// 別途fetchせず、画面が持っているデータのみから組み立てる（表示と必ず一致させる）。
export function buildAnalysisPrompt(
  data: DashboardData,
  opts: { periodLabel: string; machineLabel: string }
): string {
  const { kpi, axes, machineRows, top5, alerts, period, planVsActual } = data;
  const total = kpi.changeCount;

  const lines: string[] = [];
  lines.push(
    "以下は人材紹介会社のマイナビスカウトRPA配信の実績データです。配信条件の偏り・リストの枯渇傾向・ローテーションの改善点に加え、計画時の想定件数と実績の乖離（予実）を分析し、来週の配信計画の提案をしてください。"
  );
  lines.push("");
  lines.push("# 集計条件");
  lines.push(
    `期間: ${period.from} 〜 ${period.to}（${opts.periodLabel}） / 号機: ${opts.machineLabel}`
  );
  lines.push("");
  lines.push("# 全体KPI");
  lines.push(
    `- 配信変更回数: ${nf(kpi.changeCount)}（前期間 ${signed(kpi.changeCount - kpi.prevChangeCount)}）`
  );
  lines.push(
    `- 使用パターン数: ${kpi.usedPatternCount} / ${kpi.activePatternTotal}（30日以上未使用: ${kpi.unused30dCount}）`
  );
  const totalDiff =
    kpi.prevSearchTotal != null && kpi.prevSearchTotal > 0
      ? `（前期間 ${signed(Math.round(((kpi.searchTotal - kpi.prevSearchTotal) / kpi.prevSearchTotal) * 100))}%）`
      : "";
  lines.push(`- 検索件数合計: ${nf(kpi.searchTotal)}${totalDiff}`);
  lines.push(
    `- 平均検索件数/回: ${kpi.searchAvg != null ? nf(kpi.searchAvg) : "-"}${kpi.prevSearchAvg != null ? `（前期間 ${nf(kpi.prevSearchAvg)}）` : ""}`
  );
  lines.push(`- 3日以内の連続使用: ${kpi.continuousUseCount}件`);
  lines.push("");
  lines.push("# 予実（想定件数 vs 実績）");
  if (planVsActual.planCount === 0) {
    lines.push("対象なし（想定件数が入力された実績記録済み計画がありません）");
  } else {
    const notes = [`対象計画 ${planVsActual.planCount}件`];
    if (planVsActual.missingExpectedCount > 0)
      notes.push(`想定未入力 ${planVsActual.missingExpectedCount}件`);
    if (planVsActual.noActualCount > 0)
      notes.push(`実績なし ${planVsActual.noActualCount}件`);
    lines.push(
      `- 想定合計: ${nf(planVsActual.expectedTotal)}件 / 実績合計: ${nf(planVsActual.actualTotal)}件 / 達成率: ${planVsActual.pct ?? "-"}%（${notes.join("・")}）`
    );
    lines.push("## 号機別");
    lines.push("| 号機 | 想定 | 実績 | 達成率 |");
    lines.push("|--|--|--|--|");
    for (const m of planVsActual.machineRows) {
      lines.push(
        `| ${m.machineNo}号機 | ${nf(m.expected)} | ${nf(m.actual)} | ${m.pct != null ? `${m.pct}%` : "-"} |`
      );
    }
    lines.push("## 乖離の大きい計画 TOP5");
    if (planVsActual.worst5.length === 0) {
      lines.push("- 対象なし");
    } else {
      planVsActual.worst5.forEach((w, i) =>
        lines.push(
          `${i + 1}. ${shortJstDate(w.planDate)} ${w.machineNo}号機 ${w.patternName} 想定${nf(w.expected)}→実績${nf(w.actual)}件（${w.pct}%）`
        )
      );
    }
  }
  lines.push("");
  lines.push("# 号機別");
  lines.push("| 号機 | 状態 | 現在のパターン | 変更回数 | 最新検索件数 | 前回比 |");
  lines.push("|--|--|--|--|--|--|");
  for (const m of machineRows) {
    lines.push(
      `| ${m.machineNo}号機 | ${m.isActive ? "稼働" : "停止"} | ${m.latestPatternName ?? "-"} | ${m.changeCount} | ${m.latestSearchCount != null ? nf(m.latestSearchCount) : "-"} | ${m.prevDiffPct != null ? signed(m.prevDiffPct) + "%" : "-"} |`
    );
  }
  lines.push("");
  lines.push("# 条件軸別の使用構成");
  lines.push("## エリア別");
  lines.push(axisLines(axes.area, total));
  lines.push("## 送信状態別");
  lines.push(axisLines(axes.sendStatus, total));
  lines.push("## 登録日区分別");
  lines.push(axisLines(axes.regist, total));
  lines.push("## 卒業年度帯別");
  lines.push(axisLines(trimTopEntries(axes.gradYear, 4), total));
  lines.push("## 経験社数別");
  lines.push(axisLines(axes.companyCount, total));
  lines.push("");
  lines.push("# パターン使用回数 TOP5");
  if (top5.length === 0) {
    lines.push("- データなし");
  } else {
    top5.forEach((t, i) => lines.push(`${i + 1}. ${t.name} ${t.count}回`));
  }
  lines.push("");
  lines.push("# アラート");
  if (alerts.continuousUse.length === 0) {
    lines.push("- 連続使用: なし");
  } else {
    for (const a of alerts.continuousUse) {
      lines.push(
        `- 連続使用: ${a.machineNos.map((n) => `${n}号機`).join("・")} ${a.patternName} 3日間で${a.count}回（最終 ${shortJstDateTime(a.lastAt)}）`
      );
    }
  }
  if (alerts.searchDrop.length === 0) {
    lines.push("- 件数下降: なし");
  } else {
    for (const a of alerts.searchDrop) {
      lines.push(
        `- 件数下降: ${a.machineNo}号機 ${a.patternName} ${nf(a.prevCount)}→${nf(a.lastCount)}件（-${a.dropPct}%）`
      );
    }
  }
  return lines.join("\n");
}
