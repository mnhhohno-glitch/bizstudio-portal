# T-XXX step1 CA実績データ ChatGPT連携 調査報告（portal）

- 調査日: 2026-10-01（JST）
- 対象: bizstudio-portal（sagyou-2 を origin/master `5f2970d` まで fast-forward してから調査）
- 性質: **調査のみ**。コード変更・マイグレーション・DB書き込み・AI呼び出しはしていない
- 本番DBの数値はすべて**集計値のみ**（件数・割合・日付の最小/最大）。求職者の個人情報は出力していない

> **接続方法の変更について（重要）**: 指示どおり `railway ssh --service bizstudio-portal` で接続しようとしたが、Railway CLI のログインが切れていて使えなかった（`Unauthorized. Please run railway login again.`）。代わりに master worktree の `.env` にある `DATABASE_URL`（本番proxy）へローカルの Node（`pg`）から接続し、**接続オプション `default_transaction_read_only=on` で接続ごと読み取り専用**にして SELECT だけを実行した（`show default_transaction_read_only` = `on` を確認済み）。`railway run` は使っていない。`.env` の値は表示も記録もしていない。

---

## 1. 結論

1. **ChatGPTからCA別実績を取ることはできる**。認証（Bearer `AI_READ_API_KEY`）と、画面と同じ数字を出す集計関数（`computeWeeklyMatrix`）がすでにある。2026-08 の全CA数値は、画面の集計関数と独立に書いたSQLで完全に一致した。
2. **主な不足項目**: ①選考ステータスの**変更履歴**と**担当CA変更の履歴**が無い（今の値だけ）。②面談時間は開始・終了時刻から出せるが、**実際の長さではなく予約枠（30分・60分）の値**になっている。③**ABCD判定の履歴は 2026-09-25 以降しか無い**。それ以前は最新値の上書きだけで、AIが付けたかCAが直したかも区別できない。④二次面接の日付はほとんど入力されていない（全期間で20件）。
3. **推奨**: `company-kpi` は変えずに、CA別・日別／月別の姉妹API **`GET /api/ai/ca-kpi`** を新しく足す。純粋な追加なので master 直pushでよい区分になる。

---

## 2. 既存APIの現状（§1）

### 2-1. `GET /api/ai/company-kpi`

| 項目 | 内容 |
|--|--|
| ファイル | `src/app/api/ai/company-kpi/route.ts`（`GET`・`buildBlock`）、補助集計 `src/lib/aiRead/kpi.ts`（`countCompanyInterviewCandidates`・`sumInvoiceRevenue`） |
| 認証 | `src/lib/aiRead/auth.ts` `assertAiReadAuth`。ヘッダー `Authorization: Bearer <key>`。環境変数 **`AI_READ_API_KEY`**（Railway の `bizstudio-portal` サービスの Variables）。未設定なら 503（fail-closed）、不一致・ヘッダー無しなら 401。比較は `timingSafeEqual` |
| middleware | `src/middleware.ts` は `/api/` を素通しにしていて、認証は各routeで行う。新しいAPIを足しても middleware の変更は要らない |
| パラメータ | `year=YYYY`（省略時は今年）、`month=YYYY-MM`（省略時は今月）。当年・当月の範囲は「今日まで」。CAの指定や from/to、日別の指定は**できない** |
| CAの範囲 | `Employee.jobCategory='CA'` かつ `status='active'`（実績表の担当セレクトと同じ条件）。現在8名 |
| レスポンス | `asOf`, `timezone`, `scope:"CA_ONLY"`, `scopeNote`, `definitions`, `caCount`, `year{period,…Block,targetRegisteredMonths}`, `month{period,…Block}`, `byCa[{employeeNumber,name,year,month}]` |
| ページネーション・上限 | 無し。byCa は在籍CA全員を毎回返す |
| 応答サイズ | 8名×2期間×12項目なので数KB〜10KB程度（推定・実測はしていない） |
| タイムアウト | コードでは設定していない（`dynamic="force-dynamic"`・`maxDuration` 無し）。CAごとに順番に集計する（1CAあたり `computeWeeklyMatrix`×2＋補助集計×4）。応答時間は今回測っていない |
| キャッシュ | `Cache-Control: no-store` |

Block の各項目（売上系は今回の対象外なので、項目名だけ挙げる）:

| フィールド | 定義 | テーブル・日付 |
|--|--|--|
| `caInterviewCount` | CAと求職者の面談の件数（辞退系を除き、`interview_count>=1`） | `interview_records.interview_date`・担当＝`candidates.employee_id` |
| `companyInterviewCount` | 企業との面接（一次・二次・最終のどれか）の日付が期間内にある**求職者の人数** | `job_entries.first/second/final_interview_date` |
| `entryCount` | エントリーした**求職者の人数**（件数ではない） | `job_entries.entry_date`・`entry_flag IN (応募,エントリー,書類選考,面接,内定,入社済)` |
| `documentPassCount` / `offerCount` | 書類通過・内定の**人数** | `document_pass_date` / `offer_date` |
| `decidedDealCount` / `decidedCandidateCount` | 承諾の件数（行数）／人数 | `acceptance_date` |
| `invoiceRevenue` / `grossProfit` / `revenueTarget` / 単価2種 | 売上・粗利・目標（**今回は対象外**） | — |

共通のルール: 担当の軸は `candidates.employee_id`、`job_entries.archived_at IS NULL`（無効 `is_active=false` は含める）、JSTの範囲は `src/lib/dailyReport/jstDate.ts`。

### 2-2. 外部から読み取れる既存API（GET）

| パス | 認証（変数名） | 内容 | 分析に使えるか |
|--|--|--|--|
| `/api/ai/company-kpi` | Bearer `AI_READ_API_KEY` | 上記 | ○ |
| `/api/ai/schema-check` | Bearer `AI_READ_API_KEY` | 面談テーブルの件数とサンプル行 | × 確認用 |
| `/api/ai/health` | 無し | Gemini キーが設定されているかだけ | × |
| `/api/external/candidate-summary/[jobSeekerId]` | `KYUUJIN_API_SECRET` | 求職者1名の詳細 | × 個人情報あり |
| `/api/external/candidate-birthday/[candidateNo]` | `EXTERNAL_API_SECRET` | 生年月日・メール | × 個人情報あり |
| `/api/external/candidates/search`、`bookmarks/job-refs`、`recommend/enabled-candidates` | `JOB_PLATFORM_API_SECRET` | job-platform 連携用 | × |
| `/api/external/schedule-tasks`、`scout-conditions/current`、`scout-plan` | `EXTERNAL_API_SECRET` | 日程調整タスク・スカウト運用 | × 業務連携用 |
| `/api/external/candidate-site/*` | `CANDIDATE_SITE_API_KEY` | 求職者1名分 | × |
| `/api/internal/*` | `INTERNAL_API_KEY` | 社内連携 | × |
| `/api/rpa/mynavi/*` | `RPA_API_SECRET` | RPAの状態 | × |

CA実績を集計値で返すのは `company-kpi` だけ。

### 2-3. ChatGPT GPTs 連携の準備状況

- **OpenAPIスキーマのファイルは無い**（repo 全体で openapi / swagger / GPTs を検索して該当なし）
- 手順書も無い。関係する記述は次の3か所だけ:
  - `src/lib/aiRead/auth.ts` の先頭コメント（Claude / ChatGPT 向けと書いてある）
  - `src/app/api/ai/company-kpi/route.ts` の先頭コメントと `definitions`（スキーマ説明文の材料になる）
  - `docs/reports/T-191_api_auth_inventory.md`（company-kpi を「Bearer・個人情報なし」として棚卸し済み）

