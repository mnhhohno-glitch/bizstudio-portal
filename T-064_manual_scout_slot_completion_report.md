# T-064 一斉配信入力UI + 大フラグ機械→RPA + ユニーク制約緩和 完了報告書

実装日: 2026-05-24
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/16
master マージ済 / staging マージ済 (commit `1d44ada`)

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | Prisma スキーマ変更（searchConditionName + ユニーク制約緩和） | ✅（searchConditionName は既存だったため制約のみ） |
| 2 | 既存データ "機械" → "RPA" 書き換え | ✅ 9576 件 |
| 3 | seed 更新 | ✅ slot-helpers / filemaker-legacy 更新（seed.ts は機械配信を含まない） |
| 4 | 新規作成 API | ✅ POST /api/scout/slots/create-manual |
| 5 | 複製 API | ✅ POST /api/scout/slots/duplicate |
| 6 | 新規作成モーダル UI | ✅ /scout/slots |
| 7 | 複製モーダル UI | ✅ /scout/slots |
| 8 | UI 表示の "機械" → "RPA" 更新 | ✅ page.tsx 補足文 + route コメント |
| 9 | 既存 RPA 動作への影響なし | ✅ daily-excel-importer / aggregated-importer は isMachine フィルタで動作 |
| 10 | 新規テスト PASS | ✅ 13/13 |
| 11 | 既存テスト全項目 PASS | ✅ phase-a 17/17, aggregated 17/17, auto-create 14/14 |
| 12 | master マージ済 | ✅ |
| 13 | staging マージ済 | ✅ commit `1d44ada` |
| 14 | Railway デプロイ完了確認 | ✅ create-manual / duplicate ともに 401 応答（route 登録済） |
| 15 | 完了報告書作成 | ✅ 本ファイル |

---

## 1. スキーマ変更

### ユニーク制約の緩和

```prisma
// Before:
@@unique([deliveryDate, hourSlot, machineId])

// After:
@@unique([deliveryDate, hourSlot, machineId, deliveryCategoryLarge, deliveryCategoryMedium],
         map: "scout_slot_unique_per_category")
```

これにより、同一日・同一時間帯・同一担当者でも、大中フラグの組み合わせが異なれば複数レコードを作成可能。

### コメント更新

```prisma
deliveryCategoryLarge  String  @map("delivery_category_large") // "RPA" / "社員"
```

### searchConditionName について

調査の結果、Phase A の時点で既に `searchConditionName String? @map("search_condition_name")` が存在していたため、追加は不要。

---

## 2. マイグレーション

`prisma/migrations/20260524120000_t064_relax_slot_constraint_and_rename_machine_to_rpa/migration.sql`

```sql
-- Step 1: 既存のユニーク INDEX を削除
DROP INDEX IF EXISTS "scout_delivery_slots_delivery_date_hour_slot_machine_id_key";

-- Step 2: 新しいユニーク INDEX を作成
CREATE UNIQUE INDEX IF NOT EXISTS "scout_slot_unique_per_category"
  ON "scout_delivery_slots"(
    "delivery_date",
    "hour_slot",
    "machine_id",
    "delivery_category_large",
    "delivery_category_medium"
  );

-- Step 3: 既存データの大フラグ書き換え "機械" → "RPA"
UPDATE "scout_delivery_slots"
SET "delivery_category_large" = 'RPA'
WHERE "delivery_category_large" = '機械';
```

### 適用結果（Railway 本番）

```
$ npx prisma migrate deploy
Applying migration `20260524120000_t064_relax_slot_constraint_and_rename_machine_to_rpa`
All migrations have been successfully applied.
```

### データ書き換え件数

- '機械' のレコード: 0 件（書き換え完了）
- 'RPA' のレコード: **9576 件**

---

## 3. 新規 API 仕様

### POST /api/scout/slots/create-manual

**認証**: セッション認証

**Body**:
```json
{
  "deliveryDate": "2026-05-25",
  "hourSlot": 14,
  "machineId": "<社員のmachineId>",
  "deliveryCategoryLarge": "社員",
  "deliveryCategoryMedium": "一斉配信",
  "deliveryCategorySmall": "検索条件指定",
  "searchConditionName": "営業職_東京_30代男性",
  "mediaSource": "マイナビ転職",
  "deliveryCount": 50,
  "memo": null
}
```

**処理**:
1. バリデーション（必須項目、hourSlot 範囲、machineId 実在）
2. `generateScoutNumber()` で SC + 8桁の新規番号を採番
3. ScoutDeliverySlot.create

**レスポンス**:
```json
{ "slot": { "id": "...", "scoutNumber": "SC10076285", ... } }
```

**エラー**:
- 400: バリデーションエラー
- 409: ユニーク制約違反（同一カテゴリ重複）
- 500: その他

### POST /api/scout/slots/duplicate

**認証**: セッション認証

**Body**:
```json
{
  "sourceSlotId": "<コピー元のid>",
  "deliveryDate": "2026-05-25",
  "hourSlot": 15,
  "deliveryCount": 80,
  "searchConditionName": "新しい条件",
  "deliveryCategorySmall": "検索条件指定"
}
```

**処理**:
1. sourceSlotId のレコードを取得
2. **RPA枠（`isMachine=true`）は拒否**（400 エラー）
3. machineId / 大中フラグ / mediaSource はコピー元から引き継ぎ
4. 新規スカウトNO発番
5. レコード作成

---

## 4. UI 実装

### /scout/slots 配信枠管理画面

#### 追加された UI

1. **「+ 一斉配信レコードを新規作成」ボタン**（緑、ヘッダ部）
   - クリックで新規作成モーダルが開く
