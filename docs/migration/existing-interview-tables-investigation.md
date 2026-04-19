# 既存面談テーブル実態調査レポート

調査日: 2026-04-19
調査者: Claude Code (Phase 3 前段調査)
目的: Phase 3 のスキーマ設計を既存スキーマに整合させるための実態把握

## 1. エグゼクティブサマリー

- 既存テーブル3つ (InterviewRecord / InterviewDetail / InterviewRating) がPrismaスキーマとDBに存在
- **全テーブル 0件** — 実運用データなし
- API 4エンドポイント、UI 2ページが既に実装済み（CRUD + Gemini AI解析）
- 候補者詳細画面からの直接参照はなし（独立した `/interviews/new` と `/interviews/[id]` で操作）
- **結論: テーブルは作成済みだが未使用。既存スキーマを活かして差分追加する方針が最も安全**

## 2. スキーマ構造

### 2.1 InterviewRecord の全文

```prisma
model InterviewRecord {
  id                String    @id @default(cuid())
  candidateId       String    @map("candidate_id")
  candidate         Candidate @relation(fields: [candidateId], references: [id])
  interviewDate     DateTime  @map("interview_date")
  startTime         String    @map("start_time")
  endTime           String    @map("end_time")
  duration          Int?
  interviewTool     String    @map("interview_tool")
  interviewerUserId String    @map("interviewer_user_id")
  interviewer       Employee  @relation("interviewConductedBy", fields: [interviewerUserId], references: [id])
  interviewType     String    @map("interview_type")
  interviewCount    Int?      @map("interview_count")
  resultFlag        String?   @map("result_flag")
  interviewMemo     String?   @db.Text @map("interview_memo")
  previousMemo      String?   @db.Text @map("previous_memo")
  summaryText       String?   @db.Text @map("summary_text")
  rawTranscript     String?   @db.Text @map("raw_transcript")
  resumePdfFileId   String?   @map("resume_pdf_file_id")
  createdByUserId   String    @map("created_by_user_id")
  createdBy         Employee  @relation("interviewCreatedBy", fields: [createdByUserId], references: [id])
  detail            InterviewDetail?
  rating            InterviewRating?
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@index([candidateId])
  @@index([interviewDate])
  @@map("interview_records")
}
```

**フィールド数**: 18（リレーション・メタ除く）

### 2.2 InterviewDetail の全文

