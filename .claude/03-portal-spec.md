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
- **`対象外` は使わない**（2026-06-07 に「支援終了_当社判断」へ統一・既存9件 UPDATE 済み・面談フォームの選択肢からも削除済み）。意味重複の整理。集計上はどちらも実施扱いのため数値不変。
- 初回/既存判定は `interviewCount`（=1 初回、>=2 既存）。`interviewType` 文字列で判定しない（UI 定数外の "初回面談" が大量混在）。
- 面接対策のみ `interviewType === "面接対策"` で抽出（種別でしか取れないため例外的）。

### 日報①（T-069）
- 日報タブ＝`DailyReportView`。**実績＝予定の完了チェック（`ScheduleEntry.isCompleted`）**で確定（新たな実績テーブルは作らない。予定通りいかなかった内容は所感欄に記載）。
- **所感は CA×日付で `daily_reports` に保存**（`scheduleNote`＝当日スケジュールの気づき / `metricsReflection`＝当日数字の振り返り。共に `TEXT?`・nullable・migration `20260608000000_t069_daily_report_notes`・冪等）。③AI壁打ちで読めるよう素直に保持。
- 当日実績＝`computeWeeklyMatrix` を当日レンジで（当月実績と同項目）。属性円4種＝`computeInterviewAttributes`（当日初回面談者）。`/api/daily-report?date=` が当日 dayMatrix・attributes・当日/翌日スケジュールを返す。
- 有効化＝`DAILY_REPORT_ENABLED`（環境変数 true、本番=master の `bizstudio-portal` と検証=staging の両サービス）。
- **提出＋LINE WORKS通知（T-069②）**：提出ボタン（右上）で `status=SUBMITTED`＋`submittedAt` セット＋`notifyDailyReport`（`src/lib/dailyReport/lineworks-notify.ts`、既存 `sendBotMessage` 流用、fire&forget）。下書きは**自動保存**（debounce 2.5s＋日付移動/離脱前 keepalive）で通知なし。提出時のみ通知。
  - 通知先＝`LINEWORKS_DAILYREPORT_BOT_ID`(=12416787)/`LINEWORKS_DAILYREPORT_CHANNEL_ID`（日報報告グループ）。⚠️ **本番サービスのみ設定**（staging には未設定＝staging では通知スキップ）。
  - メッセージ＝当日サマリ（面談[初回/既存]・求人紹介BM数・エントリー・選定率[BM/D]・スケジュール消化・**コメント**[統合本文 `reportBody`]）＋**本番直リンク `?date=`**。直リンクは `PORTAL_PUBLIC_URL` or 本番ドメイン定数で固定（`PORTAL_BASE_URL` はサービス毎に staging/本番が異なるため使わない＝staging から送っても本番に飛ばす）。
- **コメントは統合1本文＋確定制（T-069②後）**：`scheduleNote`/`metricsReflection`（①の2分割）→ **`reportBody`（統合・定型■1〜■6）** に集約（migration `20260608120000_t069_report_body_confirm`、`report_body TEXT` + `comment_confirmed_at TIMESTAMP` を nullable 追加・冪等）。**確定（`commentConfirmedAt`）でないと提出不可**。本文編集で未確定に戻す。入力UIは右アコーディオン＋中央ポップアップ＋自動保存が同一 `reportBody`（CA×日付1レコード）を更新。
- **日報AIアシスト（T-069③）**：`POST /api/daily-report/assist`（**Claude `claude-sonnet-4-6`**・`src/lib/claude.ts`・`ANTHROPIC_API_KEY`。Gemini不使用）。**日報skill `src/skills/daily-report-advisor/SKILL.md`（`getDailyReportSkill`）＋ `job-matching-advisor` skill** を system 注入（cache_control: ephemeral）。当日集計（`computeWeeklyMatrix`＋`computeJobSearchDay`＋支援中ACTIVE数）を**数字として渡す＝AIに計算させない（捏造防止）**。役割＝**■1〜■6 構造保持の整理本文（rewrittenBody）＋上司視点アドバイス（advice）**。JSON `{message, rewrittenBody, advice}`。会話は `DailyReportChat` 保存。旧 `/api/daily-report/chat`（aiBody用ドロワー）は別ルート・不変。BM目安＝支援中(ACTIVE)求職者数×0.8〜1.2件/日・選定率80%・エントリー率70%（skill 内）。
- **求人検索の行動量・精度（日報グラフ）**：`computeJobSearchDay`（`/api/daily-report`）。BM数＝`CandidateFile(BOOKMARK).createdAt` 当日、出力数＝`lastExportedAt` 当日、ABCD＝`aiMatchRating` 構成比、**選定率＝(A+B+C)÷合計BM**（D・未評価除外。D は「見る目」の指標として母数に含める）。担当＝`uploadedByUserId`。⚠️ **紹介保留＝BOOKMARK に `archivedAt` が入っただけ（aiMatchRating は実値保持。D の約77%が保留へ移動）**。グラフ用は **`archivedAt` 条件を付けない（保留含む）**。`archivedAt=null` だと D を取りこぼし選定率が100%固定になる。既存 metrics.ts の `jobSearched/jobIntroduced`（`archivedAt=null`）とは別物・不変。

