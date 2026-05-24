# T-064 Phase A 調査報告書
## スカウト運用集計機能に向けた現状調査

調査日: 2026-05-24
調査者: Claude Code

---

## Block 1: T-062 関連 API の現状

### 1.1 RPA API エンドポイント一覧

| エンドポイント | メソッド | 認証 | 用途 |
|---|---|---|---|
| `/api/rpa/mynavi/batch-start` | POST | x-rpa-secret | バッチ開始、`RpaExecutionBatch` 作成 |
| `/api/rpa/mynavi/pdf-upload` | POST | x-rpa-secret | PDF受領 → Gemini AI解析 → 判定 → Candidate登録 |
| `/api/rpa/mynavi/reply-sent` | POST | x-rpa-secret | 一次返信送信完了を記録 |
| `/api/rpa/mynavi/batch-finish` | POST | x-rpa-secret | バッチ終了、集計カウント更新、LINE WORKS通知 |
| `/api/rpa/mynavi/last-execution` | GET | x-rpa-secret | 最後の COMPLETED バッチの `startedAt` を返す（PAD GetOutlook用） |

### 1.2 pdf-upload フロー詳細

```
pdf-upload 処理フロー:
  1. batchId + pdf (multipart) + 任意 recruiterName を受領
  2. バッチ存在確認
  3. Gemini API で PDF 解析 (parseResumeWithGemini)
  4. parseResumeData で構造化フィールド抽出
  5. AI解析失敗 or 氏名/生年月日 null → status: AI_FAILED, canSendReply: false
  6. recruiterName 解決（リクエスト優先 → AI抽出 consultantName フォールバック）
  7. 電話番号正規化 → 30分窓での重複チェック → status: DUPLICATE_SKIP, canSendReply: false
  8. 年齢判定 (>=40歳: AGE_NG) + 外国籍判定 (両パーツが全角カナ/英字のみ: FOREIGN_NG)
  9. NORMAL → canSendReply: true / それ以外 → canSendReply: false
  10. Candidate 新規登録 (固定値: applicationRoute="スカウト", mediaSource="マイナビ転職")
  11. PDF → Google Drive アップロード → CandidateFile (category: ORIGINAL)
  12. MynaviRpaProcessingLog 作成
  13. recalculateSubStatusIfAuto 実行
  14. レスポンス: { processingLogId, candidateId, candidateNumber, canSendReply, reason, status }
```

### 1.3 canSendReply 判定ロジック（完全マトリクス）

| 条件 | status | canSendReply | reason |
|---|---|---|---|
| Gemini API エラー | AI_FAILED | false | AI解析失敗（Gemini解析エラー） |
| 氏名 or 生年月日 null | AI_FAILED | false | AI解析失敗 |
| 同一電話番号30分以内 | DUPLICATE_SKIP | false | 直近30分以内に同一電話番号の処理あり |
| 40歳以上 + 外国籍 | AGE_NG | false | 40歳以上 / 外国籍 |
| 40歳以上のみ | AGE_NG | false | 40歳以上 |
| 外国籍のみ | FOREIGN_NG | false | 外国籍 |
| 全条件パス | NORMAL | true | null |
| 予期しないエラー | ERROR | false | 処理中に予期しないエラーが発生しました |

**注意**: PAD側（旧フロー）の判定基準は **36歳以上** だが、portal API の `isAgeNg()` は **40歳以上**。乖離あり。

### 1.4 reply-sent フロー詳細

```
reply-sent 処理フロー:
  1. processingLogId（必須）+ candidateId（任意）+ sendResult（デフォルト "SUCCESS"）+ sentAt（任意）を受領
  2. MynaviRpaProcessingLog を取得
  3. replySentAt + replyResult を更新
  4. candidateId 解決（リクエスト body 優先 → ログの candidateId フォールバック）
  5. CandidateSettingsHistory 作成:
     - sendType: "MYNAVI_FIRST_REPLY"
     - templateName: "【日程調整】初回メッセージ"
     - senderName: "藤本 夏海"
     - sendResult: リクエストの sendResult
```

### 1.5 Prisma スキーマ（RPA関連モデル）

#### RpaExecutionBatch

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| machineNumber | Int | 号機番号（デフォルト 7） |
| flowName | String | フロー名 |
| startedAt | DateTime | 開始時刻 |
| finishedAt | DateTime? | 終了時刻 |
| status | String | RUNNING / COMPLETED / FAILED |
| totalCount | Int | 処理総数 |
| normalCount | Int | 通常送信数 |
| ageNgCount | Int | 年齢NG数 |
| foreignNgCount | Int | 外国籍NG数 |
| aiFailedCount | Int | AI解析失敗数 |
| duplicateSkipCount | Int | 二重処理スキップ数 |
| errorCount | Int | エラー数 |
| errorMessage | String? | エラーメッセージ |

