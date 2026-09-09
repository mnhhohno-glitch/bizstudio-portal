// T-193: マイナビ転職スカウト応募者への一次返信メール（portal 送信版）の件名・本文。
//
// 7号機RPAがマイナビ上で送っている一次返信と同じ案内をメールでも届ける。
// 純関数（DB・env 依存は getScheduleFormUrl のみ）。プレーンテキスト専用で html は生成しない。
//
// フォームURLには必ず `?cid=<candidateId>` を付ける（付かないとフォーム回答が求職者に紐付かない）。
// 末尾スラッシュ・既存クエリで壊れないよう URL オブジェクトで組み立てる。
import { getScheduleFormUrl } from "@/lib/schedule-agent/config";

export type MynaviFirstReplyMailInput = {
  /** Candidate.name（呼び出し側で trim 済みでもここで再度 trim する） */
  name: string;
  /** Candidate.id。フォームURLの cid に使う */
  candidateId: string;
};

export type MynaviFirstReplyMail = {
  subject: string;
  text: string;
  /** 本文に埋め込んだフォームURL（ログ・検証用） */
  formUrl: string;
};

/** SCHEDULE_FORM_URL（既定 https://schedule.bizstudio.co.jp/）に cid を付与したURL。 */
export function buildScheduleFormUrlWithCid(candidateId: string): string {
  const url = new URL(getScheduleFormUrl());
  url.searchParams.set("cid", candidateId);
  return url.toString();
}

export function buildMynaviFirstReplyMail(
  input: MynaviFirstReplyMailInput,
): MynaviFirstReplyMail {
  const name = String(input.name ?? "").trim();
  const candidateId = String(input.candidateId ?? "").trim();
  const formUrl = buildScheduleFormUrlWithCid(candidateId);

  const subject = `${name}様：ビズスタジオよりご応募のお礼と日程調整のご案内です`;

  const text = `${name}様

このたびはご応募いただきありがとうございます。
株式会社ビズスタジオでございます。

まずは20～30分（最大）ほどお時間をいただき、
${name}様のご希望を伺いながら、
今後のお仕事について一緒に整理いたします。

▼面談希望日フォーム
${formUrl}

■初回面談内容
・ご経歴や転職活動状況のヒアリング
・ご希望条件や転職軸、今後のキャリアについての整理
・転職市場の動向や求人のご案内、内定までのご説明
・応募書類作成や面接対策など、選考に向けたサポート

短時間でも“次の一歩”につながる情報を
ご提供いたします。

初回面談はご負担にならないよう、
軽めのヒアリングとなります。

初回のご相談のみでも歓迎ですし、
面談後に正式なサポートをご希望の場合は、
その後は手厚くサポートいたしますので、
どうぞご安心ください。

つきましては、
ご都合のよい日時を複数ご提示いただけますと幸いです。

フォームからご希望日時をご登録いただけますが、
メッセージでのご返信でも問題ございませんので、
ご都合のよい方法でご連絡ください。

※日程調整の都合上、
【複数日・お時間帯も幅広く】いただけますようご協力をお願いいたします。

・・・・・返信フォーム・・・・・
■面談方法：
電話 or オンライン
希望する形式のみを記載ください

■日時指定（月～土：9時～21時）
第一希望：●月●日 ●時～●時
第二希望：●月●日 ●時～●時
第三希望：●月●日 ●時～●時
・・・・・・・・・・・・・・・・・・・・

※今後のご連絡は、マイナビ・メールのいずれでも可能です。 
※あわせて、マイナビ上からもご案内のメッセージをお送りいたします。 

それでは、ご返信を心よりお待ちしております。

--------------------------------------------------
株式会社ビズスタジオ

■ マイナビ転職 AGENT AWARD 2年連続受賞
■ Google口コミ評価 ★4.9

HP：https://www.bizstudio.co.jp/
E-mail：agent@bizstudio.co.jp
--------------------------------------------------
`;

  return { subject, text, formUrl };
}
