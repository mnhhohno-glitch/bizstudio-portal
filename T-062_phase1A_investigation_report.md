# T-062 Phase 1A 調査レポート: Portal 既存 RPA 管理機能の全容

**調査日**: 2026-05-16
**対象リポジトリ**: bizstudio-portal
**目的**: T-062「7号機RPA新フロー構築（FileMaker廃止+Portal連携）」に向けた既存機能の包括的調査

---

## A. RPA管理画面の構造

### A-1. 画面一覧

| パス | ページ | タイプ | 概要 |
|------|--------|--------|------|
| `/rpa-error/chat` | `chat/page.tsx` | use client | AIエラー相談チャット（メイン入口） |
| `/rpa-error/logs` | `logs/page.tsx` | use client | エラーログ一覧（フィルタ・ページネーション） |
| `/rpa-error/logs/[id]` | `logs/[id]/page.tsx` | use client | エラーログ詳細（ノート・ステータス管理） |
| `/rpa-error/known-errors` | `known-errors/page.tsx` | use client | 既知エラーパターン管理（CRUD） |
| `/rpa-error/stats` | `stats/page.tsx` | use client | エラー統計ダッシュボード（Recharts） |

### A-2. レイアウトファイル

| パス | title |
|------|-------|
| `rpa-error/chat/layout.tsx` | RPAチャット |
| `rpa-error/logs/layout.tsx` | RPAエラーログ |
| `rpa-error/logs/[id]/layout.tsx` | RPAエラー詳細 #{id}（動的） |
| `rpa-error/known-errors/layout.tsx` | 既知エラー |
| `rpa-error/stats/layout.tsx` | RPAエラー統計 |

※ `rpa-error/` 直下にはルート layout.tsx なし

### A-3. 共有コンポーネント

**`src/components/rpa-error/RpaErrorNav.tsx`** — 4タブナビゲーション:
1. エラー相談 → `/rpa-error/chat`
2. エラー一覧 → `/rpa-error/logs`
3. 既知エラー管理 → `/rpa-error/known-errors`
4. 統計 → `/rpa-error/stats`

### A-4. サイドバー登録

`src/components/layout/Sidebar.tsx` L170:
```
{ href: "/rpa-error/chat", label: "RPAエラー管理", icon: "🤖" }
```
「管理」セクション内、全ユーザー共通表示。

### A-5. ユーティリティ

| ファイル | 関数 | 用途 |
|----------|------|------|
| `src/lib/rpa-error/formatDate.ts` | `formatDateJST()`, `formatDateTimeJST()`, `formatDateOnlyJST()` | JST日時フォーマット |
| `src/lib/rpa-error/parseKnownErrorSuggestion.ts` | `parseKnownErrorSuggestion()`, `removeJsonBlock()` | Claude応答からJSON提案を抽出 |
| `src/lib/rpa-error/system-prompt.ts` | `buildSystemPrompt()` | Claude向けシステムプロンプト（400行超、7台のRPA構成・フロー定義含む） |

### A-6. 各画面の主要機能

**チャット画面** (`chat/page.tsx`):
- チャットセッション管理（作成・一覧・選択）
- Claude API経由のAIエラー相談
- AI応答からの既知エラーパターン提案（JSON解析）
- エラーログ保存モーダル（号機/フロー/概要/重要度/担当者）
- 既知エラー登録モーダル（重複検知つき）
- エラーログと既知エラーの同時登録

**ログ一覧** (`logs/page.tsx`):
- フィルタ: 号機番号、ステータス、担当者
- ページネーション（skip/take）
- 行クリックで詳細遷移
- ステータス即時更新（未対応/対応中/解決済み）

**ログ詳細** (`logs/[id]/page.tsx`):
- エラー情報カード（号機/フロー/重要度/日時）
- ステータス・担当者変更
- 既知エラー解決策表示
- チャット履歴表示
- ノート（コメント）追加

**既知エラー管理** (`known-errors/page.tsx`):
- パターン名、キーワード（タグ入力）、解決策、URL、重要度
- CRUD操作（作成はadminのみ）
- 発生件数表示

**統計** (`stats/page.tsx`):
- 期間選択（1/3/6/12ヶ月）
- 未解決エラー件数カード
- 号機×月別の積み上げ棒グラフ（Recharts）
- エラーパターンランキング（Top5）

