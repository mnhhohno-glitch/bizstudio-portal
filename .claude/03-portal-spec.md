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
- **求人検索の行動量・精度（日報グラフ）**：`computeJobSearchDay`（`/api/daily-report`）。BM数＝`CandidateFile(BOOKMARK).createdAt` 当日、出力数＝`lastExportedAt` 当日、評価内訳＝`aiMatchRating` 構成比（**T-146 以降 A/B+/B/C/D の5段階**・未評価含む）、**選定率＝出力数÷(BM数＋紹介保留数)＝`exportCount ÷ bmCount`**（T-092 で変更。`aiMatchRating` は参照しない＝D評価でも出力するため分子を評価で絞らない。※旧定義 `(A+B+C)÷合計BM` は廃止済み）。担当＝`uploadedByUserId`。⚠️ **紹介保留＝BOOKMARK に `archivedAt` が入っただけ（aiMatchRating は実値保持。D の約77%が保留へ移動）**。グラフ用は **`archivedAt` 条件を付けない（保留含む）**。`archivedAt=null` だと D を取りこぼし選定率が100%固定になる。既存 metrics.ts の `jobSearched/jobIntroduced`（`archivedAt=null`）とは別物・不変。

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

#### 件数・人数・新規の数え方（2026-09-12 確定・提案／エントリー共通）

実績表の「人数（件数）」表記のうち **括弧内＝件数・括弧外＝人数**。3点とも `src/lib/performance/weeklyMatrix.ts` の1か所で決まる。

- **件数＝生レコード**。1行＝1件で数える（明細 `/api/performance/detail` の records と一致する）。
  - ⚠️ 旧実装は `GROUP BY 候補者, external_job_id, JST日` で潰していた。**`external_job_id` は求人未紐付けのとき `0`**（`bookmarks/to-entry/route.ts` の `f.kyuujinJobId ?? 0`）なので、同じ人が同じ日に出した**別会社の応募まで1件に潰れて**いた（2026-09 は 142件→82件、2026-03 は 228件→74件）。本当の重複行は存在しないので潰さない。
  - 提案側の**移行重複ガード**（同一候補者×同一JST日のクロスソース重複で CF 側を除外する `NOT EXISTS`）は業務上必要なので**残す**。
- **新規＝その候補者が「その暦月(JST)」に出した1件目だけ**／**既存＝その月の2件目以降**。
  - 候補者×暦月で `ROW_NUMBER() OVER (PARTITION BY candidate_id, date_trunc(month, JST日) ORDER BY 日付, id)` を振り、`rn=1`＝新規・`rn>=2`＝既存。
  - 順位付けの母集団は**その月の全イベント**（表示期間に依存しない）。月をまたぐ週は日付の属する月で分ける。表示期間を変えても同じ行が新規になる。
  - ⚠️ 旧実装は「全期間初回がセル内にある候補者の、セル内の全件」を新規にしていた（合意定義と別物）。
  - この定義では **新規は1候補者1件/月**なので、月内に収まるセルでは 新規件数＝新規人数。
- **合計列**：件数＝各列（週/月）の合算（1レコード＝1件なので Σ列＝期間合計）。**人数＝期間全体の重複除去**（DISTINCT）。
  - ⚠️ 旧 `applyAdditiveTotals` は人数まで Σ週で上書きしていたため、2週にまたいで出た人が二重計上されていた（例：奥村2026-09 は 13人と表示、正しくは 11人）。達成率の分母（`total.uniq`）とも食い違っていた。
  - 直近6ヶ月（`/api/performance/cohort`）も同じで、合計列の人数は通算 `summaryMx` の DISTINCT を使う（書類通過率の分母もこれ）。
- **1人当たり＝件数÷人数**（変更なし）。平均列＝合計÷列数。
- 反映先：`/api/performance/weekly`（実績表）・`/api/performance/monthly`（当月実績）・`/api/performance/cohort`（直近6ヶ月）は同じ `computeWeeklyMatrix` を使うので自動で揃う。目標登録の参考値（`/api/performance/target/reference`）は人数（期間DISTINCT）のみ参照で不変。

実績表は「過去に何件紹介し、何件通過し、何件内定したか」の**累積実績**を見るもの（現在進行中の有効案件ではない）。

- キー対応（厳守）：
  - **求人検索**＝CandidateFile BOOKMARK `createdAt`・User.id（`uploadedByUserId`）。マトリクス上部の「検索」件数は変更しない。
  - **求人紹介（提案）＝両ソース統合**：`JobEntry.jobIntroDate` ∪ `CandidateFile BOOKMARK.lastExportedAt`。担当は両方とも `candidate.employeeId` 軸に統一。記録方式が **2026/4 に移行**（jobIntroDate 〜2026/4、lastExportedAt 2026/4〜）したため、片方だけでは過去 or 現在が欠ける。同一候補者×同一JST日のクロスソース重複は CF 側を除外（移行重複ガード、実データ衝突0件）。初回/既存は下記「件数・人数・新規の数え方（2026-09-12 確定）」に従う（エントリーと同一定義）。`weeklyMatrix.ts` の `events` CTE（UNION ALL＋NOT EXISTS）＋`ranked` CTE（候補者×暦月の `ROW_NUMBER`）。
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
    - 求人紹介・エントリー：**新規/既存/合計 × 件数(レコード)・人数(候補者ユニーク)・1人当たり(件数÷人数)**。新規＝その候補者が**その暦月(JST)に出した1件目**、既存＝その月の2件目以降（上記「件数・人数・新規の数え方」）。合計列の人数は期間全体の DISTINCT。
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

## T-139: 日程調整タスク外部API（GET取得 / PATCH更新, master, 2026-07-11）

日程調整AIエージェント（外部RPA機）が非営業時間帯にポーリング（約30分に1回・低頻度）で、scout-scheduler 由来の「日程調整」タスクを読み取り／更新するための外部API 2本。レート制限なし。

### 関連スキーマ要約（Phase 1 調査）

- `Task`（`prisma/schema.prisma` L804-832）: `id` / `title` / `status TaskStatus @default(NOT_STARTED)`（enum: `NOT_STARTED`/`IN_PROGRESS`/`COMPLETED`・L78-82）/ `categoryId → TaskCategory` / `candidateId String?`（nullable）/ `createdByUserId String`（**必須**）/ `createdAt DateTime @default(now())`（Prisma DateTime = UTC instant 保存）。
- `TaskCategory`（L749-766）: `name`。日程調整タスクは **`category.name === "日程調整"`** で識別（タイトル命名や専用カラムではなくカテゴリ名が正）。
- `TaskTemplateField`（L769-787）: `label`（"希望日時"/"面談形式"/"備考" 等）。フィールドの「意味」はこの label。
- `TaskFieldValue`（L866-876）: `taskId` / `fieldId → TaskTemplateField` / `value String @db.Text`（生テキスト。create-schedule-task は素の文字列で保存）。`@@unique([taskId, fieldId])`。
- `TaskComment`（L898-910）: `userId String`（**必須**・User FK）/ `content`。作者 nullable 不可。
- `TaskAssignee`（L835-846）: `taskId` / `employeeId → Employee`。担当は **Employee**（User ではない）。

### 新設エンドポイント

いずれも認証は **`x-api-secret` ヘッダ = 環境変数 `EXTERNAL_API_SECRET`**（create-schedule-task と同一）。不一致は 401。共有ロジックは `src/lib/schedule-tasks.ts`。

**GET `/api/external/schedule-tasks`** — カテゴリ「日程調整」のタスク一覧（他カテゴリは絶対に返さない）。
- クエリ: `status`（カンマ区切り複数可・許可外は400）/ `createdAfter` `createdBefore`（ISO・**TZ無しはJST(+09:00)解釈**）/ `limit`（既定100・最大500）。
- ソート: `createdAt` 昇順。
- レスポンス `{ tasks: [{ id, title, status, createdAt(JST +09:00), fields:{"希望日時","面談形式","備考"}(無い値はnull・生テキスト), assignees:[{id,name}], candidateId(無ければnull), hasExemptComment }] }`。
- `hasExemptComment`（boolean）: そのタスクのコメントのいずれかに判定キーワードを含めば `true`。
  判定キーワードは `SCHEDULE_EXEMPT_COMMENT_MARKER`（env / コード定数・既定 `自動対応対象外`）。
  RPAは対象外判定時に受け口2へ `{"comment":"自動対応対象外：...理由..."}` を送る運用。
  コメントは `【日程調整AI】` 接頭辞付きで保存されるが、判定は `content.includes(marker)` なので接頭辞の有無に依存しない。
  RPAはこのフラグが `true` のタスクを再処理スキップする。

**PATCH `/api/external/schedule-tasks/[taskId]`** — status 変更 / コメント追加（両方任意・少なくとも一方必須）。
- 安全柵: 対象が「日程調整」でなければ **403**（一切更新しない）。存在しない taskId は **404**。
- `status`: `NOT_STARTED`/`IN_PROGRESS`/`COMPLETED` のみ（許可外400）。
- `comment`: TaskComment として追加。作者は `resolveSystemUserId()`（anonymous@local → admin）。本文先頭に **`【日程調整AI】`** を付与し人間がAI発と判別可能に。
- 通知抑止: 内部ルート（`/api/tasks/[taskId]/status`・`/comments`）は LINE WORKS 通知（`notifyTaskCompleted`/`notifyTaskComment`）を発火させるが、**本APIは通知ヘルパーを一切呼ばない**（夜間ポーリングでの通知連発防止）。
- レスポンス: 更新後タスク（GET と同一形状）。

### JST/日付の扱い（罠#17）

`createdAt` は UTC instant 保存。`createdAfter`/`createdBefore` の TZ無し入力は `${s}+09:00` として `new Date()` に解釈させ、Prisma の `gte`/`lte`（Date=UTC）へそのまま渡す。返却は `toJstIso()`（+9h した UTC 要素を `+09:00` 表記で組む）。`toISOString().slice()` 系の変換は不使用。

### create-schedule-task の `candidateId` パラメータ（T-139 氏名正規化 step1, master, 2026-07-20）

`POST /api/external/create-schedule-task` は任意の `candidateId`（portal の `Candidate.id`）を受け取り、**PDF由来の正式氏名でタスクタイトル氏名を上書き**する。背景: フォーム手入力の氏名は入力ミス（例「平塚美月 美月」の名の重複入力・異体字「山﨑/山崎」・読み仮名の括弧付与）が起こり、RPAのマイナビ検索を失敗させる。マイナビ応募PDFから Gemini が機械抽出した `Candidate.name`（`rpa/mynavi/pdf-upload` が保存）はマイナビ登録氏名と完全一致するため、こちらを正とする。

- **氏名解決**: `candidateId` があり `Candidate` が実在すれば `Candidate.name`（trim済）を `effectiveName` としてタイトルの氏名部分に使う。タイトルの命名パターン（`【${source} 新規面談調整】新規応募者 ${氏名}` 等）は不変で、**氏名の値だけが変わる**。
- **後方互換（絶対条件）**: `candidateId` 無し／`Candidate` 不在なら従来どおりフォームの `candidateName` を使う。無効な `candidateId` でも **400 にせず**安全側（従来動作）へフォールバック（エラーで弾くとフォーム送信全体が失敗し応募者に影響するため）。scout-scheduler が cid を送り始めるまでは常にフォーム氏名。
- **Task 紐付け**: 実在が確認できた `candidateId` のみ `Task.candidateId` にセット（無効値は FK エラー回避のため `null`）。従来 NULL のままだった求職者紐付けがこの経路で通り、タスク→求職者の画面遷移が可能になる副産物。
- **フォーム氏名の保全**: 氏名を差し替えた場合（`effectiveName !== candidateName`）、元のフォーム入力氏名を `備考`（TaskFieldValue）へ `フォーム入力氏名: ○○` として追記（既存 notes があれば `\n\n` 区切りで併記）。照合ミス疑い時に人が元値を確認できるようにするため。差し替えが無ければ備考は従来どおり。
- 全体3段階（portal step1=本受け皿 → scout-scheduler が cid 転送 → RPA がフォームURLに cid 付与）の step1。実装: `src/app/api/external/create-schedule-task/route.ts`。

