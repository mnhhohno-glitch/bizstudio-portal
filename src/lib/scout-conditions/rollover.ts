// T-210: 日付が変わったときの「前日の有効を完了にする／次の予約を有効にする」判定だけを集めた純関数。
//
// DB も現在時刻も見ない（today は必ず呼び出し側が Asia/Tokyo 基準で渡す。罠#17）。
// サーバー側の切替（activate.ts）と、一覧の「翌朝有効」バッジ（_components/filter.ts）が同じ規則を使うため、
// 判定はこの1か所に置く。日付は "YYYY-MM-DD" なので辞書順の比較がそのまま日付の前後になる。

/** 判定に要る最小の形。DB 行からも画面の DTO からも作れるようにしてある */
export type RolloverRow = {
  id: string;
  /** 配信日（JST の "YYYY-MM-DD"）。未設定なら null */
  deliveryYmd: string | null;
  /** 予約の並び順（一覧の ▲▼）。小さいほど先 */
  queueOrder: number;
  /** 並び順が同じときのタイブレーク（ISO 文字列。辞書順＝時刻順） */
  createdAtIso: string;
  /** 最新実行の JST 日付。実行が無ければ null */
  lastRunYmd: string | null;
};

/** 一覧の ▲▼ と同じ並び（queueOrder 昇順 → 登録順）。 */
export function compareQueueOrder(a: RolloverRow, b: RolloverRow): number {
  if (a.queueOrder !== b.queueOrder) return a.queueOrder - b.queueOrder;
  if (a.createdAtIso < b.createdAtIso) return -1;
  if (a.createdAtIso > b.createdAtIso) return 1;
  return 0;
}

/**
 * 2-1: 有効（RUNNING）を「完了」（DONE）にすべきか。
 *
 *  - 配信日がある → 配信日が today より前（＝日付が変わった）なら完了
 *  - 配信日が空   → 最新実行の日付が today より前なら完了。実行実績も無ければ何もしない
 *                   （いつの条件か判断できない行を勝手に落とさないため）
 *
 * これは枯渇（送信10件未満）とは別の理由なので is_dry は立てない。
 */
export function shouldCompleteRunning(
  running: Pick<RolloverRow, "deliveryYmd" | "lastRunYmd">,
  todayYmd: string,
): boolean {
  if (running.deliveryYmd !== null) return running.deliveryYmd < todayYmd;
  if (running.lastRunYmd !== null) return running.lastRunYmd < todayYmd;
  return false;
}

/**
 * 2-2: 有効に上げる予約（QUEUED）を1件選ぶ。
 *
 *  - 対象は「配信日が空」または「配信日が onOrBeforeYmd 以前」（先の日付の予約は上げない）
 *  - そのうち ▲▼ の並び順で一番上の1件（T-209 は配信日の古い順だったが、並び順を優先する）
 *  - 対象が無ければ null（呼び出し側は何もしない）
 *
 * 配信日が空の予約も対象に含める（T-209 では永久に上がらなかった）。
 */
export function pickQueuedToActivate<T extends RolloverRow>(queued: T[], onOrBeforeYmd: string): T | null {
  let best: T | null = null;
  for (const c of queued) {
    if (c.deliveryYmd !== null && c.deliveryYmd > onOrBeforeYmd) continue;
    if (best === null || compareQueueOrder(c, best) < 0) best = c;
  }
  return best;
}
