/**
 * T-159 Phase 3 機能3: Azure クライアントシークレットの期限切れを事前に知らせる。
 *
 * ★なぜ必要か。`MS_GRAPH_CLIENT_SECRET` が失効しても **portal は正常に動き続ける**。
 *   同期は fire-and-forget で隔離されているため、CA のアップロードは成功し、画面にも何も出ず、
 *   OneDrive にだけ静かに入らなくなる（docs/reports/T-159_graph-connectivity-survey.md 10-3）。
 *   「エラーが出ないまま止まる」ので、期限を人間の記憶とカレンダーに委ねてはいけない。
 *
 * 期限そのものは Graph からは取れない（アプリの権限は Files.ReadWrite.All のみで、
 * 自分自身のアプリ登録を読む Application.Read.All が無い）。したがって環境変数で持つ。
 *   MS_GRAPH_SECRET_EXPIRES_AT = "YYYY-MM-DD"（Azure ポータルの「証明書とシークレット」の有効期限）
 *
 * ★未設定なら何もしない（通知もエラーも出さない）。この仕組みのために起動や夜間処理が
 *   止まっては本末転倒。設定漏れは「通知が来ないこと」として現れる。
 */

/**
 * 通知する残り日数の節目。毎晩送ると読まれなくなるため、この日数の晩だけ送る。
 * 60日から始めるのは、Azure の作業（新シークレット発行 → Railway の環境変数差し替え → 再デプロイ）に
 * 余裕を持たせるため。
 */
export const GRAPH_SECRET_NOTICE_DAYS_LEFT = [60, 30, 14, 7, 3, 1] as const;

export type GraphSecretExpiryState =
  | "UNSET" // 環境変数が未設定。何もしない
  | "INVALID" // 設定されているが日付として読めない
  | "OK" // 期限まで十分ある（節目でもない）
  | "NOTICE" // 節目の日
  | "EXPIRED"; // 期限当日または過去

export interface GraphSecretExpiryEvaluation {
  state: GraphSecretExpiryState;
  /** 設定値そのまま（YYYY-MM-DD）。UNSET のときは null。 */
  expiresAt: string | null;
  /** JST 暦日での残り日数。0 は「本日が期限」、負数は期限切れ。読めないときは null。 */
  daysLeft: number | null;
  /** 今夜 LINE WORKS に出すべきか。 */
  notify: boolean;
}

/** JST 暦日を「エポックからの日数」で表す。時刻を持たない日付同士の引き算に使う。 */
function jstDayNumber(at: Date): number {
  return Math.floor((at.getTime() + 9 * 60 * 60 * 1000) / 86_400_000);
}

/** "YYYY-MM-DD" を JST 暦日の日数に変換する。読めなければ null。 */
function jstDayNumberFromYmd(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utcMidnight = Date.UTC(y, mo - 1, d);
  // 2026-02-30 のような存在しない日付は Date.UTC が繰り上げるので、戻して一致を確かめる。
  const back = new Date(utcMidnight);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(utcMidnight / 86_400_000);
}

/**
 * 残り日数と「今夜送るか」を決める。
 *
 * ★期限切れ後は毎晩送る。既に止まっているものを黙っていても状況は良くならない。
 * ★設定値が壊れている（INVALID）ときも送る。黙って無視すると、この仕組み自体が
 *   静かに死んでいることに誰も気付けず、期限切れの見落としを潰した意味が無くなる。
 */
export function evaluateGraphSecretExpiry(
  now: Date = new Date(),
  raw: string | null | undefined = process.env.MS_GRAPH_SECRET_EXPIRES_AT,
): GraphSecretExpiryEvaluation {
  const value = (raw ?? "").trim();
  if (!value) return { state: "UNSET", expiresAt: null, daysLeft: null, notify: false };

  const expiryDay = jstDayNumberFromYmd(value);
  if (expiryDay === null) {
    return { state: "INVALID", expiresAt: value, daysLeft: null, notify: true };
  }

  const daysLeft = expiryDay - jstDayNumber(now);

  if (daysLeft <= 0) {
    return { state: "EXPIRED", expiresAt: value, daysLeft, notify: true };
  }
  if ((GRAPH_SECRET_NOTICE_DAYS_LEFT as readonly number[]).includes(daysLeft)) {
    return { state: "NOTICE", expiresAt: value, daysLeft, notify: true };
  }
  return { state: "OK", expiresAt: value, daysLeft, notify: false };
}

/** 更新手順の在り処。文面に技術用語を出さない代わり、辿れる場所だけ示す。 */
const RENEWAL_DOC = "docs/reports/T-159_onedrive-file-sync-survey.md";

/**
 * CA / 運用者向けの文面。通知が不要な評価なら null。
 *
 * ★技術用語（シークレット・クライアント・トークン・Azure）を出さない。読み手は
 *   「OneDrive にコピーされなくなる」ことだけ分かればよく、対処は運用者が手順書を見る。
 */
export function buildGraphSecretExpiryNotification(
  ev: GraphSecretExpiryEvaluation,
): string | null {
  if (!ev.notify) return null;

  if (ev.state === "INVALID") {
    return [
      "OneDrive連携の鍵の期限設定が正しくありません",
      "",
      `設定されている値: ${ev.expiresAt}`,
      "期限の確認ができないため、コピーが止まる前に気付けません。",
      "",
      `設定の直し方: ${RENEWAL_DOC}`,
    ].join("\n");
  }

  if (ev.state === "EXPIRED") {
    const past = ev.daysLeft === 0 ? "本日が期限です" : `期限を${-(ev.daysLeft ?? 0)}日過ぎています`;
    return [
      "OneDrive連携の鍵の有効期限が切れています",
      "",
      `期限: ${ev.expiresAt}（${past}）`,
      "書類のコピーは止まっています。エラーは出ません。",
      "",
      `更新手順: ${RENEWAL_DOC}`,
    ].join("\n");
  }

  return [
    "OneDrive連携の鍵の有効期限が近づいています",
    "",
    `残り${ev.daysLeft}日（期限: ${ev.expiresAt}）`,
    "期限を過ぎると、書類のコピーが止まります。",
    "エラーは出ないため、気付かないまま止まります。",
    "",
    `更新手順: ${RENEWAL_DOC}`,
  ].join("\n");
}
