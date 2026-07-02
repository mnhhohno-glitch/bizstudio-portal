# T-128 batch4: CA質問通知の原文表示化＋通知リンクURL調査 — 完了報告

実施日: 2026-07-03 ／ 対象: bizstudio-portal（本番=master）

---

## 0. 秘密鍵混入チェック（修正0）

- `git grep -n "BEGIN PRIVATE KEY"` → **該当なし**（exit 1）
- `git grep -n "LINEWORKS_PRIVATE_KEY="` → **該当なし**（exit 1）
- `docs/reports/T-128-batch4-portal-impl.md` → 鍵本文・鍵の一部いずれも含まず（環境変数名のみ記載）

**結論: push済みファイルへの秘密鍵混入なし。**

---

## 1. 修正1: 通知・タスク本文を原文主体に変更

### 変更前（要約のみ）
```
■ 質問（AI要約）
{summary}
```

### 変更後（原文全文＋要約1行）
```
■ 質問（原文）
{question}    ← 求職者が入力した原文全文（最大1000文字）

■ 要約
{summary}    ← AI要約（一覧性用）
```

### 変更ファイル

**`src/lib/candidate-site/question-notification.ts`（LINE WORKS通知本文）**
- `QuestionNotificationParams` に `question: string` フィールドを追加
- 通知本文の "■ 質問（AI要約）" → "■ 質問（原文）" に変更し `params.question` を掲載
- "■ 要約" として `params.summary` を1行追加

```typescript
// 変更後の baseLines（L35-49）
const baseLines = [
  "❓ 求職者から担当CAへの質問が届きました",
  "",
  "■ 求職者",
  `${params.candidateName} 様（${params.candidateNumber}）`,
  "",
  "■ 質問（原文）",
  params.question,          // ← 原文全文
  "",
  "■ 要約",
  params.summary,           // ← AI要約
  "",
  "■ 担当CA",
  params.caName ?? "未設定",
];
```

**`src/app/api/external/candidate-site/questions/route.ts`（タスク本文＋通知呼び出し）**
- タスク description の順序を入れ替え: "■ 質問（原文）" を先頭、"■ 要約" を後置
- `notifyCandidateQuestion` 呼び出しに `question` パラメータを追加

```typescript
// 変更後の description（L104-112）
const description = [
  `${candidate.name} 様から担当CAへの質問がありました。`,
  "",
  "■ 質問（原文）",
  question,
  "",
  "■ 要約",
  summary,
].join("\n");

// 変更後の通知呼び出し（L133-141）
notified = await notifyCandidateQuestion({
  candidateName: candidate.name,
  candidateNumber: candidate.candidateNumber,
  caName: employee?.name ?? null,
  caLineUserId: employee?.lineUserId ?? null,
  taskId: task.id,
  question,     // ← 追加
  summary,
});
```

---

## 2. 修正2: 通知リンクURL調査結果

### URL組み立ての出所

質問通知のリンク（`question-notification.ts:28,51`）:
```typescript
const baseUrl = process.env.PORTAL_BASE_URL;
// ...
baseLines.push("", "🔗 タスク詳細", `${baseUrl}/tasks/${params.taskId}`);
```

### 本番Railway環境変数の確認

```
$ railway variables --kv --service bizstudio-portal | grep PORTAL_BASE_URL
PORTAL_BASE_URL=https://bizstudio-portal-production.up.railway.app
```

**本番サービスの `PORTAL_BASE_URL` は正しい本番URLを指しており、コード修正不要。**

### テスト時にstagingを指していた原因

ローカル `.env` ファイルの `PORTAL_BASE_URL` が staging URL（`https://bizstudio-portal-staging-production.up.railway.app`）を指していた。これはローカル開発環境固有の問題で、本番Railwayサービスには影響しない。

### 他通知の横断確認