## 日程調整AIエージェント（T-139 step4・最終確定版）

RPA機（マイナビ操作・対象外判定・返信送信）と portal（枠取り・文面生成）の分業。
**稼働時間帯の制御は RPA 側の責務**（portal に時間帯制限は無い）。

> ⚠️ step3 で一時実装した「portal自走の夜間バッチ（`/api/internal/schedule-agent/run`）＋ 30分毎 cron」は**中止・削除済み**。
> portal はタスクを**読み取るだけ**で、status 変更・コメント追加は **RPA が既存 PATCH で行う**。

### 構成

| 要素 | パス | 役割 |
|--|--|--|
| 判定受け口 | `POST /api/external/schedule-agent/resolve` | 本体。2モード・結果4区分 |
| 定型パース | `src/lib/schedule-agent/parse-preferences.ts` | 「希望日時」正規表現・氏名抽出・面談形式→方法 |
| LLM抽出 | `src/lib/schedule-agent/extract-message.ts` | モードB。**年は出力させない** |
| 枠探索 | `src/lib/schedule-agent/match-slot.ts` | 空き判定＋多重仮予約の上限 |
| 仮予約 | `src/lib/schedule-agent/reserve.ts` | 二重予約チェック＋登録 |
| 文面 | `src/lib/schedule-agent/reply-templates.ts` | テンプレA〜D（一字一句固定） |
| JST/env | `src/lib/schedule-agent/jst.ts` / `config.ts` | 日付ユーティリティ・env アクセサ |

### resolve エンドポイント

認証 `x-api-secret`（`EXTERNAL_API_SECRET`）。入力は **taskId の有無**で判別:

- **モードA** `{ taskId }` … URL申し込み分。カテゴリ「日程調整」以外・存在しない → **404**（カテゴリ柵）。
  「希望日時」を**正規表現で定型パース**（`第N希望: YYYY年M月D日（曜） HH:MM〜HH:MM`／「なし」行はスキップ）。
  面談方法は「面談形式」フィールドの値（**LLM推測しない**）: 「電話」を含む→A系 / それ以外→B系。
- **モードB** `{ candidateName, messageBody, executedAt }` … マイナビ直接返信分。LLM構造化抽出。
  面談方法: 電話→A系 / オンライン・**不明→B系**（不明時のオンライン既定はモードBのみの規則）。

レスポンス（両モード共通）:
```json
{ "result": "reserved|today_only|unavailable|no_reply",
  "reservedAt": "2026-07-15T19:00:00+09:00|null",
  "reservedAtLabel": "7月15日（火）19:00～|null",
  "method": "電話|オンライン|null",
  "replyText": "<完成した返信文面>|null",
  "alreadyReserved": true｜false }
```

| result | 意味 | 文面 |
|--|--|--|
| `reserved` | 確保成功 | テンプレA(電話)／B(オンライン) |
| `today_only` | 当日希望のみ | テンプレC |
| `unavailable` | 全希望埋まり・範囲外 | テンプレD |
| `no_reply` | 解釈不能・日程外・env未設定 | **なし（null）** |

### 枠ルール

- 60分枠。開始は **9:00〜20:00**（20:00開始が最終＝20:00〜21:00 まで可）。
- **当日不可**。翌営業日〜**2週間以内**のみ。土日祝は不可（`isBusinessDay` 再利用）。
- 幅のある希望（17:00〜20:00）は**幅の中の最も早い60分枠から**30分刻みで試す。
  幅が60分未満（17:00〜17:30）は**開始から後ろへ広げて60分**（17:00〜18:00）。
- 希望の振り分け: 範囲外（過去・2週間超・土日祝）と当日は**個別にスキップ**し、範囲内の将来希望だけ探索。
  範囲内の将来希望がゼロで当日希望のみ → `today_only`。全部探して空き無し／全希望が範囲外 → `unavailable`。
- 空き判定: 対象CA（env）のうち **カレンダー連携が生きているCAのみ**。誰か1人でも空いていればOK。
  **どのCAが空いていたかは選ばない・記録しない**（担当割当は翌朝人間が行う）。
  ※`getCalendarEvents` は未接続でも `[]`（＝終日空きに見える）を返すため、接続レコードが無いCAは必ず除外する。
- **同一枠の多重仮予約の上限**: 仮予約カレンダーはCA個人カレンダーに映らないため、空き判定だけだと同じ枠に別候補者の
  仮予約が無限に積める。**「その枠の既存仮予約数 ≧ その枠で空いているCA人数」なら埋まり扱い**として次の枠を探す。
- 全日時 JST。`toISOString().slice(0,10)` 系は禁止（罠#17）。日付は `toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})`。

### 年のサーバー側決定（LLMに年を出力させない）

`extract-message.ts` の responseSchema には **year フィールドが存在しない**（プロンプトでも明示禁止）。
LLM が返すのは月・日・時刻・条件・面談方法・日程の話か否かのみ。年は `jst.ts` の `resolveYearNearestFuture()` が
**「今日以降の最も近い出現」**（今年の月日が過ぎていれば翌年）で機械決定する。12月末実行×1月の月日 → 翌年が正しく解決される。

### 仮予約カレンダー運用

- イベント名: `{氏名} {M/D(曜)HH:MM-HH:MM} {面談方法}`（例 `山田太郎 7/15(火)19:00-20:00 電話`）。説明欄に氏名・面談方法・モード・元taskId・作成日時。
- **二重予約防止**: 登録前に仮予約カレンダーの未来イベントを走査し、**同一氏名（タイトル先頭一致）**が既にあれば
  新規登録せず `alreadyReserved: true` で既存予約から**同じ文面を再生成**して返す（result は `reserved`）。
- 翌朝人間が振り分けるまでの**仮置き場**。**AIは削除しない**（不要なら人が手動削除）。

### 新設 env

| env | 用途 | 未設定時 |
|--|--|--|
| `SCHEDULE_RESERVATION_CALENDAR_ID` | 共有カレンダー「仮予約」のID | **枠取り・登録を一切行わず `no_reply`**（誤送信防止） |
| `SCHEDULE_RESERVATION_WRITER_USER_ID` | 書き込み名義ユーザー（大野将幸の userId） | 同上 |
| `SCHEDULE_AGENT_TARGET_USER_IDS` | 空き判定対象CA（カンマ区切り・3名） | `unavailable` |
| `SCHEDULE_FORM_URL` | テンプレC/Dに差し込むURL | 既定 `https://schedule.bizstudio.co.jp/` |

### 既存 GET への追加（後方互換）

`GET /api/external/schedule-tasks` に任意 `dedupeByName=true` を追加。タイトルから抽出した氏名が同一のタスクが
複数あれば **createdAt 最新の1件のみ**返す。**未指定時は従来どおり全件**（レスポンス形状も不変）。

### カレンダー連携切れ検知メール（step5）

`resolve` は対象CAごとに Google カレンダーを能動プローブし、**連携切れが1名でも見つかれば**
`masayuki_oono@bizstudio.co.jp` にメール通知する（既存 Resend 実装を流用・`RESEND_API_KEY`）。

- **プローブ**（`probe-connections.ts`）: 4状態を区別 — `ok` / `no_connection`（レコード無し）/
  `refresh_failed`（既存ヘルパが自動削除する）/ `fetch_failed`（認証OKだが list 例外）。
  `ok` 以外を「壊れている」とみなす。
- **除外**: 壊れているCAは `findAvailableSlot` の第5引数 `excludeUserIds` で明示除外する。
  `refresh_failed` はレコード削除で自然に除外されるが、`fetch_failed` はレコード残存のため
  明示除外しないと `getCalendarEvents` が `[]` を返して「空き」と誤判定される（重要）。
- **重複抑止**: `ScheduleAgentAlertLog(user_id, date)` の UNIQUE 制約で
  **同一CA×同一JST日付につき最大1通**。複数CAが同時検知でも1通にまとめて対象欄に列挙。
  ログ行を先に作成してから送信するため、並行実行のレース勝者だけが送る。
- **副作用の分離**: メール送信の成否は `resolve` 応答に影響しない
  （全例外を内部で握りつぶす・失敗時もその日はリトライしない＝毎30分の連続再送を避ける）。

追加テーブル: `schedule_agent_alert_logs`（`user_id`, `date` "YYYY-MM-DD" JST, `sent_at`。
UNIQUE `(user_id, date)`, INDEX `date`）。既存テーブルの変更なし。

### RPAとの分業（重要）

- portal は **タスクを読み取るだけ**。`resolve` は **status 変更もコメント追加もしない**。
- 対象外判定は **RPA が実施済み**の前提（portal は判定しない）。
- 返信送信後の `COMPLETED` 化・コメント付与は **RPA が既存 PATCH `/api/external/schedule-tasks/[taskId]`** で行う。
- `resolve` は通知部品（LINE WORKS 等）を**一切呼ばない・importもしない**。
  → **step6（下記）で「仮予約が新規成立したときのみ」通知可の例外を追加**（承認済み）。

### 仮予約成立時の後続処理（step6/step7・master, 2026-07）

`resolve` が**新規に仮予約を作成できたとき**（`result=reserved` かつ `alreadyReserved=false`）に限り、
`runPostReservation`（`src/lib/schedule-agent/post-reserve.ts`）で後続処理を発火する。
成立は1候補者につき1回（`reserve.ts` の二重予約チェックで担保）なので夜間ポーリングでも連発しない。
`alreadyReserved=true`（既存再返信）・`today_only`・`unavailable`・`no_reply` では**発火しない**。
フローA（モードA・taskId由来）/フローB（モードB・メッセージ由来）の両方で発火する。

**現行の後続処理は「(2) LINE通知」「(3) 翌朝タスク」の2点**（仮予約カレンダー登録は resolve 本体）。
面談管理登録（下記 (1)）は **step7 で既定無効**（手動運用）。

- **(1) 面談管理登録**（`InterviewRecord`）: **step7 で既定 OFF（手動運用に統一）**。
  実運用の日程調整タスクは candidateId=null が多く「入る時/入らない時」で中途半端になるため。
  env `SCHEDULE_AGENT_INTERVIEW_REGISTER="true"`（大小問わず）のときだけ登録する（将来の再検討用にロジックは残置）。
  既定（未設定/"false"）では呼ばれず、翌朝タスク本文に「面談管理への登録は手動で行ってください（AIは登録しません）」と明記する。
  - 有効時（env true）の挙動: 担当CA=placeholder「仮予約」。`candidateId` が無ければスキップ。
    非破壊（`interviewCount=null`＝実績集計から除外・`isLatest=false`・`status="draft"`・`interviewTool`=`電話`/`オンライン`）。
