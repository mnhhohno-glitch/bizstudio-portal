// T-210 / T-211: 日付が変わったときの「有効を完了にする／その日の予約を有効にする」判定だけを集めた純関数。
//
// DB も現在時刻も見ない（today は必ず呼び出し側が Asia/Tokyo 基準で渡す。罠#17）。
// サーバー側の切替（activate.ts）・枯渇時の予約消化（runs.ts）・一覧の「翌朝有効」バッジ（_components/filter.ts）が
// 同じ規則を使うため、判定はこの1か所に置く。日付は "YYYY-MM-DD" なので辞書順の比較がそのまま日付の前後になる。
//
// T-211 の運用ルール（T-210 からの変更点）:
//   有効になるのは「配信日が today の条件」だけ。前日のうちに翌日分を予約しておけば翌朝に自動で有効になる。
//   配信日が過ぎた条件（有効・予約とも）は自動で完了。配信日が空の予約は自動では上がらない（人が手で有効にする）。

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
 * 境界（todayYmd="2026-09-19" のとき）:
 *   配信日 09-18（昨日）→ true / 09-19（今日ちょうど）→ false / 09-20（明日）→ false
 *   配信日 null＋最新実行 09-18 → true / null＋最新実行 09-19 → false / null＋実行なし → false
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
 * 2-2（T-211 で追加）: 期限切れの予約（QUEUED）を「完了」（DONE）にすべきか。
 *
 * 配信日が today より前の予約は、その日に配信されないまま日付が変わった行なので静かに完了にする
 * （T-210 は過去日の予約も有効に上げていたため、9/13 の予約が9/18 に走り出す事故があった）。
 * 配信日が空の予約は「いつ配信するか未定」なので触らない（人が配信日を入れるまで予約のまま残す）。
 *
 * 境界（todayYmd="2026-09-19" のとき）:
 *   配信日 09-18（昨日）→ true / 09-19（今日ちょうど）→ false / 09-20（明日）→ false / null → false
 *
 * 完了にした予約は通知しない（人が気づく必要のある遷移ではない）。
 */
export function shouldCompleteQueued(queued: Pick<RolloverRow, "deliveryYmd">, todayYmd: string): boolean {
  return queued.deliveryYmd !== null && queued.deliveryYmd < todayYmd;
}

/**
 * 2-3: 有効に上げる予約（QUEUED）を1件選ぶ。
 *
 *  - 対象は **配信日が targetYmd と完全一致する行だけ**（T-211。T-210 の「targetYmd 以前・配信日が空も対象」から変更）
 *  - そのうち ▲▼ の並び順（queueOrder → 登録順）で一番上の1件
 *  - 対象が無ければ null（呼び出し側は何もしない＝その号機は有効なしになる）
 *
 * 境界（targetYmd="2026-09-19" のとき）:
 *   配信日 09-19（今日ちょうど）→ 対象 / 09-18（昨日）→ 対象外（2-2 で完了になる）
 *   配信日 09-20（明日）→ 対象外（明日の朝に上がる） / null → 対象外（自動では上げない）
 */
export function pickQueuedToActivate<T extends RolloverRow>(queued: T[], targetYmd: string): T | null {
  let best: T | null = null;
  for (const c of queued) {
    if (c.deliveryYmd !== targetYmd) continue;
    if (best === null || compareQueueOrder(c, best) < 0) best = c;
  }
  return best;
}
