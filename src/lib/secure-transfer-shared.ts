// T-147: セキュアファイル送信のうち、クライアント（送信前プレビュー画面）とサーバーの
// 両方から使う純粋関数だけを置くモジュール。
// ここには Node 専用モジュール（crypto / jsonwebtoken / Resend 送信等）を import しないこと。
// - buildTransferNoticeBody: 案内メール本文。プレビューと実送信で必ず同じ関数を使う（本文が食い違わないように）。
// - calcExpiresAt / formatJstDateTime: 有効期限の計算・表示（プレビューでも同一ロジックで出す）。

export const MAX_TRANSFER_RECIPIENTS = 10; // 1回の送信操作で指定できる宛先数の上限

/** 案内メールの件名（staging では送信時に【検証】が自動付与される）。 */
export const TRANSFER_MAIL_SUBJECT = "【株式会社ビズスタジオ】ファイル送付のご案内";

/**
 * 「JST の今日 + days 日後の 23:59:59.999」を返す。
 * 罠 #17: toISOString().slice(0,10) は UTC 基準で 9 時間ずれるので使わない。
 * JST 日付の取得は toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})（既存 jstDate.ts と同じ流儀）。
 */
export function calcExpiresAt(days: number): Date {
  const todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const [y, m, d] = todayJst.split("-").map((s) => parseInt(s, 10));
  // 壁時計日付の加算は UTC に詰めて行う（DST 無し・月跨ぎ/年跨ぎは Date.UTC が正規化）
  const target = new Date(Date.UTC(y, m - 1, d + days));
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(target.getUTCDate()).padStart(2, "0");
  return new Date(`${yy}-${mm}-${dd}T23:59:59.999+09:00`);
}

/** 画面・メール表示用の JST 日時文字列（例: "2026/08/09 23:59"）。 */
export function formatJstDateTime(dt: Date): string {
  return dt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 受信者向け: ファイル送付案内（URL・パスワード・期限・ファイル名一覧・送信者名）。
 * パスワードは本文中で独立した行に置く（コピーしやすくする・確定仕様）。
 * 有効期限は必ず JST 表記（formatJstDateTime）。
 * 送信前プレビューでは url / password に「（送信時に自動生成されます）」等のプレースホルダを渡す。
 */
export function buildTransferNoticeBody(params: {
  senderName: string;
  senderEmail: string;
  url: string;
  password: string;
  passwordInEmail: boolean; // false = パスワードは本文に載せず「別途お伝えします」と記載
  expiresAt: Date;
  fileNames: string[];
  subject?: string | null;
  message?: string | null;
}): string {
  const lines: string[] = [];
  lines.push("ご担当者様");
  lines.push("");
  lines.push("株式会社ビズスタジオよりファイルをお送りいたします。");
  lines.push("下記URLを開き、パスワードを入力のうえ、有効期限までにダウンロードをお願いいたします。");
  lines.push("");
  if (params.subject) {
    lines.push(`■件名`);
    lines.push(params.subject);
    lines.push("");
  }
  lines.push("■ダウンロードURL");
  lines.push(params.url);
  lines.push("");
  lines.push("■パスワード");
  if (params.passwordInEmail) {
    // 見出しの直後に置き、後ろだけ空行を空ける（選択してコピーしやすくする）。
    // 後ろの空行は if/else の後の push("") が兼ねる。
    lines.push(params.password);
  } else {
    lines.push("パスワードは送信者より別途お伝えします。");
  }
  lines.push("");
  lines.push("■有効期限");
  lines.push(`${formatJstDateTime(params.expiresAt)} まで（日本時間）`);
  lines.push("");
  lines.push("■ファイル");
  for (const name of params.fileNames) {
    lines.push(`・${name}`);
  }
  if (params.message) {
    lines.push("");
    lines.push(params.message);
  }
  lines.push("");
  lines.push("※有効期限を過ぎるとファイルは自動的に削除され、ダウンロードできなくなります。");
  lines.push("※本メールに心当たりがない場合は、お手数ですが破棄してください。");
  lines.push("");
  lines.push("──");
  lines.push(`株式会社ビズスタジオ ${params.senderName}`);
  lines.push(params.senderEmail);
  return lines.join("\n");
}