2. **「複製」ボタン**（各セルに表示、社員枠のみ）
   - クリックで複製モーダルが開く

#### 新規作成モーダル

入力項目:
- 配信日（date picker）
- 配信時間（8〜19時のドロップダウン）
- 担当者（社員枠のドロップダウン: 大野 望 / 藤本 夏海）
- 媒体（マイナビ転職 / マイナビエージェント等の有効媒体）
- 中フラグ（一斉配信 / 個別配信のラジオボタン）
- 小フラグ（検索条件指定 / 未指定のラジオボタン）
- 検索条件名（自由入力）
- 配信数（数値入力）

自動設定:
- 大フラグ = "社員" 固定
- スカウトNO 自動採番

#### 複製モーダル

引き継ぎ（編集不可）:
- 担当者
- 媒体
- 大フラグ
- 中フラグ

編集可能:
- 配信日
- 配信時間
- 配信数
- 検索条件名
- 小フラグ

#### マトリクス表示の変更

カラム単位を `machineId` から `(machineId, deliveryCategoryMedium)` に変更。
同じ担当者が「個別配信」と「一斉配信」の2レコードを持つ場合、別カラムとして並列表示される。

#### 補足テキスト変更

```
Before: 機械分（1〜6号機）の配信数は OneDrive エクセル取り込みで自動更新されます。
After:  RPA枠（1〜6号機）の配信数は OneDrive エクセル取り込みで自動更新されます。
        社員枠（藤本 夏海・大野 望）は手入力 / 新規作成 / 複製で管理します。
```

---

## 5. テスト結果

### 新規テスト: scripts/test-scout-slot-creation.ts

```
[1] 既存データの大フラグ書き換え
  ✓ '機械' のレコードは 0 件 — 0件
  ✓ 'RPA' のレコードが存在する（書き換え済） — 9576件
[2] テスト用社員枠取得
  ✓ 社員枠の担当者が存在 — 大野 望
[3] ユニーク制約緩和の検証
  ✓ 個別配信レコード作成 — SC10076285
  ✓ 一斉配信レコード作成（同日同時間同担当者） — SC10076286
  ✓ 2レコードのスカウトNOが連番（採番ロジック） — SC10076285, SC10076286
[4] ユニーク制約の維持確認（同一カテゴリの重複は拒否される）
  ✓ 同一カテゴリ重複は Unique 制約で拒否される
[5] 複製ロジック検証
  ✓ 複製レコード作成（時間違い） — SC10076288
  ✓ 複製のスカウトNOは新規発番
  ✓ 複製の大フラグはコピー元と同じ
  ✓ 複製の中フラグはコピー元と同じ
[6] RPA枠の判定確認
  ✓ RPA枠が DB に存在する — SC10063233
  ✓ RPA枠の大フラグは 'RPA' — RPA

=== 結果: 13 PASS / 0 FAIL ===
```

### 既存テスト（リグレッション確認）

| テスト | PASS / FAIL |
|--|--|
| test-scout-phase-a | 17 / 0 |
| test-scout-aggregated | 17 / 0 |
| test-scout-aggregated-auto-create | 14 / 0 |

### TypeScript チェック

```
$ npx tsc --noEmit
(エラーなし)
```

---

## 6. 既存 RPA フローへの影響

### daily-excel-importer

- フィルタ条件: `isMachine: true`
- 動作: `deliveryCount` のみ更新（大フラグ参照なし）
- **影響なし** ✅

### aggregated-importer

- フィルタ条件: `isMachine: true`
- 動作: `deliveryCount` のみ更新
- **影響なし** ✅

### create-daily-slots cron (Cloud Flow 1)

- 動作: `createDailySlots` で新規枠作成
- 大フラグ値は `m.isMachine ? "RPA" : "社員"` で適切に設定される
- **影響なし** ✅

### import-failed 通知

- 動作: 通知のみ、DB更新なし
- **影響なし** ✅

---

## 7. デプロイ確認

### Railway staging

```
POST https://bizstudio-portal-staging-production.up.railway.app/api/scout/slots/create-manual
→ 401 (認証必須、route 登録済)

POST https://bizstudio-portal-staging-production.up.railway.app/api/scout/slots/duplicate
→ 401 (認証必須、route 登録済)
```

両 route ともデプロイ完了済。

---

## 8. 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `prisma/schema.prisma` | 修正 | ユニーク制約変更、コメント更新 |
| `prisma/migrations/20260524120000_*/migration.sql` | 新規 | 制約緩和 + データ書き換え |
| `src/lib/scout/slot-helpers.ts` | 修正 | ハードコード "機械" → "RPA" |
| `src/app/api/scout/slots/route.ts` | 修正 | コメントのみ |
| `src/app/api/scout/slots/create-manual/route.ts` | 新規 | 手動作成 API |
| `src/app/api/scout/slots/duplicate/route.ts` | 新規 | 複製 API |
| `src/app/api/scout/import/filemaker-legacy/route.ts` | 修正 | ハードコード "機械" → "RPA" |
| `src/app/(app)/scout/slots/page.tsx` | 大幅改修 | モーダル追加、カラム分割 |
| `scripts/test-scout-slot-creation.ts` | 新規 | E2E テスト |

---

## 9. 変更禁止ファイル

以下は触っていない:
- `src/constants/candidate-flags.ts`
- `specs/` 配下
- `scripts/gas/` 配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`

`candidate-flags.ts` に「機械」という文字列があるが、これは業種マスタの「メーカー / 機械・電気・電子」等の文脈で、スカウト大フラグとは無関係。