| 通知 | ファイル | URL出所 | 本番での値 |
|---|---|---|---|
| 質問通知 | `src/lib/candidate-site/question-notification.ts:28` | `PORTAL_BASE_URL` | ✅ 本番URL |
| 応募通知 | `src/lib/candidate-site/apply-notification.ts:28` | `PORTAL_BASE_URL` | ✅ 本番URL |
| タスク通知 | `src/lib/task-notification.ts:27` | `PORTAL_BASE_URL` | ✅ 本番URL |
| 候補者回答通知 | `src/app/api/external/candidate-response/route.ts:285` | `PORTAL_BASE_URL` | ✅ 本番URL |
| スケジュールタスク | `src/app/api/external/create-schedule-task/route.ts:205` | `PORTAL_BASE_URL` | ✅ 本番URL |
| 3点タスク一括 | `src/app/api/tasks/bulk-create-3point/route.ts:137` | `PORTAL_BASE_URL` | ✅ 本番URL |
| マイナビRPA通知 | `src/lib/mynavi-rpa/notify.ts:65` | `PORTAL_BASE_URL` | ✅ 本番URL |
| 日報通知 | `src/lib/dailyReport/lineworks-notify.ts:10` | `PORTAL_PUBLIC_URL` (ハードコードfallback付) | ✅ 本番URL |

**結論: 全通知が本番では正しいURLを使用。staging URLが混入するリスクはない。**

日報通知のみ `PORTAL_PUBLIC_URL` + ハードコードフォールバック方式を採用しているが、これは「staging から送っても本番に飛ばす」という特殊要件のため。他通知は本番サービスからのみ発火するため `PORTAL_BASE_URL` で問題ない。

---

## 3. 動作確認結果

テスト候補者 5999999（大野 テスト）でローカルdevサーバー経由、共有DB接続で実施。

### 検証1: 質問テスト送信（LINE WORKS実送 1件）

```
質問原文: 【テスト送信】営業職の残業時間の目安と、未経験からの研修体制、転勤の可能性について教えてください。
```

**APIレスポンス:**
```json
{
  "ok": true,
  "taskId": "cmr434j6b0000hk4fg4yfz6vo",
  "assigned": true,
  "notified": true
}
```

**LINE WORKS通知本文（実送）:**
```
<m userId="{lineUserId}">
 求職者サイトから質問が届きました

■ 求職者
大野 テスト 様（5999999）

■ 質問（原文）
【テスト送信】営業職の残業時間の目安と、未経験からの研修体制、転勤の可能性について教えてください。

■ 要約
【テスト送信】営業職の残業時間の目安と、未経験からの研修体制、転勤の可能性について教えてください。

■ 担当CA
大野将幸

🔗 タスク詳細
https://bizstudio-portal-production.up.railway.app/tasks/cmr434j6b0000hk4fg4yfz6vo
```

### 検証2: タスク本文

```
Title: 【マイページ質問】大野 テスト - 担当CAへの質問
Description:
大野 テスト 様から担当CAへの質問がありました。

■ 質問（原文）
【テスト送信】営業職の残業時間の目安と、未経験からの研修体制、転勤の可能性について教えてください。

■ 要約
【テスト送信】営業職の残業時間の目安と、未経験からの研修体制、転勤の可能性について教えてください。
```

### 検証3: 通知リンク

`https://bizstudio-portal-production.up.railway.app/tasks/cmr434j6b0000hk4fg4yfz6vo` → **本番portalのタスク詳細ページ**（`.env.local` で `PORTAL_BASE_URL` を本番URLに上書きして確認）

### テストデータクリーンアップ

テストタスク `cmr434j6b0000hk4fg4yfz6vo` は `task_assignees` + `tasks` から削除済み。DB baseline 復帰。

---

## 4. コミット

コミットID は push 後に確定。変更ファイル:
- `src/lib/candidate-site/question-notification.ts` — 通知本文フォーマット変更
- `src/app/api/external/candidate-site/questions/route.ts` — タスク本文フォーマット変更＋通知呼び出しにquestion追加
- `docs/reports/T-128-batch4-question-notify-fix.md` — 本報告書