---

## B. Prisma モデル構造

### B-1. RPA関連モデル一覧

5モデル、すべて `prisma/schema.prisma` に定義:

#### RpaErrorChat（L939-949）

| フィールド | 型 | 備考 |
|-----------|-----|------|
| id | String | @id @default(cuid()) |
| userId | String | User リレーション |
| messages | RpaErrorChatMessage[] | 1:N |
| errorLog | RpaErrorLog? | 1:1（任意） |
| createdAt | DateTime | @default(now()) |
| updatedAt | DateTime | @updatedAt |

#### RpaErrorChatMessage（L952-961）

| フィールド | 型 | 備考 |
|-----------|-----|------|
| id | String | @id @default(cuid()) |
| chatId | String | RpaErrorChat リレーション |
| role | String | "user" \| "assistant" |
| content | String | @db.Text |
| createdAt | DateTime | @default(now()) |

カスケード削除: チャット削除時にメッセージも削除

#### RpaErrorLog（L964-985）

| フィールド | 型 | 備考 |
|-----------|-----|------|
| id | String | @id @default(cuid()) |
| machineNumber | Int | 号機番号 |
| flowName | String | フロー名 |
| errorSummary | String | @db.Text |
| status | String | @default("未対応") |
| severity | String? | 任意 |
| occurredAt | DateTime | 発生日時 |
| chatId | String? | @unique、RpaErrorChat 1:1 |
| knownErrorId | String? | RpaKnownError リレーション |
| notes | RpaErrorNote[] | 1:N |
| registeredBy | String | User リレーション（登録者） |
| assigneeId | String? | User リレーション（担当者） |
| createdAt | DateTime | |
| updatedAt | DateTime | |

#### RpaErrorNote（L988-998）

| フィールド | 型 | 備考 |
|-----------|-----|------|
| id | String | @id @default(cuid()) |
| errorLogId | String | RpaErrorLog リレーション |
| content | String | @db.Text |
| createdBy | String | User リレーション |
| createdAt | DateTime | |

カスケード削除: ログ削除時にノートも削除

#### RpaKnownError（L1001-1013）

| フィールド | 型 | 備考 |
|-----------|-----|------|
| id | String | @id @default(cuid()) |
| patternName | String | パターン名 |
| keywords | String[] | キーワード配列 |
| solution | String | @db.Text |
| solutionUrl | String? | 解決策URL |
| severity | String | 重要度 |
| errorLogs | RpaErrorLog[] | 1:N |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### B-2. User モデルの RPA 関連リレーション（L133-136）

```prisma
rpaErrorChats       RpaErrorChat[]  @relation("RpaErrorChatUser")
rpaErrorLogs        RpaErrorLog[]   @relation("RpaErrorLogUser")
rpaErrorNotes       RpaErrorNote[]  @relation("RpaErrorNoteUser")
rpaErrorAssignments RpaErrorLog[]   @relation("RpaErrorAssignee")
```

### B-3. 特記事項

- RPA専用の enum は未定義（status, severity, role はすべて String）
- 明示的インデックスなし
- ユニーク制約: `RpaErrorLog.chatId` のみ

---

## C. RPA API エンドポイント

### C-1. エンドポイント一覧（12本）

| ルート | メソッド | 行数 | 主な処理 |
|--------|---------|------|----------|
| `/api/rpa-error/chat` | GET, POST | 30 | チャット一覧取得 / 新規作成 |
| `/api/rpa-error/chat/[chatId]` | GET | 24 | チャット詳細（メッセージ込み） |
| `/api/rpa-error/chat/[chatId]/message` | POST | 67 | **Claude API 呼出**、メッセージ送受信 |
| `/api/rpa-error/chat/[chatId]/extract` | POST | 64 | **Claude API 呼出**、エラー情報抽出 |
| `/api/rpa-error/known-errors` | GET, POST | 34 | 既知エラー一覧 / 新規作成（admin） |
| `/api/rpa-error/known-errors/[id]` | PATCH, DELETE | 44 | 既知エラー更新 / 削除（admin） |
| `/api/rpa-error/known-errors/check-duplicate` | POST | 39 | キーワード重複検出（2件以上一致で警告） |
| `/api/rpa-error/logs` | GET, POST | 111 | ログ一覧（ページネーション）/ 新規作成 + **LINE WORKS通知** |
| `/api/rpa-error/logs/[id]` | GET, PATCH | 65 | ログ詳細 / ステータス・担当者更新 |
| `/api/rpa-error/logs/[id]/notes` | POST | 29 | ノート追加 |
| `/api/rpa-error/stats` | GET | 67 | 統計集計（未解決数・号機月別・ランキング） |
| `/api/rpa-error/users` | GET | 16 | アクティブユーザー一覧 |