### 当月実績タブの属性集計（T-071②・円グラフ4種）
- 母集団＝**当月の初回面談（`interview_count=1`・辞退系除外・担当軸 `candidate.employeeId`）**。4種とも母数＝初回面談数。
- **ランク**：`InterviewRating.overallRank`（A+/A/B+/B/C/D＋未評価）。
- **男女比**：`candidate.gender`（male/female/other/未設定）。
- **職種希望**：**`interview_details.desired_job_types`（JSON配列）の第1希望大分類 `[0]->>'large'`**（約10カテゴリ＋未設定）。⚠️ `candidate.desiredJobType1` は充足率21%・45粒度ラベルで使わない。面談詳細JSONの大分類（充足率73%）を使う。複数選択のうち第1希望のみ。
- **年齢層**：`candidate.birthday`→`AGE()` を `20代前半(20-24)/20代後半(25-29)/30代前半(30-34)/30代後半(35-39)/40代前半(40-44)/45歳以上(45+)/不明` に分類。
- API：`GET /api/performance/monthly`（`computeMonthlyAttributes`）。週別表は当月1日起算の週分割（`weeklyBusinessDays`・月内クランプ4-6週）で `computeWeeklyMatrix` を集計（数え方は実績表と共通）。

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
- model は `claude-sonnet-4-6` 固定（schedule/chat と揃える）。

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
  - **求人検索**＝CandidateFile BOOKMARK `createdAt`・User.id（`uploadedByUserId`）。マトリクス上部の「検索」件数は変更しない。
  - **求人紹介（提案）＝両ソース統合**：`JobEntry.jobIntroDate` ∪ `CandidateFile BOOKMARK.lastExportedAt`。担当は両方とも `candidate.employeeId` 軸に統一。記録方式が **2026/4 に移行**（jobIntroDate 〜2026/4、lastExportedAt 2026/4〜）したため、片方だけでは過去 or 現在が欠ける。同一候補者×同一JST日のクロスソース重複は CF 側を除外（移行重複ガード、実データ衝突0件）。初回/既存は統合イベントの候補者**通算最古日 `MIN(pdate)` 基準＝entry と同型**：`first_p >= レンジ開始`＝新規候補者、`first_p < レンジ開始`＝既存候補者（**候補者単位で排他、初回+既存=合計**）。`weeklyMatrix.ts` の `events` CTE（UNION ALL＋NOT EXISTS）＋`props` CTE（`MIN(pdate) OVER`）。⚠️ **`ROW_NUMBER`（rn=1/rn>1・イベント単位）方式は誤り**：1人月20件もの提案があると新規候補者も同月に2件目以降を持ち初回・既存に二重計上され「既存≒合計（構成比≒100%）」になる（T-071 修正①で MIN 方式へ是正、2026-06-07）。
  - **面談＝担当軸＝候補者の担当 CA `candidate.employeeId`（Employee.id）**。実施者軸（`interviewerUserId`）は使わない。
  - **面談ランク**＝`InterviewRating.overallRank`（`overall_rank`、InterviewRecord と 1:1・LEFT JOIN・nullable）。実データの値体系は **A+/A/B+/B/C/D ＋ 未評価(null)**（**S は存在しない**）。約55%のみ rank 付与。円グラフは**初回面談**（担当軸・到達ベース・実施判定・`interview_count = 1`）を rank 別集計、null は「未評価」に寄せ合計＝初回面談数（マトリクスの `interview.first`）。`computeInterviewRankBreakdown()`（weeklyMatrix.ts）。理由：その期間に新規で会った人の質の分布を見るため、2回目以降の再面談（評価重複）を除外。
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
- `GET /api/performance/weekly?employeeId=Y&anchorDate=YYYY-MM-DD&granularity=day|week|month`（T-071 マトリクス・FileMaker 形・粒度切替）：起算日を起点に、粒度に応じた列の実績＋目標＋TOTAL＋達成率を返す。レスポンスは `columns[]`（旧 `weeks[]` を一般化）＋ `total` ＋ `granularity`。後方互換：未指定＝week。
  - **粒度と列**（`src/lib/performance/columns.ts:buildColumns`）：
    - `day`：起算日から **5 日**（各列 1 日）。営業日列の businessDays=1、土日祝=0。
    - `week`：起算日から **5 週**（W1＝起算日〜最初の日曜の端数、W2-5＝月〜日。`splitIntoFiveWeeks`）。
    - `month`：起算月から **6 ヶ月**（各列 1 暦月）。
  - 数え方は全粒度共通（各列レンジ内の候補者ユニーク等、`computeWeeklyMatrix`）。検証済み（day/week/month とも各列 entry uniq が SQL と一致、2026-05=16人 等）。
  - **TOTAL は列別合計でなく全列カバー範囲で再ユニーク集計**（day で TOTAL=4 vs 単純合計6 のように一致しないのは仕様）。
  - **目標（粒度別）**：week＝起算月の月目標を 5 週営業日按分（`allocateToWeeks`、TOTAL=月目標）。day＝月目標÷月営業日数を営業日列に配分（土日祝列0、TOTAL=列合計）。month＝各列の月の登録目標そのまま（未登録は null、TOTAL=登録分の合計）。達成率＝TOTAL実績÷TOTAL目標。
  - 各週の実績＝`src/lib/performance/weeklyMatrix.ts:computeWeeklyMatrix`（raw SQL）。返す内容：
    - 面談：初回(count=1)/2回目(=2)/3回目以降(>=3)/合計、notDeclined。
    - 求人紹介・エントリー：**新規/既存/合計 × 件数(レコード)・人数(候補者ユニーク)・1人当たり(件数÷人数)**。新規＝その候補者の**初回**提案/エントリー（`MIN(date) OVER (PARTITION BY candidate)` がレンジ内）。既存＝初回がレンジより前。新規uniq+既存uniq=合計uniq を検証済み。
    - 選考状況：書類通過/内定/承諾（候補者ユニーク人数）＋決定売上(`SUM(revenue) WHERE acceptanceDate in range`)/決定単価(売上÷承諾人数)。
    - 数え方は `computeCaMetricsForRange` と整合（entry uniq・紹介件数・初回面談が一致することを検証済み）。
  - **TOTAL（5週合計）はユニーク再集計**：週別の単純合計ではなく、起算日〜W5末の全期間で `computeWeeklyMatrix` を再呼び出し（複数週にまたがる同一候補者の重複を排除）。週別合計とTOTALが一致しないことがあるのは仕様。
  - 週別目標＝対象月の `PerformanceTarget` を `allocateToWeeks`（T-073、5週営業日按分）で割り振り。対象メトリクス＝初回面談/合計提案人数/合計エントリー人数/書類通過/内定/承諾。
  - 達成率＝TOTAL 実績 ÷ TOTAL 目標（人数の達成率。段階間転換率とは別物）。
  - **率（段階間転換率）は週マトリクスでは出さない**（月をまたいで破綻するため）。率は cohort API で。