インデックス: `[startedAt]`, `[machineNumber, startedAt]`

#### MynaviRpaProcessingLog

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| batchId | String | FK → RpaExecutionBatch (Cascade) |
| candidateId | String? | FK → Candidate (SetNull) |
| phoneNormalized | String? | 正規化電話番号 |
| candidateName | String? | 氏名 |
| candidateAge | Int? | 年齢 |
| status | String | NORMAL / AGE_NG / FOREIGN_NG / AI_FAILED / DUPLICATE_SKIP / ERROR |
| reason | String? | 判定理由 |
| canSendReply | Boolean | 一次返信送信可否 |
| replySentAt | DateTime? | 返信送信日時 |
| replyResult | String? | SUCCESS / FAILURE |
| pdfFileName | String? | アップロードPDFファイル名 |
| pdfFileId | String? | CandidateFile ID |
| errorMessage | String? | エラーメッセージ |
| processedAt | DateTime | 処理日時 |

インデックス: `[phoneNormalized, processedAt]`, `[batchId]`, `[candidateId]`

#### CandidateSettingsHistory

| フィールド | 型 | 説明 |
|---|---|---|
| id | String (cuid) | PK |
| candidateId | String | FK → Candidate (Cascade) |
| sentAt | DateTime | 送信日時 |
| sendType | String | MYNAVI_FIRST_REPLY |
| sendResult | String | SUCCESS / FAILURE |
| templateName | String? | テンプレート名 |
| senderName | String? | 送信者名 |

### 1.6 PDF 抽出フィールドマトリクス

Gemini に指示している抽出項目と、`parseResumeData` が対応するキーの一覧:

| 抽出項目 | Gemini プロンプトのキー | parseResumeData の探索キー群 |
|---|---|---|
| 氏名 | name | name, fullName, full_name, candidateName, candidate_name, 氏名, 名前 |
| フリガナ | furigana | nameKana, name_kana, kana, furigana, フリガナ, ふりがな |
| 性別 | gender | gender, sex, 性別 |
| 生年月日 | birthday | birthDate, birth_date, birthday, dateOfBirth, date_of_birth, 生年月日 |
| メール | email | email, mail, mailAddress, メールアドレス |
| 電話番号 | phone | phone, phoneNumber, phone_number, tel, telephone, 電話番号, 携帯電話 |
| 住所 | address | address, currentAddress, current_address, 住所, 現住所 |
| 希望職種1 | desiredJobType1 | desiredJobType1, desired_job_type_1, 希望職種1, 希望職種_第1希望 |
| 希望職種2 | desiredJobType2 | desiredJobType2, desired_job_type_2, 希望職種2, 希望職種_第2希望 |
| 希望業種1 | desiredIndustry1 | desiredIndustry1, desired_industry_1, 希望業種, 希望業種1 |
| 希望業種2 | desiredIndustry2 | desiredIndustry2, desired_industry_2, desired_industry2, 希望業種2, 希望業種_第2希望 |
| 希望勤務地1 | desiredPrefecture1 | desiredPrefecture1, desiredPrefecture, desired_prefecture_1, desired_prefecture1, desired_prefecture, 希望勤務地, 希望勤務地1, 希望都道府県, 希望都道府県1 |
| 希望勤務地2 | desiredPrefecture2 | desiredPrefecture2, desired_prefecture_2, desired_prefecture2, 希望勤務地2, 希望都道府県2 |
| 希望雇用形態 | desiredEmploymentType | desiredEmploymentType, desired_employment_type, 希望雇用形態 |
| 希望年収 | desiredSalaryMin | desiredSalaryMin, desired_salary_min, 希望年収 |
| コンサルタント名 | consultantName | consultantName, consultant_name, コンサルタント名 |
| 応募経路 | applicationRoute | applicationRoute, application_route, 応募経路 |
| 媒体名 | mediaSource | mediaSource, media_source, 媒体, 媒体名 |

**注意**: AI が抽出した applicationRoute / mediaSource は **使われていない**。pdf-upload ルートで固定値 `"スカウト"` / `"マイナビ転職"` に上書きされる。consultantName は recruiterName として使用される（リクエストパラメータがない場合のフォールバック）。

### 1.7 lib/mynavi-rpa/ ユーティリティ一覧

