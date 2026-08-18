# T-167 一次返信の送信失敗を検知できるようにする — 現状調査（portal 側 / Step1）

- 調査日: 2026-08-18
- 対象リポジトリ: bizstudio-portal（branch master）
- 調査範囲: コード読み取り・Railway 本番ログ確認・本番DB SELECT のみ。**製品コードの変更・マイグレーション・DB書き込みは一切行っていない。**
- 前提（依頼元より）: 未送信の直接原因は PAD 側「物理クリックを送信」の空振りであり、portal 側にバグがあったわけではない。本調査は「RPA の誤報告を portal 側で検知できるようにする」ための改修範囲の洗い出しが目的。

---

## 1. 結論サマリ

### 調査対象0 の結果 — 現在 `"FAILED"` が飛んだときに実際に起きること

**HTTP 200 が返り、`sendResult` は `"SUCCESS"` に化けて DB に書き込まれる。** `src/app/api/rpa/mynavi/reply-sent/route.ts:38-39` が
`body?.sendResult === "FAILURE" ? "FAILURE" : "SUCCESS"` という「`FAILURE` 完全一致以外は全部 SUCCESS」判定のため、`"FAILED"` は else 側に落ちる。
結果 `MynaviRpaProcessingLog.replyResult = "SUCCESS"` / `CandidateSettingsHistory.sendResult = "SUCCESS"` が作られ、**送信失敗が成功として永久に記録される**（400 にはならない。ログにも一切残らない）。

`"SUCCESS"` / `"FAILED"` 以外の値も同じ else 側に落ちるため、挙動は完全に同一:

| RPA が送る値 | portal の解釈 | HTTP | DB書き込み |
|--|--|--|--|
| `"SUCCESS"` | SUCCESS | 200 | replyResult=SUCCESS / sendResult=SUCCESS |
| `"FAILED"`（← 今回 RPA が公開済み） | **SUCCESS** | 200 | 同上（誤記録） |
| `""`（PAD 変数未設定） | **SUCCESS** | 200 | 同上（誤記録） |
| `"%送信結果%"`（変数展開失敗） | **SUCCESS** | 200 | 同上（誤記録） |
| `"FAILURE"` | FAILURE | 200 | replyResult=FAILURE / sendResult=FAILURE |

つまり **RPA 側の `"FAILED"` は portal に一切届いていないのと同じ**。portal が失敗として受け取れる文字列は `"FAILURE"` のみ。

### 緊急対処の要否

**実害は「今と同じ（＝失敗を検知できない）」であり、RPA 側変更によって新たに壊れるものはない。**

- 400 やエラーにはならないので、RPA フローが止まる／処理ログが欠落するといった二次被害は発生しない。
- ただし **RPA 側の改修（`"FAILED"` を送る）は現時点で完全に無効化されている**。portal を直すまでは「RPA は失敗を報告しているのに portal が握り潰す」状態が続く。
- 「至急コードを止める」類の緊急性はない。**が、RPA 側改修の効果がゼロなので、未対応期間はこれまでと同じリスクを負い続ける。**

### `sendResult` を見ているか

**見ている（ただし `"FAILURE"` 完全一致のみ）。** 値は分岐に使われ、そのまま2テーブルに保存される。ハードコード固定ではないが、`"FAILED"` を含む `"FAILURE"` 以外の全ての値が `"SUCCESS"` にフォールバックする実装。

### 通知先

**LINE WORKS**（Chatwork ではない）。実装 `src/lib/mynavi-rpa/notify.ts`、環境変数 `LINEWORKS_MYNAVI_BOT_ID` / `LINEWORKS_MYNAVI_CHANNEL_ID`。
**repo 内に Chatwork 連携のコードは存在しない**（`src/` `prisma/` `docs/` `scripts/` を `chatwork` で grep してヒット0件）。

---

## 2. A. reply-sent API の現状

対象: `src/app/api/rpa/mynavi/reply-sent/route.ts`

### A-1. リクエストボディの受け口

| フィールド | 読んでいるか | 行 | 備考 |
|--|--|--|--|
| `processingLogId` | ○ | 37 | `String(body?.processingLogId \|\| "")`。空なら 400 |
| `candidateId` | ○ | 61-62 | 空なら処理ログの `candidateId` にフォールバック |
| `sentAt` | ○ | 40 | `parseDateLoose()`。パース不能なら `new Date()` |
| `sendResult` | ○ | 38-39 | `"FAILURE"` 完全一致のみ FAILURE、他は全部 SUCCESS |

**query params へのフォールバックあり。** `src/lib/mynavi-rpa/parse-request-body.ts` が
①素のJSON → ②URLエンコードされたJSON（PAD の標準挙動）→ ③form-urlencoded → ④URLクエリパラメータ の順で解決する。
ボディが取れなかった場合のみ query を採用（ボディに無いキーのみ補完）。

### A-2. `sendResult` を分岐に使っているか

使っている（38-39行）。ただし前述のとおり `"FAILURE"` 以外は全て `"SUCCESS"` に潰れる。
`"SUCCESS"` を明示的にハードコードしている箇所は無いが、**実質的に「デフォルト SUCCESS」**である。

なお `templateName` / `senderName` は route 内の定数ハードコード（10-11行）:
- `TEMPLATE_NAME = "【日程調整】初回メッセージ"`
- `SENDER_NAME = "藤本 夏海"`

### A-3. 書き込み先（全列挙）

**(1) `MynaviRpaProcessingLog` の更新（64-67行）** — 更新カラムは以下の2つのみ:

```ts
data: { replySentAt: sentAt, replyResult: sendResult }
```

`status` / `canSendReply` / `errorMessage` / `reason` は**一切触らない**。

**(2) `CandidateSettingsHistory` の insert（75-84行）** — `candidateId` が解決でき、かつ該当 Candidate が実在する場合のみ:

| 列 | 実値 |
|--|--|
| `candidateId` | body の値、無ければ処理ログの `candidateId` |
| `sentAt` | `parseDateLoose(body.sentAt)` |
| `sendType` | `"MYNAVI_FIRST_REPLY"` 固定 |
| `sendResult` | 上記の潰れた値（実質 `"SUCCESS"`） |
| `templateName` | `"【日程調整】初回メッセージ"` 固定 |
| `senderName` | `"藤本 夏海"` 固定 |

書き込み先はこの2つのみ。Candidate 本体・`supportSubStatus`・タスク・通知への波及は**無い**。

### A-4. バリデーションで 400 を返す条件

**`processingLogId` が空文字/未指定のときのみ**（42-48行）。このとき body を JSON.stringify してログ出力する。
`sendResult` の値では 400 にならない。`"FAILED"` は素通りする。

その他のステータス:
- 403: `x-rpa-secret` 不一致（`src/lib/mynavi-rpa/auth.ts`）
- 404: `processingLogId` に該当する処理ログが存在しない（54-59行）。**このとき DB には何も書かれない**
- 500: 例外時

### A-5. 例外時の挙動

89-97行。`console.error` → `notifyMynaviError("一次返信完了通知の処理に失敗しました", { detail })` で LINE WORKS 通知 →
`{ error: "予期しないエラー: ..." }` を **500** で返す。RPA 側がこの 500 をどう扱うかは portal からは未確認。

---

## 3. B. 「一次返信済み」の判定箇所

### B-1. `replySentAt` / `replyResult` を参照している箇所（repo 全体・全件）

| # | 場所 | 用途 |
|--|--|--|
| 1 | `prisma/schema.prisma:1400-1401` | カラム定義（`reply_sent_at` / `reply_result`。コメントは `"SUCCESS" \| "FAILURE"`） |
| 2 | `src/app/api/rpa/mynavi/reply-sent/route.ts:66` | **唯一の書き込み箇所** |
| 3 | `src/app/(app)/rpa-error/executions/[batchId]/page.tsx:18-19` | 型 `ProcessingLog` に宣言されているのみ。**画面の表・集計のどこでも使われていない**（テーブル列は 処理時刻/氏名/電話番号/ステータス/理由/求職者 の6列だけ） |

**これが本調査の最重要事実**: `replySentAt` / `replyResult` は **書かれているだけで、どこからも読まれていない**。
UI・集計・スクリプト・cron のいずれにも参照が無い。

### B-2. 画面上の「一次返信済み / 返信済み」相当の表示

repo 全体を「一次返信」「返信済」で grep した結果、**求職者一覧・求職者詳細・マイナビ関連画面に「一次返信済み」を示すバッジ・列・フィルタは存在しない。**
唯一「一次返信の結果」が可視化されているのは以下の1画面のみ:

- **求職者詳細 → 設定履歴タブ**（`src/components/candidates/SettingsHistoryTab.tsx`、`CandidateDetailPage.tsx:1967` から呼び出し）
  - 判定に使うのは **`CandidateSettingsHistory.sendResult`**（`replySentAt` でも `supportSubStatus` でもない）
  - データ取得は `src/app/api/candidates/[candidateId]/settings-history/route.ts`（当該 candidateId の全件を `sentAt` 降順）

`supportSubStatus` の自動再計算（`src/lib/support-sub-status.ts`）は `CandidateSettingsHistory` も `replySentAt` も参照していない（grep で0件）。

### B-3. `CandidateSettingsHistory.sendResult` を読んでいる箇所

| 場所 | 内容 |
|--|--|
| `src/components/candidates/SettingsHistoryTab.tsx:88-93` | ラベル変換 |

該当コード（88-93行）:

```tsx
h.sendResult === "SUCCESS"
  ? "border-green-200 bg-green-50 text-green-700"
  : "border-red-200 bg-red-50 text-red-700"
...
{h.sendResult === "SUCCESS" ? "成功" : "失敗"}
```

**UI が想定している値は `"SUCCESS"` の1つだけ。** `"SUCCESS"` 以外は全て赤バッジ「失敗」に落ちる（`FAILURE` も `FAILED` も空文字も同じ扱い）。
つまり **UI 側は `"FAILED"` を保存してもそのまま「失敗」と表示できる**（値の完全一致リストを持っていない）。
`sendType` のラベルは `MYNAVI_FIRST_REPLY: "マイナビ一次返信"` / `MYNAVI_RESEND: "マイナビ再送信"` の2種（15-16行）。
※`MYNAVI_RESEND` を書き込むコードは repo 内に存在しない（ラベル定義のみ）。

### B-4. 「一次返信済み」判定箇所 一覧（表）

| 場所 | 判定に使っているカラム | 影響範囲 |
|--|--|--|
| `SettingsHistoryTab.tsx:88-93`（求職者詳細＞設定履歴タブ） | `CandidateSettingsHistory.sendResult`（`=== "SUCCESS"` で成功/失敗の2値） | **CAが唯一「一次返信の結果」を目視できる場所**。ここが SUCCESS 固定になっている＝今回の見逃しの表示面 |
| `rpa-error/executions/[batchId]/page.tsx`（RPA実行バッチ詳細） | `MynaviRpaProcessingLog.status`（`NORMAL`/`AGE_NG`/…）※`replySentAt` は型宣言のみで未使用 | 「通常送信」バッジは **PDF取り込み時点の判定結果**であって送信結果ではない |
| `rpa-error/executions/page.tsx`（RPA実行履歴一覧） | `RpaExecutionBatch.normalCount` 等の集計値 | 同上。送信可否とは無関係 |
| LINE WORKS バッチ完了通知（`src/lib/mynavi-rpa/notify.ts:87-100`） | `RpaExecutionBatch.normalCount` 等 | 「通常送信 N件・エラー N件」の出所。同上 |
| `src/lib/mynavi-rpa/duplicate-check.ts:18-24` | `phoneNormalized` + `processedAt`（30分窓） | 二重処理判定。`replySentAt` を見ないため、**送信失敗して再処理されたケースも「二重処理スキップ」で弾かれうる** |

