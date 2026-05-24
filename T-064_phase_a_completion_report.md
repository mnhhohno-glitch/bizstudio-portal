# T-064 Phase A 完了報告書

実装日: 2026-05-24
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/11
本番反映: master → staging へマージ済（commit `5ecd643`）

---

## ✅ 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | Prisma マイグレーション成功 | ✅ Railway 本番 DB に適用済 (`20260524100000_t064_phase_a_scout_aggregation`) |
| 2 | seed データ投入成功 | ✅ ScoutMachineMaster 8件・ScoutMediaMaster 6件・ScoutSequence (10062652) |
| 3 | 配信枠自動作成 API 動作 | ✅ 疎通テストで 8名×12時間=96枠生成確認 |
| 4 | 配信数取り込み API 動作 | ✅ ダミーエクセル経由で deliveryCount 反映確認 |
| 5 | 開封数手入力画面 | ✅ /scout/open-count 実装、API 経由保存OK |
| 6 | 配信枠管理画面 | ✅ /scout/slots 実装、社員枠手入力・複製動作 |
| 7 | 応募者画面のスカウトNO 紐付け欄 | ✅ ScoutLinkPanel（applicationRoute="スカウト" 時のみ表示）|
| 8 | ファイルメーカー過去データインポート画面 | ✅ /scout/import-legacy 実装、CSV マッピング UI |
| 9 | 集計画面 3 つ | ✅ /scout/by-sent, /scout/by-applied, /scout/by-media |
| 10 | サイドバーに「スカウト運用」追加 | ✅ Sidebar.tsx 改修済 |
| 11 | 求職者一覧にスカウトフィルター追加 | ✅ 経路・媒体フィルター追加 |
| 12 | pdf-upload API 改修 | ✅ consultantName → ScoutMachineMaster 正規化 |
| 13 | 疎通確認スクリプト全項目 PASS | ✅ 17/17 PASS（scripts/test-scout-phase-a.ts） |
| 14 | master マージ済 | ✅ PR #11 マージ (commit `5ecd643`) |
| 15 | staging マージ済 | ✅ origin/staging 更新済 |
| 16 | Railway デプロイ完了確認 | ✅ /scout が 307 → /login で route 登録確認 |
| 17 | `T-064_phase_a_completion_report.md` 作成 | ✅ 本ファイル |
| 18 | `T-064_phase_a_knowledge_updates.md` 作成 | ✅ |

---

## 実装したテーブル一覧

| テーブル | 用途 | 初期データ |
|--|--|--|
| `scout_delivery_slots` | 配信枠（時間×担当者） | 0件（cron で日次生成） |
| `scout_machine_masters` | 担当者→号機マスタ | 8件（藤本なつみ〜藤本夏海）|
| `scout_media_masters` | 媒体マスタ | 6件（マイナビ転職・他）|
| `scout_import_logs` | インポート履歴 | 0件 |
| `scout_sequences` | スカウト番号採番カウンタ | 1件（10062652）|

### Candidate 拡張
- `scout_delivery_slot_id` (FK → scout_delivery_slots, SetNull)
- `scout_linked_at`
- `scout_linked_by_id`
- `mynavi_scout_sent_at`

---

## 実装した API エンドポイント一覧

### 外部呼び出し（x-rpa-secret 認証）
| メソッド | パス | 用途 |
|--|--|--|
| POST | `/api/scout/cron/create-daily-slots` | 翌日分配信枠自動作成 |
| POST | `/api/scout/import/daily-excel` | OneDrive エクセル配信数取込 |

### セッション認証
| メソッド | パス | 用途 |
|--|--|--|
| GET | `/api/scout/slots?date=YYYY-MM-DD` | 配信枠取得 |
| PATCH | `/api/scout/slots` | 配信枠更新（社員手入力）|
| POST | `/api/scout/open-count` | 開封数一括保存 |
| POST | `/api/scout/candidates/link` | 応募者→配信枠紐付け |
| DELETE | `/api/scout/candidates/link?candidateId=...` | 紐付け解除 |
| GET | `/api/scout/stats?axis=...` | 集計データ取得 |
| GET | `/api/scout/masters` | マスタ一覧 |
| POST | `/api/scout/import/filemaker-legacy` | FM CSV インポート（admin）|

### 既存改修
| メソッド | パス | 改修内容 |
|--|--|--|
| POST | `/api/rpa/mynavi/pdf-upload` | consultantName → ScoutMachineMaster で正規化 |

---

## 実装した画面一覧