- **全員（全CA合算）**：weekly / cohort / detail は `employeeId=all` で全CA合算。担当軸/User フィルタを外すだけ（`computeWeeklyMatrix` の `allCas` フラグで SQL 述語を TRUE に）。数え方は同じ＝候補者ユニーク（COUNT DISTINCT）で重複排除。各候補者は単一 CA 担当のため 全員＝Σ個別＋無担当（検証：全員 entry=26＝個別CA合計26）。全員モードは目標なし（達成率「—」）。
- `GET /api/performance/detail?employeeId=&anchorDate=&granularity=&tab=&stage=`（T-071 明細一覧）：マトリクスと**同条件**で対象候補者の明細行を返す。
  - 期間＝起算日と粒度から算出した全列カバー範囲（= マトリクスの TOTAL 範囲）。担当軸（全員=all で全CA）・到達ベース（段階日付がレンジ内）・無効含む・アーカイブ除く。
  - tab：entry（entryDate・post-app）/ proposal（CandidateFile lastExportedAt）/ interview（interviewDate・notDeclined）/ selection（stage=documentPass|offer|acceptance の各日付）。
  - `summary.persons`（候補者ユニーク）＝マトリクスの「人数」と一致、`summary.records`＝明細行数（件数）。検証済み（大野 entry 人数8=8・件数80=80、書類通過12=12）。行は最大1000件。
