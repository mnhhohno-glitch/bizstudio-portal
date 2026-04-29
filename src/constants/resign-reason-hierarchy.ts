export const RESIGN_REASON_LARGE_OPTIONS = ["過去型", "未来型"] as const;

export const RESIGN_REASON_LARGE_TO_MEDIUM: Record<string, string[]> = {
  "過去型": ["会社都合", "個人都合", "環境要因"],
  "未来型": ["キャリア志向", "働き方の見直し", "将来設計"],
};

export const RESIGN_REASON_MEDIUM_TO_SMALL: Record<string, string[]> = {
  "会社都合": [
    "業績不振・倒産",
    "会社の方針変更による配置転換",
    "契約満了（期間満了）",
    "部署・拠点の閉鎖",
    "希望しない異動",
  ],
  "個人都合": [
    "長時間労働・過重労働",
    "残業や休日出勤が多い",
    "ハラスメント（パワハラ・セクハラ等）",
    "上司・同僚との人間関係",
    "評価制度への不満",
    "昇給・昇進がない",
    "給与・待遇が見合わない",
    "仕事内容が合わない・ギャップがある",
    "成長・スキルアップの機会が少ない",
    "やりがいを感じない",
    "健康上の理由",
  ],
  "環境要因": [
    "通勤時間が長い・転居により通勤困難",
    "家庭の事情（育児・介護）",
    "結婚・出産",
    "ワークライフバランスが取れない",
    "職場の雰囲気が合わない",
    "社風・価値観の違い",
    "配偶者の転勤による引っ越しのため",
  ],
  "キャリア志向": [
    "やりたい仕事に挑戦したい",
    "新しい業界・職種にチャレンジしたい",
    "専門性を深めたい（資格取得・技術習得など）",
    "マネジメントに挑戦したい",
    "自分の裁量を広げたい",
    "より成長できる環境を求めて",
    "正社員になりたい",
  ],
  "働き方の見直し": [
    "リモート勤務・フレックスなど柔軟な働き方を求めて",
    "地元で働きたい／Uターン・Iターン希望",
    "ワークライフバランスを重視したい",
    "働く環境や風土にこだわりたい（例：フラットな組織文化）",
    "都市部で働きたい",
  ],
  "将来設計": [
    "将来の夢・ビジョンを実現するため",
    "海外でのキャリアを積みたい",
    "起業・独立準備のため",
    "家業を継ぐため",
  ],
};

export function getMediumOptions(large: string | null | undefined): string[] {
  if (!large) return [];
  return RESIGN_REASON_LARGE_TO_MEDIUM[large] ?? [];
}

export function getSmallOptions(medium: string | null | undefined): string[] {
  if (!medium) return [];
  return RESIGN_REASON_MEDIUM_TO_SMALL[medium] ?? [];
}