| ファイル | エクスポート | 用途 |
|---|---|---|
| auth.ts | `verifyRpaSecret(req)` | `x-rpa-secret` ヘッダを `RPA_API_SECRET` env と照合 |
| duplicate-check.ts | `checkDuplicateProcessing(phone, windowMinutes=30)` | 同一電話番号の30分窓重複チェック |
| judgment.ts | `calculateAge(birthDate)`, `isAgeNg(birthDate)`, `isForeignNg(last, first)` | 年齢NG(>=40), 外国籍NG判定 |
| notify.ts | `notifyMynaviBatchCompletion(batch)`, `notifyMynaviDuplicateSkip(phone, name?)`, `notifyMynaviError(msg, ctx?)` | LINE WORKS 通知 |
| parse-request-body.ts | `parseRpaRequestBody(req)` | PAD の URL-encoded JSON ボディをパース |
| parse-resume-data.ts | `parseResumeData(resumeData)`, `parseBirthDate(raw)` | Gemini レスポンスからフィールド抽出 |

---

## Block 2: 配信枠管理（号機・スケジュール）

### 2.1 号機構成

| 号機 | 担当者名 | フロー | 稼働時間 |
|---|---|---|---|
| 1号機 | 藤本なつみ | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 2号機 | 岡田かなこ | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 3号機 | 上原ちはる | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 4号機 | 上原千遥 | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 5号機 | 岡田愛子 | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 6号機 | 安藤嘉富 | 00.スカウトメール送信 | 日勤帯(8:00-19:57) + 夜間 |
| 7号機 | RPA7号機 | 01.応募者一次返信・情報取り込み | 5分間隔スケジュール |

### 2.2 スケジュール制御の仕組み

- **portal 内部にはスケジューラーが存在しない**（cron ライブラリなし、`railway.toml` なし、`vercel.json` なし）
- 5分間隔の実行は **Power Automate Cloud Flow** によるスケジュール実行
- portal の API は「呼ばれたら処理する」Webhook 型エンドポイント
- `setInterval` は UI 内のクライアントサイドタイマーのみ（時計表示、ポーリングティック等）

### 2.3 machineNumber の決定方式

- `batch-start` API が body から `machineNumber` を受け取る（型: number）
- 未指定時のデフォルト: **7**
- PAD 側では Windows ユーザー名から号機を自動判定:
  - creasvalue → 1号機, creasvalue1 → 2号機, ..., creasvalue8 → 7号機

### 2.4 「配信枠」概念の不在

- portal のコード・スキーマに「配信枠」「slot」の概念は **存在しない**
- 号機ごとの送信上限は PAD 側のロジック（28日以内4件以上でスキップ）
- portal はバッチの `machineNumber` を記録・表示するのみで、枠管理はしていない

---

## Block 3: メインメニュー構造

### 3.1 サイドバーメニュー構成

```
[アプリ]
  資料生成         → external (material-creator)  ※権限: material_creator
  求人出力         → external (job-analyzer)
  履歴書生成       → external (ai-resume-generator) ※権限: ai-resume-generator
  日程URL         → /schedule-urls

[管理（共通）]
  求職者管理       → /admin/master
  面談管理         → /admin/interviews
  エントリー管理    → /entries
  タスク管理       → /tasks
  勤怠管理         → /attendance
  お知らせ         → /announcements
  資料一覧         → /documents
  マニュアル       → /manuals
  RPAエラー管理    → /rpa-error/chat
  設定             → /settings

[管理（admin のみ）]
  経理管理         → external (finance-app, SSO)
  社員管理         → /admin/users
  お知らせ管理     → /admin/announcements
  資料管理         → /admin/documents
  タスクマスター    → /admin/task-master
  管理者設定       → /admin/settings
  監査ログ         → /admin/audit
```

### 3.2 RPAエラー管理サブナビ

`RpaErrorNav` コンポーネント（5タブ）:

| タブ | パス | 機能 |
|---|---|---|
| エラー相談 | /rpa-error/chat | AI チャット（エラー報告 → 対応案提示、既知エラーDB照合） |
| エラー一覧 | /rpa-error/logs | エラーログ一覧（手動記録ベース） |
| 既知エラー管理 | /rpa-error/known-errors | 既知エラーパターンの CRUD |
| 統計 | /rpa-error/stats | 号機別月別集計、既知エラーランキング |
| 実行履歴 | /rpa-error/executions | `RpaExecutionBatch` 一覧、号機フィルター、詳細画面で `ProcessingLog` テーブル |

### 3.3 スカウト運用に関連するメニュー項目の不在