### C-2. Claude API 連携

**メッセージ送信** (`/chat/[chatId]/message`):
- モデル: `claude-sonnet-4-20250514`
- max_tokens: 2048
- システムプロンプト: `buildSystemPrompt()` 経由（7台のRPA構成+フロー定義+既知エラーDB）
- 全チャット履歴をコンテキストとして送信

**エラー情報抽出** (`/chat/[chatId]/extract`):
- モデル: `claude-sonnet-4-20250514`
- max_tokens: 1024
- 号機番号（1-7）、フロー名、概要、重要度、既知エラーID を JSON で返却
- 既知エラーDB をコンテキストに含む

### C-3. LINE WORKS 連携

`/api/rpa-error/logs` POST 時、重要度が「要対応」または「緊急」の場合に通知:
- 環境変数: `LINEWORKS_TASK_BOT_ID`, `LINEWORKS_TASK_CHANNEL_ID`, `PORTAL_BASE_URL`
- 絵文字: 🚨（緊急）、🔴（要対応）
- エラー概要100文字切り詰め
- 詳細ページへのリンク付き

### C-4. アクセス制御

| エンドポイント | 認証 | 権限 |
|---------------|------|------|
| 既知エラー POST/PATCH/DELETE | getSessionUser | admin ロール |
| その他全て | getSessionUser | 認証済みユーザー |

---

## D. PDF アップロード・ファイル管理パターン

### D-1. ストレージアーキテクチャ（ハイブリッド）

| ストレージ | 用途 | 設定 |
|-----------|------|------|
| **Google Drive** | 求職者ファイル（PDF, DOCX, 画像等） | `GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID` |
| **Supabase Storage** | 面談添付ファイル（`interview-attachments`）、タスク添付（`task-attachments`） | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| **PostgreSQL** | 抽出テキスト、AI解析コメント | CandidateFile テーブル |

※ GCS（Google Cloud Storage）は未使用。バケット名はコード内にハードコード。

### D-2. ファイル API ルート一覧

**`/api/candidates/[candidateId]/files/` 配下:**

| ルート | メソッド | 概要 |
|--------|---------|------|
| `/` | GET | ファイル一覧（カテゴリ・アーカイブ状態フィルタ） |
| `/upload` | POST | Google Drive へアップロード（FormData、最大20MB） |
| `/counts` | GET | カテゴリ別件数 |
| `/bulk-download` | POST | 複数ファイルZIPダウンロード |
| `/attach-to-task` | POST | Google Drive → Supabase task-attachments へコピー |
| `/[fileId]` | GET/PATCH/DELETE | 詳細取得 / aiAnalysisComment更新 / Drive+DB削除 |
| `/[fileId]/download` | GET | Google Drive からダウンロード（base64） |
| `/[fileId]/archive` | POST | ブックマーク保留（理由・ノート付きソフト削除） |
| `/[fileId]/permanent` | DELETE | アーカイブ済みファイルの完全削除 |
| `/[fileId]/restore` | POST | アーカイブ復元 |
| `/[fileId]/replace-docx` | POST | DOCX差し替え |
| `/[fileId]/replace-xlsx` | POST | XLSX差し替え |

**`/api/candidates/[candidateId]/bookmarks/` 配下:**

| ルート | メソッド | 概要 |
|--------|---------|------|
| `/extract-text` | POST | PDF テキスト抽出（pdf-parse → 外部フォールバック） |
| `/send-to-job-tool` | POST | kyuujin-pdf-tool へ PDF 送信 + CAコメント同期 |
| `/analyze-batch` | POST | Claude Opus で AI 3軸評価 |
| `/restore-jobs` | POST | kyuujin-pdf-tool の除外求人を復元 |

### D-3. アップロードフロー

