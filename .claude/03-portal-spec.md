# 03. Portal 仕様メモ

## 主要モデル

### InterviewRecord（面談記録）

面談の中核モデル。**モデル名は `InterviewRecord`**（`Interview` ではない）。
DB テーブル名は `interview_records`、Prisma Client では `prisma.interviewRecord` でアクセス。

```prisma
model InterviewRecord {
  id                String    @id @default(cuid())
  candidateId       String    @map("candidate_id")
  interviewDate     DateTime  @map("interview_date")
  startTime         String    @map("start_time")
  endTime           String    @map("end_time")
  duration          Int?
  interviewTool     String    @map("interview_tool")
  interviewerUserId String    @map("interviewer_user_id")
  interviewType     String    @map("interview_type")
  interviewCount    Int?      @map("interview_count")
  resultFlag        String?   @map("result_flag")
  interviewMemo     String?   @map("interview_memo") @db.Text
  previousMemo      String?   @map("previous_memo") @db.Text
  summaryText       String?   @map("summary_text") @db.Text
  rawTranscript     String?   @map("raw_transcript") @db.Text
  resumePdfFileId   String?   @map("resume_pdf_file_id")
  createdByUserId   String    @map("created_by_user_id")

  // Phase 3: 状態管理
  status   String  @default("draft")
  isLatest Boolean @default(true)

  // Phase 3: AI解析結果キャッシュ
  aiAnalysisResult Json?
  aiAnalysisAt     DateTime?

  // Phase 3: 自動保存メタ
  lastSavedAt   DateTime?
  lastEditedBy  String?
  autosaveToken String?

  // T-029 Phase D-2: Google Form 自動生成
  googleFormId        String?   @map("google_form_id")
  googleFormEditUrl   String?   @map("google_form_edit_url") @db.Text
  googleFormViewUrl   String?   @map("google_form_view_url") @db.Text
  googleFormCreatedAt DateTime? @map("google_form_created_at")
  googleFormStatus    String?   @map("google_form_status")
  googleFormError     String?   @map("google_form_error") @db.Text

  detail        InterviewDetail?
  rating        InterviewRating?
  memos         InterviewMemo[]
  attachments   InterviewAttachment[]
  workHistories WorkHistory[]
  createdAt     DateTime
  updatedAt     DateTime
}
```

### InterviewAttachment（面談添付ファイル）

⚠️ ストレージは **Supabase Storage**（CandidateFile = Google Drive とは完全に別系統）。
詳細は `02-data-sources.md`「ファイルストレージの二系統」、`12-pitfalls.md` 罠ポイント #27 参照。

```prisma
model InterviewAttachment {
  id                String    @id @default(cuid())
  interviewRecordId String    @map("interview_record_id")
  fileName          String    @map("file_name")
  fileType          String    @map("file_type")
  filePath          String    @map("file_path")  // Supabase Storage パス
  fileSize          Int       @map("file_size")
  mimeType          String?
  analysisStatus    String    @default("pending")
  analysisResult    Json?
  analysisError     String?
  analyzedAt        DateTime?
  memo              String?
  uploadedAt        DateTime  @default(now())
  uploadedBy        String?
}
```

### InterviewMemo（面談メモ）

```prisma
model InterviewMemo {
  id                String   @id @default(cuid())
  interviewRecordId String   @map("interview_record_id")
  title             String
  flag              String       // "初回面談" / "その他" 等
  date              DateTime     // 日付のみ保存（T00:00:00.000Z 形式、Task と同形式）
  time              String?      // "HH:MM"
  content           String   @db.Text
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  interview InterviewRecord @relation(...)
  @@map("interview_memos")
}
```

⚠️ **日付保存形式の重要事項**: T-032 で Task と同形式（`new Date("YYYY-MM-DD").toISOString()`）に統一済み。新規 Memo 作成時は `now.toLocaleDateString('sv-SE')` で日付のみ送信、表示時も `toLocaleDateString('sv-SE')` で抽出する（`toISOString().slice(0,10)` は禁止、JST 0:00-8:59 で前日表示バグ発生）。詳細は `12-pitfalls.md` 罠ポイント #17 参照。

⚠️ **handleUpdateMemo シグネチャ**: `(memoId, field, value)` の **3 引数**。オブジェクト渡し `{ field: value }` ではない。

## 主要API一覧（求職者詳細関連）

| エンドポイント | メソッド | 用途 |
|--|--|--|
| `/api/interviews/[id]/memos` | GET | メモ一覧取得 |
| `/api/interviews/[id]/memos` | POST | メモ新規作成 |
| `/api/interviews/[id]/memos/[memoId]` | PATCH | メモ部分更新（field/value 形式） |
| `/api/interviews/[id]/memos/[memoId]` | DELETE | メモ削除 |
| `/api/candidates/[candidateId]/google-form/extract-resume` | POST | T-029 Phase D-2: Drive から PDF/.txt 取得 → candidate-intake へ multipart 転送 |
| `/api/candidates/[candidateId]/google-form/generate-form` | POST | T-029 Phase D-2: questionsJson 生成（candidate-intake 経由）|
| `/api/candidates/[candidateId]/google-form/create-form` | POST | T-029 Phase D-2: Google フォーム作成 + InterviewRecord 永続化（isLatest=true 時）|