**要点**: 「一次返信済み」を意味する判定は実質 **1箇所（設定履歴タブ）だけ**。
RPA実行画面・通知の「通常送信」は送信結果ではなく取り込み時の振り分け結果である。

---

## 4. C. batch-finish API と通知の現状

対象: `src/app/api/rpa/mynavi/batch-finish/route.ts`

### C-1. 受けているフィールド

| フィールド | 行 | 備考 |
|--|--|--|
| `batchId` | 22 | 必須。空なら body を JSON.stringify してログ出力し 400（27-30行） |
| `errorMessage` | 23-25 | 任意。あればバッチ status を `"FAILED"`、無ければ `"COMPLETED"`（68行） |

ボディのパースは reply-sent と同じ `parseRpaRequestBody`（query フォールバックあり）。

**注意: 個々の送信結果（成功/失敗件数）は batch-finish の入力に一切含まれない。** 件数は全て portal 側で DB から数え直す。

### C-2. 通知先

**LINE WORKS。** 実装 `src/lib/mynavi-rpa/notify.ts` の `notifyMynaviBatchCompletion()`（59-108行）。
チャンネル解決は `getMynaviChannel()`（11-12行）で、環境変数は:

- `LINEWORKS_MYNAVI_BOT_ID`
- `LINEWORKS_MYNAVI_CHANNEL_ID`

未設定なら `console.warn` してサイレントにスキップ。送信は `sendBotMessage()`（`src/lib/lineworks.ts`）。
トークルームは「マイナビ転職応募取り込み」。

**Chatwork 連携のコードは repo 内に存在しない**（`chatwork` grep 0件）。

### C-3. 現在の通知文面テンプレート（`notify.ts:87-100` そのまま）

```
📊 マイナビ転職応募取り込み 完了
{応募者行を1人1行: "2026/8/18 18:06 掛須 美音"}
処理時刻: {開始JST}-{終了JST時刻} ({N}分)
処理件数: {totalCount}件
　通常送信: {normalCount}件
　年齢NG: {ageNgCount}件
　外国籍NG: {foreignNgCount}件
　AI解析失敗: {aiFailedCount}件
　二重処理スキップ: {duplicateSkipCount}件
　エラー: {errorCount}件
詳細: {PORTAL_BASE_URL}/rpa-error/executions/{batchId}
```

応募者行は `MynaviRpaProcessingLog` を `batchId` で引き、`candidateName` と `processedAt`（**応募日時ではなく取り込み処理日時**）を出す（71-86行、コメントに明記あり）。

他の通知:
- `notifyMynaviDuplicateSkip()`（113-130行）: 「⚠️ マイナビ転職応募取り込み 二重処理検知」
- `notifyMynaviError()`（148-172行）: 「🚨 マイナビ転職応募取り込み エラー」

### C-4. 「通常送信 N件・エラー N件」の N の出所

`batch-finish/route.ts:43-49` の1クエリで確定する:

```ts
const grouped = await prisma.mynaviRpaProcessingLog.groupBy({
  by: ["status"],
  where: { batchId },
  _count: { _all: true },
});
const countOf = (s) => grouped.find(g => g.status === s)?._count._all ?? 0;
const normalCount = countOf("NORMAL");
const errorCount  = countOf("ERROR");
```

- テーブル: **`mynavi_rpa_processing_logs`**
- 条件: **`batch_id = <当該バッチ>` で `status` ごとに件数を数えるだけ**
- 結果を `RpaExecutionBatch.normalCount` 等に保存し（62-77行）、その保存値を通知に載せる

**`status` は PDF 取り込み時（`src/app/api/rpa/mynavi/pdf-upload/route.ts:294-313`）に、年齢NG・外国籍NG の判定だけで決まる。**
年齢OK・外国籍でない ⇒ `status="NORMAL"` / `canSendReply=true`。
つまり **「通常送信 1件」は「一次返信を送ることになっていた人が1人いた」の意味であって、「送信に成功した」の意味ではない。**
`replySentAt` / `replyResult` は集計に一切使われないので、**送信が全滅しても「通常送信 1件・エラー 0件」と出る。** 今回の事象の表示面はここ。

同様に **`errorCount` は「pdf-upload が例外を吐いた件数」**（`route.ts:474-483` で `status="ERROR"` のログを作る）であり、一次返信の失敗とは無関係。

### C-5. バッチ内の処理ログをたどる経路

`MynaviRpaProcessingLog` に **`batchId` カラムが存在する**（`prisma/schema.prisma:1390-1391`、DBカラム名 `batch_id`、`RpaExecutionBatch` への必須リレーション、`onDelete: Cascade`、`@@index([batchId])`）。
バッチ→処理ログは `batch.processingLogs` で辿れる（`schema.prisma:1378`）。

---

## 5. D. スキーマ確認

### D-1. `MynaviRpaProcessingLog`（`prisma/schema.prisma:1388-1421`）

