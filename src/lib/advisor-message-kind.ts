// T-163: AIアドバイザーチャットのメッセージが「求人全件分析の産物」かどうかの判定。
//
// チャットAPI（advisor/sessions/[sessionId]/messages）は AI へ送る「直近20件」から
// 分析産物を除外する。分析の長文が送信窓を占拠して input 肥大と few-shot 汚染
// （AIが長文レポート調を模倣し「簡潔に」の指示が効かなくなる）を起こしていたため。
//
// kind（新規分・T-163 以降は投稿時に "ANALYSIS" が付く）と本文プレフィクス（過去分）の
// 両方で判定する。バックフィル（scripts/backfill-advisor-message-kind.ts）未完了でも
// 正しく動くよう、両方の判定を残すこと。
export function isAnalysisMessage(m: { kind?: string | null; content: string }): boolean {
  if (m.kind === "ANALYSIS") return true;
  if (m.content.startsWith("【求人分析 バッチ")) return true;
  if (m.content.startsWith("【求人分析 完了")) return true;
  if (m.content.startsWith("ブックマーク求人分析")) return true;
  return false;
}