## 主要なコンポーネント

| コンポーネント | パス | 主要機能 |
|--|--|--|
| `InterviewForm.tsx` | src/components/candidates/ | 面談履歴の入力フォーム（1700+ 行、頻出修正対象、構造マップは `14-ui-component-map.md`）|
| `GoogleFormCreatorModal.tsx` | src/components/candidates/ | T-029 Phase D-2: AI Google フォーム自動生成モーダル（3 段階パイプライン UI、ファイル選択、経験職種カテゴリ選択、進捗表示）。T-038: open 時に `isLatest=true` の InterviewRecord から `googleFormEditUrl`/`googleFormViewUrl` を取得し、既存 URL ありなら completed step へジャンプして再表示。「新しく作り直す」ボタン（confirm 付き）で `handleResetAll()` 流用、新規作成時は DB 上書き。|

## 主要ライブラリ関数

| 関数 | パス | 用途 |
|--|--|--|
| `downloadFileFromDrive(fileId)` | `src/lib/google-drive.ts` | CandidateFile の Drive バイナリを base64 取得（Phase D-2 で使用）|

## よく参照すべきファイル

- 面談入力: `InterviewForm.tsx`（1700+行、頻出修正対象、構造マップは `14-ui-component-map.md` 参照）
- 面談メモ API: `src/app/api/interviews/[id]/memos/route.ts`
- 面談メモ更新 API: `src/app/api/interviews/[id]/memos/[memoId]/route.ts`
- Google Form 自動生成: `src/components/candidates/GoogleFormCreatorModal.tsx` + `src/app/api/candidates/[candidateId]/google-form/*`
- 経験職種カテゴリ定数: `src/constants/google-form-categories.ts`（21 サブカテゴリ × 7 大項目、candidate-intake `specs/generate_form_prompt.yaml` と同期）

---

## T-066: 日報・予実管理機能

### スケジュール SSoT は portal

- `DailySchedule` + `ScheduleEntry` が予定の唯一の正。Google Calendar は外部ミラー（calendarEventId で紐付け）。
- 完了状態は `ScheduleEntry.isCompleted`（portal DB）。Calendar 側には完了概念を持たせない。
- 進捗バーはクライアント計算（永続化なし）。

### 面談実施判定（厳守）

- `InterviewRecord.resultFlag` は合否ではなく「紹介ステータス／辞退」の混合。約30% が null。
- 「辞退系」は **`連絡なし辞退`／`連絡あり辞退`／`辞退`** の 3 値（定数 `INTERVIEW_DECLINED_FLAGS`）。
- それ以外（**null を含む**）は実施扱い。空欄は入力漏れだが「実施はした」と見なす。
- 初回/既存判定は `interviewCount`（=1 初回、>=2 既存）。`interviewType` 文字列で判定しない（UI 定数外の "初回面談" が大量混在）。
- 面接対策のみ `interviewType === "面接対策"` で抽出（種別でしか取れないため例外的）。

### CA 数値の集計テーブル早見

| 指標 | 算出元 | 集計フィールド | 紐づきキー | 窓 |
|--|--|--|--|--|
| 初回面談 予定/実施 | InterviewRecord (interviewCount=1) | interviewDate | interviewerUserId=Employee.id | 当日（＋実施率は当月も） |
| 既存面談 | InterviewRecord (interviewCount>=2, 辞退系除く) | interviewDate | 同上 | 当日 |
| 面接対策 | InterviewRecord (interviewType="面接対策") | interviewDate | 同上 | 当日 |
| 求人検索 | CandidateFile (category=BOOKMARK, archivedAt=null) | createdAt | uploadedByUserId=User.id | 当日（＋紹介率は当月） |
| 求人紹介 | CandidateFile (category=BOOKMARK, lastExportedAt≠null) | lastExportedAt | 同上 | 当日（＋紹介率は当月） |
| エントリー | JobEntry | entryDate | careerAdvisorId=Employee.id | 当日（＋率は当月） |
| 書類通過 | JobEntry | documentPassDate | 同上 | 当日（＋率は当月） |
| 内定 | JobEntry | offerDate | 同上 | 当日（＋率は当月） |
| 承諾 | JobEntry | acceptanceDate | 同上 | 当日（＋率は当月） |

集計実装は `src/lib/dailyReport/metrics.ts:computeCaMetrics`。JST 境界は `src/lib/dailyReport/jstDate.ts` 経由のみ（罠 #36 参照）。

### モデル