---

## 3. CA別に出せる数値の一覧表（§2）

記号: ○＝取れる／△＝条件付き（備考に理由）／×＝ポータルに記録が無い。
「担当軸」＝`candidates.employee_id`（求職者の今の担当CA）。実績表・company-kpi と同じ軸。

### 3-1. 面談

| 数値名 | 定義（何を1件と数えるか） | 元テーブル.カラム | 基準日付 | CAの紐づけ | 可否 | 備考 |
|--|--|--|--|--|--|--|
| 面談数（実施） | 面談記録1件。辞退系（連絡なし辞退・連絡あり辞退・辞退）を除き、null は実施扱い | `interview_records`・`result_flag` | `interview_date` | 担当軸 | ○ | 実績表と同じ定義。`interview_count IS NULL` は除く（現在0件） |
| 新規（1回目）面談数 | `interview_count = 1` の実施分 | `interview_records.interview_count` | `interview_date` | 担当軸 | ○ | 下の「新規／既存の見分け方」を参照。5月以降の真の初回415件のうち7件（1.7%）が既存として数えられている |
| 既存（2回目以降）面談数 | `interview_count >= 2` の実施分。2回目・3回目以降に分けることもできる | 同上 | 同上 | 担当軸 | ○ | |
| 面接対策の面談数 | `interview_type = '面接対策'` | `interview_records.interview_type` | `interview_date` | 担当軸 | ○ | 種別でしか判定できない例外。日報の定義（`computeCaMetricsForRange`）は辞退を除いていない |
| 面談時間（合計・平均） | 終了時刻−開始時刻（分） | `interview_records.start_time` / `end_time`（文字列 HH:MM）、`duration` | `interview_date` | 担当軸 | △ | 5月以降の実施分930件のうち、時刻から計算できるのは833件（90%）。ただし**中央値30分・平均37分で、432件がちょうど30/60/90分**＝予約枠の長さで、実際の長さではない。`duration` 列は約半数で空か0（時刻があるのに空が408件）なので使わない。文字起こしはDBに無い（`raw_transcript` は0件。面談ログはDriveの MEETING .txt）。面談サポートの録音（`interview_support_sessions.started_at/ended_at`）は全期間で1件だけ |
| 面談評価（ランク）分布 | 初回面談1件ごとの `overall_rank`（S/A+/A/B+/B/C/D/未評価） | `interview_ratings.overall_rank`（面談と1対1） | `interview_date` | 担当軸 | ○ | 画面の円グラフ `computeInterviewRankBreakdown` と同じ。5月以降の初回のランク入力率は72〜92%。**S が5件ある**（2026-06-08。仕様メモの「Sは存在しない」は古い）。CAがスコアを入れると画面側で自動計算されるが、手で直すこともできる。誰が付けたかと変更履歴は残らない |
| 面談予約数 | 面談記録1件（辞退も含む） | `interview_records` | `interview_date` | 担当軸 | △ | 専用の予約テーブルは無い。面談記録は事前に作られる（5月以降、過去の面談1031件のうち896件は面談日より前に作成）ので、「記録の総数」をほぼ予約数とみなせる。予約した日（`created_at`）でも数えられる |
| 実施数 | 予約のうち辞退系以外で、面談日が過去のもの | 同上 | 同上 | 担当軸 | ○ | |
| キャンセル・不参加数 | `result_flag` が `連絡なし辞退`（不参加）／`連絡あり辞退`（事前キャンセル）／`辞退`、日程変更は `日程再調整` | `interview_records.result_flag` | `interview_date` | 担当軸 | △ | 5月以降は月に連絡なし辞退16〜19件、連絡あり辞退3〜5件、日程再調整3〜5件。一度辞退にしてから日付を変えて同じ記録を使い回した場合、その履歴は残らない |
| 日程調整AIの予約・取消 | AI仮予約は日程調整の Task として残る（必要なら面談記録も作る） | `tasks`（カテゴリ「日程調整」）、`src/lib/schedule-agent/post-reserve.ts` | `tasks.created_at` | タスク作成者／担当者 | △ | AI仮予約で作る面談記録は `interview_count=null`・担当「仮予約」なので実績から外れる。今は該当0件。取消のステータス列は無い。scout-scheduler は別サービスでこの repo には無い |

**新規／既存面談の見分け方**

- 面談種別（`interview_type`）には「新規面談」「初回面談」「既存面談」「フォロー面談」「面接対策」が混ざっていて、表記にばらつきがあるので**使わない**（仕様どおり）
- 回数（`interview_count`）で見分ける。値は**保存した時点で「その求職者の既存の記録数＋1」に固定**される（`src/app/api/interviews/route.ts`）。辞退の記録も数に入る
- 確認結果（全期間）: 実施分5,143件のうち5,094件（99.0%）は日付順の順位と一致した。初回の重複（同じ求職者に `interview_count=1` の実施分が2件以上）は**0件**
- 5月以降に実施した真の初回415件のうち、408件は `interview_count=1`、**7件は2以上**（初回を辞退して取り直したケースなど）。新規が少し少なく出る
- 移行データ（FileMaker・`legacy_fm_interview_no` あり 4,656件）も同じ列に回数が入っていて、2024〜2026年4月まで連続している。回数で判定してよい

### 3-2. 求人紹介・ブックマーク

| 数値名 | 定義 | 元テーブル.カラム | 基準日付 | CAの紐づけ | 可否 | 備考 |
|--|--|--|--|--|--|--|
| 求人紹介（提案）数 | 紹介1件。2つのデータ源を合わせる | `job_entries.job_intro_date` ∪ `candidate_files`(BOOKMARK) | `job_intro_date` ／ `COALESCE(last_exported_at, introduced_at)` | 担当軸 | ○ | 実績表と同じ。本人応募（`origin='candidate'` かつ Drive ファイル無し）と自動引き当ては除く。**データ源が 2026-04 に切り替わった**（job_intro_date は2026-04まで、ブックマークは2026-04から） |
| 求人紹介の人数・新規/既存 | 求職者の人数／その月の1件目＝新規 | 同上 | 同上 | 担当軸 | ○ | 2026-09-12 に確定した定義（`weeklyMatrix.ts`） |
| ブックマーク数（求人検索） | ブックマーク1件（紹介保留も含む） | `candidate_files`(BOOKMARK) | `created_at` | `uploaded_by_user_id`（登録した人）か担当軸 | ○ | 日報の「求人検索」は登録した人の軸。5月以降のブックマーク11,671件のうち、登録した人が担当CAと違うのは470件、社員ではないアカウント（自動など）は397件 |
| 求人ツールへの出力数 | `last_exported_at` があるもの | `candidate_files.last_exported_at` | 同左 | 登録した人 | △ | **2026-09 は0件**（T-182 で求人出力を廃止し、紹介は `introduced_at` が本線になった）。今後の指標には使えない |
| マイページへの送付（紹介）数 | `introduced_at` があるブックマーク | `candidate_files.introduced_at` | 同左 | 担当軸 | ○ | 2026-04〜。2026-09 は2,117件 |
| マイページで求職者が回答した数 | 求職者が回答（気になる・応募など）したもの | `candidate_files.response_submitted_at` / `response_status`、`candidate_response_submissions` | `response_submitted_at` | 担当軸 | ○ | 求職者側の行動。`response_status` は今の値だけ |
| 本人応募数 | 求職者が自分でサイトから応募 | `candidate_files`（`origin='candidate'`） | `created_at` | 担当軸 | ○ | 全期間389件（うちDriveファイル無し123件） |