```prisma
model InterviewDetail {
  id                  String          @id @default(cuid())
  interviewRecordId   String          @unique @map("interview_record_id")
  interviewRecord     InterviewRecord @relation(fields: [interviewRecordId], references: [id], onDelete: Cascade)

  // 転職活動状況
  agentUsageFlag          String?  @map("agent_usage_flag")
  agentUsageMemo          String?  @map("agent_usage_memo")
  employmentStatus        String?  @map("employment_status")
  resignationDate         DateTime? @map("resignation_date")
  jobChangeTimeline       String?  @map("job_change_timeline")
  jobChangeTimelineMemo   String?  @map("job_change_timeline_memo")
  activityPeriod          String?  @map("activity_period")
  activityPeriodMemo      String?  @map("activity_period_memo")
  currentApplicationCount Int?     @map("current_application_count")
  applicationTypeFlag     String?  @map("application_type_flag")
  applicationMemo         String?  @db.Text @map("application_memo")

  // 学歴・職歴
  educationFlag           String?  @map("education_flag")
  educationMemo           String?  @map("education_memo")
  graduationDate          String?  @map("graduation_date")
  companyName             String?  @map("company_name")
  businessContent         String?  @map("business_content")
  tenure                  String?
  jobTypeFlag             String?  @map("job_type_flag")
  jobTypeMemo             String?  @map("job_type_memo")
  resignReasonLarge       String?  @map("resign_reason_large")
  resignReasonMedium      String?  @map("resign_reason_medium")
  resignReasonSmall       String?  @map("resign_reason_small")
  jobChangeReasonMemo     String?  @db.Text @map("job_change_reason_memo")
  jobChangeAxisFlag       String?  @map("job_change_axis_flag")
  jobChangeAxisMemo       String?  @db.Text @map("job_change_axis_memo")

  // 希望条件
  desiredJobType1         String?  @map("desired_job_type_1")
  desiredJobType1Memo     String?  @map("desired_job_type_1_memo")
  desiredJobType2         String?  @map("desired_job_type_2")
  desiredIndustry1        String?  @map("desired_industry_1")
  desiredIndustry1Memo    String?  @map("desired_industry_1_memo")
  desiredArea             String?  @map("desired_area")
  desiredPrefecture       String?  @map("desired_prefecture")
  desiredCity             String?  @map("desired_city")
  desiredAreaMemo         String?  @map("desired_area_memo")
  currentSalary           Int?     @map("current_salary")
  currentSalaryMemo       String?  @map("current_salary_memo")
  desiredSalaryMin        Int?     @map("desired_salary_min")
  desiredSalaryMinMemo    String?  @map("desired_salary_min_memo")
  desiredSalaryMax        Int?     @map("desired_salary_max")
  desiredSalaryMaxMemo    String?  @map("desired_salary_max_memo")
  desiredDayOff           String?  @map("desired_day_off")
  desiredDayOffMemo       String?  @map("desired_day_off_memo")
  desiredHolidayCount     String?  @map("desired_holiday_count")
  desiredOvertimeMax      String?  @map("desired_overtime_max")
  desiredOvertimeMemo     String?  @map("desired_overtime_memo")
  desiredTransfer         String?  @map("desired_transfer")
  desiredTransferMemo     String?  @map("desired_transfer_memo")
  workStyleFlags          String?  @map("work_style_flags")
  companyFeatureFlags     String?  @map("company_feature_flags")
  priorityCondition1      String?  @map("priority_condition_1")
  priorityCondition2      String?  @map("priority_condition_2")
  priorityCondition3      String?  @map("priority_condition_3")
  priorityConditionMemo   String?  @map("priority_condition_memo")

  // スキル
  driverLicenseFlag       String?  @map("driver_license_flag")
  driverLicenseMemo       String?  @map("driver_license_memo")
  languageSkillFlag       String?  @map("language_skill_flag")
  languageSkillMemo       String?  @map("language_skill_memo")
  chineseSkillMemo        String?  @map("chinese_skill_memo")
  japaneseSkillFlag       String?  @map("japanese_skill_flag")
  japaneseSkillMemo       String?  @map("japanese_skill_memo")
  typingFlag              String?  @map("typing_flag")
  typingMemo              String?  @map("typing_memo")
  excelFlag               String?  @map("excel_flag")
  excelMemo               String?  @map("excel_memo")
  wordFlag                String?  @map("word_flag")
  wordMemo                String?  @map("word_memo")
  pptFlag                 String?  @map("ppt_flag")
  pptMemo                 String?  @map("ppt_memo")

  // アクション
  documentStatusFlag      String?  @map("document_status_flag")
  documentStatusMemo      String?  @map("document_status_memo")
  documentSupportFlag     String?  @map("document_support_flag")
  documentSupportMemo     String?  @map("document_support_memo")
  jobReferralFlag         String?  @map("job_referral_flag")
  jobReferralTimeline     String?  @map("job_referral_timeline")
  jobReferralMemo         String?  @map("job_referral_memo")
  lineSetupFlag           String?  @map("line_setup_flag")
  lineSetupMemo           String?  @map("line_setup_memo")
  nextInterviewFlag       String?  @map("next_interview_flag")
  nextInterviewDate       DateTime? @map("next_interview_date")
  nextInterviewTime       String?  @map("next_interview_time")
  nextInterviewMemo       String?  @map("next_interview_memo")
  freeMemo                String?  @db.Text @map("free_memo")
  initialSummary          String?  @db.Text @map("initial_summary")

  // 左カラム: 転職活動状況（テキストエリア）
  careerSummary           String?  @db.Text @map("career_summary")

  // 初期条件タブ: 登録時条件
  regIndustry1            String?  @map("reg_industry_1")
  regIndustry2            String?  @map("reg_industry_2")
  regIndustry3            String?  @map("reg_industry_3")
  regJobType1             String?  @map("reg_job_type_1")
  regJobType2             String?  @map("reg_job_type_2")
  regJobType3             String?  @map("reg_job_type_3")
  regAreaPrefecture       String?  @map("reg_area_prefecture")
  regAreaCity             String?  @map("reg_area_city")
  regEmploymentType       String?  @map("reg_employment_type")
  regSalaryMin            Int?     @map("reg_salary_min")
  regSalaryMax            Int?     @map("reg_salary_max")
  regHolidays             String?  @map("reg_holidays")
  regOvertime             String?  @map("reg_overtime")
  regJobFeatures          String?  @map("reg_job_features")
  regCompanyFeatures      String?  @map("reg_company_features")
  regFreeMemo             String?  @db.Text @map("reg_free_memo")

  // アクションタブ追加
  contactMethod           String?  @map("contact_method")
  contactMemo             String?  @map("contact_memo")
  jobSendDeadline         DateTime? @map("job_send_deadline")
  nextAction              String?  @db.Text @map("next_action")
  gptMemo                 String?  @db.Text @map("gpt_memo")

  // 働き方チェックボックス（JSON文字列）
  workStylePreferences    String?  @db.Text @map("work_style_preferences")

  // テキストメモタブ
  existingInterviewMemo   String?  @db.Text @map("existing_interview_memo")
  interviewPrepMemo       String?  @db.Text @map("interview_prep_memo")
  referralHistory         String?  @db.Text @map("referral_history")

  createdAt               DateTime @default(now()) @map("created_at")
  updatedAt               DateTime @updatedAt @map("updated_at")

  @@map("interview_details")
}
```