- `GET /api/performance/cohort?employeeId=Y&months=6`（T-071 直近6ヶ月コホート率）：当月を含まない 6ヶ月前〜前月の各月コホートの段階別人数＋率。`employeeId=all` で全CA。
  - コホート＝その月に `entryDate` を持つ候補者（post-app・担当軸・archived除く・候補者ユニーク）。
  - そのコホート集合を後段階へ追跡（`BOOL_OR(documentPassDate IS NOT NULL)` 等、**月窓に縛らずいつか到達したか**で判定）。月をまたいで内定しても起点月コホートの内定として数える。
  - **率はコホート隣接段階基準**（前段が分母）：書類通過率＝書類通過÷コホート、内定率＝内定÷書類通過、承諾率＝承諾÷内定。月内の段階間率破綻（分母0で次段>0）が起きない。
  - JST 基準。`src/app/api/performance/cohort/route.ts`。

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
- `proposalPerPerson`（Float?・nullable、migration `20260607000000_t073_proposal_per_person`、`ADD COLUMN IF NOT EXISTS`）：**紹介の1人あたり件数**（手入力の係数）。**紹介件数＝`introductionCount`（紹介人数）× `proposalPerPerson`**。件数は再算出可のため係数のみ保存。達成率は人数ベースのため紹介件数は実績表の達成率に影響しない。

### 逆算（`src/lib/performance/reverseCalc.ts`・クライアント計算）

下から上へ：承諾 = `targetRevenue / unitPrice` → 内定 = 承諾/承諾率 → 書類通過 = 内定/内定率 → エントリー = 書類通過/書類通過率 → 紹介 = エントリー/エントリー率 → 面談 = 紹介/紹介率。小数保持・整数に丸めない。除数0/未満は null（未確定）。

### 営業日・週按分（`src/lib/performance/businessDays.ts`）

- **祝日マスタは DB テーブルではなく `@holiday-jp/holiday_jp` npm ライブラリ**（attendance/business-days.ts と同じソース。2025/2026 含む複数年）。Holiday テーブルは作らない。
- `monthBusinessDays(ym)`：土日＋祝日を除く営業日数。`weeklyBusinessDays(ym)`：月曜始まりで月内を週分割し各週の営業日数（月をまたがない・部分週も1週）。
- `allocateToWeeks(monthTarget, weeks)`：各週＝`月目標 ÷ 月営業日 × その週営業日` を**切り上げ**、ただし**最終週で帳尻**（最終週 = 月目標 − 他週の合計）→ **合計＝月目標を保証**。内部は小数保持。

### API

