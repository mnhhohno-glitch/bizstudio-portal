# T-064 Phase A ナレッジ追記提案

リポジトリ直下のナレッジファイルへの追記案。将幸さんが手動で反映してください。

---

## 新規ファイル提案: `15-scout-spec.md`

```markdown
# 15. スカウト運用機能仕様

## 概要
T-064 Phase A で導入。岡田さんが従来 FileMaker + Excel で行っていたスカウト運用集計を portal に統合。

## データモデル

### ScoutDeliverySlot（配信枠）
- 1日84枠（8名 × 12時間 8:00-19:00）
- 各枠は一意なスカウト番号（SC + 8桁）を持つ
- 機械分（1〜6号機）: deliveryCount は OneDrive Excel 取り込みで自動更新
- 社員分（藤本 夏海 / 大野 望）: UI で手入力

### ScoutMachineMaster（担当者→号機マスタ）
- マイナビPDF の担当者名と号機の対応
- isActive=false で集計対象から除外（6号機は停止中）

### ScoutMediaMaster（媒体マスタ）
- マイナビ転職 / マイナビエージェント が有効
- 他媒体は isActive=false

### ScoutSequence（採番カウンタ）
- FM 最終番号 + 1000 が初期値（10062652）
- generateScoutNumber() でトランザクション内で +1 採番

## 主要 API

### 外部呼び出し（Power Automate Cloud Flow 想定）
- `POST /api/scout/cron/create-daily-slots` — 翌日分配信枠の自動作成（x-rpa-secret 認証）
- `POST /api/scout/import/daily-excel` — OneDrive Excel から配信数取り込み（同上）

### 内部 API
- `GET /api/scout/slots?date=YYYY-MM-DD` — 配信枠取得
- `PATCH /api/scout/slots` — 配信枠更新
- `POST /api/scout/open-count` — 開封数一括保存
- `POST /api/scout/candidates/link` — 応募者→配信枠紐付け
- `GET /api/scout/stats?axis=...` — 集計データ
- `GET /api/scout/masters` — マスタ一覧
- `POST /api/scout/import/filemaker-legacy` — FM CSV インポート（admin）

## UI 画面

| パス | 役割 |
|--|--|
| /scout | ダッシュボード |
| /scout/by-sent | 配信日別集計 |
| /scout/by-applied | 応募日別集計 |
| /scout/by-media | 媒体・アカウント別集計 |
| /scout/slots | 配信枠管理（社員枠手入力含む） |
| /scout/open-count | 開封数手入力 |
| /scout/import-legacy | FM 過去データインポート（admin） |

## 既存機能との連携
- `pdf-upload` API は `consultantName` → `ScoutMachineMaster.recruiterName` で正規化
- 応募者画面（applicationRoute === "スカウト"）に `ScoutLinkPanel` 表示
- 求職者一覧に「経路」「媒体」フィルター追加

## Phase B 以降に残された機能
- 「対応する/しない」判断、要確認マーク（v2 要件定義 3-3）
- 進行段階管理（初回返信済/面談設定/実施/キャンセル/バックレ）
- 結びつけ失敗時 LINE タスク通知
- 月次見立て・予実管理・AI 対話
- 契約クール管理
- スキル抽出機能
- マスタ管理 UI（媒体・担当者→号機）
- Cowork による開封数自動取り込み
- マイナビ送信時刻からの自動紐付け

## 罠
- 配信枠の自動作成は1日1回（既存があればスキップ）。手動再作成する場合は対象日の全枠を `DELETE` してから API を叩く
- `generateScoutNumber` は必ず `$transaction` 内（並列リクエスト重複防止）
- 機械の集計対象フラグは isActive に連動、社員は手入力時に true 化する設計
```

---

## `03-portal-spec.md` 追記

```markdown
## スカウト運用機能（T-064 Phase A 以降）

- 新規テーブル: `scout_delivery_slots`, `scout_machine_masters`, `scout_media_masters`, `scout_import_logs`, `scout_sequences`
- Candidate に追加: `scout_delivery_slot_id`, `scout_linked_at`, `scout_linked_by_id`, `mynavi_scout_sent_at`
- 詳細は `15-scout-spec.md` 参照
```