```prisma
model MynaviRpaProcessingLog {
  id                String            @id @default(cuid())
  batchId           String            @map("batch_id")
  batch             RpaExecutionBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  candidateId       String?           @map("candidate_id")
  candidate         Candidate?        @relation(fields: [candidateId], references: [id], onDelete: SetNull)
  phoneNormalized   String?           @map("phone_normalized")
  candidateName     String?           @map("candidate_name")
  candidateAge      Int?              @map("candidate_age")
  status            String // "NORMAL" | "AGE_NG" | "FOREIGN_NG" | "AI_FAILED" | "DUPLICATE_SKIP" | "ERROR"
  reason            String?           @db.Text
  canSendReply      Boolean           @default(false) @map("can_send_reply")
  replySentAt       DateTime?         @map("reply_sent_at")
  replyResult       String?           @map("reply_result") // "SUCCESS" | "FAILURE"
  pdfFileName       String?           @map("pdf_file_name")
  pdfFileId         String?           @map("pdf_file_id")
  errorMessage      String?           @map("error_message") @db.Text
  /// AI解析失敗時に退避したPDFの Drive ファイルID / 閲覧URL。
  /// 失敗したPDFが現存しないと原因の再現ができないため 2026-08-12 に追加。
  /// 成功時は CandidateFile 側に入るのでここは null。
  failedPdfFileId   String?           @map("failed_pdf_file_id")
  failedPdfUrl      String?           @map("failed_pdf_url")
  // T-064: 自動紐付け結果（matched / no_recruiter_name / no_machine_master / no_candidate_today / no_candidate_yesterday / error）
  scoutLinkResult   String?           @map("scout_link_result")
  scoutLinkedSlotId String?           @map("scout_linked_slot_id")
  processedAt       DateTime          @default(now()) @map("processed_at")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  @@index([phoneNormalized, processedAt])
  @@index([batchId])
  @@index([candidateId])
  @@map("mynavi_rpa_processing_logs")
}
```

### D-2. `CandidateSettingsHistory`（`prisma/schema.prisma:1424-1437`）

```prisma
// 求職者 設定履歴（一次返信送信履歴）
model CandidateSettingsHistory {
  id           String    @id @default(cuid())
  candidateId  String    @map("candidate_id")
  candidate    Candidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  sentAt       DateTime  @map("sent_at")
  sendType     String    @map("send_type")   // "MYNAVI_FIRST_REPLY"
  sendResult   String    @map("send_result") // "SUCCESS" | "FAILURE"
  templateName String    @map("template_name")
  senderName   String    @map("sender_name")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([candidateId, sentAt])
  @@map("candidate_settings_histories")
}
```

（参考）`RpaExecutionBatch`（1363-1385行）は `totalCount` / `normalCount` / `ageNgCount` / `foreignNgCount` / `aiFailedCount` / `duplicateSkipCount` / `errorCount` の7カウンタを持つ。
**「送信成功数」「送信失敗数」に相当するカウンタは無い。**

### D-3. 処理ログ → 氏名・会員No への到達可否

**到達できる。**

| 欲しい値 | 経路 | カラム |
|--|--|--|
| 氏名 | `MynaviRpaProcessingLog.candidateName`（PDF解析時のスナップショット、nullable） | `candidate_name` |
| 氏名（正） | `MynaviRpaProcessingLog.candidate` → `Candidate.name` | `candidates.name` |
| 会員No（マイナビ） | `MynaviRpaProcessingLog.candidate` → `Candidate.mynaviMemberNo` | `candidates.mynavi_member_no`（`schema.prisma:497`、nullable、`@@index` あり） |
| 求職者番号（社内） | `MynaviRpaProcessingLog.candidate` → `Candidate.candidateNumber` | `candidates.candidate_number`（unique） |

**注意点**: `candidateId` は nullable かつ `onDelete: SetNull`。`DUPLICATE_SKIP` / `ERROR` のログは `candidateId` が null のことがある。
実データで `replyResult='SUCCESS'` かつ `candidateId IS NULL` の処理ログが **23件** 存在する（第6章）。

---

## 6. E. 本番データの実態確認（SELECT のみ）

実行方法: `railway ssh --service bizstudio-portal` 上で `@prisma/client` + `@prisma/adapter-pg` の read-only スクリプト（`railway run` は不使用）。

### E-1. `CandidateSettingsHistory.sendResult` の実データ（GROUP BY）

| send_result | send_type | 件数 | 最古 sent_at | 最新 sent_at |
|--|--|--|--|--|
| `SUCCESS` | `MYNAVI_FIRST_REPLY` | **159** | 2026-05-23T11:09:19Z | 2026-08-18T20:18:49Z |

**`SUCCESS` 以外の値は本番に1件も存在しない。** `FAILURE` も `FAILED` もゼロ。`sendType` も `MYNAVI_FIRST_REPLY` の1種のみ。

参考: `MynaviRpaProcessingLog.replyResult`

| reply_result | 件数 |
|--|--|
| `SUCCESS` | **180** |
| `NULL` | 254 |

（総処理ログ 434件。`replyResult='SUCCESS'` 180件のうち **23件は `candidateId` が NULL** で、そのため設定履歴が作られていない。180 − 23 = 157 で、設定履歴 159件とおおむね整合する。）

### E-2. 直近30日の `replySentAt` NULL 件数と、「未処理」との区別可否

直近30日の処理ログ（計155件）を status × canSendReply × replySentAt IS NULL で分解:

| status | can_send_reply | replySentAt | 件数 |
|--|--|--|--|
| NORMAL | true | あり | **119** |
| FOREIGN_NG | false | あり | 11 |
| AI_FAILED | false | あり | 8 |
| **NORMAL** | **true** | **NULL** | **7** |
| DUPLICATE_SKIP | false | NULL | 4 |
| AGE_NG | false | あり | 4 |
| DUPLICATE_SKIP | false | あり | 1 |
| FOREIGN_NG | false | NULL | 1 |

**直近30日で `replySentAt IS NULL` は計 12件。うち「送るはずだったのに完了報告が来ていない」= `status='NORMAL' AND canSendReply=true AND replySentAt IS NULL` が 7件。**

該当7件（氏名 / 取り込み日時UTC）:

| 氏名 | processed_at (UTC) |
|--|--|
| 小原 美緒 | 2026-08-14T14:41:55Z |
| 池三津 雄哉 | 2026-08-09T23:22:23Z |
| 林 咲良 | 2026-07-29T23:27:13Z |
| 金森 莉奈 | 2026-07-22T10:56:48Z |
| 綿野 結菜 | 2026-07-20T01:17:58Z |
| 平塚 美月 | 2026-07-20T00:28:22Z |
| 坂口 倫子 | 2026-07-20T00:13:11Z |

**区別可否**: `status` と `canSendReply` の組み合わせで「そもそも送らない人（AGE_NG/FOREIGN_NG/AI_FAILED/DUPLICATE_SKIP）」と
「送るはずだった人（NORMAL + canSendReply=true）」は区別できる。
しかし **「送るはずだったのに reply-sent が来なかった（＝RPAが途中で落ちた/呼ばなかった）」と
「送ろうとして失敗した」は区別できない。** 両者とも `replySentAt IS NULL` になり、失敗理由を書く列が無いため。
`errorMessage` はこの7件すべて NULL（PDF取り込み時の警告用であり、送信結果は書かれない）。

**逆方向の異常も確認**: `status <> 'NORMAL'`（＝送信対象外）なのに `replySentAt` が入っている行が **33件**（FOREIGN_NG 13 / AI_FAILED 10 / DUPLICATE_SKIP 6 / AGE_NG 4）。
`replySentAt` の有無は「一次返信を送ったか」の指標として**そもそも信頼できない**ことを示す実データ。

### E-3. 「送信できていないのに送信済みになっている応募者」を特定できるか

**portal のデータだけでは特定できない。**

理由: 失敗しても `replyResult` / `sendResult` は `"SUCCESS"` として保存されるため、成功した行と**完全に同一**になる。
判別に使える列（失敗フラグ・エラー文言・リトライ回数）が1つも存在しない。

代替の間接シグナル（確定ではない・要 RPA 側/マイナビ側突合）として、以下のパターンが観測できる:

- **同一人物が短時間に複数回取り込まれ、`DUPLICATE_SKIP` が連続する**行。RPA が同じ応募を繰り返し処理した痕跡。
  実例（2026-08-18・掛須 美音）:

  | processed_at (UTC) | status | replySentAt | replyResult |
  |--|--|--|--|
  | 09:06:38 | NORMAL | 2026-08-18T18:06:58Z | SUCCESS |
  | 09:17:50 | DUPLICATE_SKIP | NULL | NULL |
  | 09:25:47 | DUPLICATE_SKIP | NULL | NULL |
  | 09:32:43 | DUPLICATE_SKIP | NULL | NULL |
  | 09:39:40 | DUPLICATE_SKIP | 2026-08-18T18:41:54Z | SUCCESS |

  同一応募者に対し **5回**の取り込みと **2回**の「送信成功」記録が残っている。これは「1回で送れていなかった」ことを示唆するが、
  portal のデータだけでは断定できない（**未確認**）。

- 直近48時間の全処理ログは 12件、うち NORMAL 6件・DUPLICATE_SKIP 4件・上記の重複を含む。

**結論: 今回の事象に該当する応募者を portal 側データから機械的に抽出する条件は存在しない。**

### E-4. （付随で判明した事実・本チケット対象外）

調査中に確認できた、報告に値する事実を記録する。**いずれも本プロンプトの対象外であり、修正は行っていない。**

1. **`sentAt` が JST 壁時計値のまま UTC として保存されている。**
   本番コンテナは `TZ` 未設定で Node の実効タイムゾーンは **UTC**（実測: `Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"`）。
   `parseDateLoose()`（`reply-sent/route.ts:13-21`）は `"2026/08/18 18:04:20"` 形式を
   `new Date(y, mo-1, d, h, mi, s)` = **ローカル時刻**として構築するため、UTC コンテナでは JST の壁時計値がそのまま UTC 値になる。
   実データで裏取り済み（掛須 美音: `processed_at=2026-08-18T09:06:38Z`（=18:06 JST）に対し `reply_sent_at=2026-08-18T18:06:58Z`）。
   結果、**設定履歴タブの「送信日時」は実際より +9時間ずれて表示される**。

2. **`reply_sent_at = 1901-01-01T00:00:00Z` の行が3件**（すべて 2026-05 の「木田 朱夏」）。RPA から不正な `sentAt` が来た痕跡。

3. **`RpaExecutionBatch` が大量に RUNNING のまま残る。** 直近2日で開始 558件に対し `finishedAt` が入ったのは **11件**（`totalCount>0` は 9件）。
   batch-start は5分間隔で必ずバッチを作るが、処理対象ゼロのときは batch-finish が呼ばれず RUNNING のまま残ると見られる（**RPA 側の呼び出し条件は未確認**）。

---

## 7. Railway 本番ログでの実受信確認

- ログ取得: Railway GraphQL API でデプロイ一覧を取得し、`railway logs <deploymentId> --json -n 5000` で各デプロイのログを走査。
- 走査対象: 2026-08-17 03:21Z 〜 2026-08-18 13:22Z を覆う **13デプロイ**（Railway のログはデプロイ単位で、現行デプロイは 2026-08-18T12:59Z 起動のため、過去分は旧デプロイIDから取得した）。

**`"FAILED"` の実受信は確認できなかった。**

- 期間内に `reply-sent` が出力したログは **2件のみ**（いずれも `processingLogId missing` の 400）:

  | 時刻 (UTC) | 時刻 (JST) | body | レスポンス |
  |--|--|--|--|
  | 2026-08-18T04:03:57Z | 2026-08-18 13:03 | `{"processingLogId":"","candidateId":"","sentAt":"2026/08/18 13:03:50","sendResult":"SUCCESS"}` | **400** |
  | 2026-08-18T09:04:26Z | 2026-08-18 18:04 | `{"processingLogId":"","candidateId":"","sentAt":"2026/08/18 18:04:20","sendResult":"SUCCESS"}` | **400** |

  → 2件とも `sendResult` は **`"SUCCESS"`**。`"FAILED"` は含まれない。
  → 2件目（18:04 JST）は、E-3 に挙げた「掛須 美音」の連続再処理（18:06〜18:39 JST）の直前に発生している。