- **(2) LINE通知**: 既存タスク通知と同じ Bot/チャンネル（`LINEWORKS_TASK_BOT_ID`/`LINEWORKS_TASK_CHANNEL_ID`）。
  求職者名・仮予約日時・面談方法・「AI自動仮予約」の旨を送る。env 未設定ならスキップ（失敗にしない）。
- **(3) タスク作成**: カテゴリ **`その他`**（`日程調整` は RPA が再ポーリングし二重予約になり得るため使わない）。
  `status=NOT_STARTED`・assignee はマイナビ管理担当（`isMynaviAssignee=true` の慣例）。本文に
  求職者名・仮予約日時・面談方法・由来（フローA/B）・元taskId・「仮予約カレンダーから振り分け」＋
  面談登録の状態（既定は「手動で登録」）を記載。

**安全設計**: `runPostReservation` は**絶対に throw しない**（各処理を try/catch で隔離）。
`resolve` 応答（reserved 文面・値・HTTPコード）は不変。(2) が失敗しても (3) は実行し、
特に (3) を最優先で成立させる。いずれか失敗時は `masayuki_oono@bizstudio.co.jp` へ**1通**メール
（Resend・step5 の日次重複抑止は掛けない＝成立ごとの単発）。面談登録が無効な間は失敗対象から外れる
（対象は LINE送信失敗・タスク作成失敗のみ）。

**ダミーCA「仮予約」**:
- `User`（`status=disabled`＝ログイン不可・`isMynaviAssignee=false`・`lineworksId=null`・`role=member`）＋
  `Employee`（`status=active`＝面談担当ドロップダウンに出す・`userId`でUserにリンク・`jobCategory=null`＝
  実績表CAセレクタ/集計から除外・`isExemptFromAttendance=true`＝未打刻アラート除外・`employeeNumber="9000"`）。
- `InterviewRecord.interviewerUserId`/`createdByUserId` は名前に反して **Employee.id** を参照するため User+Employee 両方が必要。
  env `SCHEDULE_PLACEHOLDER_CA_USER_ID` には **User.id** を設定し、コードが `employee.findFirst({where:{userId}})` で Employee.id へ解決する。
- **他機能への波及**: `jobCategory=null`＋Userの各フラグにより実績表・マイナビ・LINE宛先・勤怠アラート・ログインからは除外される。
  ただし `status="active"` の Employee 一覧（`/api/employees`・社員マスター・勤怠の従業員リスト・各画面の担当CAフィルタ）
  には面談担当と同じ `status:"active"` 条件で**表示される**（面談担当に出すための必須条件と同一のため排除不可）。
  実害は表示のみ（候補者の担当CAとして選ばれることはなく、実績・通知・打刻には現れない）。

## 求人紹介タブの成立条件（T-161 改修後）

紹介履歴タブの「求人紹介」一覧は **2つのデータ源の結合**（`src/app/api/candidates/[candidateId]/jobs/route.ts`）。

1. **kyuujin-pdf-tool 側の求人**（`GET {KYUUJIN_PDF_TOOL_URL}/api/projects/by-job-seeker-id/{candidateNumber}/jobs`）
   - CAが求人PDFを出力（send-to-job-tool）したときに作られる行。`source="kyuujin"`。
   - 同一会社名×同一求人タイトルの重複 job は portal 側で排除（ブックマーク kyuujinJobId 紐付き優先→作成が古い方）。
   - `hidden_job_introductions` に載る job.id は除外。
2. **portal 側ブックマーク**（`candidate_files` category=BOOKMARK・`archivedAt IS NULL`・`kyuujinJobId IS NULL`）
   - サイト経由（`origin='candidate' AND drive_file_id IS NULL`）… `source="site"`・バッジ「本人応募」
   - 出力なし紹介済み（`introduced_at IS NOT NULL AND last_exported_at IS NULL`）… `source="introduced"`・バッジ「紹介済み」
   - id は負数（kyuujin と衝突しない選択キー）。`file_id` に CandidateFile.id。非表示削除は不可（ブックマークタブで管理）。

**一覧に出ることと実績に数えることは別**（R1/R2/R3）:
- 実績（日報の紹介数・週次実績の提案）に数える = 非サイト行 かつ `COALESCE(last_exported_at, introduced_at) IS NOT NULL`
- 本人応募（site）は一覧に出るが実績には数えない。
- 紹介保留（archivedAt != null）は一覧にも出ない。

## エントリーの求人情報の入り方（T-161 改修後）

| 作成経路 | job_category | job_title | 求人URL | external_job_id | route |
|--|--|--|--|--|--|
| 求人紹介タブ（kyuujin 行）→ 選択してエントリー | kyuujin `job_category` | kyuujin `job_title` | `original_url` | kyuujin jobs.id | null |
| 求人紹介タブ（portal 行）/ ブックマーク →「エントリーへ登録」（to-entry） | BM `job_category` | BM `job_title` | BM `memo`（URL形式のみ） | BM `kyuujin_job_id` ?? 0 | site行="site-apply" / 紹介済み行=null |
| エントリー管理 → 新規登録（手動） | 入力欄なし=NULL | 手入力 | NULL | 0 | null |

- to-entry の重複判定は **externalJobRef（求人単位）**。ref 無し行のみ会社名一致で判定。スキップは `skippedDetails`（会社名＋理由）で返り、UI が必ず表示する。
- エントリー編集モーダルに「職種」入力欄あり（自動で埋まらなかった行を人が補う）。
- サイト経由ブックマークの job_title / job_category は favorites POST が保存（T-161 新設列）。**T-161 以前の行は NULL のまま**（portal に元データが無い）。

## タスク作成時の LINE WORKS 通知仕様（T-162 で整理, 2026-08-18）

### 送信単位

**共通トークルームへ1通・本文中で全担当者をメンション**する方式。担当者ごとの個別 DM は行わない。

- Bot / チャンネル: `LINEWORKS_TASK_BOT_ID` / `LINEWORKS_TASK_CHANNEL_ID`（未設定なら warn を出して no-op）
- 通知の粒度は「1タスク = 1通」。ただし**応募書類3点セットだけは3タスクで1通**（`bulk-create-3point` が3件のリンクを1通にまとめる）
- 送信の実体は `sendBotMessage()`（`src/lib/lineworks.ts`）。1通あたり POST 1回

| 起票経路 | エンドポイント | 通知関数 | 通数 |
|--|--|--|--|
| 通常のタスク作成ウィザード | `POST /api/tasks` | `notifyTaskCreated` | タスク1件につき1通 |
| 応募書類3点セット | `POST /api/tasks/bulk-create-3point` | `sendBulkNotification`（同ファイル内） | 3タスクで1通 |
| タスク複製 | `POST /api/tasks/[taskId]`（clone） | `notifyTaskCreated` | 1通 |
| AI 起票（T-150/T-151） | `src/lib/ai-task-create.ts` | `notifyAiTaskCreated` | 1通 |

### 宛先解決

`resolveAssigneeNotifyTargets(employeeIds)`（`src/lib/task-notification.ts`）に統一。

1. `Employee.userId` のリレーションで `User` を引く（**第一手段**）
2. `User` が未リンクの `Employee` に限り、`User.name` の完全一致でフォールバック
3. `User.status !== "active"` の場合は `lineworksId` を null 扱い（＝メンションしない）
4. 返り値は**渡した `employeeIds` の順序を保持**する（本文の担当者順とメンション順を一致させるため）

`User.name` の文字列一致だけで引く旧実装は、表記ゆれによる欠落と同名ユーザーへの誤爆があるため使わないこと（罠 #45）。

### 本文とフォールバック（3段）

1. `lineworksId` を持つ担当者が1人以上 → `<m userId="...">` を人数分（各行）並べ、続けて割り当てヘッダ＋本文
2. 1 が送信失敗、または全員 `lineworksId` 未登録 → 「○○さん、△△さん <ヘッダ>」の**名前プレフィックス付き・メンションなし**で再送
3. 担当者名も無い → 素の本文

「■ 担当者」欄には `lineworksId` の有無に関わらず**全担当者名**を出す。
つまり**未登録者は本文に名前が出るのにメンションだけ飛ばない**（画面上は正常に見えるので、切り分けはログで行う）。

### 失敗時の扱い

- 通知失敗は**タスク作成を失敗させない**（fire & forget）。`POST /api/tasks` は try/catch で握りつぶし、`bulk-create-3point` は `.catch()` で握りつぶす
- 送信のたびに `[task-notify:create]` / `[task-notify:3point]` / `[task-notify:clone]` のログを1行出す
  - `assignees=<選択人数> mentionable=<メンション可能人数> names=[...]`
  - `lineworksId` 未登録者がいれば warn を追加で1行（氏名と `user=<userId|未リンク>`）
  - 送信成功時に `sent mentions=N/M` または `sent fallback(no-mention) recipients=M`

### 複数担当者

- Step3 の担当者選択はチェックボックスで**全カテゴリ複数選択可**（3点セット含む）
- 2名以上選ぶと Step4 に「完了条件」（`any` = 誰か1人 / `all` = 全員完了）が出る
- `completionType === "all"` のとき `TaskAssigneeStatus` を担当者の `User` 分だけ生成する
  （3点セットは3タスク×人数分）。未生成でも `PATCH /api/tasks/[taskId]/status` 側で自動生成される


## Google Form 経験職種カテゴリの定義（T-170 / 2026-08-19）

- 選択肢の実体は portal の `src/constants/google-form-categories.ts`（`GOOGLE_FORM_CATEGORY_GROUPS`）。
  参照元は `GoogleFormCreatorModal.tsx` と `/tasks/new`（Googleフォーム作成依頼タスク）の2箇所で、
  どちらも定数から動的生成しているため**定数を直せば両方に反映される**。
- **大項目（グループ）の定義は portal にしか無い**。candidate-intake 側 `specs/generate_form_prompt.yaml`
  の `target_subcategories` はサブカテゴリのコード一覧のみ。したがって
  「サブカテゴリ＝両リポジトリ同期／大項目＝portal 単独」。
- T-170 で サービス業4（`service_food` / `service_cooking` / `service_beauty` / `service_hotel`）と
  大項目3つ（製造・技術 `mfg_*` 3 / 物流・運輸 `logi_*` 2 / 教育・専門 `pro_*` 3）を追加し、
  `service_cs` の重複（事務職とサービス業に同一コード）を解消して**事務職側に一本化**。
  現在 36 サブカテゴリ（`other` を含む選択肢 37）・大項目 10。「その他」は常に最後。
- `GoogleFormRequestData.groupKey` は大項目の**日本語ラベルそのもの**を保存する。
  依頼保存後に定義が変わりうるため、読込側は `resolveGoogleFormGroupKey(savedGroupKey, categoryValue)`
  で「サブカテゴリの実所属」を優先して復元する。
- 今後サブカテゴリを追加・変更するときは**両リポジトリ同時更新＋コード文字列の突合を必須**とする。

## Googleフォーム作成依頼タスクの簡素化（T-172 / 2026-08-20）

- T-171 で作った依頼カテゴリ（id `cmt004eu000003hr0mrvmi7hg`）は作り込みすぎで依頼が手軽に出せなかったため、
  **依頼内容を「メイン経験職種カテゴリ」＋「その他メモ」の2項目だけに簡素化**した。
  依頼時の**履歴書AI読み取り（extract-resume 呼び出し）と会社ごとの職種指定は廃止**。
  履歴書の解析は受け取った担当者が `GoogleFormCreatorModal` で1回だけ行う（従来動作に復帰）。