### 3-3. ABCD判定

| 数値名 | 定義 | 元テーブル.カラム | 基準日付 | CAの紐づけ | 可否 | 備考 |
|--|--|--|--|--|--|--|
| AI判定の分布（今の値） | ブックマーク1件ごとの今の総合評価（A/B+/B/C/D/未評価） | `candidate_files.ai_match_rating` | `created_at` か `ai_analyzed_at` | 担当軸／登録した人 | △ | 今の値だけ（再評価やCAの手直しで上書きされる）。5段階（B+）は T-146 以降。全期間: B 3,906／C 3,247／A 2,197／B+ 1,279／D 1,011／未評価 1,268 |
| AI判定の履歴 | 評価1回＝1件（希望・通過・総合の3種） | `job_eval_records.desire_rating / pass_rating / overall_rating`、`status`、`model` | `created_at` / `evaluated_at` | 求職者経由で担当軸 | △ | **2026-09-25 からしか無い**（1,045件・927求人）。それより前の評価の推移は分からない |
| AIかCAか | — | — | — | — | × | `ai_match_rating` は、CAがコメントの「総合: X」を書き換えると上書きされる（`files/[fileId]` の PATCH）。**誰が付けたかを記録する列が無い**。最新の履歴と今の値の一致は906件中887件（19件は違う＝手直しか再評価の可能性） |
| CAの手動評価（◎○△） | CAが付ける別系統のマーク | `candidate_files.ca_match_label` | （日付列無し） | 担当軸 | △ | 1,317件。付けた日時が無いので期間では切れない |

### 3-4. エントリー・選考

| 数値名 | 定義 | 元テーブル.カラム | 基準日付 | CAの紐づけ | 可否 | 備考 |
|--|--|--|--|--|--|--|
| エントリー件数 | エントリー1行（社数） | `job_entries`（`entry_flag IN 応募,エントリー,書類選考,面接,内定,入社済`） | `entry_date` | 担当軸 | ○ | `career_advisor_id` は98.6%が空なので使わない |
| エントリー人数 | 求職者の人数 | 同上 | 同上 | 担当軸 | ○ | company-kpi の `entryCount` はこちら（名前は Count だが人数） |
| 書類提出数 | | `job_entries.document_submit_date` | 同左 | 担当軸 | △ | 2026-05は0件、2026-06から入力が始まった |
| 書類通過数 | | `document_pass_date` | 同左 | 担当軸 | ○ | |
| 一次面接数 | | `first_interview_date` | 同左 | 担当軸 | ○ | 全期間1,384件 |
| 二次面接数 | | `second_interview_date` | 同左 | 担当軸 | △ | 全期間で**20件**しかない。二次がある選考でも、入力されないか最終に入れている可能性がある |
| 最終面接数 | | `final_interview_date` | 同左 | 担当軸 | △ | 195件。一次と最終のどちらに入れるかの運用が揃っているかは未確認 |
| 内定数 | | `offer_date` | 同左 | 担当軸 | ○ | |
| 承諾数 | | `acceptance_date` | 同左 | 担当軸 | ○ | |
| 入社数 | | `join_date` | 同左 | 担当軸 | ○ | 入社予定日も入る（2026-11・12 に5件ある） |
| 辞退・見送り（落選）・取消 | 今の `entry_flag_detail`（本人辞退・選考落ち・書類見送り・本人辞退_自社他・本人辞退_他社決 など） | `job_entries.entry_flag_detail`、`company_flag`、`person_flag` | **日付列が無い** | 担当軸 | △ | 今のステータスしか無く、いつ辞退・落選したかが分からない。`updated_at` は他の編集でも変わるので代わりにならない。「取消（内定取消）」の専用値は無い |

### 3-5. その他のCA活動

| 数値名 | 定義 | 元テーブル.カラム | 基準日付 | CAの紐づけ | 可否 | 備考 |
|--|--|--|--|--|--|--|
| タスク依頼数（カテゴリ別） | タスク1件。書類作成依頼＝カテゴリ「履歴書作成」「職務経歴書作成」「推薦状作成」 | `tasks`・`task_categories.name` | `created_at` | `created_by_user_id`（依頼した人）、`task_assignees.employee_id`（担当者） | ○ | 5月以降: 日程調整514／エントリー対応344／推薦状333／履歴書316／職務経歴書314 など |
| タスク完了数 | `status='COMPLETED'` | `tasks.status` | **完了日が無い** | 同上 | △ | `task_assignee_statuses.completed_at` は全体で5件しか無い。完了日の代わりは `updated_at`（完了後の編集でも変わる） |
| AIアドバイザーのチャット | セッション1件 | `advisor_chat_sessions` | `created_at` | `created_by_user_id` | ○ | 945セッション・9名（2026-03-24〜） |
| AI呼び出し回数（種類別） | API呼び出し1回 | `advisor_usage_logs.endpoint` | `created_at` | **利用者の列が無い**。`candidate_id` から担当軸 | △ | 2026-07-02〜 |
| 面談準備（チャット）の利用 | 部屋1件 | `interview_prep_rooms` | `created_at` | `created_by_user_id` | ○ | 2026-09-27〜（29件・4名） |
| 日報の提出 | CA×日 | `daily_reports` | `date` | ユーザー | ○ | 2026-05-20〜（389件） |
| 求職者への案内メール | 送信1件 | `candidate_contact_mail_logs` | `sent_at` | `sent_by_user_id` | ○ | 2026-09-30〜（8件） |
| セキュアファイル送信 | 送信1件 | `secure_transfers` | `created_at` | 作成者 | ○ | 59件 |
| 連絡記録 | | `contact_logs` | `contacted_at` | `author_user_id` | × | 0件（使われていない） |

---

## 4. 選考の履歴と日付（§3）

- **選考ステータスの変更履歴は保存されていない**。`job_entries` は今の `entry_flag` / `entry_flag_detail` / `company_flag` / `person_flag` / `status` だけを持つ。履歴テーブルは無い。`audit_logs` に記録されるのは、求職者についてはブックマークのアーカイブ・復元・完全削除と求職者の削除だけ
- **段階ごとの日付は別々の列で保存されている**: 書類提出・書類通過・一次・二次・最終面接・内定・承諾・入社（`*_date`）。日付があれば、その段階まで進んだと数えられる（実績表の「到達ベース」）
- **辞退・見送り・落選には日付が無い**。今の状態として数えることしかできない
- 日付の順序の矛盾はわずか（書類通過がエントリーより前4件、内定が書類通過より前8件、承諾が内定より前1件、内定日の無い「内定／入社済」10件）
- **担当CAの変更履歴は残らない**（`src/app/api/candidates/[candidateId]/update/route.ts` が `employee_id` を上書きするだけ）。CA別の数値は**すべて「今の担当CA」で数えることになる**。担当が替わると、前の担当の時期の実績も新しい担当の数字に移る
- このため、**今のステータスから過去の通過率を推定することはしない**。通過率は「その段階の日付があるか」で数える