**重大な制約（結論に直結）**: 現行実装では **`processingLogId` が空のときにしか body をログ出力しない**（`reply-sent/route.ts:43`）。
正常系（`processingLogId` あり）は body も `sendResult` も**一切ログに残らない**。
したがって **「`"FAILED"` が飛んでこなかった」ことをログから証明することはできない。**
上記の 400 ログ2件は「たまたま observable だった2件はどちらも SUCCESS だった」という事実にとどまる。
DB 側も `"FAILED"` を `"SUCCESS"` に潰して保存するため、**事後に判別する手段は portal 側に存在しない**（＝この点は **未確認**）。

---

## 8. 失敗を記録する場所の選択肢（案の提示のみ・実装しない）

前提として、**どの案でも `reply-sent/route.ts:38-39` の値の潰し込みを直さない限り何も記録できない**。以下は「潰し込みを直した後、どこに書くか」の比較。

### 案1: `CandidateSettingsHistory.sendResult` に失敗値を入れて集計キーに使う

- **やること**: 38-39行を「既知の失敗値なら失敗、未知の値も失敗扱い（フェイルクローズ）」に変え、その値をそのまま既存カラムに保存する。マイグレーション不要。
- **既存の表示への影響**:
  - **設定履歴タブ（`SettingsHistoryTab.tsx:88-93`）は改修不要で正しく赤バッジ「失敗」を表示する。** 判定が `=== "SUCCESS"` の否定形のため、`FAILED` でも `FAILURE` でも動く。
  - 本番既存データは `SUCCESS` 159件のみ（`FAILURE` 0件）なので、**既存行の見え方は一切変わらない。**
- **既存の集計への影響**:
  - **バッチ完了通知の「通常送信 N件」は変わらない**（`MynaviRpaProcessingLog.status` を数えており `sendResult` を見ないため）。
    つまり **この案単独では「通常送信 1件・エラー 0件」の誤表示は直らない。** 通知側の改修が別途必要。
  - `CandidateSettingsHistory` を集計している既存コードは無い（hard-delete の件数カウントのみ: `src/app/api/admin/candidates/hard-delete/route.ts:131`）ので破壊リスクは低い。
- **弱点**: `candidateId` が解決できない場合は行自体が作られない（現行 180件中 23件が該当）。**失敗を取りこぼす経路が残る。**

### 案2: `MynaviRpaProcessingLog` に失敗記録用の nullable カラムを追加する

- **やること**: 例 `replyFailureReason String? @map("reply_failure_reason")` / `replyAttemptCount Int?` を追加。`replyResult` には受信値をそのまま生保存する。
- **既存の表示への影響**:
  - `replySentAt` / `replyResult` は **どこからも読まれていない**（B-1）ため、**既存画面への影響はゼロ**。
  - 追加カラムを表示するには `rpa-error/executions/[batchId]/page.tsx` に列追加が必要（型には既に `replyResult` が宣言済みなので差分は小さい）。
- **既存の集計への影響**: 無い。ただし **通知の「通常送信 N件」を直すには `batch-finish` の groupBy を status 単独から `status` × `replyResult` の組み合わせに変える必要がある**（`RpaExecutionBatch` に失敗カウンタ列の追加も要検討）。
- **利点**: `candidateId` が null でも必ず記録できる（処理ログは常に存在する）。バッチ単位の集計・通知に直結する。
- **弱点**: マイグレーションが必要。求職者詳細画面からは見えないので、CA が個別求職者を見たときには気づけない（案1との併用が自然）。

### 案3（推奨）: 案1＋案2の併用 ＋ 通知の集計キーを送信結果に切り替える

コードを読んだ上での所見として、**失敗の記録先は1箇所では足りない**。理由:

1. **CAが気づく面**（求職者詳細＞設定履歴タブ）は `CandidateSettingsHistory.sendResult` しか見ていない。
2. **運用が気づく面**（LINE WORKS のバッチ完了通知）は `MynaviRpaProcessingLog.status` の件数しか見ていない。

したがって最小構成は次の3点セット:

- **(a)** `reply-sent/route.ts:38-39` を**フェイルクローズ**に変更（`"SUCCESS"` 完全一致のみ成功、それ以外＝`FAILED`/`FAILURE`/空文字/`%送信結果%`/未指定 は全て失敗として記録）。
  現行と真逆の既定値にする。未知値を成功にする現行実装が今回の見逃しの本体である。
- **(b)** `MynaviRpaProcessingLog` に受信した生値を残す（`replyResult` に生保存 or 失敗理由カラム追加）。`candidateId` null 経路（実データ23件）を取りこぼさないため。
- **(c)** `batch-finish` の集計に「一次返信 成功/失敗」の軸を足し、通知文面に **`送信失敗: N件`** の行を追加する。
  現行の「通常送信 N件」は取り込み時の振り分け結果であり、**文言を変えずに意味だけ直すことはできない**。
  併せて `status='NORMAL' AND canSendReply=true AND replySentAt IS NULL`（＝完了報告が来なかった件数）も
  「**未報告: N件**」として出すと、E-2 の7件のような「RPA が呼ばなかった」ケースも拾える。

**推奨は案3。** ただし段階実施するなら **(a) を最優先**（コード1箇所・マイグレーション不要・既存表示への影響ゼロで、RPA 側の改修が即座に有効になる）。