- 会社ごとの補足は「その他メモ」に自由記述する運用へ寄せた。メモはモーダル上部のバナーに全文表示される。
- 依頼JSON は **v2**（`{ v: 2, groupKey, categoryValue, otherLabel, memo }`）。
  本番に v1 の依頼タスクが残っているため**読み取り互換のみ維持**し、
  `normalizeGoogleFormRequestData()`（`src/constants/google-form-request.ts`）で v1/v2 を v2 形へ正規化してから使う。
  v1 の `companies` / `resumeData` / `pdfFileId` / `txtFileId` は読み捨てる。
- テンプレート項目「会社別職種分類」は廃止したが、`TaskTemplateField` に **isActive 相当のフラグが無い**ため
  **物理削除せず** `GOOGLE_FORM_REQUEST_HIDDEN_LABELS` による UI 非表示で新規作成時に出さない方式を採った
  （既存タスクの `TaskFieldValue` は温存される。タスク作成 API 側に required 検証は無いので `isRequired` は無害）。

## Googleフォーム作成依頼: 会社別指定の復活（T-172追補 / 2026-08-20）

- T-172 でメインカテゴリ1本に絞ったが**会社単位の指定ができず不十分**だったため、**会社カードを復活**させた。
  ただし**依頼時の履歴書AI読み取り（extract-resume・10〜30秒待ち）は復活させない**。
- 会社名・在籍期間の取得元は **`WorkHistory`（`work_histories`）**。面談ログ解析（`/api/interviews/[id]/analyze-with-intake`）と
  面談入力フォーム（`InterviewForm`）が既に構造化保存しているため、**AI呼び出し無し・同期のDB読み取りだけ**で初期表示できる。
  新設 API: `GET /api/candidates/[candidateId]/work-histories`
  （`isLatest` 優先＋面談日降順で「会社名が1件でも入っている」`InterviewRecord` を1本選ぶ。空の下書きに引っ張られない）。
  在籍期間は `hire_date`〜`leave_date`（在籍中は「〜現在」）、無ければ `tenure_year`/`tenure_month` にフォールバック。
- カバー率（2026-08-20 本番実測）: 全求職者 4346 中 277（6.4%）だが、**直近90日に面談レコードがある327名では232名＝70.9%**。
  依頼は面談直後に出すものなので実運用の母集団ではほぼ埋まっている。`InterviewDetail.companyName` は現職1社のみ・
  対象276名とほぼ同集合なので採用しない。職歴0件の求職者は空の手入力行を1行出す（会社カードは**任意入力**）。
- 依頼JSON は **v3**（`{ v: 3, groupKey, categoryValue, otherLabel, memo, companies: [{ name, period, groupKey, categoryValue, detail }] }`）。
  `resumeData` / `pdfFileId` / `txtFileId` / `inputMode` は持たない。`normalizeGoogleFormRequestData()` が v1（companies あり）/
  v2（companies なし）/ v3 のすべてを v3 形へ正規化する。
- モーダル側は extract 実行後、**会社名一致**（`normalizeCompanyNameForMatch` = NFKC＋空白全除去の完全一致）で
  依頼の指定職種を `companyCategoryMap` / `companyGroupMap` へ上書きし、一致しない社は既定値のまま。`detail` は各社カードにヒント表示。
- テンプレート項目「会社別職種分類」は T-172 で `sort_order=99` に退避させていたものを **`sort_order=2` に戻して再利用**
  （`is_required` は false のまま＝任意）。`GOOGLE_FORM_REQUEST_HIDDEN_LABELS` には**入れたまま**にする点に注意:
  このリストは `/tasks/new` の generic 描画抑止専用で、タスク詳細（`/tasks/[taskId]`）は
  「フォーム作成指定データ」だけを隠す実装なので、**外すとウィザードに素のTEXT入力が二重に出る**。

## 面談サポート機能（T-183 / Phase 1: 2026-08-27, Phase 2: 2026-08-27, Phase 3: 2026-08-28, Phase 4: 2026-08-31, Phase 5: 2026-09-01, Phase 6: 2026-09-01, Phase 7: 2026-09-01）

面談中のリアルタイム文字起こし＋AI解説で新人CAの理解を補助し、記録を振り返り・研修教材に使う。
要件の正: `docs/mendan-support/requirements.md`（v9。Phase 7 で事前情報の漏えい修正〔固有名詞リスト方式〕＋ログコピー＋話者識別に改訂）。

- **モデル**: `InterviewSupportSession`（`interview_support_sessions`）。`InterviewRecord` に多対1（onDelete: Cascade）・
  `createdByUserId` は Employee.id。`id` は**クライアント生成**（支援画面の「開始」初回押下で確定）で、
  1分ごとの定期保存は同一 id への upsert（丸ごと上書き）＝冪等。
  `transcript` = `[{ t: ISO, text }]` / `explanations` = `[{ t, mode, sourceText, resultText }]`
  （mode: `recent`/`selection`=手動、Phase 3 で `auto-term`/`auto-job`/`auto-reason` を追加）。
  `endedAt` null は「記録中/中断」（タブを閉じた等）で、一覧の長さ表示は transcript 最終時刻から概算する。
- **API**（すべて `getSessionUser` 認証）:
  - `POST /api/interview-support/explain` … AI解説（Haiku・SSEストリーミング・prompt cache・usage は AdvisorUsageLog へ記録）
  - `POST /api/interview-support/[interviewId]/session` … 保存（upsert・endedAt 未指定は null 扱い＝再開対応）
  - `GET /api/interview-support/sessions?candidateId=` … **求職者単位**の軽量一覧（本文は返さない）
  - `GET/DELETE /api/interview-support/sessions/[sessionId]` … 内容取得 / セッション単位削除
- **画面**:
  - 支援画面 `/interview-support/[interviewId]`（`InterviewSupportScreen.tsx`）。Web Speech API（`useSpeechTranscription.ts`）で
    文字起こし→1分ごと＋停止時＋解説完了直後にDB保存。beforeunload では keepalive 保存（ベストエフォート）。
    sessionStorage 退避は保存成功の有無に関わらず継続（最後の砦）。
  - 振り返り: `InterviewForm` 右カラム「面談サポート」タブ（`InterviewSupportLogTab.tsx`）。求職者に紐づく全セッションの
    一覧（回次タイトル・開始日時・長さ・作成CA）・行クリックで時系列閲覧（解説は amber カードでログと区別）・
    confirm つき削除・「＋ 新規面談サポート」（支援画面を別タブで開く。ヘッダーボタンと併存）。
    Phase 3 の更新型カード（auto-job/auto-reason）は閲覧では時系列に混ぜず、indigo のサマリーカードとして先頭に表示。
- **自動検知（Phase 3）**: 「ボタンを押して解説」は押すタイミングの判断が現場で難しいため、AIの会話自動監視が主役。
  既存ボタン2つ（直近30秒/選択部分）は「今すぐ知りたい」時の即時フォローとして併存。
  - `POST /api/interview-support/auto-scan` … 非ストリーミング（Haiku・max_tokens 600・system 固定で prompt cache・
    usage は endpoint `interview-support-auto-scan` で AdvisorUsageLog へ）。リクエスト =
    `{ text（前回スキャン以降の新規確定発話）, explainedTerms, existingJobs, existingReason }`、
    レスポンス = `{ terms, jobs, reason }`。JSONパース失敗は空結果扱い（エラーを画面に出さない）。
  - クライアント（`InterviewSupportScreen.tsx`）は**認識中のみ30秒間隔**（`AUTO_SCAN_INTERVAL_MS`）でスキャン。
    新規発話が**20字未満ならスキップ**（`AUTO_SCAN_MIN_CHARS`。無言・相槌区間はコストゼロ）。
    API失敗時はスキャン済み位置を進めず次回同じ発話でリトライ（自動フローは沈黙）。
  - 3種カード: ①用語 `auto-term` = 時系列エリアに積む（「自動・用語」バッジ。解説済み直近30件を毎回渡し再解説しない。
    最大2件/回）／②業務内容 `auto-job` = **会社/職務ごとに1枚の更新型**（AIが同一職務判定に使う `key` で突き合わせ、
    統合済み全文で置き換え）／③転職理由 `auto-reason` = **全体で1枚の更新型**。②③は右カラム上段の固定エリアに表示し、
    更新時は背景色 transition で1.5秒ハイライト。希望条件・日程調整・雑談は検知しない（沈黙が正解）。
  - 保存は既存 explanations（Json）に相乗り。用語=1件ずつ、②③=**保存時点の最新版のみ**（更新履歴は積まない。
    定期保存時にクライアントが最新状態から組み立てる）。保存API・テーブルは無変更。
- **Deepgram 連携（Phase 4）**: 文字起こしの主エンジンを Deepgram ストリーミングに差し替え（内蔵方式はフォールバックとして併存）。
  - `POST /api/interview-support/stt-token`（`getSessionUser` 認証）… サーバー環境変数 **`DEEPGRAM_API_KEY`** で
    Deepgram `POST /v1/auth/grant` を呼び、短時間有効トークン（TTL 60秒）を返す。永続キーはブラウザに渡さない。
    キー未設定・発行失敗・タイムアウト(5秒)は `{ available: false }`。
  - `useDeepgramTranscription.ts` … `useSpeechTranscription` と**同一インターフェース**。MediaRecorder（webm/opus・250msチャンク）→
    WebSocket `wss://api.deepgram.com/v1/listen?model=nova-3&language=ja&interim_results=true&endpointing=300&punctuate=true&smart_format=true`。
    **認証は `Sec-WebSocket-Protocol: ["bearer", <一時トークン>]`**（`access_token` クエリはハンドシェイク拒否される・本番実測 2026-08-31。
    拒否時は Deepgram 側にリクエスト記録すら残らない）。
    interim は差し替え表示・`is_final` で確定ログに追加。接続断は1秒待って自動再接続（トークン・Recorder とも作り直し。webm はストリーム
    先頭にヘッダを持つため Recorder の使い回し不可）。「停止」は CloseStream 送信→ WS/Recorder/マイクをクローズし再接続しない。
    「認識中（緑）」は最初のメッセージ受信（`receiving`）で判定し、それまでは「接続中…」。接続・トークン・音声取得の失敗は
    `engineError` として上部バーに赤字表示し続ける（受信回復で消える。緑なのに無反応、を作らない）。
  - エンジン切替: 画面起動時に stt-token を1回呼んで判定（`available: true` → Deepgram / それ以外 → 内蔵）。判定完了まで「開始」は
    無効。上部バーに使用中エンジン名（「Deepgram」/「ブラウザ内蔵」）を小さく表示。**フックは両方マウント**して engine で選ぶ
    （フックの条件呼び出し不可のため。使わない側は start しない限り不活性）。
  - **自動検知のイベント駆動化（Phase 4）**: 30秒タイマー（旧 `AUTO_SCAN_INTERVAL_MS`）を廃止し、**発話が確定するたび**に
    auto-scan を予約起動。直前のスキャン完了から最低5秒（`AUTO_SCAN_COOLDOWN_MS`）は待ち、待ち中の確定発話は次の1回にまとめて送る
    （予約は常に1本・応答待ち中に発火した分は完了後に予約し直す）。スキップ条件（新規発話20字未満）・explainedTerms・
    existingJobs/existingReason・カード更新ロジック・手動ボタン2つは Phase 3 のまま。auto-scan API のプロンプトも無変更。
  - UI: 右カラム（解説カード）を主役化。横幅比率 ログ 40% : カード 60%（`flex-[2]` : `flex-[3]`）、カード本文は `text-base leading-8`。
