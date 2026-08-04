// T-147: セキュアファイル送信のうち、クライアント（送信前確認画面）とサーバーの
// 両方から使う純粋関数だけを置くモジュール。
// ここには Node 専用モジュール（crypto / jsonwebtoken / Resend 送信等）を import しないこと。
//
// メール本文の構成（2026-08-04 改修で確定）:
//   （1）本文               … 確認画面で全文編集可能（宛名・挨拶・本題。既定文面 + 添え書きを合成）
//   （2）ファイル情報ブロック … 自動生成・編集不可（URL / パスワード / 有効期限 / ファイル）
//                              「メールに記載しない」選択時は ■パスワード 欄ごと省略する
//   （3）注意書き            … 自動・編集不可
//   （4）署名               … 自動・編集不可
// 件名は入力値がそのまま Subject ヘッダになる（空欄時は TRANSFER_MAIL_SUBJECT）。
// 本文中に ■件名 欄は置かない。
// 確認画面のプレビューと実送信は必ず同じ関数で組み立てる（食い違い防止）。

export const MAX_TRANSFER_RECIPIENTS = 10; // 1回の送信操作で指定できる宛先数の上限

/** 件名が未入力のときに使う既定のメール件名（staging では送信時に【検証】が自動付与される）。 */
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
 * （1）編集可能領域の既定文面。確認画面を開いたとき入力欄に入れる初期値。
 * 前画面の「添え書き」は下書きとして末尾に合成する。
 */
export function buildDefaultTransferBodyIntro(message?: string | null): string {
  const lines = [
    "ご担当者様",
    "",
    "株式会社ビズスタジオよりファイルをお送りいたします。",
    "下記URLを開き、パスワードを入力のうえ、有効期限までにダウンロードをお願いいたします。",
  ];
  const trimmed = message?.trim();
  if (trimmed) {
    lines.push("");
    lines.push(trimmed);
  }
  return lines.join("\n");
}

/**
 * （2）ファイル情報ブロック +（3）注意書き。自動生成・編集不可。
 * passwordInEmail=false のときは ■パスワード 欄ごと省略する（確定仕様）。
 * パスワードは独立した行に置く（コピーしやすくする・確定仕様）。有効期限は必ず JST 表記。
 * 確認画面ではプレースホルダ（「（送信時に自動生成されます）」等）を渡す。
 */
export function buildTransferFixedBlock(params: {
  url: string;
  password: string;
  passwordInEmail: boolean;
  expiresAt: Date;
  fileNames: string[];
}): string {
  const lines: string[] = [];
  lines.push("■ダウンロードURL");
  lines.push(params.url);
  lines.push("");
  if (params.passwordInEmail) {
    lines.push("■パスワード");
    lines.push(params.password);
    lines.push("");
  }
  lines.push("■有効期限");
  lines.push(`${formatJstDateTime(params.expiresAt)} まで（日本時間）`);
  lines.push("");
  lines.push("■ファイル");
  for (const name of params.fileNames) {
    lines.push(`・${name}`);
  }
  lines.push("");
  lines.push("※有効期限を過ぎるとファイルは自動的に削除され、ダウンロードできなくなります。");
  lines.push("※本メールに心当たりがない場合は、お手数ですが破棄してください。");
  return lines.join("\n");
}

/** （4）署名。自動・編集不可。 */
export function buildTransferSignature(senderName: string, senderEmail: string): string {
  return ["──", `株式会社ビズスタジオ ${senderName}`, senderEmail].join("\n");
}

/**
 * 受信者向け案内メールの最終本文: （1）→（2）（3）→（4）を空行で連結。
 * body は確認画面で編集された全文（空にされた場合はそのまま省略される）。
 */
export function buildTransferNoticeBody(params: {
  body: string;
  senderName: string;
  senderEmail: string;
  url: string;
  password: string;
  passwordInEmail: boolean;
  expiresAt: Date;
  fileNames: string[];
}): string {
  const parts: string[] = [];
  const body = params.body.trim();
  if (body) parts.push(body);
  parts.push(
    buildTransferFixedBlock({
      url: params.url,
      password: params.password,
      passwordInEmail: params.passwordInEmail,
      expiresAt: params.expiresAt,
      fileNames: params.fileNames,
    })
  );
  parts.push(buildTransferSignature(params.senderName, params.senderEmail));
  return parts.join("\n\n");
}