---

## 9. 値の表記ズレ

| 出所 | 失敗を表す文字列 |
|--|--|
| RPA（PAD「一次返信送信完了通知」サブフロー・2026-08-18 公開済み） | **`"FAILED"`** |
| portal コード（`reply-sent/route.ts:39`） | **`"FAILURE"`** |
| portal スキーマのコメント（`schema.prisma:1401`, `1430`） | **`"FAILURE"`** |
| portal UI（`SettingsHistoryTab.tsx:88-93`） | **値を列挙していない**（`"SUCCESS"` 以外は全て「失敗」表示） |
| 本番既存データ | **失敗値は0件**（`sendResult` は `SUCCESS` 159件のみ、`replyResult` は `SUCCESS` 180件 + NULL 254件のみ） |

**一致していない。** portal は `"FAILURE"` を、RPA は `"FAILED"` を使っている。

**どちらに揃えるべきか — RPA 側の `"FAILED"` に揃えることを推奨。** 根拠:

1. **既存データに `"FAILURE"` は1件も存在しない**（実測 0件）。よって `"FAILURE"` を守る理由となる過去データが無い。
   逆に `"FAILED"` を採用しても、既存データとの不整合は発生しない。
2. **RPA 側は既に本番公開済み**。portal が `"FAILED"` を受ければ RPA 側の再改修・再公開が不要になる。
3. **UI は値を列挙していない**ため、`"FAILED"` をそのまま保存しても設定履歴タブは「失敗」と正しく表示する。UI 改修が不要。
4. スキーマのコメント（`"SUCCESS" | "FAILURE"`）2箇所の書き換えだけで整合が取れる。

ただし **(a) のフェイルクローズ化（`"SUCCESS"` 完全一致のみ成功）を入れるなら、失敗値の綴り自体は本質的な問題ではなくなる。**
`"FAILED"` / `"FAILURE"` / 空文字 / `"%送信結果%"` のいずれが来ても失敗として記録されるため、表記統一は「保存値の見やすさ」の問題に縮小する。
**綴り統一よりフェイルクローズ化を優先すべき。**

---

## 10. 未確認事項

推測で埋めず、確認できていないことを列挙する。

1. **`"FAILED"` が実際に本番へ飛んできたことがあるか。**
   正常系（`processingLogId` あり）は body をログ出力しないため、Railway ログから判定できない。
   DB も `"SUCCESS"` に潰して保存するため事後判別も不可能。**恒久的に確認不能。**
2. **Railway ログの保持範囲。** デプロイ単位でしかログを引けず、2026-08-17 03:21Z より前は今回走査していない。それ以前に `"FAILED"` の 400 ログがあったかは未確認。
3. **RPA が reply-sent の 400 / 404 / 500 をどう扱うか**（リトライするのか、無視して次へ進むのか）。portal 側からは確認できない。
4. **2026-08-18 の 400 ログ2件（13:03 / 18:04 JST）が、どの応募者・どのバッチのものか。** `processingLogId` も `candidateId` も空だったため紐付け不能。
5. **「掛須 美音」の連続再処理（5回取り込み・2回の SUCCESS 記録）が、実際に送信失敗によるものかどうか。** portal データからは断定できない。マイナビ側の送信履歴との突合が必要。
6. **`RpaExecutionBatch` が RUNNING のまま残る条件**（直近2日で 558件中 547件が未完了）。RPA 側で batch-finish を呼ぶ条件が portal からは不明。
7. **`MYNAVI_RESEND` の運用実態。** UI にラベル定義があるが書き込むコードが repo に無く、本番データにも0件。過去仕様の名残か将来用かは未確認。
8. **「一次返信済み」が bizstudio-mypage / kyuujin-pdf-tool など他リポジトリで参照されているか。** 本調査は portal リポジトリ内に限定した。

---

## 11. Step2 実装記録（2026-08-18）

Step1 の調査結果に基づき、以下を実装した。**スキーマ変更なし（マイグレーション不要）。本番DBへの書き込みも一切行っていない。**

### 11-1. 変更ファイル

| ファイル | 変更内容 |
|--|--|
| `src/app/api/rpa/mynavi/reply-sent/route.ts` | 送信結果判定をフェイルクローズ化。生値のサーバーログ出力を追加。失敗時は `replySentAt` を更新しない。レスポンスに正規化後の結果値を含める |
| `src/lib/mynavi-rpa/notify.ts` | バッチ完了通知に「送信失敗: N件」＋失敗した応募者（氏名 / 会員No）の列挙を追加。「通常送信」→「取り込み」へラベル変更 |

`src/app/api/rpa/mynavi/batch-finish/route.ts` は**変更していない**。送信失敗の集計は同一 `batchId` の処理ログを引いている `notifyMynaviBatchCompletion` の中で完結するため、既存の `findMany` の `select` を拡張するだけで済み、クエリ追加も batch-finish 側の改修も不要だった。

### 11-2. `reply-sent` の呼び出し元

repo 全体（`.git` / `node_modules` / `.next` を除く）を `reply-sent` で grep した結果、**src 配下の呼び出し元は0件**。ヒットしたのは以下のみで、いずれも実行コードではない。

- `src/app/api/rpa/mynavi/reply-sent/route.ts`（実装本体）
- 各種調査報告書（`.claude/T-063-phase1-report.md` / `docs/reports/T-167_...` / `T-062_...` / `T-064_...` / `tmp/scout_status_investigation_report.md`）
- `tsconfig.tsbuildinfo` / `tsconfig.verify.tsbuildinfo`（ビルドキャッシュ）

**このエンドポイントを叩いているのは RPA のみ。**他に `sendResult` を送らない呼び出し元は存在しないため、フェイルクローズ化による巻き添えは発生しない。

### 11-3. 判定テーブル（変更後）