1. FormData で受信（ファイル + カテゴリ + メモ）
2. MIME/拡張子バリデーション（PDF, DOCX, XLSX, PPT, JPEG, PNG, WEBP, TXT）
3. Google Drive に求職者フォルダ作成/取得 → アップロード
4. CandidateFile レコード作成（driveFileId, driveViewUrl, driveFolderId）
5. BOOKMARK カテゴリの場合、`recalculateSubStatusIfAuto()` 実行

### D-4. ブックマーク処理フロー

```
アップロード → テキスト抽出 → AI 3軸評価 → kyuujin-pdf-tool 送信
                                               ↓
                                          CAコメント同期
                                          マイページ連携
```

---

## E. candidate-intake 連携

### E-1. 連携エンドポイント（4本）

| Portal API | candidate-intake エンドポイント | メソッド | リクエスト形式 | 用途 |
|-----------|-------------------------------|---------|-------------|------|
| `/api/interviews/[id]/analyze-with-intake` | `/api/portal/analyze-interview` | POST | JSON | 面談ログ+履歴書PDF のAI解析 |
| `/api/candidates/[id]/google-form/extract-resume` | `/api/intake/extract_resume` | POST | **multipart/form-data** | 履歴書PDF からの構造化データ抽出 |
| `/api/candidates/[id]/google-form/generate-form` | `/api/intake/generate_form` | POST | JSON | Google Form 質問JSON生成 |
| `/api/candidates/[id]/google-form/create-form` | `/api/intake/create_form_v2` | POST | JSON | Google Form 実体作成+ID永続化 |

### E-2. 認証

```typescript
headers: {
  "Content-Type": "application/json",
  "x-portal-secret": process.env.PORTAL_SHARED_SECRET,
}
```

### E-3. URL 解決順序

```typescript
const intakeUrl = process.env.CANDIDATE_INTAKE_URL
  || process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL
  || "https://candidate-intake-production.up.railway.app";
```

### E-4. データフロー

**面談解析** (`analyze-with-intake`):
- 入力: Supabase の面談添付ファイル（PDF + TXT）
- 出力: `filemaker_mapping`, `work_history[]`, `missing_items`
- マッピング: `src/lib/interview-analyzer-mapping.ts` で InterviewDetail フィールドに変換
- UI: `InterviewForm.tsx` L925 の「✨ ログを解析して各カラムへ自動入力」ボタン

**Google Form ワークフロー**:
- extract-resume → generate-form → create-form の3ステップ
- 最終ステップで InterviewRecord に formId/editUrl/viewUrl を永続化

### E-5. UI 連携

- `InterviewForm.tsx` L1759: AI解析ボタン（添付ファイルがある場合のみ表示）
- `DocumentsTab.tsx` L300-310: candidate-intake への直接リンク（面談サブタブ）

### E-6. 注意事項

- `extract_resume` のみ **multipart/form-data**（他は JSON）
- `candidate-flags.ts`（変更禁止）は candidate-intake の `flags.ts` と同期必須

---

## F. LINE WORKS 通知

### F-1. コアファイル

| ファイル | 関数 | 用途 |
|----------|------|------|
| `src/lib/lineworks.ts` | `getAccessToken()` | JWT Bearer フローで LINE WORKS API 2.0 トークン取得 |
| | `sendBotMessage(botId, channelId, text)` | ボットメッセージ送信 |
| `src/lib/attendance/lineworks-notify.ts` | `notifyPunchAction()` | 出退勤通知 |
| | `notifyAdminModificationRequest()` | 時間修正申請通知 |
| | `notifyAdminLeaveRequest()` | 有給申請通知 |
| | `notifyApprovalResult()` | 承認/却下結果通知 |
| `src/lib/task-notification.ts` | `notifyTaskCreated()` | タスク作成通知 |
| | `notifyTaskCompleted()` | タスク完了通知 |
| | `notifyTaskComment()` | タスクコメント通知 |

### F-2. 通知トリガーポイント