- `GET /api/performance/target/reference?employeeId=Y&yearMonth=YYYY-MM`：参考値。**昨年同月/前月/直近3か月(前月まで)/直近半年(前月まで)**。yearMonth 基準で期間算出（実績表の「今日起点」ではない）。
  - **紹介〜承諾の人数・率は実績表（`computeWeeklyMatrix`）と同一集計に統一**（2026-06-07 修正）：紹介人数＝`proposal.total.uniq`（両ソース統合・候補者ユニーク）、エントリー＝`entry.total.uniq`、書類通過/内定/承諾＝`selection.*`。**各率は人数ベースの隣接段比**（紹介率＝紹介÷面談、エントリー率＝エントリー÷紹介、…）。`proposalPerPerson`＝`proposal.total.perPerson`。
  - ⚠️ **旧実装は `computeCaMetricsForRange`（CandidateFile 単一・件数）を紹介人数に使い、紹介人数に件数が混入（575等）・エントリー率が件数分母で過小（2.8%）→ それを目標率に写すと逆算が爆発**していた。これが目標数字膨張の根本原因（%変換は元から正常）。人数ベース集計に統一して解消（エントリー率 57% 等の現実値に）。
  - 初回面談率（実施率＝実施÷予定）は `computeCaMetricsForRange` の値を維持（隣接段比ではない別指標）。
  - ⚠️ **紹介率の分母＝`matrix.interview.total`（合計面談＝first+second+thirdPlus）**。a1c0321 で `interview.first`（初回面談）を渡してしまい紹介率が 100% 超になっていたバグを修正（前月93.3%→47.5%、3か月106.4%→64.9% 等）。半年で依然 >100% になるのは**過去面談履歴の未インポート**が原因（紹介＝候補者ユニーク・面談＝レコード数の単位差ではなく、面談レコードが不足しているため）。データ投入後に正常化する。reference API は表示用に `interviewTotal`・`interviewExisting` も返す。
  - **逆算の面談＝合計面談が母数（T-073）**：`reverseCalc` の面談段＝`紹介÷紹介率＝合計面談（totalInterviewCount）`。合計面談を **初回%（`firstInterviewRatio` 手入力）** で内訳化＝初回面談（合計×初回%）／既存面談（合計×(1-初回%)）。内訳は逆算チェーンに影響しない。**保存：interviewCount＝初回面談**（実績表の達成率は初回実績と比較するため初回を保存）／**existingInterviewCount＝既存**／**firstInterviewRatio（0〜1・nullable・migration `20260608140000_t073_first_interview_ratio`）**。週按分は合計面談。表示順＝合計面談→初回%→初回面談→既存面談。
  - **各週の内訳・率＋決定単価参考値（T-073 Phase A+B・表示のみ）**：週按分の各週に 初回面談＝合計面談の週按分×初回%・既存面談＝同×(1-初回%)（各週 初回+既存=合計面談按分）、1人あたり件数・紹介率は月固定値を各週表示。reference API は **`decidedUnitPrice`（決定売上÷決定数）** を返し、参考値テーブルに「売上単価（決定単価）」行を表示（売上未記録期間は「—」）。集計本体（computeWeeklyMatrix/allocateToWeeks）・按分対象・逆算・保存は不変。
  - **週按分の手動調整（T-073 Phase C）**：目標登録モーダルで **初回面談・既存面談の各週セルのみ手入力可**（合計面談・紹介・エントリーは自動配分のまま）。**合計面談（各週）＝初回+既存で自動更新**（直接編集不可）。未調整の週は自動配分（合計面談の週按分×初回%）。超過＝初回+既存の週合計が月の合計面談目標を超えたら赤＋アラート＋**保存ブロック**。「自動配分に戻す」で破棄。保存は **`weeklyOverrides Json?`**（`{firstInterview:[週値…], existingInterview:[週値…]}`、未調整週 null・全未調整なら `Prisma.JsonNull`。migration `20260608180000_t073_weekly_overrides`・JSONB・nullable・冪等）。**手動週値は目標モーダル内だけ**＝実績表(weekly/route)の週目標・達成率は**月目標ベースのまま変更しない**。初回%(月固定)とは別（手動調整週は初回%でなく手入力実数を使う）。
  - `computeCaMetricsForRange`（日報の正本）自体は不変。reference が参照して参考値を組み替えるだけ（日報非波及）。
- `GET /api/performance/target?employeeId=Y&yearMonth=YYYY-MM`：既存目標取得。
- `POST /api/performance/target`：upsert（`employeeId_yearMonth`）。全数値フィールドの有限性を検証。

### リグレッション
- T-071 集計（`computeCaMetricsForRange`）は一切変更せず参考値で呼ぶだけ。年(1/1-今日) entry=428・面談52/56 が不変（内定/承諾は live データ増加で変動するが定義不変）。