**フィールド数**: 96（リレーション・メタ除く）

### 2.3 InterviewRating の全文

```prisma
model InterviewRating {
  id                  String          @id @default(cuid())
  interviewRecordId   String          @unique @map("interview_record_id")
  interviewRecord     InterviewRecord @relation(fields: [interviewRecordId], references: [id], onDelete: Cascade)

  personalityMotivation           Int?  @map("personality_motivation")
  personalityMotivationMemo       String? @map("personality_motivation_memo")
  personalityCommunication        Int?  @map("personality_communication")
  personalityCommunicationMemo    String? @map("personality_communication_memo")
  personalityManner               Int?  @map("personality_manner")
  personalityMannerMemo           String? @map("personality_manner_memo")
  personalityIntelligence         Int?  @map("personality_intelligence")
  personalityIntelligenceMemo     String? @map("personality_intelligence_memo")
  personalityHumanity             Int?  @map("personality_humanity")
  personalityHumanityMemo         String? @map("personality_humanity_memo")
  personalityTotal                Int?  @map("personality_total")
  personalityTotalMemo            String? @map("personality_total_memo")

  careerJobType                   Int?  @map("career_job_type")
  careerJobTypeMemo               String? @map("career_job_type_memo")
  careerExperience                Int?  @map("career_experience")
  careerExperienceMemo            String? @map("career_experience_memo")
  careerJobChangeCount            Int?  @map("career_job_change_count")
  careerJobChangeCountMemo        String? @map("career_job_change_count_memo")
  careerAchievement               Int?  @map("career_achievement")
  careerAchievementMemo           String? @map("career_achievement_memo")
  careerQualification             Int?  @map("career_qualification")
  careerQualificationMemo         String? @map("career_qualification_memo")
  careerTotal                     Int?  @map("career_total")
  careerTotalMemo                 String? @map("career_total_memo")

  conditionJobType                Int?  @map("condition_job_type")
  conditionJobTypeMemo            String? @map("condition_job_type_memo")
  conditionSalary                 Int?  @map("condition_salary")
  conditionSalaryMemo             String? @map("condition_salary_memo")
  conditionHoliday                Int?  @map("condition_holiday")
  conditionHolidayMemo            String? @map("condition_holiday_memo")
  conditionArea                   Int?  @map("condition_area")
  conditionAreaMemo               String? @map("condition_area_memo")
  conditionFlexibility            Int?  @map("condition_flexibility")
  conditionFlexibilityMemo        String? @map("condition_flexibility_memo")
  conditionTotal                  Int?  @map("condition_total")
  conditionTotalMemo              String? @map("condition_total_memo")

  grandTotal                      Int?  @map("grand_total")
  grandTotalMemo                  String? @db.Text @map("grand_total_memo")
  overallRank                     String? @map("overall_rank")

  createdAt                       DateTime @default(now()) @map("created_at")
  updatedAt                       DateTime @updatedAt @map("updated_at")

  @@map("interview_ratings")
}
```

**フィールド数**: 35（リレーション・メタ除く）

### 2.4 Candidate モデルのリレーションフィールド

Candidate モデル内のInterview関連リレーション:

```prisma
interviewRecords InterviewRecord[]
```

これのみ。`profile` や `candidateMemos` のリレーションはまだ存在しない。

### 2.5 関連マイグレーションファイル