- `EmployeeJobCategory` enum（`CA`/`MARKETING`/`OFFICE_AND_MGMT`）。`Employee.jobCategory` に nullable で持つ。NULL はコメントのみフォーマットへフォールバック。
- `DailyReport`：1 ユーザー × 1 日。`numbers`(Json) に metrics スナップショット、`comment` に社員入力、`aiBody` に AI 生成本文。`jobCategory` を保存時点でスナップショットして将来の職種変更後も過去日報のフォーマットを凍結。
- `DailyReportChat`：AI 会話履歴（ScheduleChat と同じパターン）。

### AI 入力ルール

- AI には `metrics.ts` で算出済みの**集計値**と予実サマリのみを渡す（仕様 #10 厳守）。
- 生の `InterviewRecord` / `JobEntry` / `Candidate` を AI に流してはいけない（数字の整合・PII 双方の事故源）。
- model は `claude-sonnet-4-20250514` 固定（schedule/chat と揃える）。

### 関連ファイル

- `src/lib/dailyReport/constants.ts`：辞退系定数、職種→フォーマット解決
- `src/lib/dailyReport/jstDate.ts`：JST 境界ヘルパ
- `src/lib/dailyReport/metrics.ts`：CA 数値の集計
- `src/lib/dailyReport/prompt.ts`：職種別 system prompt
- `src/lib/dailyReport/featureFlag.ts`：`DAILY_REPORT_ENABLED`（デフォルト OFF）
- `src/app/api/daily-report/route.ts`：GET（状態取得）、POST（下書き/確定）
- `src/app/api/daily-report/chat/route.ts`：AI チャット
- `src/components/dailyReport/DailyReportChatDrawer.tsx`：右スライドイン会話 UI
- `src/components/dashboard/DashboardTabs.tsx`：3 タブ切替（Client）

## T-071: 実績表機能（ダッシュボード）

日報の CA 数値（T-066）を土台に、複数期間（日/週/月/3か月/半期/年）で同じ指標を俯瞰する実績表。

### 集計の汎用化（metrics.ts）

- `computeCaMetricsForRange({ userId, employeeId, from, to })`：from〜to の**単一レンジ**で全 CA 指標を集計する汎用関数（T-071 新設）。率の分母は同一レンジ内の母数。
- `computeCaMetrics({ userId, employeeId, dateStr })`（日報用・当日+当月）は `computeCaMetricsForRange` を**当日窓と当月窓の2回呼ぶラッパー**に置き換え済み。出力 `CaDailyMetrics` は T-066 から不変（リグレッションなし）。
  - count 系=当日窓、率系=当月窓。当月窓は `jstMonthStart` 〜 `jstNextMonthStart - 1ms`（従来の `lt nextMonthStart` と等価）。
- キー対応は T-066 のまま厳守：検索/紹介=User.id（uploadedByUserId）、面談=Employee.id（interviewerUserId）、エントリー=Employee.id（careerAdvisorId）。
- 面談実施判定は `{ OR: [{ resultFlag: null }, { resultFlag: { notIn: 辞退系 } }] }`（罠 #37 のまま）。

### 期間レンジ（jstDate.ts / periods.ts）

- `jstWeekStart`（**月曜始まり**）、`jstQuarterStart`（2か月前の月初）、`jstHalfStart`（暦半期 1/1 or 7/1）、`jstYearStart`（1/1）、`jstDayOfWeek` を追加。
- `src/lib/dailyReport/periods.ts`：6 期間の定義（`PERFORMANCE_PERIODS`）と `periodRange(key, todayStr)`。`to` は常に今日 23:59:59.999 JST。
- 任意期間指定は本実装スコープ外（from/to 引数化済みなので後付け可能）。

### API

- `GET /api/performance?employeeId=Y`：指定 CA の 6 期間分の指標をまとめて返す（`Promise.all`）。employeeId 省略時はログインユーザー本人を解決。閲覧権限は**全 CA 可**（admin 限定にしない＝確定仕様）。
- `GET /api/performance/advisors`：`jobCategory='CA'` の active Employee 一覧（担当セレクト用）＋本人 employeeId。

### インデックス（T-071 migration `20260605120000_t071_performance_indexes`）

- 集計クエリ `WHERE key = X AND dateField BETWEEN from AND to` 用の複合インデックスを追加：
  - `interview_records (interviewer_user_id, interview_date)`
  - `candidate_files (uploaded_by_user_id, created_at)` / `(uploaded_by_user_id, last_exported_at)`
  - `job_entries (career_advisor_id, {entry_date|document_pass_date|offer_date|acceptance_date})`
- `CREATE INDEX IF NOT EXISTS`（冪等）。`prisma migrate deploy` はトランザクション内実行なので CONCURRENTLY は不可。対象は数千行規模でロックは数ミリ秒のため通常 CREATE INDEX で実害なし。schema.prisma にも `@@index` を追加済み（drift 防止）。
