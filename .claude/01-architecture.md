# 01. アーキテクチャマップ

株式会社ビズスタジオの開発ecosystem全体像。新しいタスクを始める前にここを確認すれば、どのリポジトリに何の責務があるか即判断できる。

## リポジトリ一覧と責務

| リポジトリ | スタック | ホスト | 責務 |
|--|--|--|--|
| **bizstudio-portal** | Next.js / TypeScript / Tailwind / Prisma / PostgreSQL | Railway | CA 管理画面（求職者・面談・タスク・エントリー・経理）|
| **kyuujin-pdf-tool** | Python 3.9 / FastAPI / SQLAlchemy / SQLite | Railway | 求人マイページのバックエンド・データ管理 |
| **bizstudio-mypage** | Next.js / TypeScript | Vercel (mypage.bizstudio.co.jp) | 求職者向けマイページのフロントエンド |
| **candidate-intake** | TypeScript / Gemini API | Glitch | 面談ログ・PDF からの AI 解析エンジン |
| **ai-resume-generator** | TypeScript / Gemini / LibreOffice | (確認) | 履歴書・職務経歴書の自動生成 |
| **bizstudio-website** | Astro | Vercel (bizstudio.co.jp) | コーポレートサイト |
| **bizstudio-finance** | (確認) | Railway | 経理・会計管理（仕訳、銀行CSV、AI分類）|
| **scout-scheduler** | Vercel (schedule.bizstudio.co.jp) | Vercel | 日程調整アプリ |
| **manus-input-packager** | TypeScript | (確認) | キャリアカウンセリング資料生成 |
| **offerbox-scout-generator** | TypeScript / Railway | Railway | OfferBox スカウト文章生成 |

## データフロー（マイページ操作の例）

```
[求職者] 求人マイページで「気になる」を選択
  ↓
bizstudio-mypage (Vercel)
  ↓ PUT /api/external/mypage/{token}/feedback
kyuujin-pdf-tool (Railway / SQLite)
  ↓ JobFeedback テーブルに保存
  ↓ notify_portal_responses() 呼出（Phase A-1 以降）
bizstudio-portal (Railway / PostgreSQL)
  ↓ POST /api/external/candidate-response
  ↓ CandidateJobResponse に upsert
  ↓ createOrUpdateResponseTask で CA タスク作成
  ↓ LINE WORKS Bot 通知
[CA] portal でタスク確認
```

## データフロー（面談入力の例）

```
[CA] 面談履歴入力画面で「ログを解析して各カラムへ自動入力」
  ↓
bizstudio-portal の InterviewForm.tsx
  ↓ POST /api/interviews/[id]/analyze (intake 経由)
candidate-intake (Glitch)
  ↓ Gemini で面談ログ解析
  ↓ 結果を JSON 返却
bizstudio-portal
  ↓ Interview, Candidate モデルに保存
[CA] 結果確認
```

## データフロー（求人ブックマーク → マイページ送信）

```
[CA] 求人 PDF アップロード
  ↓
bizstudio-portal: CandidateFile (category=BOOKMARK) に保存
[CA] 「求人出力へ送信」or「移動」押下
  ↓
bizstudio-portal: send-to-job-tool API
  ↓ Step 1〜6 実行
kyuujin-pdf-tool: project, processing_unit, job, memo を作成
  ↓ portal に project URL 返却
  ↓ portal が CandidateFile.lastExportedAt を更新
[CA] portal でマイページURLを求職者に共有
[求職者] マイページで求人を閲覧・選択
```

## 関連リポジトリ間の認証

| 連携 | 認証方法 | 環境変数 |
|--|--|--|
| portal → kyuujinPDF | x-api-secret ヘッダ | KYUUJIN_API_SECRET (両方に設定) |
| kyuujinPDF → portal | x-api-secret ヘッダ | PORTAL_API_SECRET |
| mypage → kyuujinPDF | URLトークン認証 | （URL内 secret パラメータ）|
| portal → candidate-intake | (確認) | INTAKE_API_KEY |

## 主要ドメインモデル間の関係

```
[Candidate] (portal)
  ├─ files: CandidateFile[] (BOOKMARK / MANUAL / DOCUMENTS等)
  ├─ interviews: Interview[]
  ├─ jobEntries: JobEntry[]
  ├─ jobResponses: CandidateJobResponse[]  ← マイページ回答（webhook受信）
  └─ tasks: Task[]

[Project] (kyuujinPDF)
  ├─ processing_units: ProcessingUnit[] （バッチ単位）
  │   └─ jobs: Job[] （求人レコード）
  │       └─ feedbacks: JobFeedback[] （求職者の回答）
  ├─ memos: Memo[] （CAコメント）
  └─ share_tokens: ShareToken[] （マイページURL生成用）
```

## 重要な紐付けキー

| 軸 | 値 |
|--|--|
| 求職者の identity | `Candidate.candidateNumber` (portal) ↔ `ShareToken.job_seeker_id` (kyuujinPDF) |
| 求人の identity | `kyuujinPDF Job.id` (Int) = portal で `externalJobId` として保存 |
| ファイル名照合 | `CandidateFile.fileName` ↔ `Job.company_name`（正規化マッチ、04参照）|

## 関連リポジトリ間で同じ概念を別名で呼んでいる例

| portal側 | kyuujinPDF側 | 共通の意味 |
|--|--|--|
| `WANT_TO_APPLY` / `INTERESTED` | `apply` / `interested` | マイページ回答ステータス |
| `lastExportedAt` | submission の `submitted_at` | 送信日時 |
| `externalJobId` | `Job.id` | kyuujinPDF 求人ID |
| `candidateNumber` | `job_seeker_id` | 求職者番号 |

## 参照すべき詳細ファイル

- リポジトリ別の詳細仕様 → `03-portal-spec.md`、`04-kyuujinpdf-spec.md`、`05-mypage-spec.md`、`06-other-repos.md`
- データソース source of truth → `02-data-sources.md`
- バグパターン辞書 → `08-bug-patterns.md`