| トリガー | API ルート | 通知関数 | 条件 |
|---------|-----------|---------|------|
| タスク作成 | POST `/api/tasks` | `notifyTaskCreated()` | 常時 |
| タスク完了 | PATCH `/api/tasks/[id]/status` | `notifyTaskCompleted()` | 他の担当者+作成者に通知 |
| タスクコメント | POST `/api/tasks/[id]/comments` | `notifyTaskComment()` | コメント者以外に通知 |
| 3点セット一括作成 | POST `/api/tasks/bulk-create-3point` | `sendBulkNotification()` | 常時 |
| 出退勤 | `executePunch()` | `notifyPunchAction()` | 常時 |
| 時間修正申請 | POST `/api/attendance/correction` | `notifyAdminModificationRequest()` | 常時 |
| 有給申請 | POST `/api/attendance/leave` | `notifyAdminLeaveRequest()` | 常時 |
| 申請承認/却下 | POST `/api/attendance/approve/[token]` | `notifyApprovalResult()` | 常時 |
| RPAエラーログ作成 | POST `/api/rpa-error/logs` | `sendBotMessage()` | 重要度「要対応」or「緊急」 |
| 外部スケジュールタスク | POST `/api/external/create-schedule-task` | `sendBotMessage()` | 常時 |
| 求職者回答 | POST `/api/external/candidate-response` | `sendBotMessage()` | 常時 |

### F-3. 環境変数

| 変数 | 用途 |
|------|------|
| `LINEWORKS_CLIENT_ID` | OAuth クライアントID |
| `LINEWORKS_CLIENT_SECRET` | OAuth クライアントシークレット |
| `LINEWORKS_SERVICE_ACCOUNT` | サービスアカウント |
| `LINEWORKS_PRIVATE_KEY` | RS256 秘密鍵 |
| `LINEWORKS_TASK_BOT_ID` | タスク通知ボットID |
| `LINEWORKS_TASK_CHANNEL_ID` | タスク通知チャンネルID |
| `LINEWORKS_ATTENDANCE_BOT_ID` | 勤怠通知ボットID |
| `LINEWORKS_ATTENDANCE_CHANNEL_ID` | 勤怠通知チャンネルID |

### F-4. メンション機能

`<m userId="lineworksId">名前</m>` 構文でユーザーメンション。失敗時はプレーンテキストにフォールバック。

### F-5. ユーザー管理

- `User.lineworksId` フィールド（String?）で LINE WORKS アカウント紐付け
- `/api/admin/users/[id]/lineworks-id` PATCH で管理画面から設定
- `src/app/(app)/admin/users/LineworksIdButton.tsx` — 設定UIコンポーネント

---

## G. 求職者詳細画面タブ構造

### G-1. 2階層タブシステム

**第1階層（TOP_VIEWS, L94-97）:**

| キー | ラベル | コンポーネント | タイプ |
|------|--------|---------------|--------|
| `basic` | 基本 | CandidateHeader + サブタブ | デフォルト |
| `interview` | 面談履歴 | InterviewHistoryTab | インポート |

**第2階層（SUB_TABS, L101-107）:**

| キー | ラベル | コンポーネント | ファイル | タイプ |
|------|--------|---------------|---------|--------|
| `history` | 紹介履歴 | HistoryTab | `HistoryTab.tsx` (2700行超) | インポート |
| `documents` | 書類 | DocumentsTab | `DocumentsTab.tsx` | インポート |
| `tasks` | タスク | CandidateTasksTab | インライン (L979-1224) | インライン |
| `support` | 対策・サポート | SupportTab | インライン (L1229-1280) | インライン |
| `notes` | メモ | NotesTab | インライン (L1288-1395) | インライン |

### G-2. Support タブのネスト構造

| サブタブ | コンポーネント | 場所 | 内容 |
|---------|---------------|------|------|
| 面接対策 | InterviewTab | インライン L327-476 | 面接ガイド、ワークシート、PREP、AI自己分析 |
| 面談 | CounselingTab | インライン L512-634 | 事務職診断セッション、結果表示 |

### G-3. URL パラメータ

- `?view=basic|interview` → 第1階層制御
- `?tab=history|documents|tasks|support|notes` → 第2階層制御
- `?from=interviews` → 戻りリンクコンテキスト

### G-4. 主要モーダル

- EditModal（基本情報編集）
- MypageModal
- ScheduleModal
- GoogleFormCreatorModal（T-029, T-038）
- EndModal

---

## H. 重複チェック機構

### H-1. 現状のチェック機構

| 対象 | チェック方法 | 場所 | 状態 |
|------|------------|------|------|
| candidateNumber | DB ユニーク制約 + API バリデーション | `schema.prisma` L232 + `master/candidates/route.ts` L116-124 | **実装済み** |
| phone | なし | — | **未実装** |
| email | フォーマットバリデーションのみ | `CandidateRegistrationModal.tsx` L132-134 | **重複チェックなし** |

