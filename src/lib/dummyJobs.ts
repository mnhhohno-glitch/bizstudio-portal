export type Job = {
  id: string;
  seq_no: number;
  aiJobId: string; // 関連するAIジョブID
  company_name: string;
  job_title: string;
  job_db: string;
  location: string;
  job_description: string;
  working_hours: string;
  salary: string;
  holidays: string;
  requirements: string;
  benefits: string;
  transfer: string;
  source_url: string;
  updated_at: string;
};

export const DUMMY_JOBS: Job[] = [
  {
    id: "job-001",
    seq_no: 1,
    aiJobId: "AJ-2024-002",
    company_name: "株式会社テックイノベーション",
    job_title: "シニアフロントエンドエンジニア",
    job_db: "リクナビNEXT",
    location: "東京都渋谷区",
    job_description: "自社プロダクトのフロントエンド開発をリードしていただきます。React/TypeScriptを用いた開発が中心です。チームメンバーの技術指導やコードレビューもお任せします。",
    working_hours: "フレックスタイム制（コアタイム10:00-15:00）",
    salary: "600万円〜900万円",
    holidays: "完全週休2日制（土日祝）、年間休日125日",
    requirements: "・フロントエンド開発経験5年以上\n・React/Vue.jsいずれかの実務経験\n・TypeScript経験",
    benefits: "社会保険完備、交通費全額支給、リモートワーク可、書籍購入補助",
    transfer: "なし",
    source_url: "https://example.com/job/001",
    updated_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "job-002",
    seq_no: 2,
    aiJobId: "AJ-2024-002",
    company_name: "グローバルコンサルティング合同会社",
    job_title: "ITコンサルタント",
    job_db: "doda",
    location: "大阪府大阪市北区",
    job_description: "クライアント企業のDX推進を支援するコンサルティング業務。要件定義からプロジェクト管理まで幅広く担当いただきます。",
    working_hours: "9:00-18:00（実働8時間）",
    salary: "700万円〜1200万円",
    holidays: "完全週休2日制（土日祝）、夏季休暇、年末年始休暇",
    requirements: "・IT業界での業務経験3年以上\n・プロジェクトマネジメント経験\n・ビジネスレベルの英語力歓迎",
    benefits: "社会保険完備、退職金制度、資格取得支援、海外研修制度",
    transfer: "あり（国内拠点間）",
    source_url: "https://example.com/job/002",
    updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "job-003",
    seq_no: 3,
    aiJobId: "AJ-2024-003",
    company_name: "ヘルスケアソリューションズ株式会社",
    job_title: "バックエンドエンジニア",
    job_db: "マイナビ転職",
    location: "福岡県福岡市博多区",
    job_description: "医療系SaaSのバックエンド開発。Go言語を用いたマイクロサービス設計・実装を担当。",
    working_hours: "フルフレックス（標準労働時間8時間）",
    salary: "500万円〜800万円",
    holidays: "完全週休2日制、有給休暇、特別休暇",
    requirements: "・バックエンド開発経験3年以上\n・Go/Python/Javaいずれかの経験\n・RDBの設計経験",
    benefits: "社会保険完備、在宅勤務手当、健康診断、ストックオプション",
    transfer: "なし",
    source_url: "https://example.com/job/003",
    updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "job-004",
    seq_no: 4,
    aiJobId: "AJ-2024-002",
    company_name: "エンタープライズシステムズ株式会社",
    job_title: "インフラエンジニア",
    job_db: "リクナビNEXT",
    location: "愛知県名古屋市中区",
    job_description: "大規模システムのインフラ設計・構築・運用。AWS/GCPを活用したクラウドインフラの最適化を推進。",
    working_hours: "9:30-18:30（実働8時間）",
    salary: "550万円〜850万円",
    holidays: "完全週休2日制（土日祝）、年間休日120日",
    requirements: "・インフラ運用経験3年以上\n・AWS/GCP/Azureいずれかの実務経験\n・Linux操作スキル",
    benefits: "社会保険完備、交通費支給、資格手当、リモートワーク可",
    transfer: "可能性あり",
    source_url: "https://example.com/job/004",
    updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// コードブロック形式テキストを生成
export function generateJobCodeBlock(job: Job): string {
  return `${job.seq_no}.＿${job.company_name}
${job.source_url}
・${job.job_title}
・勤務地
${job.location}
・仕事内容
${job.job_description}
・勤務時間
${job.working_hours}
・年収
${job.salary}
・休日
${job.holidays}
・応募要件
${job.requirements}
・福利厚生
${job.benefits}
・転勤
${job.transfer}`;
}