---

## 5. データの期間と品質（§4）

### 5-1. 期間と移行データの見分け方

| データ | 最古〜最新（JST） | 移行データの見分け方 | 移行データの件数 | 作成日時の集中 |
|--|--|--|--|--|
| 面談 `interview_records` | 2023-12-01〜2026-10-09（未来の予約20件を含む） | `legacy_fm_interview_no IS NOT NULL` | 4,656 / 5,732 | 集中なし（最多の日で28件）。FileMakerの作成日時を引き継いでいる |
| 面談評価 `interview_ratings` | 作成 2026-04-21〜 | 面談側で判定 | — | 移行した面談（1〜3月）の評価も4月に後から入っている。評価の作成日時では期間を切れない |
| エントリー `job_entries` | `entry_date` 2023-12-01〜2026-10-01 | `fm_entry_no IS NOT NULL` | 27,555 / 29,023 | **2026-04-13 に27,559件が集中**（移行の実行日）。`entry_date` などの業務日付は元の日付が入っているので、業務日付で集計すれば問題ない |
| ブックマーク `candidate_files` BOOKMARK | 2026-03-26〜 | （移行なし。ポータルで作ったものだけ） | 0 | — |
| 求職者 `candidates` | `created_at` 2026-02-17〜 | — | 3,637名が2月 | **2026-02-17 に3,621名が集中**。`created_at` を登録日として使ってはいけない |
| AI判定の履歴 `job_eval_records` | 2026-09-25〜 | — | — | — |

### 5-2. 2026年1月以降の月別件数

面談（`interview_date`・JST月）:

| 月 | 記録 | うち移行 | 辞退系 | 初回（実施） | 既存（実施） | ランクあり |
|--|--|--|--|--|--|--|
| 2026-01 | 188 | 187 | 40 | 71 | 77 | 148 |
| 2026-02 | 176 | 175 | 25 | 68 | 83 | 149 |
| 2026-03 | 141 | 140 | 11 | 52 | 78 | 118 |
| 2026-04 | 171 | 149 | 13 | 66 | 92 | 125 |
| 2026-05 | 173 | 0 | 13 | 82 | 78 | 98 |
| 2026-06 | 192 | 0 | 22 | 66 | 104 | 135 |
| 2026-07 | 228 | 0 | 20 | 84 | 124 | 185 |
| 2026-08 | 206 | 0 | 21 | 82 | 103 | 163 |
| 2026-09 | 218 | 0 | 24 | 89 | 105 | 188 |
| 2026-10（1日まで＋予約） | 34 | 0 | 1 | 19 | 14 | 19 |

エントリー・選考（`job_entries`・アーカイブ除く・各日付のJST月）:

| 月 | エントリー件数 | エントリー人数 | うち移行 | 紹介(job_intro) | 書類提出 | 書類通過 | 一次 | 二次 | 最終 | 内定 | 承諾 | 入社 |
|--|--|--|--|--|--|--|--|--|--|--|--|--|
| 2026-01 | 173 | 43 | 173 | 1,282 | 160 | 55 | 40 | 0 | 11 | 8 | 4 | 4 |
| 2026-02 | 206 | 39 | 206 | 1,498 | 188 | 44 | 41 | 0 | 11 | 13 | 6 | 5 |
| 2026-03 | 228 | 29 | 199 | 1,118 | 189 | 37 | 39 | 0 | 8 | 7 | 2 | 3 |
| 2026-04 | 157 | 30 | 44 | 222 | 45 | 32 | 24 | 0 | 6 | 3 | 3 | 11 |
| 2026-05 | 186 | 34 | 0 | 0 | 0 | 47 | 28 | 4 | 4 | 4 | 2 | 1 |
| 2026-06 | 289 | 45 | 0 | 0 | 75 | 66 | 37 | 4 | 7 | 6 | 4 | 3 |
| 2026-07 | 279 | 45 | 0 | 0 | 153 | 60 | 60 | 6 | 6 | 12 | 5 | 1 |
| 2026-08 | 229 | 48 | 0 | 0 | 136 | 50 | 40 | 4 | 13 | 13 | 10 | 2 |
| 2026-09 | 313 | 50 | 0 | 0 | 188 | 51 | 32 | 2 | 7 | 8 | 6 | 7 |

※書類通過以降の列は件数（行数）。実績表の書類通過・内定・承諾は人数なので、この表より小さくなる（例: 2026-08 の内定は13件・10人）。

ブックマーク（`candidate_files` BOOKMARK）:

| 月 | 作成 | 出力(`last_exported_at`) | 紹介(`introduced_at`) | 提案として数える数 | AI評価 |
|--|--|--|--|--|--|
| 2026-03 | 55 | 0 | 0 | 0 | 29 |
| 2026-04 | 1,182 | 270 | 277 | 274 | 906 |
| 2026-05 | 1,731 | 1,143 | 1,171 | 1,144 | 1,534 |
| 2026-06 | 2,101 | 1,798 | 1,779 | 1,803 | 1,764 |
| 2026-07 | 2,393 | 1,850 | 2,073 | 1,968 | 2,158 |
| 2026-08 | 2,180 | 1,623 | 1,774 | 1,774 | 2,076 |
| 2026-09 | 3,116 | **0** | 2,117 | 2,034 | 3,024 |

### 5-3. 欠損・重複

| 確認項目 | 結果 |
|--|--|
| 担当CAが空の求職者 | 277 / 4,611名（6.0%）。ただし5月以降の活動に絡むのは面談1件・ブックマーク10件・エントリー0件で、影響はほぼ無い |
| 担当CAが「CA職種」以外の求職者 | 職種未設定の社員が担当の求職者が1,155名いる（主に退職者・移行時の担当）。5月以降の活動は0件。company-kpi は CA職種の在籍者だけを対象にしているので、これらの求職者の過去の実績は byCa に出てこない（全社合計には入る） |
| 面談の実施者（`interviewer_user_id`）と担当CAの一致 | 1〜4月は99%一致、**5月以降は約9%しか一致しない**。5月以降は CA職種以外の社員4名（社員番号 1000025・1000029・1000027・1000004）が全体の87%（1,051件中912件）を占める。この列には面談記録を作った人が初期値で入り（`interview-create.ts`）、作成者と全件一致する。そのため「予約を入力した人」と考えられ、面談したCAを表しているとは言えない。CA実績には担当軸を使う（仕様どおり） |
| 同じ求職者・同じ日・同じ開始時刻の面談 | 26組（54件、全期間） |
| エントリーの重複の疑い（同じ求職者×同じ求人ID（0以外）×同じ日） | 1組（2件） |
| 同じ求職者×同じ会社名×同じ日 | 36組（74件）。職種違いの複数応募を含むので、すべてが重複とは限らない |
| `external_job_id = 0`（求人未紐付け） | 27,846 / 29,023（ほぼ移行分）。求人IDで重複を判定するのは向かない |
| 面談の `duration` | 5月以降、時刻があるのに `duration` が空か0なのが408件。時刻から計算し直す必要がある |

### 5-4. 2026年5月以降を信頼できる実績とみなしてよいか

**おおむね「よい」。ただし項目による**。根拠:

- 2026-05 から面談・エントリーとも移行データが0件で、すべてポータルで入力されている（4月は移行と新規が混ざっている）
- ブックマーク（紹介）は 2026-04 から本格的に使われ始め、5月以降は件数が安定している
- 担当CAが空の割合は5月以降ほぼ0
- 2026-08 の検算で、画面の集計関数と独立に書いたSQLが全項目で一致した（§7）