### 社員詳細管理（/admin/users[id]・T-096、2026-06-10）

FileMaker「業務管理ファイル（社員管理）」を廃止しportalに一本化。社員詳細を6タブで管理。

- Employee 追加カラム（全nullable）: furigana / birthday(@db.Date) / gender / hire_date / resign_date / address / phone / emergency_contact_name / emergency_contact_relation / emergency_contact_phone
- 新規テーブル（Employee 1:1）: employee_bank_accounts（口座）/ employee_insurances（雇用保険・社会保険・扶養日付）/ employee_salaries（給与手当・支給総額カラムなし＝表示時計算）/ employee_equipments（貸与物・PW5種は *_encrypted に AES-256-GCM 暗号文）
- 新規テーブル（1:N）: employee_dependents（扶養家族・sortOrder付き・Employee直紐付け）
- API（全て admin 限定・route冒頭で getSessionUser + role !== "admin" チェック）:
  - POST /api/admin/employees — Employee作成＋Userリンク（同番号の未リンクEmployeeがあれば再利用）
  - GET/PATCH /api/admin/employees/[employeeId] — 詳細取得（PWは有無booleanのみ返す）/ {section, data} 形式のタブ単位部分更新（basic|bank|insurance|salary|equipment、1:1はupsert）
  - GET .../secrets?field= — PW1項目を復号して返す（ホワイトリスト: pcInitialPassword/lineworksPassword/appleIdPassword/googlePassword/office365Password）
  - POST/PATCH/DELETE .../dependents — 扶養家族CRUD（id はbody渡し）
- 暗号化: src/lib/secret-encryption.ts（encryptSecret/decryptSecret）。実体は src/lib/encryption.ts の AES-256-GCM（無変更）、鍵 MANUS_KEY_ENCRYPTION_SECRET（本番・staging両方設定済み）
- 有休は新規モデルなし: Employee.paidLeave + LeaveRequest を統合表示。残日数編集は既存 PATCH /api/attendance/admin/employees を呼ぶ（approval.ts 無変更）
- 入力整形の単一ソース: src/lib/employee-detail.ts（日付は "YYYY-MM-DD"→UTC midnight、罠#17準拠）
- 在籍状態の表示: active=在籍 / disabled=退社（詳細ページは Employee.status、一覧は User.status のまま。退職日カラムは持たず resign_date を別途追加）
- 年齢・在籍年数・支給総額はDB保存せず表示時計算
- 既存 PATCH /api/admin/users/[id] は無変更（名前・メール・権限・職種の既存モーダルの責務のまま）
- FileMaker既存データの移行はしない（社員ごとに手入力運用）

### 自動補完マスタ（T-097, 2026-06-11）

社員詳細の入力補助。マスタは画面に持たず、コード入力時にAPIで引く。

- BankMaster: code(4桁String PK) → name。BranchMaster: (bankCode, branchCode)UNIQUE → name、bankCode FK。PostalCodeMaster: postalCode(7桁String @index) → address（同一郵便番号に複数行あり）
- Employee.postalCode(nullable) 追加
- 検索API（getSessionUser でログイン確認のみ・admin限定にしない。コードは数字以外除去＋ゼロ詰め正規化してから検索）:
  - GET /api/masters/banks/[code] → { code, name }
  - GET /api/masters/banks/[code]/branches/[branchCode] → { name }
  - GET /api/masters/postal-code/[code] → { matches: [{ address }] }（複数候補）
- 大量投入: scripts/seed-masters-t097.ts を `railway run npx tsx ... --dry-run/--execute` で本番webコンテナに前景実行。createMany 2000件チャンク・skipDuplicates。PostalCodeMaster は cuid PK のため count>0 ならスキップで二重投入防止。TSVは prisma/seeds/data/（LF・UTF-8・コードゼロ詰め）。投入実績: 銀行1205 / 支店29524 / 郵便124629
- migration.sql に1万行超のINSERTは書かない（deploy肥大化のためスクリプト分離）

### 社員履歴書AI解析（T-098＋追補, 2026-06-11）

履歴書・入社書類をAIで読み取り、社員詳細タブに仮入力（人が確認して保存・自動保存しない）。