| マイグレーション | 行数 | 内容 |
|---|---|---|
| `20260408000000_add_interview_records` | 187行 | 3テーブル新規作成 (interview_records, interview_details, interview_ratings)、FK制約、インデックス |
| `20260409000000_add_interview_detail_fields` | 35行 | interview_details に20カラム追加 (career_summary, reg_*系, contact_*, work_style_preferences, テキストメモ系) |
| `20260412000000_add_finance_route_second_interview` | 9行 | job_entries への追加（面談テーブルとは無関係、名前が紛らわしいだけ） |

**20260408000000_add_interview_records/migration.sql** (冒頭):
```sql
-- CreateTable
CREATE TABLE "interview_records" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "interview_date" TIMESTAMP(3) NOT NULL,
    ...
```

**20260409000000_add_interview_detail_fields/migration.sql** (全文):
```sql
-- 左カラム
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "career_summary" TEXT;
-- 初期条件タブ: 登録時条件
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "reg_industry_1" TEXT;
...（20カラム追加）
-- テキストメモタブ
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "existing_interview_memo" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "interview_prep_memo" TEXT;
ALTER TABLE "interview_details" ADD COLUMN IF NOT EXISTS "referral_history" TEXT;
```

## 3. データ件数（staging DB）

### 3.1 基本カウント

| テーブル | 件数 |
|---|---|
| InterviewRecord | **0** |
| InterviewDetail | **0** |
| InterviewRating | **0** |

### 3.2 作成履歴

- 最古レコード: なし (null)
- 最新レコード: なし (null)
- ユニーク候補者数: 0
- 2回以上面談がある候補者: 0

### 3.3 作成者分布

なし（0件のため）

### 3.4 Detail/Rating との紐付き状況

- Detail があるレコード: 0
- Rating があるレコード: 0

### 3.5 解釈

**全テーブル0件 → 完全に未使用**。スキーマとAPIは作成済みだが、実運用には至っていない。テーブル構造の変更を行っても既存データへの影響はゼロ。

## 4. コード内での使用箇所

### 4.1 API ルート

| ファイルパス | メソッド | エンドポイント | 目的 |
|---|---|---|---|
| `src/app/api/interviews/route.ts` | POST | `/api/interviews` | 面談レコード新規作成（detail, rating同時作成対応） |
| `src/app/api/interviews/[id]/route.ts` | GET | `/api/interviews/:id` | 面談レコード詳細取得（detail, rating, candidate, interviewer含む） |
| `src/app/api/interviews/[id]/route.ts` | PATCH | `/api/interviews/:id` | 面談レコード更新（detail, rating upsert対応） |
| `src/app/api/interviews/[id]/route.ts` | DELETE | `/api/interviews/:id` | 面談レコード削除 |
| `src/app/api/candidates/[candidateId]/interviews/route.ts` | GET | `/api/candidates/:candidateId/interviews` | 候補者の面談一覧取得（interviewer, rating.overallRank, grandTotal含む） |
| `src/app/api/interviews/analyze/route.ts` | POST | `/api/interviews/analyze` | Gemini AI解析（文字起こし＋PDF → 構造化JSON抽出） |

### 4.2 UI ページ

| ファイルパス | 行数 | 画面名 | 機能 |
|---|---|---|---|
| `src/app/(app)/interviews/new/page.tsx` | 306行 | 面談新規作成 | 面談基本情報入力 + AI解析（文字起こし/PDF入力 → Gemini解析 → detail自動入力） |
| `src/app/(app)/interviews/[id]/page.tsx` | 468行 | 面談詳細/編集 | タブUI (初期条件/希望条件/ランク評価/アクション/面談メモ) + 自動保存 |

**候補者詳細画面 (`candidates/[candidateId]/page.tsx`) からの参照**: `/api/candidates/:candidateId/interviews` の直接呼び出しは**なし**。面談タブは「面談」サブタブとして存在するが、GuideEntry（面談ガイド）の参照のみで、InterviewRecordの一覧表示は実装されていない。

### 4.3 AIアドバイザーとの関連

**関連なし**。`src/lib/` 内にInterviewRecord関連のユーティリティはない。AIアドバイザー系API（`/api/candidates/[candidateId]/advisor/`）からの参照もなし。

### 4.4 Prisma型の使用箇所

API ルート内でのみ `prisma.interviewRecord` / `prisma.interviewDetail` / `prisma.interviewRating` を使用。`@prisma/client` から型を明示的にimportしている箇所はなし（UIページでは手動型定義を使用）。

## 5. 既存UI挙動

### 5.1 候補者詳細画面の面談関連タブ