**例外**（5月以降でも注意が要るもの）:

- 書類提出日の入力が始まったのは2026-06
- 二次面接の日付はほとんど入っていない
- 求人ツールへの出力数は2026-09から0（廃止）
- ABCD判定の履歴は2026-09-25から
- 辞退・落選の日付はどの期間にも無い
- 面談時間は予約枠の長さ

---

## 6. 定義上の注意（§5）

- **求職者数・エントリー件数・面接回数を混同しない**
  - 実績表の「人数」＝求職者の人数（同じ月に複数社へエントリーしても1人）
  - 「件数」＝エントリーの行数（社数）
  - 企業面接は company-kpi では人数（`companyInterviewCount`）。面接の回数（一次・最終を別々に数える）とは違う
  - CAとの面談（`interview_records`）と企業面接（`job_entries.*_interview_date`）は別物
- company-kpi の `entryCount` は**人数**（`entry.total.uniq`）。ChatGPTが件数と読み違えないよう、新しいAPIでは `entryCandidates` / `entryRecords` のように名前で分ける
- **2種類の通過率を分ける**
  - 「エントリーした月を起点にした通過率（コホート）」: その月にエントリーした人が、その後いつか書類通過したか（`/api/performance/cohort` の方式）
  - 「その月に起きた通過件数」: 書類通過日がその月にある件数（実績表の方式）
  - 同じ「9月の書類通過率」でも値は違う
- **選考中の案件を不合格として数えない**。コホートの通過率は、最近エントリーした分ほど結果が出ていない（選考中）ので低く出る。直近1〜2か月のコホートは「未確定」として扱う
- 辞退・落選には日付が無いので、「月別の辞退数」は出せない。出すなら「今の時点で辞退になっている件数（エントリー月別）」と明記する
- 5月以降のデータは約5か月分しかない。**季節性は判断しない**。月ごとの差は、CAの人数の変化や業務・機能の変化（例: 2026-09 の出力廃止、2026-06 の書類提出日の入力開始）で生じている可能性が高い
- 担当CAは今の担当で数える（§4）
- 当月の範囲: company-kpi は「今日まで」、実績表の月列は「月末まで」。当月は面談の未来の予約の分だけずれる。突き合わせは過去の月で行う

---

## 7. 既存画面との突き合わせ結果（§6）

### 7-1. 同じ数値を表示している画面

| 画面 | 該当ファイル | 計算箇所 |
|--|--|--|
| ホームの実績表（週・日・月マトリクス） | `src/components/performance/PerformancePanel.tsx` → `/api/performance/weekly` | `src/lib/performance/weeklyMatrix.ts` `computeWeeklyMatrix`、`applyAdditiveTotals` |
| 当月実績タブ（属性円グラフ・週別） | `/api/performance/monthly` | `computeWeeklyMatrix`、`computeMonthlyAttributes` |
| 面談ランク円グラフ | `/api/performance/weekly` | `computeInterviewRankBreakdown` |
| 直近6か月（コホート率） | `/api/performance/cohort` | `src/app/api/performance/cohort/route.ts`（`computeWeeklyMatrix` を6か月分） |
| 明細一覧 | `/api/performance/detail` | 同じ条件の Prisma クエリ |
| 日報（当日実績・求人検索グラフ） | `src/components/dailyReport/DailyReportView.tsx` → `/api/daily-report` | `computeWeeklyMatrix`＋`computeDayStageDetails`、求人検索は `computeJobSearchDay` |
| 目標登録の参考値 | `TargetModal.tsx` → `/api/performance/target/reference` | `computeCaMetricsForRange`（初回面談の実施率だけ）＋`computeWeeklyMatrix` |

### 7-2. 定義が食い違う箇所

| 箇所 | 食い違い |
|--|--|
| `src/lib/dailyReport/metrics.ts` `computeCaMetricsForRange` と `computeWeeklyMatrix` の違い① | 求人検索・紹介の CA の軸が `candidate_files.uploaded_by_user_id`（登録した人）。`computeWeeklyMatrix` は `candidates.employee_id`（担当）。5月以降のブックマークで登録者と担当が違うのは約4% |
| 同上② | 紹介のデータ源が `candidate_files` だけ（`job_entries.job_intro_date` を見ない）。2026-04 より前の紹介が欠ける |
| 同上③ | 面接対策の面談で辞退系を除いていない |
| 同上の補足 | `src/app/api/performance/route.ts`（6期間）はこの関数を使っているが、画面からの呼び出しは見つからなかった（古い経路とみられる） |
| `metrics.ts` 81行付近のコメント | 面談の軸を `interviewerUserId` と書いているが、実装は担当軸。コメントが古い |
| `company-kpi` の `entryCount` | 名前は件数だが中身は人数（`entry.total.uniq`）。`definitions.counts` の説明文にも人数とは書かれていない |
| 仕様メモ `.claude/03-portal-spec.md` | 「面談ランクに S は存在しない」とあるが、実データに S が5件ある |

### 7-3. 実際に一致を確かめた項目（2026-08・全CA）

画面と同じ関数 `computeWeeklyMatrix` を読み取り専用の接続で 2026-08-01〜08-31（JST）に当てた結果と、別に書いたSQLの結果を比べた。

| 項目 | 画面の関数 | 独立SQL | 一致 |
|--|--|--|--|
| CAとの面談（実施） | 185 | 185 | ○ |
| 初回面談 | 82 | 82 | ○ |
| エントリー人数／件数 | 48 / 229 | 48 / 229 | ○ |
| 書類通過（人数） | 26 | 26 | ○ |
| 内定（人数） | 10 | 10 | ○ |
| 承諾（人数／件数） | 9 / 10 | 9 / 10 | ○ |

さらに、CA別（在籍CA8名）の面談合計185とエントリー人数の合計48は、全CA合算と一致した（担当なしの求職者の活動は0）。記憶メモにある「2026-08 の承諾は10件・9人」とも合っている。
※ブラウザで画面を開いての目視確認はしていない。画面が使っている関数を直接呼んで確認した。

---

## 8. API案と架空データのサンプル（§7）

### 8-1. 2案の比較

| | A. company-kpi を拡張 | B. 姉妹API `GET /api/ai/ca-kpi` を追加（**推奨**） |
|--|--|--|
| 既存のGPTへの影響 | レスポンスの形が変わると、すでに登録した GPT の動きが変わるおそれ | 無し |
| パラメータ | year/month の固定の形に from/to・日別を足すと複雑になる | 最初から from/to・粒度・CA を設計できる |
| 応答サイズ | 全社・年・月・全CAを毎回返すので大きくなる | 必要な範囲だけ返す |
| デプロイ区分 | 既存APIの変更なので **staging 必須** | 純粋な追加なので **master 直push可**（認証は既存の `assertAiReadAuth` をそのまま使う） |
| 数字の一貫性 | 同じ | 同じ（`computeWeeklyMatrix` を正本として使い、別の実装を作らない） |

**推奨は B**。理由: 既存のGPTに影響せず、追加だけで済み、ChatGPTにとって分かりやすい形（期間×CA×指標）にできる。

### 8-2. パラメータ例

```
GET /api/ai/ca-kpi?from=2026-05-01&to=2026-09-30&granularity=month&ca=1000001
Authorization: Bearer <AI_READ_API_KEY>
```