現在のメニューに以下は **存在しない**:
- スカウト送信管理 / スカウト集計ダッシュボード
- 配信枠管理
- 応募者進行状況（RPA連携分のみ）ビュー
- 「マイナビ」「スカウト」で絞り込めるフィルター付きビュー

RPAエラー管理 → 実行履歴で `7号機` フィルターをかければ、一次返信バッチの処理結果は閲覧可能。ただし UI は「エラー管理」文脈であり、運用集計ダッシュボードとしてはデザインされていない。

---

## Block 4: 求職者一覧のフィルタリング

### 4.1 現在のフィルター一覧

| フィルター | 実装場所 | UI コントロール |
|---|---|---|
| 支援状況タブ | クライアント | タブ: 支援中 / 支援前 / 待機 / 支援終了 / ALL / アーカイブ |
| フリーテキスト検索 | クライアント (300ms debounce) | テキスト入力: candidateNumber, name, nameKana, employee.name |
| 担当CA | クライアント | `<select>` ドロップダウン（Employee 一覧） |
| 登録日 from/to | クライアント | `<input type="date">` ×2 |
| 性別 | クライアント | `<select>`: ALL / 男性 / 女性 |
| 支援終了理由 | クライアント | `<select>` — 支援終了タブ選択時のみ表示 |

### 4.2 存在しないフィルター

以下のフィルターは **未実装**:

- **経路（applicationRoute）フィルター** — 「スカウト」「応募」で絞り込めない
- **媒体（mediaSource）フィルター** — 「マイナビ転職」「indeed」等で絞り込めない
- **スカウトNO** — 検索対象に含まれていない
- **担当RC（recruiterName）** — 検索対象に含まれていない
- **supportSubStatus** — フィルターなし（一覧テーブルには表示あり）

### 4.3 サーバーサイドAPI のフィルター

`GET /api/master/candidates` は `search` クエリパラメータのみ対応:
- 検索対象: name, nameKana, candidateNumber, phone, email
- `applicationRoute`, `mediaSource`, `supportStatus` 等のサーバーサイドフィルターは **未実装**

### 4.4 全件取得の問題

`admin/master/page.tsx` はサーバーサイドで **全 Candidate を取得** し、クライアントに渡している。フィルターは全てクライアントサイド `useMemo` で処理。データ量が増えるとパフォーマンス劣化の可能性。

### 4.5 CandidateRow 型（一覧テーブルの表示項目）

```typescript
type CandidateRow = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  employee: { id: string; name: string } | null;  // 担当CA
  recruiterName: string | null;                     // 担当RC
  createdAt: string;
  supportStatus: string;
  supportSubStatus: string | null;
  supportEndReason: string | null;
  jobStatus?: "entry" | "introduced" | "before" | null;
};
```

**注意**: `applicationRoute`, `mediaSource`, `scoutNumber` は CandidateRow に **含まれていない**。一覧テーブルには表示されない。

---

## Block 5: FileMaker 連携と過去データ

### 5.1 FileMaker の位置付け

FileMaker Pro 20 は BizStudio の **旧基幹システム**。portal は FileMaker を置き換える目的で開発されたが、移行期間中は **双方向連携** が続いている。

### 5.2 現在の FileMaker 連携ポイント

| 連携 | 方向 | 詳細 |
|---|---|---|
| RPA 7号機 FM出力 | FM → PAD | FileMaker の `.fmp12` スクリプトでスカウトNO・登録済電話番号を出力 |
| FMインポートファイル作成 | PAD → FM | RPA が `02.求職者一括登録インポート_元.xlsx` を作成し OneDrive 経由で FM にインポート |
| AI分析 filemaker_mapping | portal → FM | 面談分析 AI が FileMaker 列名に対応するフラグ値を出力 |
| 勤怠インポート | FM → portal | 過去の勤怠データ（2026-03以前）を FM からエクスポートして portal にインポート済み |
| エントリー一括インポート | FM → portal | 過去のエントリーデータを `fmEntryNo` 付きで portal に移行済み |
| タスクカテゴリ | portal | 「求職者紹介のFM登録依頼」「RAエントリーのFM登録」タスクカテゴリが存在 |

### 5.3 FileMaker データフォーマット

#### FM インポートファイル（`02.求職者一括登録インポート_元.xlsx`）

RPA 7号機のサブフロー⑫で作成。集計ファイルの「Import」シートから展開したデータを書き込み、BI列に処理日を記入。OneDrive の「インポート前」フォルダに配置。

#### FM エクスポートファイル

