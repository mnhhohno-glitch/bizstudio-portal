# T-064 集計済みデータ取込 API 改修: 配信枠自動作成オプション 完了報告書

実装日: 2026-05-24
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/14
本番反映: master → staging マージ済（commit `e12a428`）

---

## 背景

過去データ（1/11〜5/23 の約134日分）を取り込む際、対象日の配信枠を手動で作成するのは非現実的。集計データ送信時に配信枠が存在しなければ自動作成するオプションを追加。

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | `src/lib/scout/slot-creator.ts` 新規作成 | ✅ |
| 2 | `create-daily-slots/route.ts` リファクタ後も同じ挙動 | ✅ |
| 3 | `autoCreateSlots` オプション追加 | ✅ |
| 4 | 自動作成テスト PASS | ✅ 14/14 PASS |
| 5 | 既存テスト全項目 PASS | ✅ 17/17 PASS |
| 6 | master マージ済 | ✅ PR #14 |
| 7 | staging マージ済 | ✅ commit `e12a428` |
| 8 | Railway デプロイ完了確認 | ✅ 200 OK |
| 9 | 完了報告書作成 | ✅ 本ファイル |

---

## API 仕様変更

### 変更前
```json
POST /api/scout/import/aggregated
{ "targetDate": "2026-01-15", "data": [...] }
```
配信枠未作成時: HTTP 500 エラー

### 変更後
```json
POST /api/scout/import/aggregated
{ "targetDate": "2026-01-15", "data": [...], "autoCreateSlots": true }
```

| パラメータ | 型 | デフォルト | 説明 |
|--|--|--|--|
| `autoCreateSlots` | boolean | `false` | `true`: 配信枠未作成時に自動作成（96枠） |

### レスポンス（自動作成時）
```json
{
  "status": "COMPLETED",
  "targetDate": "2026-01-15",
  "successCount": 60,
  "skippedCount": 0,
  "slotsAutoCreated": 96,
  "errors": []
}
```

- `slotsAutoCreated`: 自動作成した枠数（自動作成しなかった場合はフィールド自体が省略）

---

## 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/lib/scout/slot-creator.ts` | 新規 | `createSlotsForDate(dateStr)` 共通関数 |
| `src/app/api/scout/cron/create-daily-slots/route.ts` | 改修 | 共通関数呼び出しにリファクタ |
| `src/lib/scout/aggregated-importer.ts` | 改修 | `autoCreateSlots` パラメータ追加 |
| `src/app/api/scout/import/aggregated/route.ts` | 改修 | `autoCreateSlots` をパース・転送 |
| `scripts/test-scout-aggregated-auto-create.ts` | 新規 | 疎通テスト |

---

## PAD 側での過去データ取り込みサンプルリクエスト

```
POST /api/scout/import/aggregated
Headers:
  x-rpa-secret: <RPA_SECRET>
  Content-Type: application/json

Body:
{
  "targetDate": "2026-01-15",
  "autoCreateSlots": true,
  "data": [
    {"machineNumber":1,"hourSlot":8,"deliveryCount":69},
    {"machineNumber":1,"hourSlot":9,"deliveryCount":57},
    ...
    {"machineNumber":5,"hourSlot":19,"deliveryCount":25}
  ]
}
```

134日分を一括で取り込む場合は、PAD 側で日付をループして 134回 POST する。各リクエストで `autoCreateSlots: true` を指定すれば、配信枠の事前作成は不要。

---

## 疎通テスト結果

```
=== T-064 autoCreateSlots 疎通確認 ===

[1] autoCreateSlots=true — 枠未作成日にデータ送信
  ✓ status=COMPLETED
  ✓ successCount=60 — 60件
  ✓ slotsAutoCreated=96 — 96枠
  ✓ 1号機 8時 deliveryCount=18 — actual=18
  ✓ 全枠96件存在 — 96件

[2] 同じ日に再度送信 — 枠既存、データ上書き
  ✓ status=COMPLETED
  ✓ successCount=1 — 1件
  ✓ slotsAutoCreated=undefined（枠既存） — undefined
  ✓ 1号機 8時 deliveryCount=999 に上書き — actual=999

[3] autoCreateSlots=false — 枠なし日にデータ送信 → エラー
  ✓ エラーメッセージに '配信枠が存在しません' 含む
  ✓ 例外がスローされた

[4] createSlotsForDate — 重複防止
  ✓ 初回作成 status=CREATED — 96枠
  ✓ 再実行 status=SKIPPED
  ✓ 再実行 createdCount=0

=== 結果 ===
  PASS: 14
  FAIL: 0
```

---

## 既存 API への影響

| API | 影響 |
|--|--|
| `/api/scout/cron/create-daily-slots` | 内部リファクタのみ、入出力・挙動変更なし |
| `/api/scout/import/aggregated`（autoCreateSlots 未指定時） | 変更なし |
| `/api/scout/import/daily-excel` | 変更なし |
| `/api/scout/import/daily-excel-base64` | 変更なし |
| その他の scout API / RPA API | 変更なし |