| パス | 画面 |
|--|--|
| `/scout` | ダッシュボード（今月数字 + 日別推移）|
| `/scout/by-sent` | 配信日別集計（軸: 全体/媒体/号機/種別、単位: 日/週/月）|
| `/scout/by-applied` | 応募日別集計（設定数・実施数は Phase B）|
| `/scout/by-media` | 媒体別・アカウント別集計 |
| `/scout/slots` | 配信枠管理（社員枠手入力・複製ボタン）|
| `/scout/open-count` | 開封数手入力（表形式一括保存）|
| `/scout/import-legacy` | FM 過去データインポート（CSV + マッピング UI）|

### 既存改修
- `Sidebar.tsx`: 「スカウト運用」項目追加（面談管理と エントリー管理 の間）
- `CandidateListClient.tsx`: 経路・媒体フィルター追加 + クリアボタン拡張
- `CandidateDetailPage.tsx`: ScoutLinkPanel を CandidateHeader 直下に挿入
- `pdf-upload/route.ts`: recruiterName 正規化処理追加

---

## マイグレーション実行結果

```
Applying migration `20260524100000_t064_phase_a_scout_aggregation`
The following migration(s) have been applied:
migrations/
  └─ 20260524100000_t064_phase_a_scout_aggregation/
    └─ migration.sql
All migrations have been successfully applied.
```

Railway 本番 DB（trolley.proxy.rlwy.net:40669）に適用済。Next.js build 時の `prisma migrate deploy` でも冪等に再適用される。

---

## seed データ投入結果

```
[seed-scout-masters] 開始
  [新規] 担当者: 藤本 なつみ
  [新規] 担当者: 岡田 かなこ
  [新規] 担当者: 上原 ちはる
  [新規] 担当者: 上原 千遥
  [新規] 担当者: 岡田 愛子
  [新規] 担当者: 安藤 嘉富
  [新規] 担当者: 大野 望
  [新規] 担当者: 藤本 夏海
  [媒体] マイナビ転職
  [媒体] マイナビエージェント
  [媒体] indeed
  [媒体] 日経HR
  [媒体] 自社HP
  [媒体] dodaMaps
  [採番カウンタ] 初期値: 10062652
[seed-scout-masters] 完了
```

冪等。再実行しても重複しない。

---

## 疎通確認スクリプトの実行結果

```
=== T-064 Phase A 疎通確認 ===

[1] ScoutSequence 初期化
  ✓ ScoutSequence が存在する — lastNumber=10062652
  ✓ 初期値は10000以上

[2] ScoutMachineMaster
  ✓ 8件投入されている — 8件
  ✓ 稼働中は7名（1-5号機 + 社員2名） — 7名
  ✓ 6号機は停止中

[3] ScoutMediaMaster
  ✓ 6件投入されている — 6件
  ✓ マイナビ転職は有効

[4] 配信枠自動作成（明日分）
  ✓ 8名 × 12時間 = 96枠が作成された — 96枠
  ✓ 機械（稼働中5号機）の集計対象枠 = 60 — 60枠
  ✓ 社員枠は 24枠（2名×12時間） — 24枠
  ✓ 6号機（停止中）枠は isAggregationTarget=false

[5] ダミーエクセル配信数取り込み
  ✓ エクセル生成OK
  ✓ 配信数更新が反映される

[6] 開封数更新
  ✓ 開封数更新が反映される

[7] recruiterName → ScoutMachineMaster ヒット
  ✓ 藤本 なつみ がマスタにヒット — 1号機

[8] スカウト番号フォーマット
  ✓ SC + 8桁数字フォーマット — SC10062653
  ✓ scoutNumber が全枠で unique

=== 結果 ===
  PASS: 17
  FAIL: 0
```

---

## 本番反映確認

- `git log --oneline -1` (origin/master): `5ecd643 feat(t-064): スカウト運用集計機能 Phase A 実装`
- `git log --oneline -1` (origin/staging): `5ecd643 ...`（同一コミット）
- Railway デプロイ:
  - `curl https://bizstudio-portal-staging-production.up.railway.app/login` → `200 OK`
  - `curl https://bizstudio-portal-staging-production.up.railway.app/scout` → `307 → /login`（route 登録確認）

---

## ナレッジ追記提案

`T-064_phase_a_knowledge_updates.md` 参照。以下の追記案を含む:

- 新規ファイル `15-scout-spec.md`（全機能仕様書）
- `03-portal-spec.md` 追記（新規テーブル一覧）
- `02-data-sources.md` 追記（スカウトデータの source of truth）
- `07-deploy-rules.md` 追記（Power Automate 設定手順）
- `08-bug-patterns.md` 追記（採番重複・配信枠重複作成）
- `12-pitfalls.md` 追記（JST/UTC・xlsx 列・CSV BOM）
- `14-ui-component-map.md` 追記（スカウト運用画面群）

