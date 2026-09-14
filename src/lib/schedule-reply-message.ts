// T-196 step1: 日程調整フォーム送信時にマイナビのメッセージで送る返信文面。
//
// 目的: scout-scheduler が求職者へ送っているメールと **同じ趣旨・同じ文言** をマイナビ側でも届ける。
//   （メールを見ない応募者が一定数いるため二経路にする）
// メールとの差分は媒体差だけ:
//   - 迷惑メールフォルダの注意文 / 署名ブロックは省く（マイナビのメッセージ欄のため不要）
//   - 件名の社名【】は付けない（マイナビ側は送信元が自明）
// 本文はプレーンテキスト。改行は \n（HTML にしない）。
//
// ★ここは純関数だけを置く。DB・環境変数・現在時刻に触れない（単体で検証できる状態を保つ）。

/** 生成した1通ぶん。マイナビの件名欄・本文欄にそのまま入る。 */
export type MynaviScheduleReply = {
  subject: string;
  text: string;
};

/**
 * 仮確定できたとき。
 * @param whenLabel 例「9月16日（火）19:00〜20:00」（reservedRangeLabel の出力）
 * @param meetingFormat 例「オンライン」「電話」（確定した面談方法）
 */
export function buildMynaviScheduleReservedReply(params: {
  candidateName: string;
  whenLabel: string;
  meetingFormat: string;
}): MynaviScheduleReply {
  const name = params.candidateName.trim();
  return {
    subject: `${name}様｜面談日時のご案内`,
    text: [
      `${name} 様`,
      "",
      "お世話になっております。",
      "株式会社ビズスタジオでございます。",
      "",
      "面談日程のご登録ありがとうございます。",
      "以下の日時で面談のご予約を承りました。",
      "",
      `■日時：${params.whenLabel}`,
      `■面談形式：${params.meetingFormat}`,
      "",
      "担当者より改めて、面談方法（お電話の場合は発信元の番号、オンラインの場合はURL）をご連絡いたします。",
      "やむを得ず日時の変更をご相談させていただく場合がございます。あらかじめご了承ください。",
    ].join("\n"),
  };
}

/**
 * 仮確定できなかったとき（空きなし・対象外・エラー等をまとめて1通に寄せる）。
 * @param preferredDates フォームから届いた「希望日時」をそのまま入れる（第1〜第3希望の定型文字列）
 */
export function buildMynaviScheduleReceivedReply(params: {
  candidateName: string;
  meetingFormat: string;
  preferredDates: string;
}): MynaviScheduleReply {
  const name = params.candidateName.trim();
  return {
    subject: `${name}様｜面談希望日を受け付けました`,
    text: [
      `${name} 様`,
      "",
      "お世話になっております。",
      "株式会社ビズスタジオでございます。",
      "",
      "この度は面談の希望日をお送りいただき、誠にありがとうございます。",
      "以下の内容で受け付けいたしました。",
      "",
      "■ ご希望の面談形式",
      params.meetingFormat.trim(),
      "",
      params.preferredDates.trim(),
      "",
      "担当者より改めて、正式な日程をご連絡いたします。",
      "今しばらくお待ちくださいませ。",
    ].join("\n"),
  };
}