- **事前情報＋確認ポイント（Phase 5）**: 実面談テストで判明した課題（次に聞くことが出ない・用語カードの誤検知・
  業務内容が一般論・事前資料未使用による文脈誤読）への対応。
  - `GET /api/interview-support/[interviewId]/prior-info`（`getSessionUser` 認証・`?fileId=` で明示指定可）…
    面談→求職者の CandidateFile（MEETING/ORIGINAL/BS_DOCUMENT/APPLICATION・PDF・非アーカイブ・driveFileId あり）から
    ファイル名に**キャリアシート/職務経歴/レジュメ/履歴書**を含むものを検索し、この優先順→新しい順で自動選択。
    テキスト抽出は `extractTextFromPdf`（pdf-parse→pdfjs-dist。**AI不使用**）で、T-164 の `parsedText` キャッシュが
    あれば流用（**書き込みはしない**＝advisor-context のAI解析パイプラインと混ぜない）。抽出 **200字未満はスキャンPDF
    とみなし `{ available: false }`**。成功時は先頭 **6,000字**に切り詰めた `text`＋`candidates`（複数候補の一覧）を返す。
  - 支援画面: 起動時に prior-info を取得し上部バーに「事前情報: あり（ファイル名）／なし」を表示。候補が複数の時だけ
    プルダウン（＋「使わない」）。開始後は切り替え不可（`sessionStarted`）。
  - **auto-scan の Phase 5 拡張**: リクエストに `priorInfoText`（≦6,000字。面談中は byte 一致の同一文字列を送り続ける）。
    system は「固定指示」＋「事前情報」の**2ブロックそれぞれに cache_control**。jobs/reason のレスポンスに
    `questions: string[]`（新人CAがそのまま読み上げられる深掘り質問1〜3件。回答済みは外して入れ替える更新型）を追加。
    existingJobs に questions、existingReason は `{ text, questions }` オブジェクト（旧 string も受理）。max_tokens 600→900。
  - **判定調整（Phase 5）**: 職種名・国家資格名は terms に出さず jobs で扱う／文の途中で切れた語・単独の1語・文脈と
    噛み合わない語は文字起こしの断片として terms にしない（クライアント側でも業務内容カードの title・key に含まれる
    term を表示前に除外＝二重防御）／jobs 要約は「実際に何をしていたか」で、職種名のみの段階は1〜2行＋
    「（本人の具体的な業務はまだ未聴取）」注記、強みは根拠がある時だけ。
  - カードUI: 業務内容・転職理由カードに「確認ポイント」欄（本文より小さめの箇条書き）。保存は explanations の
    auto-job/auto-reason 要素に `questions` を追加（Json 相乗り・テーブル/保存API無変更）。
    `InterviewSupportLogTab` の閲覧でも確認ポイントを表示（Phase 4 以前の保存データは optional 扱いで無表示）。
- **事前情報の裏方専用化＋Keyterm 認識強化（Phase 6）**: 実面談テストで、事前情報から作った下書きカードが
  **CAの「シート照合」を誘発し会話への集中を崩す**ことが判明したための方針転換。画面は常に白紙から会話ベースで積み上げる。
  - **廃止**: 開始時の下書き生成（bootstrapモード。auto-scan の text 必須化で復活不可）と、カードの
    `source`（"prior"|"conversation"）・「事前情報／会話で確認済み」ラベル。Phase 5 の一時期に `source` 付きで
    保存された explanations は閲覧側が読み飛ばすだけ（表示は壊れない）。
  - **事前情報の用途（system プロンプト）**: 読み取り補正と要約の正確性向上のためだけの裏方。誤字・断片・固有名詞は
    事前情報を手がかりに補正して理解する。**事前情報にしか出ていない内容をカード・questions に書くこと、
    「シートでは〜」型の照合質問は禁止**。本人が会話で語るまでカードを作らない。
    上部バーの「事前情報: あり／なし」表示と複数候補プルダウンは裏方の確認用として存続。
  - **Keyterm Prompting**: prior-info API が抽出テキストから固有名詞リスト（社名・病院名・施設名・学校名・資格名・
    職種名。重複除去・最大50語）を `keyterms` として返す。抽出は `CLAUDE_MODEL_FAST`（Haiku）1回・失敗は空配列で続行・
    usage は endpoint `interview-support-prior-keyterms` で AdvisorUsageLog へ。`useDeepgramTranscription` に
    `setKeyterms`（ref 保持）を追加し、listen 接続URLに `keyterm=語1&keyterm=語2...` を付与（nova-3 の Keyterm
    Prompting。反映は次の WebSocket 接続から＝取得完了前に開始しても再接続時に効く）。事前情報なしは keyterm なしで従来どおり。
- **事前情報の漏えい修正＋ログコピー＋話者識別（Phase 7）**: 実面談テストで、会話が1社目の話しかしていない段階で
  業務内容カードにシートにしかない内容（「理学療法士（10年以上）」等）が出る・転職理由が語り始めの瞬間にシート内容で
  先出しされる漏えいが再発（**Phase 6 の指示文による禁止では軽量モデルが守り切れない**）ことへの対応。
  - **漏えい修正（構造的に漏えい不能化）**: auto-scan への**シート抽出テキスト（`priorInfoText`）の送信・受け付けを廃止**し、
    prior-info API が抽出済みの `keyterms`（固有名詞リスト。最大50語・各100字）だけを渡す。system は
    「固定指示」＋「固有名詞リスト」の2ブロック（両方 cache_control。リストは面談中 byte 一致でキャッシュに乗る）。
    固定指示は「リストは表記補正のためだけ／リストにある語でも会話に出ていなければ書かない／会話に出ていない
    年数・社数・在籍期間・業務内容・転職理由を書かない／title に経験年数を付けない／転職理由は本人が語った分だけを
    要約し続きが語られたら統合更新」を明記。prior-info API の全文抽出処理は存続（表示・keyterm 抽出元）だが
    auto-scan へは送らない。usage note は `keyterms:N`。
  - **スキャン停止経路の修正**: auto-scan fetch に **30秒タイムアウト**（`AbortSignal.timeout`。応答が永久に
    返らないと `scanInFlight` が立ちっぱなしで以後のスキャンが全停止する経路を塞ぐ）＋ **3回連続失敗で上部バーに
    赤字「自動検知エラー（自動で再試行します）」**（`AUTO_SCAN_FAIL_THRESHOLD`。1回成功で消える。
    サーバー側 JSON パース失敗は従来どおり空結果 200 でループは止まらない）。
  - **ログコピー**: 支援画面のログ枠右上＋面談サポートタブのセッション閲覧に「コピー」ボタン。
    `[HH:MM:SS] 話者: 発話内容` 改行区切りの全文をクリップボードへ（カード・解説は含めない）。成功トースト表示。
  - **話者識別**: `useDeepgramTranscription` に `diarize=true`。確定発話の `words[].speaker` の最頻値を
    `TranscriptEntry.speaker`（番号）に保持。表示名は画面側で解決: **最初に発話した話者=CA・2人目=求職者**
    （3人以上は「話者3」等）・上部バー「⇄ 話者入れ替え」でCA/求職者を反転（既存ログ表示・以後の保存にも反映）。
    ログ行は時刻の後にラベル（CA=青/求職者=緑）。保存 transcript の各エントリに `speaker`（**解決済み表示名の文字列**）を
    追加（Json 相乗り・テーブル/保存API無変更。speaker なしの過去データは従来表示）。auto-scan・explain へ送る
    テキストにも「CA:」「求職者:」プレフィックスを付け、両 system プロンプトに「話者ラベルは誤りうる。矛盾したら
    内容を優先」を明記。Web Speech フォールバックは話者識別なし（従来表示）。

## スカウト配信条件コンソール（T-194, master, 2026-09-14）

- **目的**: マイナビ側に保存した検索条件を名前で選ぶ現行方式（号機と担当者の組み合わせがズレると別条件で配信されても
  「成功」で終わる事故が起きた）をやめ、**portal 側で検索条件6軸を持ち、RPA がマイナビの検索フォームへ直接入力する方式**へ
  移行する。本タスクはその**第1段階＝条件を管理する画面（`/scout/conditions`）とデータモデルまで**。
  仕様の正本は `スカウト検索条件_新方式_検索軸仕様_2026-09-13.md` / `スカウト配信条件コンソール_UI仕様_2026-09-13.md`（リポジトリ外）。
- **コミット**: 9f5f202（master へは merge 6fd65f5 で反映）。
- **マイグレーション**: `20260914090000_t194_scout_conditions`（追加のみ・IF NOT EXISTS／enum と FK は `DO $$ ... EXCEPTION WHEN duplicate_object` で冪等）。
  既存テーブルへの変更は `rpa_scout_machines` への nullable 列 `default_template_id` 追加のみ。既存レコードの書き換えは無い。

### 号機マスタ: 既存 `RpaScoutMachine`（rpa_scout_machines）を流用

- portal には号機テーブルが2つある。`ScoutDeliverySlot.machineId` が参照する `ScoutMachineMaster`（配信実績集計用。
  `recruiterName`+`validFrom` がキー・社員行も混在・2026-09-14 時点で5号機が active のまま）ではなく、
  `RpaScoutMachine`（`machineNo` 一意＝1行/号機・`isActive` が既に 1〜4=稼働 / 5〜6=停止 で仕様一致・RPA 検索条件管理
  `/admin/rpa-scout` の既存マスタ）を号機マスタとして使う。`ScoutCondition.machineId` / `ScoutRun.machineId` はこちらを参照。
- 追加したのは nullable `defaultTemplateId`（→ `scout_templates`）のみ。**号機別デフォルト割当は使わない（全号機が全テンプレートを共用）と
  2026-09-14 に確定**したため、本番は全号機 null のまま（列は残置）。
- **マイナビ上の担当者名はテーブルに持たない**。画面表示は `src/lib/recruiterDisplay.ts` の `splitRecruiterDisplay(\`${machineNo}号機\`)`
  で RC_ROSTER から導出する（独自の号機↔担当者対応表を作らない）。

### 新規テーブル（Prisma モデル名 / 物理名）

| モデル | 物理名 | 主な列 |
|--|--|--|
| `ScoutTemplate` | `scout_templates` | `kind`(ScoutTemplateKind) / `name` / `subject` / `body`(Text) / `sortOrder` / `isActive`。`@@unique([kind, name])`。件名・本文の差し込みタグ `[担当者]` `[社名]` `[最終学歴]` `[経験職種]` は生のまま保持（RPA 側で置換） |
| `ScoutCondition` | `scout_conditions` | `machineId`(→rpa_scout_machines) / `status`(ScoutConditionStatus, 既定 QUEUED) / `queueOrder`(予約の並び順) / **1.** `searchTarget`(ScoutSearchTarget) / **2.** `registDateMode`(ScoutRegistDateMode) + `registDays`(1/3/7/14/30/60/90/180/360) + `registDateFrom`/`registDateTo`(@db.Date) / **3.** `lastLoginDays`(既定1) / **4.** `gradYearFrom`/`gradYearTo` / **5.** `companyCount`(null=-- / 0=0社 / 1〜6=～N社 / 7=7社以上) / **6.** `areaMode`(ScoutAreaMode) + `prefectures`(String[]) / `templateId`(→scout_templates, SetNull) / `plannedCount` / `deliveryDate`(@db.Date) / `createdById`(→users, SetNull) / `createdAt`(=予約登録日時) |
| `ScoutRun` | `scout_runs` | `conditionId`(→scout_conditions, **Cascade**) / `machineId` / `executedAt`(真のUTC instant) / `extractedCount` / `sentCount` / `isDry` / `rawNotification`(完了通知の原文, Text) |
| `Holiday` | `holidays` | `date`(@db.Date, unique) / `name` |

