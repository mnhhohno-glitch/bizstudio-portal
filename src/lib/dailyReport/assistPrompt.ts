// T-069③：日報AIアシスト（所感整理＋上司視点アドバイス）のプロンプト。
// 数字はすべて呼び出し側で集計した値を渡す（AIに計算・捏造させない）。

export interface AssistContext {
  caName: string;
  dateStr: string;
  // 当日集計（システム算出値のみ）
  interviewTotal: number;
  interviewFirst: number;
  interviewExisting: number;
  proposalUniq: number; // 紹介人数
  entryTotal: number;
  entryRate: number | null; // エントリー÷紹介
  bmCount: number; // 求人検索（BM）数
  exportCount: number; // 出力（提案）数
  selectionRate: number | null; // T-092: 出力数/(BM数+紹介保留数)
  dCount: number; // 当日BM の D 件数
  activeCandidates: number; // 支援中（ACTIVE）求職者数
  plannedCount: number;
  completedCount: number;
  reportBody: string; // CA が書いた所感（■1〜■6）
}

const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

// AI への役割指示（skill とは別に、出力形式を固定するための短い指示）。
export const ASSIST_INSTRUCTION = `あなたは人材紹介CAの上司です。添付の「日報アドバイザースキル」と「job-matching-advisor スキル」に従い、部下の日報をレビューしてください。

役割:
1. CAが書いた所感（■1〜■6）を、**見出し・順序・6項目構造を必ず保持**したまま、事実ベースで簡潔に整理して書き直す（rewrittenBody）。内容の意味は変えない。
2. 上司が部下を直接教育する視点で、行動量・精度・行動内容について率直にアドバイスする（advice）。■1（乖離理由）と■6（次アクション）、既存求職者フォロー・声掛け・選定率の質を特に踏まえる。

厳守:
- 数字は下記「当日の実績数値」に書かれた値のみ使う。**自分で数字を作らない・推測で増減させない**。
- 所感に書かれていない行動を「やった」と断定しない。書かれていなければ確認を促す。
- 出力は必ず JSON。マークダウンのコードブロック記法（\`\`\`）は使わない。
- JSON 形式: { "message": "会話としての短い返答", "rewrittenBody": "■1〜■6 を保持した整理後の本文", "advice": "上司としての率直なアドバイス（できた点・課題・明日のアクション）" }`;

export function buildAssistContext(c: AssistContext): string {
  const digest = c.plannedCount > 0 ? Math.round((c.completedCount / c.plannedCount) * 100) : 0;
  return [
    `# 対象: ${c.caName} / ${c.dateStr}`,
    "",
    "## 当日の実績数値（システム集計・これ以外の数字を作らないこと）",
    `- 面談: 合計${c.interviewTotal}件（初回${c.interviewFirst}／既存${c.interviewExisting}）`,
    `- 求人紹介（紹介人数）: ${c.proposalUniq}人`,
    `- エントリー: ${c.entryTotal}件（エントリー率 ${pct(c.entryRate)}）`,
    `- 求人検索 BM数: ${c.bmCount}件 / 出力数: ${c.exportCount}件`,
    `- 選定率: ${pct(c.selectionRate)}（出力${c.exportCount}／BM${c.bmCount}・出力数÷(BM数+紹介保留数)）`,
    `- 支援中（ACTIVE）求職者数: ${c.activeCandidates}人`,
    `- スケジュール: 予定${c.plannedCount}件／完了${c.completedCount}件（消化${digest}%）`,
    "",
    "## 数字の目安（判定の参考。スキルに準拠）",
    `- 1日のBM数目安 ≒ 支援中求職者数 × 0.8〜1.2 ＝ ${Math.round(c.activeCandidates * 0.8)}〜${Math.round(c.activeCandidates * 1.2)}件`,
    "- 選定率 80%以上が目安（ただし高さだけで評価しない。BM量とのバランス重視）",
    "- エントリー率 70%以上が目安",
    "- BM 0件の日は面談・エントリー対応中心の日として扱う（責めない）",
    "",
    "## CA が書いた所感（■1〜■6・この構造を保持して整理する）",
    c.reportBody && c.reportBody.trim() ? c.reportBody.trim() : "（未記入）",
  ].join("\n");
}