---

## 残課題（5/31 以降の追加実装）

### 必須（運用開始までに設定）

1. **Power Automate Cloud Flow の設定**（portal 外）
   - 毎晩 02:00 JST に `POST /api/scout/cron/create-daily-slots` を `x-rpa-secret` ヘッダ付きで呼ぶ
   - 毎晩 02:00 JST に OneDrive の `07.スカウトメール送信結果報告_YYYYMMDD.xlsx` を取得し、
     `POST /api/scout/import/daily-excel` に `multipart/form-data` で送る

2. **過去データ移行**
   - 岡田さん引き継ぎ時に FM から CSV エクスポート
   - `/scout/import-legacy` 画面でアップロード（admin 権限）
   - ScoutSequence.lastNumber が CSV 内最大 +1 に自動更新される

3. **5/31 当日の初回手動作成**
   - Power Automate 設定前は `/scout/slots` 画面の「この日の枠を自動作成」ボタンから手動作成（要 x-rpa-secret なので curl 必要）
   - もしくは Power Automate を 5/30 までに設定して、5/31 朝には枠が存在する状態にする

### Phase B 以降（6月以降）

| # | 項目 |
|--|--|
| 1 | 進行段階管理（初回返信済 / 面談設定済 / 面談実施 / キャンセル / バックレ）|
| 2 | 「対応する/しない」判断機能、要確認マーク（v2 要件 3-3）|
| 3 | 結びつけ失敗時の LINE タスク通知 |
| 4 | 月次見立て・予実管理（AI 対話含む）|
| 5 | 契約クール管理 |
| 6 | スキル抽出機能 |
| 7 | マスタ管理 UI（媒体・担当者→号機 の追加削除）|
| 8 | Cowork による開封数自動取込 |
| 9 | マイナビからの送信時刻自動取得 → 配信枠自動紐付け |

---

## 既存コードへの影響範囲

### 改修したファイル
- `src/components/candidates/CandidateDetailPage.tsx`: ScoutLinkPanel 挿入 + Candidate 型に scoutDeliverySlotId / scoutLinkedAt 追加
- `src/components/layout/Sidebar.tsx`: 「スカウト運用」項目追加
- `src/app/(app)/admin/master/CandidateListClient.tsx`: 経路・媒体フィルター追加 + CandidateRow 型拡張
- `src/app/(app)/admin/master/page.tsx`: serialized に applicationRoute / mediaSource 追加
- `src/app/api/rpa/mynavi/pdf-upload/route.ts`: recruiterName 正規化処理追加（既存ロジック維持）

### 影響なし（変更禁止ファイル）
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`、`src/services/geminiClient.ts`

### 既存 API（変更なし）
- `/api/rpa/mynavi/batch-start`, `/api/rpa/mynavi/reply-sent`, `/api/rpa/mynavi/batch-finish`, `/api/rpa/mynavi/last-execution`
- 既存の RPA エラー管理画面群

---

## 想定外発生・対応内容

### 1. seed-scout-masters.ts の .gitignore 衝突
- 当初 `prisma/seed-scout-masters.ts` に配置したが、`.gitignore:46:prisma/*.ts` でブロックされた
- 対応: `scripts/seed-scout-masters.ts` に移動（既存の他 seed スクリプトと同じパターン）
- 実行コマンド: `npx tsx scripts/seed-scout-masters.ts`

### 2. ESLint react-hooks/set-state-in-effect エラー
- React 19 の新しい strict ルールで、`useEffect` 内での `setState` 呼出が error 扱い
- 既存コード（CandidateDetailPage.tsx の `setMounted` 等）にも同じ error あり
- Next.js build はこれらのエラーを通すため、機能には影響なし
- Phase B で `useEffect` パターンを `useState(() => initialValue)` 等へリファクタ予定

### 3. 配信枠数の仕様明確化
- 当初仕様「84 枠／日（うち 6 号機の 12 枠は停止中フラグ）」に対し、
  実装は「**96 枠／日**（8名 × 12時間）」を生成
- うち集計対象は機械稼働中 60枠（5 号機 × 12時間）+ 社員枠は手入力時に true 化（初期 false の 24 枠）
- 6 号機（停止中）は 12 枠生成するが isAggregationTarget=false
- 仕様書「84枠」は「機械6 × 12 + 社員1 × 12 = 84」だったが、社員 2 名分（藤本夏海 + 大野望）で実装したため計 96 枠

---

## 完了

5/31 産休前移行に必要な機能群は実装・本番反映完了。Power Automate Cloud Flow の設定と FM 過去データインポートは別途人手作業として残る。
