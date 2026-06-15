# T-064 スカウト集計失敗通知 API 完了報告書

実装日: 2026-05-24
PR: https://github.com/mnhhohno-glitch/bizstudio-portal/pull/15
本番反映: master → staging マージ済（commit `71d0146`）

---

## 背景

7号機 PAD で毎朝 7:00 に動く「03.スカウト配信実績集計」が失敗した場合、LINE WORKS トークルームに通知する仕組みを追加。既存の応募者一次返信フロー（batch-start / batch-finish）と同じパターンを踏襲。

---

## 完了条件チェックリスト

| # | 項目 | 結果 |
|--|--|--|
| 1 | 既存 LINE WORKS 通知実装の把握完了 | ✅ `src/lib/mynavi-rpa/notify.ts` パターン確認 |
| 2 | `src/app/api/rpa/scout/import-failed/route.ts` 新規作成 | ✅ |
| 3 | テスト作成 | ✅ `scripts/test-scout-import-failed.ts` |
| 4 | 既存 API への影響なし | ✅ batch-start / batch-finish 変更なし |
| 5 | master マージ済 | ✅ PR #15 |
| 6 | staging マージ済 | ✅ commit `71d0146` |
| 7 | Railway デプロイ完了確認 | ✅ (route 登録確認) |
| 8 | 完了報告書作成 | ✅ 本ファイル |

---

## 新規 API 仕様

```
POST /api/rpa/scout/import-failed
Headers:
  x-rpa-secret: <secret>
  Content-Type: application/json

Body:
{
  "targetDate": "2026-05-25",
  "errorMessage": "2号機ファイルアクセス失敗",
  "processLog": [
    "OK: 1号機 当日 157件 (スキャン 196 行)",
    "ERROR: 2号機 ファイルが他のプログラムによって使用されています"
  ]
}
```

| フィールド | 型 | 必須 | 説明 |
|--|--|--|--|
| `targetDate` | string | はい | 対象日（YYYY-MM-DD） |
| `errorMessage` | string | はい | エラー概要（短文） |
| `processLog` | string[] | いいえ | 詳細ログ（最大20件） |

### レスポンス

```json
{ "status": "NOTIFIED", "targetDate": "2026-05-25" }
```

LINE WORKS 環境変数未設定時:
```json
{ "status": "SKIPPED", "targetDate": "2026-05-25", "reason": "LINE WORKS credentials not configured" }
```

---

## LINE WORKS 通知メッセージフォーマット

```
🚨 スカウト配信実績集計 失敗
対象日: 2026-05-25

エラー: 2号機ファイルアクセス失敗

詳細:
OK: 1号機 当日 157件 (スキャン 196 行)
ERROR: 2号機 ファイルが他のプログラムによって使用されています
```

### 送信先

既存の「マイナビ転職応募取り込み」トークルーム（`LINEWORKS_MYNAVI_BOT_ID` / `LINEWORKS_MYNAVI_CHANNEL_ID`）

---

## 既存通知パターンとの整合性

| 既存エンドポイント | 通知内容 | チャネル |
|--|--|--|
| `/api/rpa/mynavi/batch-start` | バッチ開始 | MYNAVI チャネル |
| `/api/rpa/mynavi/batch-finish` | バッチ完了 | MYNAVI チャネル |
| **`/api/rpa/scout/import-failed`** | **スカウト集計失敗** | **MYNAVI チャネル（同じ）** |

認証方式: 全て `x-rpa-secret` ヘッダ（`verifyRpaSecret()`）

---

## PAD 側のサンプルリクエスト

```
URL: https://bizstudio-portal-staging-production.up.railway.app/api/rpa/scout/import-failed
Method: POST
Headers:
  x-rpa-secret: <RPA_SECRET>
  Content-Type: application/json
Body:
{
  "targetDate": "%todayStr%",
  "errorMessage": "%errorSummary%",
  "processLog": %processLogList%
}
```

PAD 側の実装:
1. 「03.スカウト配信実績集計」の各号機処理でエラーが発生したら `%processLogList%` に追記
2. 全号機処理後にエラーがあれば本 API を呼び出し
3. `%errorSummary%` は最初に発生したエラーの要約

---

## 実装ファイル一覧

| ファイル | 種別 | 内容 |
|--|--|--|
| `src/app/api/rpa/scout/import-failed/route.ts` | 新規 | 失敗通知エンドポイント |
| `scripts/test-scout-import-failed.ts` | 新規 | 疎通テスト（HTTP 経由） |

---

## 既存 API への影響

変更なし。全て新規追加のみ。
