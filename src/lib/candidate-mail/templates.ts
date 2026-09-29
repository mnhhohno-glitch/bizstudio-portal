// T-207: 求職者向け案内メール（LINE登録案内・あいさつメール）の文面。
// 文面はここに固定で持つ（DB には持たない）。差し込みは以下の4つ:
//   〔氏名〕  = 求職者の氏名
//   〔CA姓〕  = 送信するCAの姓（社員名を空白（半角・全角）で分けた先頭。空白が無ければ氏名全体）
//   〔URL〕   = 送信するCAの Employee.lineWorksUrl
//   〔QR〕    = そのURLから作ったQRコード画像（HTML では <img src="cid:..."> ・テキストでは注記に置き換え）
// このファイルはクライアント（確認画面）からも import されるため、依存を持たない。
// 送信そのもの・QR画像の生成はサーバ専用の send.ts / qr.ts に置く。

export const CONTACT_MAIL_TYPES = ["line", "greeting"] as const;
export type ContactMailType = (typeof CONTACT_MAIL_TYPES)[number];

export function isContactMailType(v: unknown): v is ContactMailType {
  return typeof v === "string" && (CONTACT_MAIL_TYPES as readonly string[]).includes(v);
}

export const CONTACT_MAIL_LABELS: Record<ContactMailType, string> = {
  line: "LINE登録案内",
  greeting: "あいさつメール",
};

/** HTML の <img src="cid:..."> と Resend の attachments[].content_id で一致させる値。 */
export const LINE_QR_CID = "line-works-qr";

/** QRコードの表示幅（px）。画像は高精細画面向けに2倍（qr.ts の 240px）で作り、表示はこの大きさ。 */
export const QR_DISPLAY_PX = 120;

/** テキスト本文で 〔QR〕 の位置に置く注記（テキストのみのメーラー向け）。 */
export const QR_TEXT_FALLBACK = "（QRコードは HTML 表示でご覧いただけます）";

export type ContactMailVars = {
  candidateName: string;
  caFamilyName: string;
  lineWorksUrl?: string | null;
};

/**
 * 社員名から CA姓 を取り出す。空白（半角・全角）で分けた先頭。空白が無ければ氏名全体。
 * 例: "大野 将幸" → "大野" / "大野　将幸" → "大野" / "大野将幸" → "大野将幸"
 */
export function caFamilyNameOf(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim();
  if (!name) return "";
  const head = name.split(/[\s　]+/)[0];
  return head || name;
}

// ---- 文面（指示された文面をそのまま。〔 〕は差し込み） ----

const LINE_SUBJECT = "LINEご登録案内｜株式会社ビズスタジオの〔CA姓〕です";
const LINE_BODY = `〔氏名〕様

お世話になっております。
株式会社ビズスタジオの〔CA姓〕でございます。

本日はご面談のお時間をいただきありがとうございます。
以下のURLまたはQRコードよりLINE登録をお願いいたします。

〔URL〕

〔QR〕

URLクリック
↓
上段のLINEを使用を選択
↓
友達追加登録をお願いします。

以上ご対応よろしくお願いいたします。

株式会社ビズスタジオ
〔CA姓〕`;

const GREETING_SUBJECT = "ご面談のお礼｜株式会社ビズスタジオの〔CA姓〕です";
const GREETING_BODY = `〔氏名〕様

お世話になっております。
株式会社ビズスタジオの〔CA姓〕でございます。

本日はご面談のお時間をいただきありがとうございます。
今後のご連絡は、こちらのメールアドレスよりお送りいたします。
履歴書・職務経歴書などをお送りいただく際も、本メールへのご返信でお送りいただけますと幸いです。

引き続き、どうぞよろしくお願いいたします。

株式会社ビズスタジオ
〔CA姓〕`;

const TEMPLATES: Record<ContactMailType, { subject: string; body: string }> = {
  line: { subject: LINE_SUBJECT, body: LINE_BODY },
  greeting: { subject: GREETING_SUBJECT, body: GREETING_BODY },
};

/** その種類の文面に 〔URL〕〔QR〕 が含まれるか（= 送信CAに lineWorksUrl が必要か）。 */
export function requiresLineWorksUrl(type: ContactMailType): boolean {
  return TEMPLATES[type].body.includes("〔URL〕") || TEMPLATES[type].body.includes("〔QR〕");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BuiltContactMail = {
  subject: string;
  /** テキスト本文（〔QR〕は注記に置き換え済み） */
  text: string;
  /** HTML 本文（〔QR〕は <img src="cid:LINE_QR_CID">・〔URL〕はリンク） */
  html: string;
  /** HTML に QR 画像を含めたか（含めるなら送信時に cid 付きで添付する） */
  hasQr: boolean;
};

/**
 * 件名・テキスト本文・HTML 本文を差し込み済みで組み立てる。
 * 確認画面（GET）と実送信（POST）が同じ関数を通るので、見たものと送るものは同じ。
 */
export function buildContactMail(type: ContactMailType, vars: ContactMailVars): BuiltContactMail {
  const t = TEMPLATES[type];
  const family = vars.caFamilyName;
  const url = (vars.lineWorksUrl ?? "").trim();

  const subject = t.subject.replace(/〔CA姓〕/g, family);

  const text = t.body
    .replace(/〔氏名〕/g, vars.candidateName)
    .replace(/〔CA姓〕/g, family)
    .replace(/〔URL〕/g, url)
    .replace(/〔QR〕/g, QR_TEXT_FALLBACK);

  const hasQr = t.body.includes("〔QR〕");
  const htmlLines = t.body.split("\n").map((line) => {
    if (line === "〔QR〕") {
      return `<img src="cid:${LINE_QR_CID}" alt="LINE登録用QRコード" width="${QR_DISPLAY_PX}" height="${QR_DISPLAY_PX}" style="display:block;width:${QR_DISPLAY_PX}px;height:${QR_DISPLAY_PX}px;">`;
    }
    if (line === "〔URL〕") {
      const e = escapeHtml(url);
      return `<a href="${e}">${e}</a>`;
    }
    return escapeHtml(
      line.replace(/〔氏名〕/g, vars.candidateName).replace(/〔CA姓〕/g, family).replace(/〔URL〕/g, url),
    );
  });
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;font-size:14px;line-height:1.8;color:#222;">` +
    htmlLines.join("<br>\n") +
    `</div>`;

  return { subject, text, html, hasQr };
}