| ファイル | 出力元 | 内容 |
|---|---|---|
| `01.スカウトNO出力.fmp12` | FileMaker | スカウトNO 一覧を Excel 出力 |
| `01.登録済電話番号リスト出力.fmp12` | FileMaker | 登録済み電話番号リスト（重複チェック用） |

#### エントリーデータ（移行済み）

`scripts/bulk-import-0413.mjs` に含まれるハードコードデータから判明するフォーマット:
- `fmEntryNo`: FileMaker のエントリー番号（例: `"Entry39236"`）
- `candidateNumber`, `companyName`, `jobTitle`, `entryFlag`, `personFlag`, `companyFlag` 等

#### 勤怠データ

FileMaker からエクスポートした `.xlsx` ファイル。portal の `/attendance/admin/import` ページでインポート。2026-03 以前のデータのみ対象。

### 5.4 PAD 旧フロー vs portal 新フロー の差異

| 項目 | PAD 旧フロー (7号機) | portal API (pdf-upload) |
|---|---|---|
| 年齢NG閾値 | 36歳以上 | 40歳以上 (`isAgeNg`) |
| 重複チェック | FM電話番号リスト + Outlook履歴 | `MynaviRpaProcessingLog` 30分窓 |
| FM連携 | インポートファイル作成 + FM出力 | なし（portal DB に直接登録） |
| 一次返信 | PAD がマイナビ上で直接メッセージ送信 | PAD が送信 → `reply-sent` で結果記録 |
| データ保存先 | FileMaker + OneDrive Excel | portal DB (Candidate + CandidateFile) |

### 5.5 二重管理の現状

現時点で新規応募者データは **portal と FileMaker の両方** に登録されている:
1. portal: `pdf-upload` API で `Candidate` 作成
2. FileMaker: PAD サブフロー⑫でインポートファイル作成 → FM に手動インポート

この二重管理は移行期の暫定措置と推測される。

---

## 横断的発見事項

### F-1: 年齢NG閾値の不一致
- PAD システムプロンプト記載: **36歳以上**
- portal `isAgeNg()`: **40歳以上**
- PAD サブフロー⑤記載: **36歳以上**
- PAD サブフロー⑨記載: **35歳以下** を送信対象
- 実運用でどちらが適用されているか要確認

### F-2: スカウト運用の可視化ギャップ
portal には以下のビューが **存在しない**:
- スカウトメール送信数の日別/号機別集計
- 応募→一次返信→面談設定の進行状況ファネル
- 経路別（スカウト/応募）の求職者分布
- 担当RC別の応募受信数

### F-3: 「00.スカウトメール送信」フローのデータが portal にない
1〜6号機のスカウトメール送信結果は **OneDrive の蓄積ファイル（Excel）にのみ記録** されている。portal にはスカウト送信のログテーブルやAPIが存在しない。集計する場合は Excel からの取り込みが必要。

### F-4: applicationRoute / mediaSource の固定値問題
`pdf-upload` ルートで `applicationRoute: "スカウト"`, `mediaSource: "マイナビ転職"` がハードコードされている。AI 抽出値は無視される。将来的にマイナビ以外の媒体や応募経由の取り込みに対応する場合、この固定値ロジックの見直しが必要。

### F-5: 求職者一覧の全件取得
`admin/master/page.tsx` がサーバーサイドで全件取得 → クライアントサイドフィルター。求職者数が数千件を超えるとパフォーマンス問題が発生する可能性。経路フィルター等を追加する場合、サーバーサイドフィルターへの移行を検討すべき。

### F-6: admin ルートガードの不在
`src/app/(app)/admin/layout.tsx` はセッション認証のみで、`role === "admin"` のチェックがない。admin メニューはサイドバーの表示制御のみで保護されており、URL 直打ちでアクセス可能。

---

## 調査結論

スカウト運用集計機能を構築するにあたり、以下が主要なギャップ:

1. **1〜6号機（スカウト送信）のデータが portal にない** — 送信結果は OneDrive Excel にしか存在しない
2. **求職者一覧にスカウト関連のフィルターがない** — applicationRoute/mediaSource でのフィルタリング未実装
3. **進行ファネルの可視化機能がない** — スカウト→応募→一次返信→面談→エントリーの進行状況を追跡する仕組みがない
4. **号機管理の概念が portal 側に薄い** — machineNumber はログに記録されるが、号機マスターや担当者紐付けはシステムプロンプトにハードコード
5. **PAD と portal の判定基準に乖離がある** — 年齢NG閾値（36歳 vs 40歳）