候補者詳細画面 (`candidates/[candidateId]/page.tsx`) は:
- 「面談」サブタブを持つ (`subTab: "interview" | "counseling"`)
- しかし、InterviewRecordの一覧取得や表示は未実装
- 面談ガイド（GuideEntry）の管理のみ
- 面談履歴の表示はない

### 5.2 既存面談関連API

完全なCRUD + AI解析が実装済み:
- `POST /api/interviews` — 作成
- `GET /api/interviews/:id` — 取得
- `PATCH /api/interviews/:id` — 更新（detail/rating upsert含む）
- `DELETE /api/interviews/:id` — 削除
- `GET /api/candidates/:candidateId/interviews` — 候補者別一覧
- `POST /api/interviews/analyze` — Gemini AI解析（`gemini-3-flash-preview` 使用）

### 5.3 AI解析APIの重要な発見

`/api/interviews/analyze` は:
- `gemini-3-flash-preview` モデルを直接使用（Phase 2で移植したgemini-client.tsは**未使用**）
- Gemini REST APIを直接fetchで呼び出し（SDK不使用）
- 文字起こしテキスト + PDF履歴書から `detail` フィールドを構造化JSON抽出
- **candidate-intakeの解析とは独立した、簡易版のAI解析が既に存在する**

## 6. Phase 3計画への影響

### 6.1 仕様書で計画していた内容との整合性

| Phase 3 仕様 | 既存スキーマ | 状態 |
|---|---|---|
| InterviewRecord (新規作成) | **既に存在** | 構造が異なるが、多くのフィールドが対応 |
| InterviewMemo (新規作成) | 存在しない | **追加が必要** |
| InterviewAttachment (新規作成) | 存在しない | **追加が必要** |
| CandidateProfile (新規作成) | InterviewDetail が部分的にカバー | **設計判断が必要** |
| CandidateMemo (新規作成) | 存在しない | **追加が必要** |

**InterviewRecord の差分**:

Phase 3仕様にあって既存にないフィールド:
- `interviewNumber` + `@@unique([candidateId, interviewNumber])` — 面談番号の一意制約
- `method` — 既存は `interviewTool` で代替済み
- `assigneeCaId` / `assigneeCaName` — 既存は `interviewerUserId` (Employee FK) + `createdByUserId`
- `status` (draft/complete) — 状態管理
- `isLatest` — 最新面談フラグ
- `ratingXxx` (16個) — 既存は InterviewRating テーブルに分離
- アクション系フィールド — 既存は InterviewDetail テーブルに分離
- AI解析フィールド (`aiAnalysisResult`, `aiAnalysisAt`)
- 自動保存メタ (`lastSavedAt`, `lastEditedBy`, `autosaveToken`)

既存にあってPhase 3仕様にないフィールド:
- `interviewTool` — 面談ツール（電話/オンライン/対面）→ Phase 3の `method` に相当
- `interviewerUserId` (Employee FK) — 既存はEmployeeテーブルとの外部キー制約
- `createdByUserId` (Employee FK) — 作成者
- `previousMemo` — 前回面談メモ（自動コピー）
- `summaryText` — 初回面談まとめ
- `rawTranscript` — 文字起こし原文
- `resumePdfFileId` — PDF参照

**InterviewDetail vs CandidateProfile の重複**:

InterviewDetail には以下のカテゴリがあり、CandidateProfile仕様と大幅に重複:
- 転職活動状況 (11フィールド) ≈ CandidateProfile の agencyStatus系
- 学歴・職歴 (14フィールド) ≈ CandidateProfile の education系 + workHistory
- 希望条件 (28フィールド) ≈ CandidateProfile の salary系 + area系 + holidays系
- スキル (14フィールド) ≈ CandidateProfile の driverLicense系 + language系 + PCスキル系
- アクション (15フィールド) ≈ Phase 3仕様のInterviewRecordのアクション系
- 登録時条件 (16フィールド) ≈ CandidateProfile の初期登録データ

**設計上の違い**:
- **既存設計**: 全データを面談ごとのスナップショット (InterviewDetail) として保持。CandidateProfileは存在しない
- **Phase 3仕様**: 固定データをCandidateProfile (1:1) に分離し、面談ごとのデータはInterviewRecordにインライン化

**InterviewRating の対応**:
- 既存: 独立テーブル (16カテゴリ×スコア+メモ、小計3つ、総合計、総合ランク)
- Phase 3仕様: InterviewRecord にインライン (`ratingTransferIntent` 等)
- **構造はほぼ同一**。カテゴリ名の対応:

