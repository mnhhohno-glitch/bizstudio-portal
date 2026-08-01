# T-150 運用メモ — AI起票タスクの期日リマインド（朝バッチ）

対象: `.github/workflows/t150-task-due-reminder.yml` / `POST /api/internal/tasks/due-reminder` / `src/lib/t150-due-reminder.ts`

## 何をするものか

AIアドバイザーとの会話から起票されたタスク（`tasks.source = "AI_ADVISOR"`）のうち、

- **期日が今日のもの**
- **期日を過ぎていて、まだ完了していないもの**（完了するまで毎朝）

を LINE WORKS のタスク通知トークルームへ **1通にまとめて** 送る。

| 項目 | 値 |
|--|--|
| 実行時刻 | 毎日 **JST 07:00**（cron `0 22 * * *` = UTC 22:00） |
| 呼び先 | `https://bizstudio-portal-production.up.railway.app/api/internal/tasks/due-reminder` |
| 認証 | `x-api-key: ${{ secrets.INTERNAL_API_KEY }}`（auto-expire / resubmit-stale と同一シークレット） |
| 通知先 | `LINEWORKS_TASK_BOT_ID` / `LINEWORKS_TASK_CHANNEL_ID` のトークルーム（担当者は `<m userId>` メンション） |

## ★ 通知対象は AI起票分のみ

対象条件は `src/lib/t150-due-reminder.ts` の `buildDueReminderWhere()` **1箇所に集約**している。

```ts
{ source: "AI_ADVISOR", status: { not: "COMPLETED" }, dueDate: { not: null, lt: JST翌日0:00 } }
```

**手動タスク（`source = NULL`）は対象外。** 本番実測（2026-08-02）では未完了かつ期日ありのタスク60件が
**すべて期日超過**の状態で担当者4名に紐づいており、全タスクを対象にすると初日の朝に60件が飛び、
完了されるまで毎朝繰り返す。通知そのものが無視される機能になるため、意図的に絞っている。

将来「全タスク対象」に広げたくなった場合は、`buildDueReminderWhere()` だけを変更すれば足りる。
ただし**広げる前に、まず既存の期日超過タスクを片付ける運用を回すこと**（でないと初日に溢れる）。

1回の実行で本文に列挙するのは最大 **20件**（`DUE_REMINDER_MAX_ITEMS`）。超過分は「…ほか N 件」に畳む。

## ★ 止まっても気づけない（最重要の運用注意）

- **失敗時は GitHub Actions 上で赤くなるだけで、通知は飛ばない。** 既存の auto-expire / resubmit-stale も同じ設計。
- **schedule 自体が動かなくなった場合は検知できない。** GitHub の仕様として、
  **リポジトリが60日間非アクティブだと scheduled workflow は自動的に無効化される。**
- 本機能は「通知が来ない」状態が
  **「対象タスクが無い」のか「cron が死んでいる」のか区別できない**性質を持つ。
  作成時通知（`notifyAiTaskCreated`）と違い、無音が正常状態にもなりうる。

→ **朝通知が数日来ない場合は、GitHub Actions の実行履歴（Actions タブ → "T-150 task due reminder"）を確認すること。**
　 実行履歴自体が無ければ schedule が止まっている。

## 手動実行の方法（安全）

1. GitHub の **Actions** タブ → 左メニューの **"T-150 task due reminder (daily 07:00 JST)"** を開く
2. **Run workflow** → `dry_run` に **`true`** を選んで実行
3. ログの `=== Summary ===` で対象件数・担当者別内訳を確認できる

`dry_run=true` は**送信しない**（DBも変更しない）ので、いつ実行しても安全。
実際に送りたい場合のみ `dry_run=false` を選ぶ。定時実行（schedule）は常に `dry_run=false`。

API を直接叩く場合:

```bash
curl -sS -X POST "https://bizstudio-portal-production.up.railway.app/api/internal/tasks/due-reminder?dry_run=true" \
  -H "x-api-key: $INTERNAL_API_KEY" | jq .
```

## レスポンスの見方

| フィールド | 意味 |
|--|--|
| `mode` | `DRY-RUN` / `EXECUTE` |
| `jstToday` | 判定に使った JST 暦日 |
| `source` | 対象の起票元（`AI_ADVISOR`） |
| `total` / `dueToday` / `overdue` | 対象総数 / 当日期日 / 期日超過 |
| `listed` / `truncated` | 本文に列挙した件数 / 畳んだ件数 |
| `byAssignee` | 担当者別件数と `lineworksId` の有無 |
| `items` | 各タスクの `taskId` / `title` / `candidateName` / `dueDate` / `overdueDays` |
| `sent` | 実際に送信したか（DRY-RUN では常に false） |

## LINE WORKS ID 未設定の担当者

本番の active ユーザー9名中 **2名が `lineworks_id` 未設定**。
メンションできない場合は既存通知と同じ3段フォールバックで動く。

1. `lineworksId` のあるユーザーだけメンション
2. メンション送信に失敗したら、担当者名プレフィックス付きでメンションなし再送
3. 担当者名も無ければ素の本文

→ 未設定の担当者には**メンション通知が飛ばない**（本文中の担当者名で拾ってもらう形）。
　 確実に届かせたい場合は `users.lineworks_id` を設定すること。

## 関連

- 作成時通知: `notifyAiTaskCreated`（`src/lib/task-notification.ts`）
- 期日リマインド通知: `notifyAiTaskDueReminder`（同上）
- 起票API: `src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/[messageId]/suggested-tasks/route.ts`
- 罠#17（JST）: 曜日・暦日判定は `src/lib/schedule-agent/jst.ts` の `jstYmd()` 経由。
  Railway は UTC 稼働のため `new Date().getDay()` / `toISOString().slice(0,10)` は使わない。
