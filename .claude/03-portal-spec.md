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
### 集計の軸と定義（T-071 確定・実績ベース）

実績表は「過去に何件紹介し、何件通過し、何件内定したか」の**累積実績**を見るもの（現在進行中の有効案件ではない）。

- キー対応（厳守）：
  - 検索/紹介＝**User.id**（`uploadedByUserId`）。変更しない。
  - **面談＝担当軸＝候補者の担当 CA `candidate.employeeId`（Employee.id）**。実施者軸（`interviewerUserId`）は使わない。
  - **エントリー以降＝担当軸＝`candidate.employeeId`**。
- ⚠️ **`JobEntry.careerAdvisorId` は使わない**：実データの 99.9%（28007 行中 27981 行）が NULL の実質未使用カラム。管理画面 `/api/entries` の担当フィルタも `careerAdvisorName → candidate.employee.name`（`EntryBoard.tsx` が送る）。
- ⚠️ **`interviewerUserId`（実施者軸）も使わない**：岡田=面談官（実施者 初回58/担当0）、安藤=CA（実施者 初回5/担当78）のように役割で乖離が大きく、CA 実績を表さない。担当軸なら面談管理「担当CA=大野」と一致（初回 59=59 検証済み）。
- **無効/アーカイブの扱い**：
  - 無効（`isActive=false`）は**含む**（過去実績の一部。除外しない）。← T-071 で一旦入れた `isActive:true` 絞りは撤回。
  - アーカイブ（`archivedAt` あり）は**除く**（削除扱い。`archivedAt: null` のみ）。
- **エントリー各段階は到達ベース累積 × 候補者ユニーク人数**（「現在その段階」ではなく「その段階に到達した**候補者が何人いるか**」）：
  - ⚠️ **候補者ユニーク（`COUNT(DISTINCT candidateId)`）で数える**（T-071 後修正）。レコード件数（延べ応募数）ではない。実装は `prisma.jobEntry.findMany({ select:{candidateId}, distinct:["candidateId"] }).length`（`metrics.ts:countUniqueCandidates`）。
    - 同一候補者が同月に複数社で同段階に到達 → その月は **1**（例：大野5月は延べ114応募だが候補者16人 → エントリー=16）。
    - 月をまたげば各月で別カウント（レンジが別）。
  - エントリー（応募到達）＝ `entryFlag IN {応募,エントリー,書類選考,面接,内定,入社済}`（求人紹介除外）、`entryDate` がレンジ内の候補者ユニーク。`hasEntry`/`hasJoined` は全件 false の未使用フィールドで使えない。
  - 書類通過＝ `documentPassDate` がレンジ内の候補者ユニーク（非 null＝到達。T-075 で過去復元・自動入力済み）。
  - 内定＝ `offerDate`、承諾＝ `acceptanceDate` がレンジ内の候補者ユニーク。
  - 各段階は「その段階の日付」でレンジ絞り。中間段階を後で通過した案件も到達としてカウント（管理画面の current-state タブ件数とは概念が異なり一致しない。タブ＝現在地、実績表＝到達累積×人数）。
  - **求人検索/紹介は件数のまま**（User.id軸・1人複数件OK・変更なし）。**面談（初回/既存/対策）は現状維持**（初回は interviewCount=1 で候補者1件なので実質ユニーク）。
  - ⚠️ **率は出さない方針**（人数のみ）：月内の段階間率はファネルが月をまたいで分母0になり破綻するため、率の正しい窓は後段階。`entry.rate` 等のフィールドは残るが人数比で意味は限定的。
- 面談実施判定は `{ OR: [{ resultFlag: null }, { resultFlag: { notIn: 辞退系 } }] }`（罠 #37 のまま）。初回/既存は interviewCount、面接対策は interviewType（不変）。
- 各率の分子は上記修正後の値、分母は同レンジ内の前段階数（現状維持）。
- **検証（管理画面 真値突合・大野）**：年(1/1-今日) entry=428 / 書類通過45 / 内定15 / 承諾9 / 面談初回52(予定56) / 既存40 / 対策15。3か月 entry=218。当月6月 entry=34 面談初回7/8。面談初回(全期間)=59 が面談管理「担当CA=大野」と完全一致。他CA（安藤 entry369・面談70、南條 entry224・面談26、岡田 entry2・面談0）も整合。
- 日報（`computeCaMetrics`）にも同じ軸・定義が波及（ラッパー経由）。日報の当日/当月も「担当候補者ベース」になる。

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

## T-073: 目標設定機能（実績表）

実績表（PerformancePanel）の「🎯 目標登録」ボタンから、CA 個人の**月次目標**を設定する。逆算で各段階の必要数を算出し、週へ営業日按分する。

### モデル `PerformanceTarget`（migration `20260606000000_t073_performance_target`）

- `@@unique([employeeId, yearMonth])`（1 CA × 1 月）。保存は**月目標のみ**（週按分は表示時計算）。
- 起点：`targetRevenue`（目標売上）、`unitPrice`（売上単価）。
- 各段階の目標数：`interviewCount`（面談初回）/`introductionCount`/`entryCount`/`documentPassCount`/`offerCount`/`acceptanceCount`、任意で `existingInterviewCount`/`interviewPrepCount`。すべて **Float（小数保持）**。
- 各段階の率（隣接段の比、0〜1）：`introductionRate`（面談→紹介）/`entryRate`（紹介→エントリー）/`documentPassRate`（エントリー→書類通過）/`offerRate`（書類通過→内定）/`acceptanceRate`（内定→承諾）。

### 逆算（`src/lib/performance/reverseCalc.ts`・クライアント計算）

下から上へ：承諾 = `targetRevenue / unitPrice` → 内定 = 承諾/承諾率 → 書類通過 = 内定/内定率 → エントリー = 書類通過/書類通過率 → 紹介 = エントリー/エントリー率 → 面談 = 紹介/紹介率。小数保持・整数に丸めない。除数0/未満は null（未確定）。

### 営業日・週按分（`src/lib/performance/businessDays.ts`）

- **祝日マスタは DB テーブルではなく `@holiday-jp/holiday_jp` npm ライブラリ**（attendance/business-days.ts と同じソース。2025/2026 含む複数年）。Holiday テーブルは作らない。
- `monthBusinessDays(ym)`：土日＋祝日を除く営業日数。`weeklyBusinessDays(ym)`：月曜始まりで月内を週分割し各週の営業日数（月をまたがない・部分週も1週）。
- `allocateToWeeks(monthTarget, weeks)`：各週＝`月目標 ÷ 月営業日 × その週営業日` を**切り上げ**、ただし**最終週で帳尻**（最終週 = 月目標 − 他週の合計）→ **合計＝月目標を保証**。内部は小数保持。

### API

- `GET /api/performance/target/reference?employeeId=Y&yearMonth=YYYY-MM`：左側の参考値。**昨年同月/前月/直近3か月(前月まで)/直近半年(前月まで)** の各段階 数・率。T-071 `computeCaMetricsForRange`（担当軸・到達ベース・無効含む・アーカイブ除く）を月レンジで呼ぶだけ。yearMonth 基準で期間算出（実績表の「今日起点」ではない）。
- `GET /api/performance/target?employeeId=Y&yearMonth=YYYY-MM`：既存目標取得。
- `POST /api/performance/target`：upsert（`employeeId_yearMonth`）。全数値フィールドの有限性を検証。

### リグレッション
- T-071 集計（`computeCaMetricsForRange`）は一切変更せず参考値で呼ぶだけ。年(1/1-今日) entry=428・面談52/56 が不変（内定/承諾は live データ増加で変動するが定義不変）。