- API: POST /api/admin/employees/[employeeId]/parse-resume（admin限定・DB/Drive保存しない読み捨て）
  - 複数ファイル: formData.getAll("files")（後方互換で単一 "file" も受理）
  - 制限: 最大5ファイル / 各10MB / 合計30MB、対応mimeType = PDF / Word(.doc,.docx) / 画像(PNG/JPEG/WebP/HEIC)、maxDuration 300
  - parser: src/lib/employee-resume-parser.ts の parseEmployeeResume(files[]) が全ファイルのinlineDataを1リクエストにまとめ、Gemini(gemini-3-flash-preview)が横断抽出（同一項目は最も信頼できる記載を採用）
  - 返却: 社員タブのstateキー準拠フラットJSON（読めない項目はnull）。後処理で型正規化（性別"男"/"女"のみ、コードはゼロ詰め、accountType"普通"/"当座"のみ、日付YYYY-MM-DD・罠#17準拠）
  - 既存 candidates/parse-resume（求職者向け）とは別経路で独立運用
- AI連携の標準: PDF→構造化JSONはGemini(GEMINI_API_KEY)、CA向けチャットはClaude(ANTHROPIC_API_KEY, src/lib/claude.ts)。ファイルは base64 inlineData でGeminiに直接渡す（OCR/抽出ライブラリ不要）

## 内定承諾報告タスク 自動生成・自動入力＋課金方式（master 6d8433b, 2026-06-23）

エントリー管理画面の内定承諾を起点に「内定承諾報告」タスク作成を半自動化し、テンプレートに課金方式ラジオを新設した機能。

### 発火・遷移（エントリー → タスク作成）

- 発火: エントリーで `entryFlag="内定"` かつ**今回の更新で** `entryFlagDetail="承諾"` になった瞬間（`EntryBoard.handleFlagUpdate` の PATCH 成功後 `maybeOfferAcceptancePrompt`）。確認ダイアログ「承諾報告のタスクを作成しますか？」を表示。既承諾行の他フラグ（companyFlag 等）更新は `flags` に entryFlagDetail を含まないため**非発火**。
- 遷移: 「作成する」で `/tasks/new?prefill=offer-acceptance&categoryName=内定承諾報告&candidateId&companyName&theoreticalAnnualIncome&feeRatePercent&revenue&feeType&acceptanceDate&joinDate&step=2`。日付は JST（`toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"})` で `YYYY-MM-DD`、罠#17）。null 値はクエリに載せない。
- 着地: 常に **Step2（テンプレート入力）**。職種/業種/勤務地/雇用形態がライブDBに残る場合は CA 手入力補完。

### 課金方式ラジオ（紹介手数料）

- 実装は `tasks/new/page.tsx` の `isNaitei` カスタムUIのみ。**`renderField()`・DBマスタ（TaskTemplateField）は不変**。
- 「理論年収」「紹介手数料（税抜き）」を `getVisibleFields` の `hiddenLabels` で generic 描画から除外し、ラジオ（固定/理論年収）で制御。
  - 理論年収方式: `round(理論年収 × 手数料% / 100)`（手数料%入力）。
  - 固定方式: 紹介手数料を直接入力。
  - 算出 helper: module `computeReferralFee(mode, theoryIncome, feeRate, fixedFee)`（`Math.round`、欠損は null=未保存）。表示と保存で共用。
- 最終値は submit の `extraFieldValues` でラベル「理論年収」「紹介手数料（税抜き）」へ格納。初期選択は `feeType`（ANNUAL_RATE→理論年収 / それ以外→固定）。

### 「内定承諾報告」テンプレート構成（訂正版）