---

## `02-data-sources.md` 追記

```markdown
## スカウト配信枠

| データ | source of truth | 同期方向 |
|--|--|--|
| 配信枠（時間×号機） | portal `ScoutDeliverySlot` | 毎晩02:00自動作成（Power Automate） |
| 配信数（機械分） | OneDrive Excel | 毎晩02:00取り込み → portal |
| 配信数（社員分） | portal UI 手入力 | - |
| 開封数 | portal UI 手入力（将来Coworkで自動化予定） | - |
| 担当者→号機 | portal `ScoutMachineMaster` | 初期値はマイグレーション投入 |
| スカウト番号 | portal `ScoutSequence` で採番 / FM 過去データは CSV インポート | - |
```

---

## `07-deploy-rules.md` 追記

```markdown
## T-064 Phase A デプロイ時の追加手順

1. マイグレーション `20260524100000_t064_phase_a_scout_aggregation` を本番に適用（`prisma migrate deploy` は build で自動）
2. seed: `npx tsx prisma/seed-scout-masters.ts` を本番DBに対して1回だけ実行
3. Power Automate Cloud Flow の設定:
   - 毎晩 02:00 JST に `POST /api/scout/cron/create-daily-slots` を `x-rpa-secret` ヘッダ付きで呼ぶ
   - 毎晩 02:00 JST に OneDrive の最新「07.スカウトメール送信結果報告_YYYYMMDD.xlsx」を取得し、
     `POST /api/scout/import/daily-excel` に multipart で送る
4. 過去データ移行: 管理者が `/scout/import-legacy` 画面で FM エクスポート CSV をアップロード
```

---

## `08-bug-patterns.md` 追記

```markdown
## T-064 関連の想定罠

- **スカウト番号重複**: `generateScoutNumber()` は必ず `prisma.$transaction` 内で呼ぶ。並列リクエストで重複採番が発生する
- **配信枠の重複作成**: `createDailySlots()` は対象日に既存枠が1件でもあればスキップ。手動再作成は `DELETE` してから
- **集計対象フラグ**: 機械分は `isActive` に追従、社員分は初期 false → 手入力で true 化。停止中号機（6号機）が誤って集計に含まれないよう注意
- **PAD と portal の判定基準の乖離**: 年齢NG閾値が PAD=36歳 vs portal=40歳 で食い違っている既知問題。Phase B で統一予定
```

---

## `12-pitfalls.md` 追記

```markdown
## スカウト機能の罠

- **JST と UTC**: `ScoutDeliverySlot.deliveryDate` は `@db.Date`（UTC 00:00 で記録）。JST 表示時は `getTomorrowJst()` 等のヘルパー必須
- **xlsx ライブラリの列インデックス**: `SCOUT_EXCEL_FORMAT.machineColumnMap` は B列=1、C列=2 …（0始まり）。配信レポート Excel の構造が変わったらここを更新
- **CSV BOM**: FM エクスポート CSV は BOM 付き UTF-8 が多い。`parseCSVLine` で BOM を除去している
- **applicationRoute = "スカウト"** 以外の Candidate には `ScoutLinkPanel` は描画されない（経路を「スカウト」に変更しないと紐付け不可）
```

---

## `14-ui-component-map.md` 追記

```markdown
## スカウト運用画面

- `src/components/scout/ScoutNav.tsx` — タブナビ（7タブ）
- `src/components/scout/ScoutLinkPanel.tsx` — 応募者ページに表示する紐付けパネル
- `src/app/(app)/scout/page.tsx` — ダッシュボード
- `src/app/(app)/scout/by-sent/page.tsx` — 配信日別集計
- `src/app/(app)/scout/by-applied/page.tsx` — 応募日別集計
- `src/app/(app)/scout/by-media/page.tsx` — 媒体別集計
- `src/app/(app)/scout/slots/page.tsx` — 配信枠管理（手入力UI付き）
- `src/app/(app)/scout/open-count/page.tsx` — 開封数手入力
- `src/app/(app)/scout/import-legacy/page.tsx` — FM 過去データインポート
```