| パラメータ | 必須 | 内容 |
|--|--|--|
| `from` / `to` | ○ | `YYYY-MM-DD`（JST）。`to` が今日より後なら今日に丸める |
| `granularity` | 任意 | `month`（既定）／`week`／`day`／`total`。上限の例: day は62日、week は26週、month は24か月 |
| `ca` | 任意 | 社員番号。カンマ区切りで複数指定。省略すると在籍CA全員＋全社合計 |
| `metrics` | 任意 | `interview,proposal,entry,selection,rating,activity` のうち返すグループ（応答サイズを抑えるため） |

### 8-3. レスポンス項目（案）

- `generatedAt`（データを取った時刻。ISO・JST）、`timezone`、`period`、`granularity`、`scope:"CA_ONLY"`
- `dataFreshness`: テーブルごとの最終更新時刻（`interview_records` / `job_entries` / `candidate_files` の `MAX(updated_at)`）
- `caveats`: 固定の注意書き（今の担当CAで数える、辞退に日付が無い、面談時間は予約枠、ABCD履歴は2026-09-25以降 など）
- `definitions`: 各指標の定義文（company-kpi と同じ書き方）
- `rows[]`: `{ ca: {employeeNumber, name} | "ALL", bucket: "2026-05", metrics: {...} }`
- metrics の中身:
  - interview: `total`、`first`、`existing`、`interviewPrep`、`booked`、`noShow`、`cancelled`、`rescheduled`、`minutesTotal`、`minutesAvg`
  - proposal: `records`、`candidates`、`newRecords`、`existingRecords`
  - bookmark: `created`、`introducedToMypage`
  - aiRating（今の値の分布）: `A`、`B+`、`B`、`C`、`D`、`unrated`
  - interviewRank（初回の分布）: `S`、`A+`、`A`、`B+`、`B`、`C`、`D`、`unrated`
  - entry: `records`、`candidates`、`newRecords`、`existingRecords`
  - selection: `documentSubmit`、`documentPass`、`firstInterview`、`finalInterview`、`offer`、`acceptance`、`join`（それぞれ `records` と `candidates`）
  - activity: `tasksRequested`（カテゴリ別）、`advisorChatSessions`、`interviewPrepRooms`、`dailyReportsSubmitted`
- **求職者の情報は一切返さない**（氏名・ID・連絡先は含めない。返すのは件数だけ）

### 8-4. 架空データによるレスポンス例

（実在のCA・数値ではない）

```json
{
  "generatedAt": "2026-10-01T10:15:00+09:00",
  "timezone": "Asia/Tokyo",
  "scope": "CA_ONLY",
  "period": { "from": "2026-08-01", "to": "2026-09-30" },
  "granularity": "month",
  "dataFreshness": {
    "interview_records": "2026-10-01T10:02:11+09:00",
    "job_entries": "2026-10-01T09:48:40+09:00",
    "candidate_files": "2026-10-01T10:10:05+09:00"
  },
  "caveats": [
    "CA別の数値は求職者の現在の担当CAで集計しています（担当変更の履歴はありません）",
    "面談時間は開始・終了時刻の差で、予約枠の長さに近い値です",
    "辞退・見送りには日付が無いため、月別件数は出していません"
  ],
  "rows": [
    {
      "ca": { "employeeNumber": "CA-A", "name": "CA-A" },
      "bucket": "2026-08",
      "metrics": {
        "interview": { "total": 40, "first": 18, "existing": 22, "interviewPrep": 3, "booked": 46, "noShow": 4, "cancelled": 1, "rescheduled": 1, "minutesTotal": 1520, "minutesAvg": 38 },
        "proposal": { "records": 410, "candidates": 25, "newRecords": 22, "existingRecords": 388 },
        "interviewRank": { "A": 1, "B+": 3, "B": 7, "C": 5, "D": 0, "unrated": 2 },
        "aiRating": { "A": 60, "B+": 45, "B": 120, "C": 90, "D": 30, "unrated": 15 },
        "entry": { "records": 52, "candidates": 11, "newRecords": 11, "existingRecords": 41 },
        "selection": {
          "documentPass": { "records": 12, "candidates": 7 },
          "firstInterview": { "records": 9, "candidates": 6 },
          "offer": { "records": 3, "candidates": 3 },
          "acceptance": { "records": 2, "candidates": 2 }
        },
        "activity": { "tasksRequested": { "履歴書作成": 6, "職務経歴書作成": 6, "推薦状作成": 7 }, "advisorChatSessions": 30, "interviewPrepRooms": 0 }
      }
    },
    {
      "ca": { "employeeNumber": "CA-B", "name": "CA-B" },
      "bucket": "2026-08",
      "metrics": { "interview": { "total": 25, "first": 12, "existing": 13 }, "entry": { "records": 30, "candidates": 8 } }
    }
  ]
}
```

### 8-5. ChatGPT カスタムGPTへの登録に必要なもの

| 項目 | 内容 |
|--|--|
| OpenAPIスキーマ | **新しく作る必要がある**（repo に無い）。OpenAPI 3.1 の YAML/JSON。`servers` に本番URL、`/api/ai/ca-kpi` と `/api/ai/company-kpi` の GET、パラメータ、レスポンスの型、各フィールドの説明（`definitions` の文をそのまま使う）。置き場所の案は `docs/gpt/openapi-ai-read.yaml` |
| 認証 | GPT の Actions で「API Key」→「Bearer」を選び、`AI_READ_API_KEY` の値を登録する（値はGPT側の設定画面で直接入れ、repo やチャットには書かない） |
| 応答サイズ | 既定の month×CA全員×主要指標なら20〜40KB程度の見込み（推定）。day 粒度×全員×全指標は大きくなるので、`metrics` で絞るか日数に上限を設ける |
| 応答時間 | Actions には応答時間の上限があり、一般には数十秒程度と言われる（**要確認**）。day 粒度で `computeWeeklyMatrix` を日ごとに呼ぶと、CA8名×31日×6クエリになり遅い。step2 では「日付で GROUP BY する集計SQL」を新しく作り、定義は `computeWeeklyMatrix` に合わせる（2026-08 の値が一致することをテストで確かめる） |
| 応答サイズの上限・プライバシーポリシーURLの要否 | **要確認**（カスタムGPTを公開範囲「自分のみ／組織内」で使う場合の扱い） |
| 個人情報 | 返さない設計（求職者は件数のみ。CAは社員番号と表示名だけ）。company-kpi と同じく、氏名を出すかどうかは定数1つで切り替えられるようにする |

### 8-6. step2 で触るファイルの見込みとデプロイ区分

- 新規: `src/app/api/ai/ca-kpi/route.ts`
- 新規: `src/lib/aiRead/caKpi.ts`（日別・月別の GROUP BY 集計。面談時間、ランク分布、AI判定分布、タスク）
- 新規: `docs/gpt/openapi-ai-read.yaml`
- 読むだけ（変更しない）: `src/lib/performance/weeklyMatrix.ts`、`src/lib/aiRead/auth.ts`、`src/lib/dailyReport/jstDate.ts`、`src/lib/dailyReport/constants.ts`
- 検算: `scripts/` に検証スクリプトを置く（2026-08 で `computeWeeklyMatrix` と一致することを確認。末尾に `export {};`）
- **デプロイ区分**: 新規APIの追加だけで、認証方式も既存API・DBも変えないので **master 直push可**。company-kpi の `entryCount` の改名など既存APIに手を入れる場合は **staging 必須**（推奨案では触らない）