- 定義元: DBマスタ `TaskCategory(name="内定承諾報告")` → `TaskTemplateField`。実行時 `/api/task-categories?includeFields=true` 取得。seed（`scripts/seed-task-categories.ts`）は初期値で、管理UI（`/admin/task-master/[categoryId]`）編集によりライブDBと乖離しうる（**ライブが真**）。
- seed 全11項目（備考以外は必須）: 対象者フルネーム / 企業名 / 理論年収 / 紹介手数料（税抜き）/ 内定承諾日(DATE) / 入社日(DATE) / 内定した職種 / 内定した業種 / 内定した勤務地（都道府県）/ 雇用形態 / 備考(任意)。
- `page.tsx` が5ラベル（対象者フルネーム/職種/業種/勤務地/雇用形態）を `hiddenLabels` で隠してカスタムUI置換（本機能でさらに 理論年収/紹介手数料（税抜き）を追加で隠す）。
- ※前回調査の「職種/業種/勤務地/雇用形態のみ」は不完全だった（generic 可視項目を見落とし）。上記が訂正版。
- **ライブDB実ラベルの確定（2026-06-24, railway ssh 実測）**: カテゴリ id=`cmmqtqm9h0000bg4fgac0yxue`。11項目: **対象者**(TEXT必須) / 企業名 / 理論年収 / 紹介手数料（税抜き）/ 内定承諾日(DATE) / 入社日(DATE) / 内定した職種 / 内定した業種 / 内定した勤務地（都道府県）/ 雇用形態 / 備考(任意)。
  - ⚠️ ライブの実ラベルは **「対象者」**（seed の「対象者フルネーム」ではない）。`hiddenLabels` は「対象者フルネーム」を隠す設定のため**「対象者」は隠れず可視のまま残る**。
- **対象者欄の自動充填（fix, 2026-06-24）**: 「対象者」は可視テンプレ項目。`page.tsx` の useEffect で、Step0 選択候補者から **`氏名（candidateNumber）`（全角括弧）** を `fieldValues[対象者field.id]` にセット（ラベル解決は live `fields` 配列の `label==="対象者"` 基準）。候補者選択（手動 / prefill=offer-acceptance）に追従、手入力上書きも可（deps に fieldValues を含めないため手入力では再発火しない）。可視項目なので submit は normalFieldValues 経由で送信。旧 submit の「対象者フルネーム」push は除去（実ラベル不一致で no-op だった・二重格納防止）。理論年収/職種等の hidden+カスタム項目は不変。

### エントリー(JobEntry)の取得元フィールド

- 日付: `offerDate`(内定日) / `offerDeadline`(承諾期限) / `acceptanceDate`(内定承諾日) / `joinDate`(入社日)。
- 財務(T-088): `feeType`(ANNUAL_RATE/FIXED) / `theoreticalAnnualIncome` / `feeRatePercent` / `revenue`(確定額SSoT)。
- いずれもエントリー一覧API（`Entry` 型）に露出済み・API改修不要。

## T-120: JobEntry.taskRequestedAt（「タスク依頼中」バッジ, master, 2026-07-01）

エントリー管理「タスク作成」（エントリー対応依頼）で依頼対象になった行を示すフィールド。エントリー管理の「タスク依頼中」バッジ表示に使う。

### モデル

- `JobEntry.taskRequestedAt DateTime? @map("task_requested_at")`（nullable・非破壊追加）。migration `20260701100000_t120_job_entry_task_requested_at`（`ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS task_requested_at TIMESTAMP(3)`・additive・冪等）。
- 記録タイミング: タスク作成成功時、**選択された JobEntry 行だけ**に `now()` を記録（`POST /api/tasks` の任意 `taskRequestedEntryIds: string[]` → `prisma.jobEntry.updateMany(... taskRequestedAt: new Date())`）。マーク失敗してもタスク作成は成功扱い。
- エントリー一覧API（`GET /api/entries`）は `include`（JobEntry scalar 全返却）のため、列追加だけで `Entry` 型に自動露出（API改修不要。`Entry` 型に `taskRequestedAt?: string | null` を追加）。
- 明示的なクリア処理は持たない。タイムスタンプは存在チェック専用で、日付整形しないため罠 #17（`toISOString().slice` 禁止）に抵触しない。

### バッジ表示条件（EntryTable）

- **`taskRequestedAt != null` かつ `entryFlag === "エントリー"` の間だけ表示**。フラグが「書類選考」以降へ進めば条件が外れて自動的に消える（タブ移動のみがトリガ。タスク完了状態には非連動）。
- 担当者2名化（佐藤 葵 + 見ル野 未来）と合わせた UI 詳細は `14-ui-component-map.md`「タスク作成ウィザード（/tasks/new）＋ エントリー『タスク依頼中』バッジ（T-120）」を参照。