enum 5種: `ScoutTemplateKind`(UNSENT/SENT/INDIVIDUAL) ・ `ScoutConditionStatus`(RUNNING/QUEUED/DRY/DONE) ・
`ScoutSearchTarget`(EXCLUDE=含まない〔未送信〕/ ONLY=のみ〔送信済〕/ INCLUDE=含む) ・ `ScoutRegistDateMode`(PERIOD=期間指定 / DATE=日付入力) ・
`ScoutAreaMode`(NATIONWIDE/EAST/WEST/PREFECTURE)。

**固定値6項目は列を持たない**（RPA が常に固定入力する。schema.prisma と migration.sql のコメントに明記）:
学歴=不問（チェックを入れない。入れると学歴欄が空の求職者が落ちる）／経験職種=指定なし／居住地=指定なし／0社を除く=チェックなし／
除外リストの会員=含まない／自社へ応募した会員=含まない。画面の詳細パネルには「固定値」として定数 `FIXED_VALUES` から表示するだけ。

日付の持ち方: `@db.Date` 列は UTC 0時の Date として保持し、読む側は `toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })`
（UTC 0時＝JST 9時なので同じ日付になる）。`executedAt` / `createdAt` は真の instant（`/admin/rpa-scout` 系の「JST壁時計をUTC欄に載せる」方式とは別）。

### API（ログインセッション必須・`getSessionUser()`。RPA 向け外部 API は未実装）

| ルート | 役割 |
|--|--|
| `GET /api/scout/conditions` | 条件全件＋号機（`RpaScoutMachine`）＋テンプレート＋祝日を1レスポンスで返す（`ConditionsResponse`）。絞り込みはクライアント側 |
| `POST /api/scout/conditions` | 作成。`parseConditionInput()` で検証（PREFECTURE で都道府県0件は 400／PERIOD で registDays 未指定は 400 等）。QUEUED で `queueOrder` 未指定なら号機内の末尾（max+1） |
| `PATCH /api/scout/conditions/[id]` | 部分更新（渡した項目だけ検証・`createdById` は変えない） |
| `DELETE /api/scout/conditions/[id]` | 削除（`scout_runs` は Cascade で一緒に消える） |
| `POST /api/scout/conditions/bulk` | `{ action: "duplicate" \| "delete", ids }`。複製は **status=QUEUED・同じ号機の末尾・`deliveryDate` は引き継がない・登録者=操作者** |

共通処理は `src/lib/scout-conditions/server.ts`（`conditionInclude` / `toConditionDto` / `parseConditionInput` / `toPrismaData`）。

### シード（`scripts/seed-scout-conditions.ts`。upsert・存在チェックで再実行可）

実行: `export DATABASE_URL=<master worktree の .env の値>; npx tsx scripts/seed-scout-conditions.ts`（`railway run` は使わない）。

| 対象 | 元データ | 2026-09-14 投入結果 |
|--|--|--|
| 祝日 | `prisma/seed/holidays-2026.json`（UI仕様書の2026年18日。振替休日 5/6・国民の休日 9/22 含む） | 18件 upsert（date unique） |
| 号機 | `RpaScoutMachine.isActive` を 1〜4=true / 5〜6=false に **updateMany するだけ**（行は作らない） | 更新0件（既に仕様どおり） |
| テンプレート | `prisma/seed/scout-templates.json` を `(kind, name)` で upsert | 19本（未送信5 / 送信済9 / 個別5） |
| 初期条件 | `scout_conditions` が空のときだけ、稼働号機ごとに `RpaScoutLog` 最新→`RpaScoutPattern` を6軸へ写像し **RUNNING** で1件ずつ作成。テンプレートはログの件名テンプレ名で照合 | 4件（1号機=EXCLUDE・7日以内、2〜4号機=ONLY） |

- **テンプレート JSON の出所**: 仕様では `prisma/seed/05.集計ファイル.xlsx`「テンプレートマスタ」から生成する想定だったが、
  xlsx が開発機に無かったため、同じマスタを移行済みの **`rpa_scout_subject_templates`（kind 付き・有効19本＝仕様の内訳と一致）から
  `scripts/generate-scout-templates-json.ts --from-db` で生成**した。xlsx が入手できたら `--xlsx <path>` で再生成→シード再実行で上書きできる
  （列名「種別/名称/件名/本文」をヘッダで探す実装。xlsx の実レイアウトは**未確認**）。JSON はコミット、xlsx は `.gitignore`（`prisma/seed/*.xlsx`）。
- 初期条件の写像規則: `sendStatus` SENT→ONLY / UNSENT→EXCLUDE。`registDirection` WITHIN→PERIOD、**AFTER（N日以降＝既登録）は
  DATE モードで「終了=当日−N日・開始なし」**、原文「N日前」は from=to=当日−N。`companyCount` は 0〜7 の範囲外なら null。

### 既知制約・未実装

- **条件を削除すると `scout_runs`（実績）がカスケード削除される**。T-195 で「実績がある条件は削除不可」に変更予定。
- 未実装（T-195 以降）: RPA 向け条件取得 API・実績（完了通知）受け取り API（`scout_runs` へ書くのはこれ。現状0件）・
  枯渇判定（送信件数10件未満）と予約の自動消化・予約切れの LINE WORKS 通知/タスク自動起票。
  画面上部の「◯号機の予約が空です」警告帯は **QUEUED が無い稼働号機を数えて出す静的表示のみ**で、通知・起票はしていない。
- 一覧の枯渇色（送信件数 < 10 または status=DRY）は `isDryRow()`（`_components/filter.ts`）で判定。閾値は `DRY_THRESHOLD`（constants.ts）。

## 配信条件の日付切替（T-209 → T-210 → T-211, master, 2026-09-18）

**運用ルール（T-211 で確定）: 有効になるのは「配信日が今日」の条件だけ。前日のうちに翌日分を予約しておけば翌朝に
自動で有効になる。配信日が過ぎたものは自動で完了。**

T-209 は**その号機に有効（RUNNING）が無いときだけ**予約を上げる作りで、前日の有効が残っていると翌日の予約が
永久に始まらなかった（2026-09-18 朝に1〜4号機すべてで発生し、人が手で完了→有効にした）。T-210 で「前日の有効を自動で完了」を
足したが、**対象を「配信日が今日以前」にしたため**配信日が過去の予約（9/13）が拾われ、過去日付の有効が一覧を開くたびに
完了→切替→LINE通知を繰り返した。さらに保存時の状態自動決定（T-197）が配信日を見ないため 9/21 配信予定の条件が当日に有効になった。
T-211 で下記に変更。

| 論点 | T-210 | **T-211（現行）** |
|--|--|--|
| 前日以前の有効 | 配信日が今日より前なら DONE（配信日が空なら最新実行日で判定・実行も無ければ何もしない） | 同じ（変更なし） |
| 期限切れの予約 | 触らない（有効に上げてしまっていた） | **配信日が今日より前なら自動で DONE**（通知なし。配信日が空の予約は触らない） |
| 上げる予約の対象 | 配信日が空、または今日以前 | **配信日が今日と一致するものだけ**（過去・未来・空欄は対象外） |
| 上げる予約の選び方 | 一覧の ▲▼ の並び順（queueOrder→登録順）で一番上 | 同じ（変更なし） |
| 有効が無くなった号機 | 通知なし | 通知なし（T-211 で1行通知を足したが **T-212 で廃止**。朝のまとめ通知の「条件なし」で分かる） |
| 保存時の状態決定 | 号機に有効が無ければ有効（配信日は見ない） | **配信日が今日 かつ 号機に有効が無い → 有効。それ以外は予約の末尾** |
| 枯渇時の予約消化の候補 | 予約の ▲▼ 先頭（配信日は見ない） | **配信日が今日の予約の ▲▼ 先頭**（しきい値10件・is_dry・通知・タスクは不変） |

- **判定の単一ソースは `src/lib/scout-conditions/rollover.ts`（純関数・DB も現在時刻も見ない）**。
  `shouldCompleteRunning()` / `shouldCompleteQueued()` / `pickQueuedToActivate()` を、サーバー側（`activate.ts`）・
  枯渇時の予約消化（`runs.ts`）・一覧の「翌朝有効」バッジ（`_components/filter.ts` の `nextMorningConditionIds`）が共用する。
  規則を変えるときはここ1か所。境界（今日ちょうど／昨日／明日／空欄）は各関数の JSDoc に明記してある。
- 実行は `activate.ts` の `runDateRollover(machineId)`（号機ロックの中で 2-1 有効の完了 → 2-2 期限切れ予約の完了 →
  2-3 当日の予約を有効化 の順）。呼び口は2つ:
  `GET /api/external/scout-conditions/current`（RPA。**有効の有無にかかわらず毎回通す**）と `GET /api/scout/conditions`（一覧表示）。
  cron は無い（RPA か人が触った時点で切り替わる。1号機の夜間フローが 5:00 に取りに来るのでその時点で当日扱いになる）。
- **T-212: `runDateRollover()` は LINE WORKS へ何も送らない**（DB の状態を直すだけ）。通知は下の朝のまとめ1通に一本化した。
- 「翌朝有効」バッジ: 今の有効が明朝の判定で完了になる見込み（配信日が今日以前 / 配信日が空で最新実行が今日以前）か、
  今の有効が無い号機にだけ、**配信日が明日ちょうど**の予約の先頭1件へ出す。今の有効の配信日が明日以降なら出さない。
- **配信日の自動補完はしない**（T-210 までは「有効にするとき配信日が空なら当日を入れる」をしていたが、
  有効になるのは配信日が今日の行だけになったので `create.ts` / `activate.ts` / `runs.ts` の補完はすべて削除した）。
- 副作用として、**配信日が今日の予約が1件も無い号機は有効なしになる**（RPA は `condition: null` で停止）。
  枯渇経路の「予約が空」通知・ポータルタスク起票（`queue-empty.ts`）は不変。
- 日付は必ず `jstTodayYmd()`（`toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })`）基準。`toISOString().slice(0,10)` は使わない（罠#17）。

## 朝の「本日の配信条件」まとめ通知（T-212, master, 2026-09-19）

**スカウト配信条件の LINE WORKS 通知を「朝1通のまとめ」に一本化した。**

T-210/T-211 は日付切替のたびに号機ごとに「条件Aを完了 → 条件Bに切替」を送っていたが、
**1号機の夜間フローが 5:00 に `/current` を取りに来るため通知が早朝に飛び**、しかも完了した条件が無い号機には出なかった。
運用の求めは「RPA が動き出す8時前後に、全号機の本日の配信条件を1通で」。

| 通知 | T-211 | **T-212（現行）** |
|--|--|--|
| 日付切替の「条件Aを完了 → 条件Bに切替」 | 号機ごとに1行 | **廃止** |
| 「本日の配信条件がありません」 | 有効が無くなった号機に1行 | **廃止** |
| **朝の「本日の配信条件」まとめ** | – | **新規（1日1通・全号機分）** |
| 枯渇して次の予約に切り替わった通知 | あり | 変更なし |
| 枯渇したのに次が無い通知＋ポータルタスク | あり | 変更なし |