---

## 9. 実際に確認できたこと／確認できていないこと

### 確認できたこと

- company-kpi の認証・パラメータ・全フィールドの定義（コードを読んで確認）
- 外部から読めるGETの一覧。OpenAPIスキーマが無いこと
- 本番DBの集計値（§5 の全表）。面談・エントリー・ブックマーク・AI評価履歴・タスク・AI利用ログ・監査ログ
- 新規／既存面談の判定精度（初回の重複0件、取り違え7件／415件）
- 面談時間を時刻から計算できる割合と、その値が予約枠に寄っていること
- 選考の変更履歴と担当CAの変更履歴が無いこと（コードとテーブルの両方）
- 2026-08 の主要6項目で、画面の集計関数と独立SQLが一致したこと

### 確認できていないこと

- **`railway ssh` 経由での実行**（CLIのログイン切れ。代わりに読み取り専用の接続で実行した）
- ブラウザで画面を開いての目視の突き合わせ（画面が使う関数を直接実行して代わりにした）
- company-kpi の実際の応答時間と応答サイズ（APIキーを使わない方針なので叩いていない）
- `interviewer_user_id` が「予約を入力した人」だという点（作成者と100%一致することとコードの初期値からの推定。業務の運用は聞き取りが必要）
- 二次面接の日付がほとんど無い理由（入力されていないのか、最終面接の欄に入れているのか）
- 担当CAの変更が実際にどのくらいあったか（履歴が無いので測れない）
- カスタムGPT側の応答時間・サイズの上限（要確認）

---

## 10. 大野さんに判断してほしいこと

**CA別の実績は「今の担当CA」でまとめて数える方式でよいですか？**
今のポータルには担当替えの記録が残らないため、求職者の担当を替えると、前の担当が出した面談・エントリー・内定もすべて新しい担当の実績として数えられます（実績表も同じです）。このままでよければ step2 はこの方式で作ります。「担当替えの前の実績は前の担当に残したい」場合は、先に担当替えの履歴を残す仕組みを入れる必要があり、それより前の分は戻せません。

---

## step2 実装結果（2026-10-01・commit 166025b → master・追補 commit は末尾参照）

### 実装したもの

| 区分 | ファイル | 内容 |
|--|--|--|
| 新規API | `src/app/api/ai/ca-kpi/route.ts` | `GET /api/ai/ca-kpi?from&to&granularity=day/week/month&caId&groups`。Bearer `AI_READ_API_KEY`（既存の `assertAiReadAuth`）。`definitions`（定義・基準日付・信頼できる開始日・注意点）・`caveats`・`dataFreshness`・`attribution: current_ca`・`caAssignmentHistorySince`・`currentStatus`（取得時点の選考状況）を同梱 |
| 集計 | `src/lib/aiRead/caKpi.ts` | 区切りの表（VALUES）と JOIN して GROUPING SETS で「全員＋担当ごと」を 1 グループ 1 クエリで出す。CA × 区切りごとに `computeWeeklyMatrix` を呼ぶ方式は day 粒度で数千クエリになるため採らなかった |
| 部品の共有 | `src/lib/performance/weeklyMatrix.ts` | `proposalEventsSql` / `entryEventsSql` / `DECLINED_SQL` / `ENTRY_FLAGS_COUNTED_SQL` / `tsLit` を export（関数に切り出しただけ。`computeWeeklyMatrix` が発行する SQL は refactor 前後で byte 一致することを `$queryRawUnsafe` の差し替えで確認） |
| パラメータ | `src/lib/aiRead/caKpiParams.ts` | 検証・区切り（week は月曜〜日曜・実績表と同じ）・上限（day 92 日／week・month 400 日／rows 推定 85KB） |
| 担当CA替えの記録 | `prisma/schema.prisma`・`prisma/migrations/20261001100000_t_xxx_candidate_ca_assignment_history/`・`src/lib/ca-assignment-history.ts` | `candidate_ca_assignment_histories`（求職者ID・変更前CA・変更後CA・変更日時・変更した社員・経路）。書き込みはこのファイルに集約し、担当が変わらない保存では書かない。更新と同じトランザクション |
| 記録を入れた経路 | `src/app/api/candidates/[candidateId]/update/route.ts`（`candidate_update`）、`src/app/api/master/candidates/bulk-update/route.ts`（`bulk_change_assignee`）、`src/app/api/master/candidates/route.ts`（`candidate_create`・担当付きで登録したときだけ） | |
| スナップショット | 上記マイグレーションの末尾 INSERT | 「今の担当CA」を変更前CA=NULL・経路=`initial_snapshot`・id=`snap_`+求職者ID で 1 回だけ投入。Railway のビルド（`prisma migrate deploy`）で適用されるため `railway ssh` 不要 |
| GPT 登録資料 | `docs/gpt/ca-kpi-openapi.yaml`（OpenAPI 3.1・`company-kpi` 同梱・架空の例）、`docs/gpt/ca-kpi-gpt-setup.md`（登録手順・指示文） | |
| 検証 | `scripts/verify-ca-kpi-t-xxx-step2.ts`（正本との一致・読み取り専用）、`scripts/test-ca-kpi-params-t-xxx-step2.ts`（純粋関数）、`scripts/test-ca-assignment-history-t-xxx-step2.ts`（ローカル検証DB専用・書き込みあり） | |
| ナレッジ | `.claude/12-pitfalls.md` #54 | 面談の「実施者」欄は予約を入れた人であって担当CAではない |

### 担当CAを書き換える経路の一覧（漏れの確認）

`src/` 全体で `Candidate.employeeId` / `candidates.employee_id` を書き換える箇所を検索した結果:

| 経路 | ファイル | 記録 |
|--|--|--|
| 求職者詳細の基本情報編集 | `PATCH /api/candidates/[candidateId]/update`（`assignedEmployeeId`） | ○ `candidate_update` |
| 求職者一覧の一括「担当CA変更」 | `POST /api/master/candidates/bulk-update`（`change_assignee`） | ○ `bulk_change_assignee`（変わる行だけ） |
| 新規登録 | `POST /api/master/candidates`（`employeeId`） | ○ `candidate_create`（担当付きのときだけ） |
| マイナビRPA の PDF 取り込み・スカウト履歴・一次返信メール・重複チェック | `src/app/api/rpa/mynavi/*`、`src/lib/mynavi-rpa/*` | 担当CAを書かない（対象外） |
| 外部API（求職者サイト・日程調整・スカウト条件 等） | `src/app/api/external/*` | 担当CAを書かない（読むだけ） |
| その他の `candidate.update` 20 か所（支援状況・配信枠・OneDrive・自動配信など） | `src/lib/*`、`src/app/api/scout/*` 等 | 担当CAを書かない |
| 過去の一回限りの修正スクリプト | `scripts/fix-bs-employees-and-remap.ts`、`scripts/fix-duplicate-employees*.ts`（2026-05〜06 の社員重複整理） | 実行済み・今後は使わない。再実行するなら `recordCaAssignmentChanges` を通すこと |

生SQL（`UPDATE candidates`）で担当を書く箇所は `src/` に無い。

### テスト（§4）