### H-2. Candidate モデルの一意制約

`prisma/schema.prisma` の Candidate モデル:
- `candidateNumber`: **@unique あり**
- `phone`: String?、ユニーク制約 **なし**
- `email`: String?、ユニーク制約 **なし**

### H-3. 電話番号正規化

- `parse-resume/route.ts` L59: 履歴書解析時に「ハイフンなし、数字のみ」で抽出
- **正規化ユーティリティは未実装**（重複検出用の電話番号比較機能なし）

### H-4. 他のコンテキストでの重複チェック

- **ジョブエントリー重複**: `entries/route.ts` L59-74 — candidateId + externalJobId の組み合わせチェック
- **RPA既知エラー重複**: `known-errors/check-duplicate/route.ts` — キーワード2件以上一致で警告
- **ファイルアップロード重複**: `FileUploadModal.tsx` L69-72 — ファイル名+サイズの一致チェック

---

## I. 環境変数一覧

### I-1. データベース

| 変数 | 用途 | 参照箇所 |
|------|------|---------|
| `DATABASE_URL` | PostgreSQL 接続文字列 | 50+ファイル |

### I-2. 認証・セキュリティ

| 変数 | 用途 |
|------|------|
| `NEXTAUTH_SECRET` | NextAuth.js 認証シークレット |
| `NEXTAUTH_URL` | NextAuth.js アプリURL |
| `PORTAL_SSO_SECRET` | SSO シークレット |
| `INTERNAL_API_KEY` | 内部 API 認証キー |
| `EXTERNAL_API_SECRET` | 外部 API 認証シークレット |
| `PORTAL_SHARED_SECRET` | candidate-intake 連携認証 |
| `NODE_ENV` | 環境判定 |

### I-3. AI/LLM サービス

| 変数 | 用途 | 主な使用箇所 |
|------|------|-------------|
| `GEMINI_API_KEY` | Google Gemini | 履歴書解析、面談AI整理、タスクAI整理 |
| `ANTHROPIC_API_KEY` | Anthropic Claude | ブックマーク評価、RPAチャット、アドバイザー、スケジュール |
| `OPENAI_API_KEY` | OpenAI | 終了コメント要約、終了通知生成、事務レポート |

### I-4. LINE WORKS（8変数、F-3参照）

### I-5. candidate-intake

| 変数 | 用途 |
|------|------|
| `CANDIDATE_INTAKE_URL` | サーバーサイド接続URL |
| `NEXT_PUBLIC_CANDIDATE_INTAKE_URL` | クライアントサイド接続URL |

### I-6. kyuujin-pdf-tool

| 変数 | 用途 |
|------|------|
| `KYUUJIN_PDF_TOOL_URL` | kyuujin PDF tool URL（デフォルト: `https://web-production-95808.up.railway.app`） |
| `KYUUJIN_API_URL` | kyuujin API URL（同上） |
| `KYUUJIN_API_SECRET` | API シークレット（`x-api-secret` ヘッダ） |

### I-7. Google 系

| 変数 | 用途 |
|------|------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | サービスアカウント JSON キー |
| `GOOGLE_DRIVE_CANDIDATE_FILES_FOLDER_ID` | 求職者ファイル用フォルダID |
| `GOOGLE_DRIVE_MANUAL_FOLDER_ID` | 手動アップロード用フォルダID |
| `GOOGLE_DRIVE_TEMPLATE_FOLDER_ID` | テンプレート用フォルダID |
| `GOOGLE_CALENDAR_CLIENT_ID` | Calendar OAuth クライアントID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Calendar OAuth シークレット |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Calendar OAuth リダイレクトURI |

### I-8. Supabase

| 変数 | 用途 |
|------|------|
| `SUPABASE_URL` | プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | サービスロールキー |

### I-9. その他