保存値は必ず `"SUCCESS"` / `"FAILED"` のどちらかに正規化し、生値は保存しない。

| RPA が送る `sendResult` | 変更前 | **変更後** | `replySentAt` | HTTP |
|--|--|--|--|--|
| `"SUCCESS"` | SUCCESS | **SUCCESS** | 更新 | 200 |
| `"FAILED"` | SUCCESS（誤記録） | **FAILED** | 更新しない | 200 |
| `"FAILURE"` | FAILURE | **FAILED** | 更新しない | 200 |
| `""`（空文字） | SUCCESS（誤記録） | **FAILED** | 更新しない | 200 |
| `"%送信結果%"` | SUCCESS（誤記録） | **FAILED** | 更新しない | 200 |
| フィールド欠落 / null | SUCCESS（誤記録） | **FAILED** | 更新しない | 200 |

失敗時も `CandidateSettingsHistory` は1行 insert され `sendResult="FAILED"` が入る。`SettingsHistoryTab.tsx` は `=== "SUCCESS"` の2値判定のため「失敗」と表示される（Step1 で確認済み）。

### 11-4. オフライン動作確認（実施済み）

DB / LINE WORKS に触れずに検証するため、**製品コードの本文をそのまま**取り出して実行した。

- `normalizeSendResult` は `route.ts` から関数定義をそのまま抽出して実行。
- 通知本文は `notify.ts` を丸ごとコピーし、**import 3行だけ**をスタブに差し替えて実行（`diff` で import 3行以外に差分がないことを確認済み）。

#### (1) `normalizeSendResult` の真理値表（実行結果）

```
"SUCCESS"                      -> SUCCESS
"success"（小文字）             -> SUCCESS
" SUCCESS "（前後空白）          -> SUCCESS
"FAILED"（RPAが実際に送る値）    -> FAILED
"FAILURE"（旧仕様の値）          -> FAILED
""（空文字）                    -> FAILED
"%送信結果%"（変数展開失敗）      -> FAILED
undefined（フィールド欠落）      -> FAILED
null                           -> FAILED
true（型違い）                  -> FAILED
0（型違い）                     -> FAILED
```

#### (2) 通知本文 — 送信失敗0件（行が出ないこと）

```
📊 マイナビ転職応募取り込み 完了
2026/8/18 09:10 山田 太郎
2026/8/18 09:10 鈴木 花子
処理時刻: 2026/08/18 09:05-09:22 (17分)
処理件数: 4件
　取り込み: 3件
　年齢NG: 1件
　外国籍NG: 0件
　AI解析失敗: 0件
　二重処理スキップ: 0件
　エラー: 0件
詳細: https://portal.example/rpa-error/executions/batch_test
```

→ 「送信失敗」行は出ない。「通常送信」が「取り込み」に変わっている。

#### (3) 通知本文 — 送信失敗2件（氏名・会員No が取れないレコードを含む）

```
📊 マイナビ転職応募取り込み 完了
2026/8/18 09:10 山田 太郎
2026/8/18 09:10 鈴木 花子
2026/8/18 09:10 （氏名不明）
2026/8/18 09:10 佐藤 次郎
処理時刻: 2026/08/18 09:05-09:22 (17分)
処理件数: 4件
　取り込み: 3件
　年齢NG: 1件
　外国籍NG: 0件
　AI解析失敗: 0件
　二重処理スキップ: 0件
　エラー: 0件
送信失敗: 2件
　鈴木 花子 / 会員No: M002
　- / 会員No: -
詳細: https://portal.example/rpa-error/executions/batch_test
```

→ `candidateId` が NULL（Step1 で実データ23件を確認）のレコードでも通知は落ちず、`-` で出力される。

#### (4) 通知本文 — 送信失敗23件（上限20件 + 「他 N件」）

末尾のみ抜粋。

```
送信失敗: 23件
　失敗 1 / 会員No: M100
　（…20行目まで…）
　失敗 20 / 会員No: M119
　他 3件
```

#### (5) 型チェック

`npx tsc --noEmit -p tsconfig.json` → エラー0件。

### 11-5. 未実施の確認（本番DB書き込みを伴うため停止）

以下は**実施していない**。依頼の禁止事項「本番DBへの書き込み（UPDATE / DELETE / INSERT すべて禁止。既存レコードの値の書き換えもしない）」に該当するため。

1. デプロイ済み `reply-sent` へ `sendResult: "FAILED"` を実際に POST し、`MynaviRpaProcessingLog.replySentAt` が NULL のまま `replyResult="FAILED"` になることを DB で確認する。
   - このテストは**既存の処理ログ行を UPDATE する**（`processingLogId` が実在しないと 404 で終わり、何も検証できない）。テスト用の行を新規作成する場合も `RpaExecutionBatch` + `MynaviRpaProcessingLog` の INSERT が必要。
   - さらに `candidateId` が付いていれば `CandidateSettingsHistory` にテスト行が1行増え、その求職者の設定履歴タブに「失敗」として表示される。
2. 実際の LINE WORKS への通知送信（`batch-finish` の実行）。本番トークルーム「マイナビ転職応募取り込み」へ実メッセージが飛ぶため未実施。通知本文は 11-4 のオフライン実行で代替確認した。

**テストで作成した本番レコードは0件。**

実施する場合の推奨手順（要承認）:

- テスト専用の `RpaExecutionBatch` を1件 INSERT し、そこに `MynaviRpaProcessingLog` を `candidateId=NULL` で数件 INSERT する（求職者の設定履歴を汚さない）。
- そのログ ID に対して `sendResult` を `"FAILED"` / 省略 / `""` / `"SUCCESS"` の4パターンで POST。
- SELECT で `replySentAt` / `replyResult` を確認。
- テスト行は削除せず残し、`batchId` を報告書に記載する。
