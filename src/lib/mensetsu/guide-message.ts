// T-206: 求職者へ送る案内文（URL・公開期限・初回の生年月日入力の案内入り）
import { formatYmdJa } from "./dates";

export type GuideMessageInput = {
  candidateName: string; // "姓 名"（半角/全角空白区切り）。姓だけを使う
  companyName: string | null;
  stage: string;
  url: string;
  lastViewableDayYmd: string; // "YYYY-MM-DD"
  requireBirthdate: boolean;
  /** 差し替え後の案内文（2 行目を「面接対策の内容を反映して、資料を更新しました。」にする） */
  updated?: boolean;
};

export function familyNameOf(candidateName: string): string {
  const first = candidateName.trim().split(/[ 　]+/)[0];
  return first || candidateName.trim();
}

export function buildGuideMessage(input: GuideMessageInput): string {
  const sei = familyNameOf(input.candidateName);
  const subject = input.companyName
    ? `${input.companyName}の${input.stage}に向けた対策資料`
    : `${input.stage}に向けた対策資料`;
  const line2 = input.updated ? "面接対策の内容を反映して、資料を更新しました。" : `${subject}をお送りします。`;
  const lines = [
    `${sei}さん`,
    line2,
    "",
    input.url,
    "",
    `スマホ・PCどちらでもご覧いただけます（${formatYmdJa(input.lastViewableDayYmd)}まで公開）。`,
  ];
  if (input.requireBirthdate) lines.push("初回のみ、ご本人確認のため生年月日の入力をお願いします。");
  lines.push("ご不明点があればお気軽にご連絡ください。");
  return lines.join("\n");
}
