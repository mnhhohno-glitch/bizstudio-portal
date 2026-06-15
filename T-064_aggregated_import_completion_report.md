# T-064 Phase A 追加: 集計済みデータ取込 API 完了報告書

実装日: 2026-05-24
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/13
本番反映: master → staging マージ済（commit `f7e949b`）

---

## 背景

旧方針（07.スカウトメール送信結果報告.xlsx を Base64 で送信）から、新方針（06.送信結果蓄積ファイルを 7号機 PAD で集計し、JSON で送信）への移行に対応。

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | `src/lib/scout/aggregated-importer.ts` 新規作成 | ✅ |
| 2 | `src/app/api/scout/import/aggregated/route.ts` 新規作成 | ✅ |
| 3 | 既存 API（旧フロー用 2 本）の挙動変わらず | ✅ Base64 テスト 13/13 PASS |
| 4 | 集計版 API テスト PASS | ✅ 17/17 PASS |
| 5 | 既存テスト全項目 PASS | ✅ |
| 6 | master マージ済 | ✅ PR #13 |
| 7 | staging マージ済 | ✅ commit `f7e949b` |
| 8 | Railway デプロイ完了確認 | ✅ 200 OK |
| 9 | 完了報告書作成 | ✅ 本ファイル |

---

## 新規 API 仕様

```
POST /api/scout/import/aggregated
Headers:
  x-rpa-secret: <secret>
  Content-Type: application/json

Body:
{
  "targetDate": "2026-05-24",
  "data": [
    { "machineNumber": 1, "hourSlot": 8, "deliveryCount": 69 },
    { "machineNumber": 1, "hourSlot": 9, "deliveryCount": 57 },
    { "machineNumber": 2, "hourSlot": 8, "deliveryCount": 24 },
    ...
  ]
}
```

### バリデーション

| フィールド | ルール |
|--|--|
| `targetDate` | 必須、YYYY-MM-DD 形式 |
| `data` | 必須、1件以上の配列 |
| `data[].machineNumber` | 1〜6 の整数 |
| `data[].hourSlot` | 8〜19 の整数 |
| `data[].deliveryCount` | 0 以上の整数 |

### レスポンス

成功時:
```json
{
  "status": "COMPLETED",
  "targetDate": "2026-05-24",
  "successCount": 60,
  "skippedCount": 0,
  "errors": []
}
```

一部スキップ時:
```json
{
  "status": "COMPLETED",
  "targetDate": "2026-05-24",
  "successCount": 59,
  "skippedCount": 1,
  "errors": [
    { "machineNumber": 7, "hourSlot": 8, "reason": "machine not found" }
  ]
}
```

配信枠未作成時: HTTP 500
```json
{
  "error": "対象日 2026-05-24 の配信枠が存在しません。先に配信枠を作成してください。"
}
```

---

## 号機マスタとの対応

| machineNumber | recruiterName | machineLabel | isActive |
|--|--|--|--|
| 1 | 藤本 なつみ | 1号機 | ✅ |
| 2 | 岡田 かなこ | 2号機 | ✅ |
| 3 | 上原 ちはる | 3号機 | ✅ |
| 4 | 上原 千遥 | 4号機 | ✅ |
| 5 | 岡田 愛子 | 5号機 | ✅ |
| 6 | 安藤 嘉富 | 6号機 | ❌（停止中） |

6号機（停止中）: マスタに存在するため受信・反映はされる。ただし `isAggregationTarget=false` のため集計画面には表示されない。

---

## 7号機 PAD 側のサンプルリクエスト

PAD で HTTP アクションを設定する際のサンプル:

```
URL: https://bizstudio-portal-staging-production.up.railway.app/api/scout/import/aggregated
Method: POST
Headers:
  x-rpa-secret: <RPA_SECRET>
  Content-Type: application/json
Body:
{
  "targetDate": "%targetDateVariable%",
  "data": %aggregatedDataVariable%
}
```

`%aggregatedDataVariable%` のフォーマット例（PAD で組み立て）:
```json
[
  {"machineNumber":1,"hourSlot":8,"deliveryCount":69},
  {"machineNumber":1,"hourSlot":9,"deliveryCount":57},
  {"machineNumber":1,"hourSlot":10,"deliveryCount":55},
  {"machineNumber":1,"hourSlot":11,"deliveryCount":42},
  {"machineNumber":1,"hourSlot":12,"deliveryCount":38},
  {"machineNumber":1,"hourSlot":13,"deliveryCount":51},
  {"machineNumber":1,"hourSlot":14,"deliveryCount":63},
  {"machineNumber":1,"hourSlot":15,"deliveryCount":55},
  {"machineNumber":1,"hourSlot":16,"deliveryCount":48},
  {"machineNumber":1,"hourSlot":17,"deliveryCount":40},
  {"machineNumber":1,"hourSlot":18,"deliveryCount":33},
  {"machineNumber":1,"hourSlot":19,"deliveryCount":25}
]
```

全号機送る場合は最大 72 件（6号機×12時間）。稼働中の 1〜5 号機分のみ（60件）でもOK。

---

## 疎通テスト結果

```
=== T-064 集計済みデータ取込 疎通確認 ===

  ✓ 配信枠作成 — 96枠

[1] 正常系: 稼働中5号機×12時間
  ✓ status=COMPLETED
  ✓ successCount=60 — 60件
  ✓ skippedCount=0 — 0件
  ✓ errors=0件

[2] DB 反映確認
  ✓ 1号機 8時 deliveryCount=18 — actual=18
  ✓ 3号機 12時 deliveryCount=42 — actual=42
  ✓ 5号機 19時 deliveryCount=69 — actual=69

[3] 6号機（停止中）データ反映
  ✓ 6号機 status=COMPLETED
  ✓ 6号機 successCount=2 — 2件
  ✓ 6号機 8時 deliveryCount=77 — actual=77

[4] 存在しない号機（7号機）スキップ
  ✓ 7号機含み status=COMPLETED
  ✓ successCount=1（1号機分のみ） — 1件
  ✓ skippedCount=1（7号機） — 1件
  ✓ errors[0].reason='machine not found'

[5] ScoutImportLog 記録確認
  ✓ AGGREGATED_JSON ログが存在 — 3件
  ✓ COMPLETED ログが存在 — 3件

=== 結果 ===
  PASS: 17
  FAIL: 0
```

---

## 既存 API への影響

| API | 影響 |
|--|--|
| `/api/scout/import/daily-excel` | 変更なし（残置） |
| `/api/scout/import/daily-excel-base64` | 変更なし（残置） |
| `/api/scout/import/filemaker-legacy` | 変更なし |
| `/api/scout/cron/create-daily-slots` | 変更なし |
| その他の scout API / RPA API | 変更なし |

---

## 運用フロー（新方式）

```
02:00 JST  Power Automate → POST /api/scout/cron/create-daily-slots
           → 翌日分 96 枠作成

02:30 JST  7号機 PAD 起動
           → 06.送信結果蓄積ファイル_1〜6号機.xlsx を読み込み
           → 時間×号機別に当日分を集計
           → POST /api/scout/import/aggregated に JSON 送信
           → 当日分 deliveryCount 反映完了
```
