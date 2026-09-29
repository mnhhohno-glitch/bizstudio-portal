// T-208 step2: 面談記録の入力画面（InterviewForm.tsx）の選択肢のうち、台本のボタンが値を入れる欄のもの。
// 画面の <select> と台本の定義が同じ配列を見ることで、「押した値が選択肢に実在する」ことを確認スクリプトで保証する。
// 付録C で足した選択肢: 自動車免許「取得(AT限定)」・希望残業「45時間超も可」。

export const AGENT_USAGE_OPTIONS = ["初めて利用", "他社利用中", "利用経験あり"];
export const EMPLOYMENT_STATUS_OPTIONS = ["在職中", "離職中"];
export const JOB_CHANGE_TIMELINE_OPTIONS = ["すぐにでも", "3カ月以内", "半年以内", "1年以内", "未定"];
export const ACTIVITY_PERIOD_OPTIONS = ["1週間以内", "1カ月以内", "3カ月以内", "半年以内", "半年以上"];
export const APPLICATION_TYPE_OPTIONS = ["検討中", "応募中", "選考中", "なし"];
export const DESIRED_DAY_OFF_OPTIONS = ["土日祝休み", "完全週休2日", "シフト制", "曜日問わず"];
export const DESIRED_OVERTIME_OPTIONS = ["絶対不可", "10時間以内", "20時間以内", "30時間以内", "45時間以内", "45時間超も可"];
export const DESIRED_TRANSFER_OPTIONS = ["なし", "可", "要相談"];
export const DRIVER_LICENSE_OPTIONS = ["取得", "取得(AT限定)", "未取得", "取得予定"];
export const LANGUAGE_SKILL_OPTIONS = ["不可", "日常会話", "ビジネス", "ネイティブ"];
export const JAPANESE_SKILL_OPTIONS = ["ネイティブ", "ビジネス", "日常会話"];
export const TYPING_OPTIONS = ["ブラインドタッチ可", "中級", "初級"];
export const PC_SKILL_OPTIONS = ["中級", "上級", "初級", "不可"];
export const DOCUMENT_STATUS_OPTIONS = ["未着手", "本人作成中", "書類サポート中", "完成"];
export const CONTACT_METHOD_OPTIONS = ["LINE", "メール", "電話"];
export const NEXT_INTERVIEW_FLAG_OPTIONS = ["設定済", "調整中", "未設定"];

export const WORK_STYLE_OPTIONS = [
  "フルリモート", "上場企業", "退職金制度", "海外勤務・出張あり",
  "ハイブリッド", "スタートアップ", "固定残業NG", "海外常駐希望",
  "フレックス勤務", "住宅手当", "賞与必須", "英語を使う仕事",
];

/** 欄（detail の列名）→ 選択肢。台本の確認スクリプトはこの表で値の実在を確かめる */
export const DETAIL_SELECT_OPTIONS: Record<string, string[]> = {
  agentUsageFlag: AGENT_USAGE_OPTIONS,
  employmentStatus: EMPLOYMENT_STATUS_OPTIONS,
  jobChangeTimeline: JOB_CHANGE_TIMELINE_OPTIONS,
  activityPeriod: ACTIVITY_PERIOD_OPTIONS,
  applicationTypeFlag: APPLICATION_TYPE_OPTIONS,
  desiredDayOff: DESIRED_DAY_OFF_OPTIONS,
  desiredOvertimeMax: DESIRED_OVERTIME_OPTIONS,
  desiredTransfer: DESIRED_TRANSFER_OPTIONS,
  driverLicenseFlag: DRIVER_LICENSE_OPTIONS,
  languageSkillFlag: LANGUAGE_SKILL_OPTIONS,
  japaneseSkillFlag: JAPANESE_SKILL_OPTIONS,
  typingFlag: TYPING_OPTIONS,
  excelFlag: PC_SKILL_OPTIONS,
  wordFlag: PC_SKILL_OPTIONS,
  pptFlag: PC_SKILL_OPTIONS,
  documentStatusFlag: DOCUMENT_STATUS_OPTIONS,
  contactMethod: CONTACT_METHOD_OPTIONS,
  nextInterviewFlag: NEXT_INTERVIEW_FLAG_OPTIONS,
};