- 送るタイミング: `GET /api/external/scout-conditions/current` が **その日（JST）の 07:00 以降に最初に呼ばれたとき**、
  日付切替（`runDateRollover`）を終えた**あと**。**07:00 より前（1号機の夜間フロー 5:00）では送らない**（切替自体は走る）。
  RPA が一度も動かない日は送られない（許容済み）。cron は無い。
- 実装は `src/lib/scout-conditions/daily-summary.ts` の `notifyDailySummaryIfDue()` 1か所。呼び口は `external.ts` のみ。
  文面の組み立ては**純関数 `buildDailySummaryMessage(todayYmd, lines)`**（DB も現在時刻も見ない）。
  行は稼働中（`isActive`）の号機を号機番号順に、有効（RUNNING）の条件を `conditionLabel()` の要約＋レコード番号（`1-017`）で1行ずつ。
  有効が無い号機は「条件なし」。**テンプレート名は入れない**（長くなるため）。
- 1日1回の担保: **新規テーブル `scout_daily_notifications`**（`date` @db.Date が主キー・`sent_at`）。
  `createMany({ skipDuplicates: true })`（= ON CONFLICT DO NOTHING）1文で行を取れた呼び出しだけが送るので、
  複数号機が同時に取りに来ても1通に絞られる。
- 呼んできた号機以外はまだ当日の切替を通っていないことがあるため、文面を作る前に `runDateRolloverForActiveMachines()` を通す
  （判定は `rollover.ts` のまま。ここに規則は足さない）。
- **送信失敗で RPA を止めない**: この経路は throw せず `console.warn` に残すだけ。`/current` のレスポンスは常に正常に返る。

```
【スカウト】本日（9/19 土）の配信条件が有効になりました
1号機: 未送信/7日以内/卒15-26/～3社/全国（1-017）
2号機: 送信済/2026-09-17〜2026-09-17/卒15-26/～3社/全国（2-010）
5号機: 条件なし
```

## 配信条件の実行履歴タブ・結果＝初回値・実行回数（T-213, master, 2026-09-20）

1条件が1日に何回も実行される（1回50人前後）ため、条件一覧の「最新の実行日時」だけでは履歴が追えず、
RPA から届く「検索結果件数」を回数分合算していたため 26859 のような母数になっていた。

- **「実行履歴」サブタブ**: `/scout/conditions?view=runs`。1行＝`scout_runs` 1件を実行日時の新しい順。
  列は条件一覧と同じ2段組み（実行日時/枯渇・号機/担当者・条件NO/状態・検索対象/登録日・ログイン/卒業年度・経験社数/居住地・
  希望勤務地/テンプレート・結果・抽出/送信）。条件側の項目は**その条件に現在設定されているもの**（実行時の値は RPA から届かない。
  T-201 の編集ロックで実績のある条件は状態以外変わらないため一致する）。
  絞り込みは期間（実行日時基準・既定は今日を含む直近7日）／号機／枯渇のみ／文字検索（NO・条件要約・テンプレート名・担当者名の部分一致）。
  100件ずつページング・総件数表示・表示中の CSV。NO クリックで既存の編集モーダル。
  内部 API `GET /api/scout/runs?from=&to=&machines=&dry=&q=&page=`（`src/lib/scout-conditions/run-history.ts`）。
  期間・号機・枯渇は DB で絞り、文字検索とページングは在庫で行う（照合対象が表示用の合成文字列のため）。
  **外部 API（`/api/external/scout-conditions/*`）は不変。**
- **「結果」（検索結果件数）は初回の値**: 値を持つ実行のうち `executed_at` が最も古い1件の値（`firstSearchResultCount`。
  `server.ts` の `firstSearchResultCount()` 1か所）。適用先は条件一覧の「予測/結果」下段（達成率も同じ値で計算）・
  編集モーダルの実績「結果」・条件一覧 CSV（「結果件数（初回）」列を追加）。集計・グラフに合算箇所は無かった。
  `totalSearchResultCount` は廃止。抽出・送信の累計（T-203）は変えていない。
- **条件一覧の「実行日時」下段に実行回数**（`3回`。0回は `-`）。CSV にも「実行回数」列。

## 配信条件の更新者/更新日時・同日他号機との重なり表示（T-214, master, 2026-09-20）

### 更新者・更新日時（マイグレーション `20260920120000_t214_scout_condition_edited_by`）

`scout_conditions` に nullable の `edited_at` / `edited_by_id`（User 参照・ON DELETE SET NULL）を追加。
`updated_at`（`@updatedAt`）は日付切替・枯渇切替・RPA の結果受信など自動処理でも動くため、**人が保存した操作だけ**に付ける別列。
付与は `server.ts` の `editorStamp(actorId)` 1か所。

| 操作 | 書く |
|--|--|
| 編集モーダルの「保存する」（PATCH `/api/scout/conditions/[id]`） | ○ |
| 一覧・モーダルからの手動の状態変更（同じ PATCH） | ○ |
| 一括操作（`bulk/route.ts`）: 複製＝新規作成なので作成者のみ（更新は `-`）／削除＝行が消える | – |
| ▲▼の並び替え（bulk `move`） | × |
| 日付切替（`activate.ts` / `rollover.ts`）・枯渇による切替（`runs.ts`）・朝のまとめ通知・RPA の結果受信 | × |

編集モーダルの実績ブロックは 配信日／**作成**（作成日時＋登録者を1行）／**更新**（更新日時＋更新者。未更新は `-`）／最終実行／予測・結果・抽出・送信。
「登録者」の単独行は「作成」に統合して廃止。既存レコードは null のまま。

### 同日の他号機パネル（`SameDayPanel.tsx`）

編集モーダルを左右2列（最大幅 1560px）にし、右に「同日の他号機」パネル。
対象は**他の稼働中号機**（`RpaScoutMachine.isActive`）の**有効・予約**で、配信日がフォームの配信日と同じもの（**空なら今日**）。
内部 API `GET /api/scout/conditions/same-day?date=&machineId=`（号機順→▲▼順）。モーダルを開いたとき、配信日・号機が変わったときに取り直す。
**1280px（xl）未満では右パネルをフォームの下に回す**。xl 以上ではスクロールしても右パネルは上に留まる（sticky）。

> ⚠️ T-214 で入れた「**重なり**」（7軸すべてが**交わる**）は **T-216 で廃止**し、「**重複**」（7軸すべてが**一致する**）に置き換えた。
> 判定の中身は下の「T-216」の節を参照。`overlap.ts` は `duplicate.ts` になり、`overlapRecordNos` は `duplicateRecordNos` になっている。

- 触っていないもの: 外部 API のレスポンス構造・受け入れ処理、状態の内部値、日付切替・枯渇判定・通知、保存時の状態決定、編集ロック。

## 配信条件の配信日を必須にする（T-200, master, 2026-09-21）

**配信日が空の配信条件は作れない・保存できない。** 空だと一覧の期間フィルタ（予約日/配信日基準）にも
日付タブ（前日/当日/翌日）にも出ず、「すべて」でしか見つからない行になるため。
T-211 で「空なら当日を入れる」サーバー側の補完は廃止しているので、**空は空のまま保存させない**方針に揃えた。

| 場所 | 挙動 |
|--|--|
| 編集モーダル（新規作成・複製後・編集） | 項目名「配信日」に赤い `*`。空のまま「保存する」を押すと入力欄の直下に赤字「配信日を入力してください」を出し、保存しない（`FormRow` の `required` / `error`） |
| サーバー（POST `/api/scout/conditions`・PATCH `/api/scout/conditions/[id]`） | `parseConditionInput` が空を 400 で弾く |
| **実績のある条件（T-201 のロック中）** | **必須チェックを飛ばす**。判定は PATCH の `const locked = current.runs.length > 0`（`parseConditionInput(..., { requireDeliveryDate: !locked })`）。配信日が空のまま実績を持ってしまった古い行の「状態だけ変える」操作を止めないため。画面側も同じ判定（`locked` なら save のチェックをしない） |
| 一括複製（bulk `duplicate`） | 配信日は引き継がず**空のまま作る**（サーバー側の補完もしない）。画面の「複製」は作成後そのままモーダルを開くので、そこで配信日を入れて保存する |
| 一覧の「予約日/配信日」列 | 下段が空の行は赤字で **`配信日なし`**（2026-09-21 時点で 3-018 の1件） |

- `requireDeliveryDate` を false にしてよいのはロック中の行だけ。既定は true。
- 触っていないもの: 外部 API のレスポンス構造・受け入れ処理、状態の内部値、日付切替（`rollover.ts`/`activate.ts`）、朝のまとめ通知、枯渇判定・通知・予約消化、保存時の状態決定（T-211）。

## 保存前の確認画面・一覧の更新日時・「重複」の新定義（T-216, master, 2026-09-21）

スカウト配信条件コンソール（`/scout/conditions`）の運用要望3件。**スキーマ変更なし**（`edited_at` / `edited_by_id` は T-214 で追加済み）。

### 1. 保存前の確認画面（`ConditionModal.tsx`）

編集モーダル（新規・編集・複製のすべて。**ロック中〔T-201〕の行も同じ**）で「保存する／登録する」を押すと、
**すぐには保存せず、モーダルの中身を確認画面に差し替える**（別モーダルは重ねない）。見出しは「保存内容の確認」。

| | |
|--|--|
| 表示項目（`FormGroup`/`FormRow` の1行1項目） | 号機・担当者／**状態（保存後にどうなるか**。新規は T-211 の規則で「有効」か「予約（末尾）」、編集・ロック中は変更後の値）／配信日／検索条件7軸（一覧と同じ要約文言）／配信文（`T-001　テンプレート名`）／予測件数／**重複**の有無 |
| 重複あり | その行に赤字で `2号機 2-018 と重複しています`（§3 の新定義。同日の他号機がまだ読めていない間は「確認中…」） |
| ボタン | 「戻る」（編集へ。**入力内容は保持**）／「この内容で保存」の2つだけ |
| 成功 | モーダルを閉じて一覧へ戻り、一覧を読み直す（新規作成でも開き直さない）。「重複」印はサーバーが一覧 GET で付けるため読み直しが要る（`ConditionsClient` の `refresh()`。スピナーを出さず複製ハイライト〔T-204〕も消さない） |
| 失敗（400/409 等） | 確認画面に留まり、エラー文をその場に赤字で出す（閉じない） |
| Enter | 保存しない。モーダル内の入力欄・プルダウン上の Enter は `onKeyDown` で無効化（ボタン・リンク・textarea は通す）。保存は2回の明示的なクリックだけ |
| Esc | 確認画面では**編集に戻る**（入力を捨てない）。編集画面では従来どおり閉じる |

- 配信日の必須チェック（T-200）は確認画面へ進む前（`requestConfirm`）で行う。不正な値のまま確認画面に進ませない。
- 実処理は `save()`（従来どおり POST / PATCH）。ボタンの押し口が `requestConfirm` → `save` の2段になっただけで、送る中身・サーバー側は不変。

### 2. 一覧の「予約日/配信日」列の上段を更新日時に（`ConditionTable.tsx`）