| 変数 | 用途 |
|------|------|
| `PDF_EXTRACTOR_URL` | 外部 PDF テキスト抽出サービス |
| `ALLOWED_ORIGINS` | CORS 許可オリジン |
| `MANUS_KEY_ENCRYPTION_SECRET` | Manus キー暗号化シークレット |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | アプリケーションベースURL |
| `NEXT_PUBLIC_BASE_URL` | 公開ベースURL |
| `PORTAL_BASE_URL` | Portal ベースURL（通知リンク用） |
| `NEXT_PUBLIC_FINANCE_URL` | Finance アプリURL |
| `NEXT_PUBLIC_MATERIAL_CREATOR_URL` | Material Creator URL |
| `NEXT_PUBLIC_JOB_ANALYZER_URL` | Job Analyzer URL |
| `NEXT_PUBLIC_RESUME_GENERATOR_URL` | AI Resume Generator URL |

**合計**: 46 ユニーク環境変数

---

## J. スクリプト一覧

### J-1. カテゴリ別スクリプト数

| カテゴリ | 件数 | 概要 |
|---------|------|------|
| 調査・監査（読み取り専用） | 13 | DB クエリ、外部API確認 |
| マイグレーション | 6 | データ変換・移行 |
| データ修正 | 9 | 誤データ修復 |
| シード・初期化 | 7 | マスタデータ投入 |
| インポート・一括操作 | 5 | 外部データ取り込み |
| アナウンス | 7 | リリース告知作成 |
| 同期・再計算 | 3 | 外部連携・ステータス再計算 |
| ユーティリティ | 6 | 変換・デバッグ |
| **合計** | **56** | |

### J-2. 主要スクリプト（T-062 に関連しうるもの）

**調査系:**
- `check-kyuujin-jobs.ts` — kyuujin PDF tool API から求人一覧取得
- `check-portal-jobs.ts` — portal hidden jobs vs kyuujin jobs 照合
- `sync-mypage-responses.ts` — kyuujin マイページ回答を portal へ同期
- `inspect-candidate-bookmarks.ts` — ブックマーク評価データ詳細ダンプ

**マイグレーション系:**
- `migrate-bee-job-entries.ts` — Bee 媒体 jobDb 修正（T-028）
- `migrate-document-sending-plan-T051.ts` — 求人送付フラグ移行（T-051）
- `recalculate-sub-status.ts` — 全アクティブ求職者の supportSubStatus 再計算

### J-3. 実行パターン

```bash
npx tsx scripts/[script-name].ts [options]
```

共通オプション:
- `--dry-run`: プレビュー（変更なし）
- `--execute`: 実行

### J-4. npm scripts（package.json）

```json
{
  "dev": "next dev",
  "build": "prisma generate && prisma migrate deploy && next build",
  "start": "next start",
  "lint": "eslint"
}
```

Prisma seed: `npx prisma db seed` → `prisma/seed.ts`

### J-5. 定期実行・cron

**スクリプト内に cron/スケジューラー設定なし。** 定期実行は外部管理または未実装。

### J-6. ドキュメント状況

`.claude/09-scripts-and-tools.md` は **存在しない**（未作成）。

---

## 総括

### 既存 RPA 管理機能の成熟度

| 領域 | 成熟度 | 備考 |
|------|--------|------|
| エラーログ管理 | ✅ 完成 | CRUD + フィルタ + ページネーション |
| AI エラー相談 | ✅ 完成 | Claude Sonnet 4 連携、提案抽出、既知エラー自動登録 |
| 既知エラー DB | ✅ 完成 | キーワード管理、重複検知、発生件数追跡 |
| 統計・可視化 | ✅ 完成 | Recharts 棒グラフ、ランキング、期間フィルタ |
| LINE WORKS 通知 | ✅ 完成 | 重要度ベース自動通知、メンション対応 |
| ファイル管理基盤 | ✅ 完成 | Google Drive + Supabase ハイブリッド、AI評価パイプライン |
| candidate-intake 連携 | ✅ 完成 | 4エンドポイント、面談AI解析+Google Form生成 |
| 重複検出 | ⚠️ 部分的 | candidateNumber のみ。電話/メール未対応 |

### T-062 で活用可能な既存基盤

1. **RPA エラー管理システム** — 7号機フロー追加はシステムプロンプト更新で対応可能
2. **LINE WORKS 通知基盤** — `sendBotMessage()` を新フローのイベントにも適用可能
3. **ファイルアップロードパイプライン** — Google Drive 連携パターンが確立済み
4. **candidate-intake 連携** — `x-portal-secret` 認証パターンが標準化済み
5. **Prisma + PrismaPg アダプタ** — スクリプト実行パターンが確立済み
