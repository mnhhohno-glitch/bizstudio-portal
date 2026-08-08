// T-139 step4: 返信文面テンプレート。
// ★文言は指定どおり一字一句そのまま。改変・敬語調整・改行変更は禁止。
// 差し込みは以下の3箇所のみ:
//   $candidateName            → 氏名
//   ●月●日（●）●●:●●～   → 確保枠の開始日時（例: 7月15日（火）19:00～）
//   {SCHEDULE_FORM_URL}       → 日程登録フォームURL
import { getScheduleFormUrl } from "./config";

/** テンプレA：電話面談・確保成功 */
export const TEMPLATE_A = `$candidateName様

お世話になっております。
株式会社ビズスタジオでございます。

このたびは面談をご希望いただき、誠にありがとうございます。
$candidateName様の転職活動を、弊社キャリアアドバイザーが全力でサポートさせていただきます。

ご指定いただきました以下の日程にて、面談の枠を確保いたしました。

▼面談のご予約内容
■日時：●月●日（●）●●:●●～
■面談方法：お電話

担当アドバイザー情報の詳細は、確定次第、
追ってこちらのメッセージにてご案内させていただきます。

何かご不明な点やご都合の変更などございましたら、
いつでもこちらのメッセージにご返信ください。

それでは、当日お話しできることを楽しみにしております。`;

/** テンプレB：オンライン面談・確保成功 */
export const TEMPLATE_B = `$candidateName様

お世話になっております。
株式会社ビズスタジオでございます。

このたびは面談をご希望いただき、誠にありがとうございます。
$candidateName様の転職活動を、弊社キャリアアドバイザーが全力でサポートさせていただきます。

ご指定いただきました以下の日程にて、面談の枠を確保いたしました。

▼面談のご予約内容
■日時：●月●日（●）●●:●●～
■面談方法：オンライン

担当アドバイザーの確定後、当日ご利用いただくオンライン面談のURLを
発行し、こちらのメッセージにてご案内させていただきます。
ご案内まで今しばらくお待ちくださいませ。

何かご不明な点やご都合の変更などございましたら、
いつでもこちらのメッセージにご返信ください。

それでは、当日お話しできることを楽しみにしております。`;

/** テンプレC：当日希望のみ */
export const TEMPLATE_C = `$candidateName様

お世話になっております。
株式会社ビズスタジオでございます。

このたびは面談をご希望いただき、誠にありがとうございます。
誠に恐れ入りますが、本日の面談枠はすべて埋まっており、
ご希望のお時間でのご案内が難しい状況でございます。

お手数をおかけしますが、下記より翌営業日以降のご希望日時を
改めてお知らせいただけますでしょうか。

▼日程のご登録はこちら
{SCHEDULE_FORM_URL}

どうぞよろしくお願いいたします。`;

/** テンプレD：希望がすべて埋まり */
export const TEMPLATE_D = `$candidateName様

お世話になっております。
株式会社ビズスタジオでございます。

このたびは面談をご希望いただき、誠にありがとうございます。
誠に恐れ入りますが、ご希望いただきました日程はいずれも
すでに埋まっており、ご案内が難しい状況でございます。

お手数をおかけしますが、下記より別のご希望日時を
改めてお知らせいただけますでしょうか。

▼日程のご登録はこちら
{SCHEDULE_FORM_URL}

どうぞよろしくお願いいたします。`;

/** 面談方法（返信文面の振り分けキー）。 */
export type MeetingMethod = "電話" | "オンライン";

const DATE_PLACEHOLDER = "●月●日（●）●●:●●～";

function fill(template: string, candidateName: string, dateLabel?: string): string {
  let out = template.split("$candidateName").join(candidateName);
  if (dateLabel) out = out.split(DATE_PLACEHOLDER).join(dateLabel);
  out = out.split("{SCHEDULE_FORM_URL}").join(getScheduleFormUrl());
  return out;
}

/** 確保成功: 電話→A / オンライン→B。dateLabel は reservedLabel() の出力（例 "7月15日（火）19:00～"）。 */
export function buildReservedReply(
  candidateName: string,
  method: MeetingMethod,
  dateLabel: string
): string {
  return fill(method === "電話" ? TEMPLATE_A : TEMPLATE_B, candidateName, dateLabel);
}

/** 当日希望のみ（テンプレC）。 */
export function buildTodayOnlyReply(candidateName: string): string {
  return fill(TEMPLATE_C, candidateName);
}

/** 希望がすべて埋まり・範囲外（テンプレD）。 */
export function buildUnavailableReply(candidateName: string): string {
  return fill(TEMPLATE_D, candidateName);
}
