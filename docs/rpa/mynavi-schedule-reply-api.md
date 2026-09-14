# 日程調整のマイナビ返信 API（7号機RPA 向け手順書）

対象: 日程調整の返信をマイナビのメッセージで送る RPA（7号機）
ポータル側担当: 大野 将幸
版: 2026-09-14（T-196 step1 = コミット 9074848 / 追補「送信結果が不明」を反映）

---

## 0. 概要

日程調整フォームの申し込みを受けると、ポータルは返信の文面・件名・マイナビ会員No. をタスクに積みます。
**送信そのものはポータルでは行いません**。7号機RPA が取りに来て、マイナビの画面で送り、結果を返します。

| 用途 | メソッド | パス |
|--|--|--|
| 送信待ちの取得 | GET | `/api/rpa/mynavi/schedule-reply/pending?limit=10` |
| 結果の報告 | POST | `/api/rpa/mynavi/schedule-reply/complete` |

- ベースURL（本番）: `https://bizstudio-portal-production.up.railway.app`
- 認証: リクエストヘッダ `x-rpa-secret: <共有済みの値>`（既存 `/api/rpa/mynavi/*` と同じ値）。不一致は **HTTP 401**。
- 日時は JST。

---

## 1. 送信待ちの取得 `GET /api/rpa/mynavi/schedule-reply/pending`

クエリ `limit`（任意・既定 10・上限 50）。

```json
{
  "items": [
    {
      "taskId": "clx...",
      "candidateName": "山田 太郎",
      "memberNo": "1234567890",
      "subject": "面談日程のご連絡",
      "text": "山田 太郎 様\n……",
      "createdAt": "2026-09-14T18:00:00+09:00"
    }
  ]
}
```

返さない行（＝RPA が触らなくてよい行）:

- 送信済み（`success` を報告済み）
- 申し込みから 7 日より古い
- 失敗（`failed`）の報告が 3 回に達した
- **送信結果が不明（`unconfirmed`）を1回でも報告した** ← 追補で追加。人が目視確認します

---

## 2. 結果の報告 `POST /api/rpa/mynavi/schedule-reply/complete`

```json
{ "taskId": "clx...", "result": "success" }
```

`result` は次の3つ。**`taskId` は pending で受け取った値をそのまま返してください。**

| result | 使う場面 | ポータル側の動き |
|--|--|--|
| `success` | 「送信しました」が確認できた | 送信済みとして打刻。以後 pending に出ない |
| `failed` | 送信できなかった（画面に到達できない・エラー表示など、**送れていないと分かる**とき） | 打刻しない＝次回また pending に出る。3回で打ち切り |
| `unconfirmed` | 「送信する」は押したが**送れたか分からない**（「送信しました」を拾えなかった） | 打刻しない。要目視確認として記録し、pending から外して担当者へ通知 |

`note`（任意・文字列）は状況の説明。`failed` / `unconfirmed` のときはできるだけ入れてください。タスクのコメントに残ります。

### `unconfirmed` の例

```json
{
  "taskId": "clx...",
  "result": "unconfirmed",
  "note": "送信後に「メッセージを送信しました」を20秒待っても表示されず"
}
```

レスポンス:

```json
{ "ok": true, "status": "unconfirmed" }
```

- **`unconfirmed` を報告した行に、RPA が再度触ることはありません。**（自動再送はしません）
- 同じ行に `unconfirmed` を二度報告しても、通知とコメントは1回だけです（`ok: true` は返ります）。
- ポータルは担当者へ LINE WORKS で「要目視確認」を通知します。人がマイナビのメール履歴を見て、
  未送信なら手動で送ります。タスク詳細には赤いバッジ「要目視確認：マイナビ返信が送れたか不明」が出ます。

> 以前の版にあった「送れたか分からないときは `failed` を報告」は **廃止** しました。
> `failed` は次回また pending に出るため、実際には送れていた人へ同じメッセージが最大3通届いてしまいます。
> **送れたか分からないときは必ず `unconfirmed`** を報告してください。

### レスポンス（`success` / `failed`）

```json
{ "ok": true, "alreadySent": false, "sentAt": "2026-09-14T18:05:00+09:00" }
```

- すでに送信済みの行に `success` を報告した場合は `alreadySent: true` が返ります（二重に打刻しません）。
- `failed` は `alreadySent: false` / `sentAt: null` 固定です。

### エラー

| 状況 | HTTP |
|--|--|
| `x-rpa-secret` 不一致 | 401 |
| `taskId` が空 | 400 |
| `result` が上記3つ以外 | 400 |
| `taskId` のタスクが無い | 404 |