| 既存 InterviewRating | Phase 3仕様 rating |
|---|---|
| personalityMotivation | ratingTransferIntent |
| personalityCommunication | ratingCommunicationSkill |
| personalityManner | ratingBusinessManner |
| personalityIntelligence | ratingIntelligence |
| personalityHumanity | ratingPersonality |
| careerJobType | ratingJobExperience |
| careerExperience | ratingWorkExperience |
| careerJobChangeCount | ratingTransferCount |
| careerAchievement | ratingAchievementSkill |
| careerQualification | ratingLanguageCert |
| conditionJobType | ratingDesiredJob |
| conditionSalary | ratingDesiredSalary |
| conditionHoliday | ratingDesiredHoliday |
| conditionArea | ratingArea |
| conditionFlexibility | ratingFlexibility |
| grandTotal / overallRank | ratingOverall / grandTotal |

### 6.2 再計画の選択肢

#### 案A: 既存テーブルを活かして差分追加（推奨）

**メリット**:
- 既存API・UI (4エンドポイント + 2ページ + AI解析) がそのまま動く
- マイグレーションが小さい（ALTER TABLE + 新テーブル3つ）
- 既存のEmployeeリレーション（面談者FK）を維持
- 3テーブル分離設計は正規化の観点で妥当

**やること**:
1. InterviewRecord に不足フィールド追加: `status`, `isLatest`, `aiAnalysisResult`, `aiAnalysisAt`, `lastSavedAt`, `lastEditedBy`, `autosaveToken`
2. InterviewMemo テーブル新規追加 (InterviewRecord の子)
3. InterviewAttachment テーブル新規追加 (InterviewRecord の子)
4. CandidateProfile テーブル新規追加 (Candidate の1:1子)
5. CandidateMemo テーブル新規追加 (Candidate の子)
6. InterviewDetail / InterviewRating は**そのまま維持**（Phase 3仕様のインライン化はしない）

**やらないこと**:
- InterviewDetail を CandidateProfile に統合（データ構造が異なりすぎる）
- InterviewRating を InterviewRecord にインライン化（既存設計で十分）
- 既存APIの変更

#### 案B: 新テーブルを別名で並行運用

Phase 3仕様通りの5テーブルを別名（例: `InterviewRecordV2`）で作成し、既存テーブルと並行運用。後で旧テーブルを廃止。

**メリット**: 仕様通りの設計
**デメリット**: テーブル数が増える、移行期間が長い、APIの二重管理

#### 案C: 既存テーブルを仕様に合わせて作り直す

データが0件なので、既存3テーブルを DROP して仕様通りに再作成。

**メリット**: クリーンな設計
**デメリット**: 既存API・UIが全て壊れる（4エンドポイント + 2ページの改修が必要）。AI解析APIも要改修。

### 6.3 判断に必要な追加情報

1. **既存の面談UI・APIは使い続ける予定か？** — `/interviews/new` と `/interviews/[id]` は実装済みだが未使用。今後も使うなら案Aが安全。不要なら案Cで作り直しも可能
2. **InterviewDetail の設計は維持したいか？** — 面談ごとに希望条件・スキル等のスナップショットを保持する設計。CandidateProfileとは設計思想が異なる（スナップショット vs 最新固定値）
3. **AI解析API (`/api/interviews/analyze`) の扱い** — 既にGemini直接呼び出しで動いている。Phase 2で移植したgemini-client.tsに統合するか、既存のまま維持するか
4. **`interviewerUserId` → Employee FK の維持** — Phase 3仕様の `assigneeCaId`/`assigneeCaName` (String) とは設計が異なる。既存のFK制約の方がデータ整合性は高い

## 7. 次のアクション推奨

### 将幸さんが判断すべき点

1. **案A/B/Cのどれで進めるか** — 推奨は案A（既存活用 + 差分追加）。データ0件なので案Cも可能だが、既存API・UIの改修コストが増える
2. **CandidateProfile の要否** — InterviewDetail が面談ごとのスナップショットとして機能するなら、CandidateProfile は「最新の固定値」として別途必要か
3. **AI解析の統合方針** — 既存 `/api/interviews/analyze` と Phase 2 の `gemini-client.ts` をどう統合するか

### 判断後のフェーズ再開

- 案A選択時: Phase 3 を「差分追加版」として再設計 → 実行
- 案B選択時: Phase 3 を仕様通り実行（テーブル名をV2にする）
- 案C選択時: Phase 3 を「既存テーブル置換版」として再設計 → 既存API・UI改修も含める