- 上段: `edited_at` があれば **`更新 2026-09-21(月) 10:02 大野`**（更新者は**姓だけ**。`filter.ts` の `surnameOf`。ホバーで予約日）。無ければ従来どおり予約日（`createdAt`）。見出しは「予約日/更新」。
- 下段: 配信日（変更なし。空なら赤字「配信日なし」も従来どおり）。
- **並び替え・絞り込みの基準は変えない**（期間フィルタの「予約日」は従来どおり `createdAt`、日付タブは配信日）。実行履歴タブも変更なし。
- 条件一覧 CSV に **「更新日時」「更新者」**（フルネーム）の2列を「予約登録日時」の右へ追加。
  あわせて **T-194 から見出しと値が入れ替わっていた「作成日」「配信日曜日」の2列の見出しを値に合わせて直した**（値の並びは不変）。

### 3. 「重なり」→「重複」・判定は同一条件のみ（`src/lib/scout-conditions/duplicate.ts`）

T-214 の「重なり」は **7軸すべてが交わる**（範囲が少しでも触れる）だったが、最終ログイン日「N日以内」は必ず今日を含むため実質つねに交わり、
居住地「全国」・希望勤務地「指定なし」も何とでも交わるので、**条件がまったく違う組にまで印が付いていた**（2026-09-21 時点で15行）。
印を見に行く意味が無くなっていたため、**7軸すべての値が一致する組だけ**を「重複」とする定義に変えた。**旧判定は廃止**。

**重複＝次をすべて満たす**: ① 同じ配信日（配信日が空の有効・予約は「今日」とみなす。T-214 と同じ約束） ② 別の号機（同じ号機どうしは対象外）
③ 相手の状態が有効（RUNNING）または予約（QUEUED）・相手の号機が稼働中 ④ **7軸すべてが同じ値**。

判定は軸ごとに「正規化した文字列キー（`axisKey`）が等しいか」。**境界の考え方は一致のみで、範囲の交差は見ない。**

| 軸 | 一致とみなす値（`axisKey`） |
|--|--|
| 検索対象 | 値そのもの（`EXCLUDE` / `ONLY` / `INCLUDE`） |
| 登録日 | 指定方法＋値。期間指定は `PERIOD:7`（未選択＝指定なしは `PERIOD:`）、日付入力は `DATE:2026-09-01~2026-09-07`（端が空はそのまま空）。**指定方法が違えば別物** |
| 最終ログイン日 | 日数そのもの（`1日以内` と `3日以内` は別物） |
| 卒業年度 | 開始と終了の組（`2015-2026`。指定なしは空文字。`15-26` と `21-22` は**別物**） |
| 経験社数 | 値そのもの（指定なしは空文字。`～3社` と `～1社` は**別物**） |
| 居住地 | 都道府県の集合（全国/東日本/西日本は `expandAreaToPrefectures` で展開してから比較。「全国」と「47都道府県を選んだ都道府県指定」は一致） |
| 希望勤務地 | 都道府県の集合（指定なし〔ALL〕は RPA が「全国」を入れるので全都道府県に展開して比較） |

- 関数: `isDuplicate(a, b)`（真偽）／`conditionKey(c)`（7軸をまとめた1本のキー）／`axisKey(key, c)`／`duplicateAxes(a, b)`（軸ごとの内訳）／
  `findDuplicates(target, others)`／一覧用 `computeListDuplicates(rows, activeMachineIds, todayYmd)`（「同じ日 × 同じ7軸キー」でまとめてから他号機を拾う）。
  **`todayYmd` を使うのは「配信日が空なら今日」の読み替えだけ**で、軸の判定は現在時刻に依存しない（旧判定は「N日以内」を今日基準の区間に直していた）。
- 文言はすべて「**重複**」に統一: 一覧の赤い印／モーダル上部の赤字 `… と重複しています`／右パネルの見出し `重複 N件` と行バッジ／確認画面の「重複」行。
- DTO は `overlapRecordNos` → **`duplicateRecordNos`**、サーバー側は `attachListOverlaps` → **`attachListDuplicates`**、ファイルは `overlap.ts` → **`duplicate.ts`**。

**本番（読み取りのみ）での印の変化（2026-09-21・全82件／判定対象26件）**

| | 印の付いた行 |
|--|--|
| 変更前（T-214「重なり」） | 15行: 1-016・2-008・2-009・2-012・2-014・3-007・3-008・3-011・3-018・3-019・4-011・4-012・4-014・4-018・5-005 |
| 変更後（T-216「重複」） | **0行** |

当日タブに出る8行（1-016・2-008・2-009・3-007・3-008・4-011・4-012・5-005）の印は全部消える。
7軸キーを並べると差が見えるので妥当: 3-007 と 4-011 は居住地だけが違う（東日本17県 / 西日本30県）、3-007 と 3-008 は卒業年度・経験社数が違う、など。

- 触っていないもの: 外部 API（`/api/external/scout-conditions/current`・`/runs`）、状態の内部値（`RUNNING`/`QUEUED`/`DRY`/`DONE`）、
  保存時の状態決定（T-211）、編集ロック（T-201）、日付切替・朝のまとめ通知・枯渇判定・通知・タスク作成、`seq_no`/`T-001` 採番、`scout_templates`、都道府県短縮表記、スキーマ。

## 号機の稼働オン/オフを画面から切り替える（T-215, master, 2026-09-21）

`RpaScoutMachine.isActive` は seed / スクリプトでしか変えられなかった。**スキーマ変更なし**（既存列）で切替 UI を足した。

- 場所: `/scout/conditions`（条件一覧）の**絞り込みエリア右端の「号機設定」ボタン** → 中央モーダル `MachineSettingsModal.tsx`。
  号機番号順（1〜6号機）に「号機／担当者／稼働トグル」の3列。担当者名は `MachineLabel` と同じ既存の紐付け（`recruiterDisplay` の `RC_ROSTER`）で、独自の対応表は持たない。
- 保存: 切替のたびに即時 `PATCH /api/scout/machines/[id]`（body `{ isActive: boolean }`・ログインセッション認証）。
  画面へ先に反映し、失敗したら元に戻してトーストを出す。
- 稼働オフの効き方は**既存ロジックがそのまま拾う**（`isActive` を見ている箇所は変更していない）。

| 見ている場所 | 稼働オフのとき |
|--|--|
| 朝のまとめ通知（`daily-summary.ts`） | 対象外 |
| 日付切替（`activate.ts` の `runDateRolloverForActiveMachines`） | 対象外 |
| 一覧の警告帯（予約切れ／「有効」なし） | 対象外 |
| 同日の他号機パネル（`/api/scout/conditions/same-day`）・一覧の「重なり」印（`attachListOverlaps`） | 対象外 |
| 外部 API（`external.ts`） | `N号機は停止中です` で拒否 |
| **条件一覧の「号機」絞り込み** | **これまでどおり全号機を出す**（停止中の号機の過去実績も見られるように） |

- 稼働オフにしてもその号機の条件・実績は消さない（行はそのまま残り、一覧・CSV にも出る）。
- 触っていないもの: 外部 API のレスポンス構造・受け入れ処理、状態の内部値、日付切替・朝のまとめ通知・枯渇判定/通知/予約消化のロジック、`seq_no` 採番。

## ブックマークのエリア・職種（T-196, master, 2026-09-15）

求職者詳細のブックマーク一覧（HistoryTab / BookmarkSection）に「エリア」「職種」列を追加した。
**値の source of truth は job-platform（求人プラットフォーム）**。取り込み時に自社マスタの対応表
（職種 大＞中＞小、エリア 都道府県／市区）で機械的に確定した値を portal にコピーして保持するだけで、
**portal 側では推測も生成もしない（AI 呼び出しは一切なし）**。null は「未取得」＝画面は「—」。

### CandidateFile の列

| 列 | DB 列名 | 用途 | 例 |
|--|--|--|--|
| `jobArea` | `job_area` | エリア（表示用・T-196 新設） | 「東京都 港区」 |
| `jobCategory` | `job_category` | 職種（**T-161/T-185 の既存列を流用**・新設していない） | 「CAD・CAMオペレーター」 |
| `jobCategoryPath` | `job_category_path` | 職種フルパス（ホバー表示専用・T-196 新設） | 「技術職（機械・電気）＞設計＞CAD・CAMオペレーター」 |

- migration: `20260915120000_t196_candidate_file_job_area_category`（`ADD COLUMN IF NOT EXISTS` ×3・冪等）。
- `jobCategory` は T-185 で求人本文からの抽出も入っているため、埋め戻し前から値がある行がある
  （本番 BOOKMARK 11,302 行中 1,558 行が 2026-09-15 時点で値あり）。job-platform からの値が来たら上書きされる。

### 値の入り口（2つ・どちらも job-platform 側から）

**① 既存のブックマーク受信 API（任意項目として追加・後方互換）**

`POST /api/external/bookmarks/from-job-platform`（認証 `x-api-secret`: `JOB_PLATFORM_API_SECRET`）

```jsonc
{ "candidateNumber": "5008587",
  "jobs": [{ "externalJobRef": "hl-ap-xxx", "companyName": "…", "extractedText": "…",
             "jobArea": "東京都 港区",            // 任意・string|null|undefined
             "jobCategory": "CAD・CAMオペレーター", // 任意（既存項目。jobType でも可）
             "jobCategoryPath": "技術職（機械・電気）＞設計＞CAD・CAMオペレーター" }] }  // 任意
```

- 未指定なら**既存挙動と完全同一**（新規作成は null、既存行の更新では既存値を消さない）。
- バリデーションは文字列長上限 200 文字のみ（超過は切り詰め・受信自体は失敗させない）。
- `origin: "auto"`（T-189 自動引き当て）経路でも同じ3項目を受け取る。

**② 埋め戻し用 API（既存分の一括更新・T-196 新設）**

`POST /api/external/bookmarks/job-attributes`（認証は ① と同じ）

```jsonc
{ "items": [{ "externalJobRef": "hl-ap-xxx", "jobArea": "東京都 港区",
              "jobCategory": "CAD・CAMオペレーター", "jobCategoryPath": "技術職…＞…" }] }
// → { "ok": true, "received": 1, "matchedRefs": 1, "updatedRows": 3, "errors": [] }
```

- 1リクエスト最大 **500 件**（超過は 400）。
- `externalJobRef` が一致する**全** `CandidateFile`（`category="BOOKMARK"`・`archivedAt` 問わず・求職者をまたぐ）を
  `updateMany` で更新。**既に値が入っている行も上書きする**（job-platform が正）。
  3項目とも「送られてきた値で上書き」＝部分更新はしない（未指定は null で消える）。
- `matchedRefs` = 1行以上更新できた求人IDの数 / `updatedRows` = 実際に更新した行数。

`GET /api/external/bookmarks/job-refs?onlyMissing=true`（認証は ① と同じ）

- BOOKMARK の `externalJobRef` を distinct で返す → `{ "refs": [...], "count": N }`。
- `onlyMissing=true` で `jobArea` と `jobCategory` が**両方 null** の行に限定（どちらか埋まっていれば取得済み扱い）。

### 画面

- 列順: `☑ | DB名 | DBNO | 会社名 | エリア(100px) | 職種(150px) | 希望 | 通過 | 総合 | 本人回答 | 担当 | 紹介日 | 操作`
- 職種セルのホバーは `jobCategoryPath ?? jobCategory`。長い値は `truncate`。
- **並び替え・絞り込みは対象外**（表示のみ）。紹介保留タブ（ArchivedBookmarkSection）にも出していない。