| 項目 | 結果 |
|--|--|
| 2026-08・全CA の合計が step1 の数字と一致 | **一致**（本番で確認。下記） |
| 認証なし／誤ったキー → 401 | 本番で 401 / 401 |
| 期間超過 → 400 | 本番で 400（day 365 日: 「上限は 92 日」）、応答過大 → 400（全CA × 12 か月） |
| 担当CA替えで履歴が 1 行増え、変わらない保存では増えない | ローカル検証DB（docker postgres:16）で `scripts/test-ca-assignment-history-t-xxx-step2.ts` PASS（同じCAで再保存→増えない／変更→1行／解除→1行／一括は変わる行だけ／担当なし登録→増えない／履歴側の失敗で更新も戻る） |
| 既存テスト・型チェック・ビルド | `scripts/test-ca-kpi-params-t-xxx-step2.ts` 9 件 PASS、`tsc --noEmit` OK、`eslint` OK、`npx prisma generate && npx next build` OK |
| `computeWeeklyMatrix` の発行 SQL | refactor 前後で 6 本とも byte 一致（担当指定・全員の 2 ケース） |
| 架空データでの定義確認 | ローカル検証DB に架空の求職者 7 名・面談 13 件・エントリー 15 件・ブックマーク 9 件を入れ、手計算の期待値と API の全項目（面談・時間・ランク・紹介・ブックマーク・評価・エントリー・選考段階・現在の状況・活動）が一致。`computeWeeklyMatrix` との突合 335 項目 PASS |

### 本番確認（§5）

本番（`bizstudio-portal-production.up.railway.app`・デプロイ済みコミット 166025b を Railway API で確認）に対して実施:

| 確認 | 結果 |
|--|--|
| `GET /api/ai/ca-kpi?from=2026-08-01&to=2026-08-31&granularity=month`（全CA 8 名） | 200・22KB・1.0 秒。全員行: 面談 **185**・初回 **82**・既存 103・エントリー **48 人／229 件**・書類通過 **26 人**（50 件）・内定 **10 人**（13 件）・承諾 **9 人／10 件**・入社 2・企業面接 28 人（57 件）・一次 23 人／40 件・二次 4・最終 12 人／13 件・紹介 1,774 件／107 人・ブックマーク作成 2,180／紹介 1,774・面談時間 7,222 分（170 件・平均 42.5 分）。**step1 §7-3 と全項目一致**。CA別 8 行の面談合計 185・エントリー 229 件／48 人も全員行と一致 |
| `company-kpi?month=2026-08` との突合 | 面談 185＝185、エントリー人数 48＝48、書類通過 26＝26、内定 10＝10、成約件数 10＝10、企業面接人数 28＝28 |
| コンテナ上で `scripts/verify-ca-kpi-t-xxx-step2.ts --from 2026-08-01 --to 2026-08-31 --expect-2026-08`（`railway ssh`・読み取り専用接続） | **1,044 項目すべて一致・PASS**（全員＋CA 8 名 × month 1 区切り＋week 6 区切り × 面談3・紹介2・エントリー2・選考6・企業面接1・ランク分布、caId 指定クエリとの一致、step1 の 8 数値） |
| 担当CA替えの記録（`railway ssh` 経由の SELECT） | `initial_snapshot` **4,334 行 ＝ 担当CAが入っている求職者 4,334 名**（担当なし 277 名）。全行 変更前CA=NULL・変更した社員=NULL。スナップショットの変更後CA と `candidates.employee_id` の不一致 0 件。マイグレーション完了 2026-10-01 20:20:50 JST（`_prisma_migrations`）。`caAssignmentHistorySince` = 2026-10-01 |
| 認証・上限 | キーなし 401／誤ったキー 401／day 365 日 400／全CA × 12 か月 400 |
| 応答サイズ・時間（既定グループ） | 全CA × 月別 11 か月: 114KB・1.9 秒（→ 上限を超えるため追補で 400 にした）、全CA × 日別 10 日: 104KB・1.2 秒、1 CA × 週別 3 か月（activity 込み）: 23KB・0.5 秒、1 CA × 日別 92 日: 109KB・0.7 秒 |

**追補（同日）**: 上の実測で 1 行 ≈ 1.1KB と分かり、全CA × 11 か月（99 行）が ChatGPT Actions の応答上限（約 10 万文字）を超えるため、行数の上限（100 行）を **rows の推定バイト数 85KB** に改めた（`checkCaKpiSizeLimit`。既定グループで全CA月別は 8 か月、`groups` を減らせば長くできる。400 の本文に区切りの上限と対処を書く）。この変更後に本番で 400／200 を再確認した（末尾の「追補の本番確認」）。

### 実際に確認できたこと

- 本番 API の 2026-08 の数値が step1・`company-kpi`・`computeWeeklyMatrix` と一致すること（API の HTTP 応答と、コンテナ上の検証スクリプトの両方）
- スナップショットの件数が担当CAあり求職者数と一致し、値も現在の担当と一致すること
- 認証（401）・期間超過（400）・応答過大（400）の挙動
- 担当CA替えの記録が「変わるときだけ」書かれること（ローカル検証DBでの関数テスト。本番では画面からの担当替えがまだ発生していないため `candidate_update` 等の行は 0 件）
- 応答サイズと応答時間（上表）

### 確認できていないこと

- **本番の画面から実際に担当CAを替えて履歴が 1 行増えること**（本番データを動かす操作なので行っていない。関数レベルの動作はローカルで確認済み。最初の担当替えのあとに `SELECT route, count(*) FROM candidate_ca_assignment_histories GROUP BY route` で `candidate_update` 等が増えていることを見るとよい）
- カスタムGPT への登録と、ChatGPT 側の応答サイズ・応答時間の上限（約 10 万文字・数十秒と言われているが実測していない）。登録後に `docs/gpt/ca-kpi-gpt-setup.md` の動作確認を行う
- `activity` グループは user 軸（操作した本人）であり、担当CA軸の数値と母集団が違う点の業務上の妥当性
- `currentStatus` の declined / rejected / closed は全期間の累計（FileMaker 移行分を含む。全員行で辞退 24,214・見送り 3,973）。期間を絞った値が必要なら `entryOutcomeNow`（エントリー月別）を使う
- 2026-08 以外の月の値（検証スクリプトは任意の期間で実行できる。例: `--from 2026-05-01 --to 2026-09-30`）

### 追補の本番確認（commit 0de02d1・デプロイ済みコミットを Railway API で確認）

| 確認 | 結果 |
|--|--|
| 全CA × 月別 11 か月（2025-11〜2026-09） | 400「応答が大きすぎます（11 区切り × 9 行 = 99 行・推定 106KB、上限 85KB）。同じ条件なら区切りは 8 個まで…」 |
| 全CA × 月別 8 か月（2026-02〜2026-09） | 200・86.9KB（72 行）・1.1 秒 |
| 1 CA × 日別 92 日・既定グループ | 400（groups を減らす案内） |
| 1 CA × 日別 92 日・`groups=interview,entry,selection` | 200・81KB（92 行）・0.7 秒 |
| 2026-08・全CA（再確認） | 200・22KB・0.5 秒。全員行 185／82／48 人・229 件／26／10／9 人・10 件（変わらず） |

備考: 上限の推定は ASCII バイト数で、`definitions`（日本語・約 6KB）を足しても ChatGPT の「約 10 万文字」に収まる見込み。ChatGPT 側の実測は未実施（GPT 登録後に確認）。
