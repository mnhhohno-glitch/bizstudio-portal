# T-168 RPA実行バッチが「実行中」のまま残る — 現状調査（portal 側 / Step1）

- 調査日: 2026-08-18（DB スナップショット時刻 2026-08-18 14:26 UTC = 23:26 JST）
- 対象リポジトリ: bizstudio-portal（branch master / HEAD `92895f3`）
- 調査範囲: コード読み取り・本番DB SELECT のみ・Railway HTTPログ観測。**製品コードの変更・マイグレーション・DB書き込みは一切行っていない。** `railway run` も未使用。
- 関連: `docs/reports/T-167_portal_reply-sent-failure-survey.md`

---

## 1. 結論サマリ

### 1-1. 未完了になる原因

**「取り込み対象メールが0件だった実行では、RPA（PAD）側が `batch-finish` を呼ばずにフローを終了している」** が原因。portal 側に自動クローズの仕組みは無いため、`batch-start` で作られた `RpaExecutionBatch` は `status="RUNNING"` のまま永久に残る。

裏付けとなる実データ（本文 3章・4章に全数）:

| 事実 | 数値 |
|--|--|
| 未完了（RUNNING）バッチのうち **処理ログが0件**のもの | **23,190 / 23,219 件（99.88%）** |
| 直近2日の未完了バッチのうち処理ログが0件のもの | **543 / 548 件（99.1%）** |
| 完了（COMPLETED）バッチのうち処理ログが1件以上のもの | 392 / 405 件（96.8%） |
| 処理ログが1件以上あるバッチの完了率（2026-05-18以降） | **389 / 409 件（95.1%）** |
| Railway HTTPログ実測（2026-08-18 14:16:04〜14:32:53 UTC、16分50秒） | `POST /api/rpa/mynavi/batch-start` × **3**（すべて 200）／ `batch-finish` **0件** |

つまり「たまに落ちる」のではなく、**空振り実行（対象メール0件）では構造的に必ず未完了になる**。5分間隔で起動されるため、1日約288件・2日で約576件が積み上がる。

**ただし、これで説明できない残差が28件ある。** 処理ログが1件以上あるのに RUNNING のまま残っているバッチが 28件（T-167 検証用ダミー1件を除く）存在する。うち 2026-05-18 以降は20件、その中で実際に求職者を取り込んだ（`status="NORMAL"`）ものは13件。**この28件については原因未特定**（PAD が処理途中で異常終了した／`batch-finish` が届かなかった、のいずれかと推測されるが、portal 側からは確認できない → 8章「未確認事項」）。

**「いつから壊れたか」という境目は存在しない。** 機能リリース初日（2026-05-16）の1件目のバッチから既に RUNNING で残っている（4-4）。

### 1-2. バッチ完了通知は発火しているか

**発火している。ただし `batch-finish` が呼ばれたときだけ＝直近2日で11回のみ。**

- `notifyMynaviBatchCompletion()` の呼び出し箇所は `src/app/api/rpa/mynavi/batch-finish/route.ts:81` の1箇所のみ。バッチが未完了＝この関数が呼ばれない＝通知も出ない。
- 直近2日の COMPLETED は 11件 → LINE WORKS「📊 マイナビ転職応募取り込み 完了」は**11回発火したはず**（本番の `LINEWORKS_MYNAVI_BOT_ID` / `LINEWORKS_MYNAVI_CHANNEL_ID` / `PORTAL_BASE_URL` はいずれも設定済みであることをコンテナ env で確認済み）。
- 一方、**空振り実行548回分は通知が出ていない。これは運用上むしろ妥当**（0件で5分ごとに通知が飛ぶ方が困る）。
- **問題は、処理ログがあるのに未完了で終わった 28件**。この28件の応募者については完了通知が一切飛んでいない。直近では 2026-08-18 09:05 UTC（18:05 JST）の「掛須 美音」さん（`status=NORMAL` / `replyResult=SUCCESS`）が該当し、取り込みと一次返信は成功しているのに完了通知は出ていない。
- なお LINE WORKS トークルームの実メッセージそのものは未確認（8章）。

### 1-3. T-167 で追加した「送信失敗: N件」は現状の運用で表示されるか

**表示される。ただし約95%の確率で、という条件付き。**

- 送信失敗（`MynaviRpaProcessingLog.replyResult = "FAILED"`）は、そもそも応募者を取り込んだバッチにしか発生しない。**処理ログが0件のバッチには送信失敗は原理的に存在しない**ため、「558件が未完了 → T-167 の改修が永久に表示されない」という因果関係は**成立しない**。
- 処理ログが1件以上あるバッチの完了率は 2026-05-18 以降で **95.1%（389/409）**。したがって送信失敗が起きたバッチも 95% 程度は `batch-finish` に到達し、`src/lib/mynavi-rpa/notify.ts:101-113` の「送信失敗: N件」ブロックが本文に載る。
- **残り約5%（処理ログはあるが未完了で終わるケース）では、送信失敗があっても通知に出ない。** ここは T-168 の修正で潰すべき穴である。
- 補足: `notify.ts:101` の判定は `replyResult === "FAILED"`。T-167 実装後の `reply-sent` が書き込む値は `"FAILED"`（T-167 報告書 12-3 の本番実データで確認済み）で一致している。

### 1-4. 発生し始めた時期

**2026-05-16（マイナビRPA新フロー Phase 1B のリリース初日）から。「正常に完了していた時期」は存在しない。**

- `RpaExecutionBatch` の最古行 `cmp8dllwr00001dp1f3kt2987` = `started_at 2026-05-16T13:22:21.089Z`（JST 22:22）は `status="RUNNING"` / `finished_at=NULL` / 処理ログ0件。
- 該当機能のコミットは `3d92886 2026-05-16 20:40 feat(T-062): マイナビRPA新フロー Phase 1B 一括実装`。この直後から発生している。
- 件数が爆発したのは **2026-05-22**（41件）→ **2026-05-23（280件）以降**で、以後ほぼ毎日 277〜286件。この期間 portal 側のデプロイは無い（2026-05-21 11:34 の `b5dd034` の次のコミットは 2026-05-23 21:26 の `e2a1262`）。**したがって件数爆発の原因は Power Automate Cloud 側のスケジュール（5分間隔化）であり、portal のデプロイではない。**

---

## 2. A. バッチのライフサイクル

### 2-1. `RpaExecutionBatch` モデル定義（`prisma/schema.prisma:1363-1385` 全カラム）

| カラム | 型 | nullable | 既定値 | DB列名 |
|--|--|--|--|--|
| `id` | String | no | `cuid()` | `id`（PK） |
| `machineNumber` | Int | no | — | `machine_number` |
| `flowName` | String | no | — | `flow_name` |
| `startedAt` | DateTime | no | — | `started_at` |
| `finishedAt` | DateTime | **yes** | — | `finished_at` |
| **`status`** | String | no | **`"RUNNING"`** | `status` |
| `totalCount` | Int | no | 0 | `total_count` |
| `normalCount` | Int | no | 0 | `normal_count` |
| `ageNgCount` | Int | no | 0 | `age_ng_count` |
| `foreignNgCount` | Int | no | 0 | `foreign_ng_count` |
| `aiFailedCount` | Int | no | 0 | `ai_failed_count` |
| `duplicateSkipCount` | Int | no | 0 | `duplicate_skip_count` |
| `errorCount` | Int | no | 0 | `error_count` |
| `errorMessage` | String?（`@db.Text`） | yes | — | `error_message` |
| `processingLogs` | `MynaviRpaProcessingLog[]` | — | — | リレーション |
| `createdAt` | DateTime | no | `now()` | `created_at` |
| `updatedAt` | DateTime | no | `@updatedAt` | `updated_at` |

index: `@@index([startedAt])` / `@@index([machineNumber, startedAt])`（`prisma/schema.prisma:1382-1383`、DDL は `prisma/migrations/20260516000000_add_mynavi_rpa_models/migration.sql:63,66`）。
テーブル名: `rpa_execution_batches`。

**状態カラムは `status`（String。enum ではない）。** 取りうる値はスキーマコメント（`prisma/schema.prisma:1369`）で `"RUNNING" | "COMPLETED" | "FAILED"` と宣言されており、**DB制約は無い**。実データに存在する値は **`RUNNING` と `COMPLETED` の2種のみ**（`FAILED` は全期間で0件 → 3-1）。

`MynaviRpaProcessingLog.batchId` → `RpaExecutionBatch.id` は **`onDelete: Cascade`**（`prisma/schema.prisma:1391`）。バッチを削除すると処理ログも消える（7-3 の掃除案に関係）。

### 2-2. バッチを**作成**しているコード（全列挙）

**1箇所のみ**: `src/app/api/rpa/mynavi/batch-start/route.ts:26-33`

```ts
const batch = await prisma.rpaExecutionBatch.create({
  data: { machineNumber, flowName, startedAt: new Date(), status: "RUNNING" },
});
```

- `machineNumber` 既定 7（同 19-20行）、`flowName` 既定 `"01.応募者一次返信・情報取り込み"`（同 21-24行）。実データも全件この組み合わせ（3-4）。
- `batch-start` 以外にバッチを作る箇所は repo 全体に無い（`grep -rn "rpaExecutionBatch" src/ scripts/` の全ヒットは batch-start / batch-finish / last-execution / pdf-upload / rpa-error 2ルートのみ）。

### 2-3. バッチを**完了させている**コード（全列挙）

**1箇所のみ**: `src/app/api/rpa/mynavi/batch-finish/route.ts:65-79`

```ts
const updated = await prisma.rpaExecutionBatch.update({
  where: { id: batchId },
  data: {
    finishedAt: new Date(),
    status: errorMessage ? "FAILED" : "COMPLETED",
    errorMessage,
    totalCount, normalCount, ageNgCount, foreignNgCount,
    aiFailedCount, duplicateSkipCount, errorCount,
  },
});
```

- 件数は `MynaviRpaProcessingLog` を `status` で groupBy して集計（同 43-63行）。`totalCount` は6種の合算であり、**リクエストボディの値ではなく DB 実測値**。
- 直前に `findUnique` で存在チェックし、無ければ **404**（同 31-40行）。`batchId` が空なら **400**（同 26-29行。`console.error` でボディをログ出力）。
- 更新成功後に `notifyMynaviBatchCompletion(updated)`（同 81行）→ LINE WORKS 通知。
- `status` を書き換える他の箇所は repo 内に存在しない。`pdf-upload`（`src/app/api/rpa/mynavi/pdf-upload/route.ts:172-178`）はバッチを `findUnique` で参照するだけで更新しない。

### 2-4. タイムアウト／自動クローズ

**存在しない。** 以下すべてで0件:

- `RpaExecutionBatch` を更新するコードは `batch-finish` の1箇所のみ（2-3）。
- cron / スケジュールジョブから当テーブルを触るコードは無い（既存 cron は `src/app/api/scout/cron/create-daily-slots` と `/api/internal/bookmarks/resubmit-stale` のみで、いずれも `rpaExecutionBatch` を参照しない）。
- DB 側のトリガ／期限処理も無い（マイグレーション `20260516000000_add_mynavi_rpa_models/migration.sql` は CREATE TABLE + INDEX + FK のみ）。

**したがって、PAD が `batch-finish` を呼ばない限り RUNNING は永久に残る。**

---

## 3. B. 実データでの実態確認（SELECT のみ / `railway ssh --service bizstudio-portal` 経由）

### 3-1. 状態別件数

スナップショット 2026-08-18 14:26 UTC。

| 区分 | RUNNING | COMPLETED | FAILED |
|--|--|--|--|
| 全期間 | **23,219** | **405** | 0 |
| 直近7日 | 1,955 | 34 | 0 |
| 直近2日 | **548** | **11** | 0 |

- 全レコード数 23,625（14:30 UTC 時点。5分ごとに増える）。
- `FAILED` は全期間で 0件。**`errorMessage` 付きで `batch-finish` が呼ばれたことは一度も無い。**
- 直近2日は 559件（548+11）。5分間隔なら理論値 576件なので、**ほぼ全実行分が RUNNING で残っている**。

### 3-2. 未完了バッチにぶら下がる処理ログ件数の分布 ★仮説の検証

**RUNNING（全期間）**

| 処理ログ件数 | バッチ数 |
|--|--|
| **0件** | **23,190** ← 99.88% |
| 1件 | 28 |
| 4件 | 1（T-167 検証用ダミー `t167-verify-20260818`） |

**RUNNING（直近2日）**

| 処理ログ件数 | バッチ数 |
|--|--|
| **0件** | **543** |
| 1件 | 4 |
| 4件 | 1（同上ダミー） |

**COMPLETED（全期間）** — 対照

| 処理ログ件数 | バッチ数 |
|--|--|
| 0件 | 13 |
| 1件 | 380 |
| 2件 | 10 |
| 3件 | 2 |

→ **「処理ログが0件のバッチは完了しない」「処理ログがあるバッチはほぼ完了する」という強い相関がある。仮説（対象メール0件のときに完了通知を呼ばずに終わる）は支持された。**

ただし逆側の例外が両方向にある:
- 処理ログ0件でも COMPLETED になったものが **13件**（3-5）。
- 処理ログがあるのに RUNNING のままのものが **28件**（3-6）。

### 3-3. 完了しているバッチ（直近2日・11件）の特徴

| # | started_at (UTC) | finished_at (UTC) | 所要 | 処理ログ | total_count |
|--|--|--|--|--|--|
| 1 | 2026-08-17 01:20:15 | 01:23:52 | 3分37秒 | 1 | 1 |
| 2 | 2026-08-17 03:15:15 | 03:18:17 | 3分02秒 | 1 | 1 |
| 3 | 2026-08-17 03:45:12 | 03:47:26 | 2分14秒 | 1 | 1 |
| 4 | 2026-08-17 07:30:14 | 07:33:10 | 2分56秒 | 1 | 1 |
| 5 | 2026-08-17 10:15:12 | 10:18:35 | 3分23秒 | 1 | 1 |
| 6 | 2026-08-17 11:15:12 | 11:18:12 | 3分00秒 | 1 | 1 |
| 7 | 2026-08-18 02:02:25 | 02:04:52 | 2分27秒 | 1 | 1 |
| 8 | **2026-08-18 04:02:32** | 04:03:51 | 1分19秒 | **0** | 0 |
| 9 | **2026-08-18 09:02:57** | 09:04:22 | 1分25秒 | **0** | 0 |
| 10 | 2026-08-18 09:38:00 | 09:41:55 | 3分55秒 | 1 | 1 |
| 11 | 2026-08-18 11:15:16 | 11:18:51 | 3分35秒 | 1 | 1 |

未完了バッチとの違い:

- **処理ログ件数が決定的**。11件中9件が処理ログ1件（＝実際に応募者を取り込んだ実行）。
- `machine_number` / `flow_name` は未完了バッチと**完全に同一**（7号機 / `01.応募者一次返信・情報取り込み`）。この2カラムに区別する情報は無い。
- `error_message` は11件すべて NULL。
- **起動時刻の「分」に規則性がある**。5分グリッド上（分 mod 5 = 0）の起動は直近2日で RUNNING 536件 / COMPLETED 7件。グリッド外（mod 5 ≠ 0）は RUNNING 12件 / COMPLETED 4件。グリッド外の起動は毎時 02〜03分ごろに1回ずつあり（08-17 05:02 / 07:02 / 10:02、08-18 00:02 / 02:02 / 03:02 / 04:02 / 05:03 / 06:02 / 09:02 / 10:02）、**5分周期とは別の起動系統が存在する**。ただしその系統も一貫して完了するわけではなく（11件中 COMPLETED は3件のみ）、これだけでは完了/未完了を説明できない。
- COMPLETED の所要時間は 処理ログ0件のとき 1分19秒〜1分25秒、1件のとき 2分14秒〜3分55秒。

### 3-4. flow / machine 別内訳（全期間）

| machine_number | flow_name | status | 件数 |
|--|--|--|--|
| 7 | 01.応募者一次返信・情報取り込み | RUNNING | 23,218 |
| 7 | 01.応募者一次返信・情報取り込み | COMPLETED | 405 |
| 7 | 01.応募者一次返信・情報取り込み【T-167検証用ダミー】 | RUNNING | 1 |

→ **フロー・号機は1系統のみ。**

### 3-5. 処理ログ0件で COMPLETED になった 13件（全数）

| started_at (UTC) | finished_at (UTC) |
|--|--|
| 2026-05-23 01:11:58 | 01:13:22 |
| 2026-07-22 01:20:24 | 01:21:18 |
| 2026-07-22 11:00:24 | 11:01:10 |
| 2026-07-26 10:35:17 | 10:35:59 |
| 2026-07-29 14:40:12 | 14:41:18 |
| 2026-07-29 15:50:23 | 15:52:14 |
| 2026-07-31 05:00:30 | **14:23:13**（9時間23分） |
| 2026-07-31 14:25:19 | 14:27:06 |
| 2026-08-06 07:05:13 | 07:06:27 |
| 2026-08-11 08:20:15 | 08:21:21 |
| 2026-08-16 10:00:14 | 10:01:31 |
| 2026-08-18 04:02:32 | 04:03:51 |
| 2026-08-18 09:02:57 | 09:04:22 |

いずれも `error_message` は NULL。**この13件がなぜ完了できたのかは portal 側からは特定できない**（8章）。

### 3-6. 処理ログがあるのに RUNNING のまま残っている 28件（全数・T-167 ダミー除く）

| バッチ起動 (UTC) | 処理ログ status | 氏名 | canSendReply | replyResult |
|--|--|--|--|--|
| 2026-08-18 09:31:00 | DUPLICATE_SKIP | 掛須 美音 | false | null |
| 2026-08-18 09:24:12 | DUPLICATE_SKIP | 掛須 美音 | false | null |
| 2026-08-18 09:16:26 | DUPLICATE_SKIP | 掛須 美音 | false | null |
| **2026-08-18 09:05:04** | **NORMAL** | **掛須 美音** | **true** | **SUCCESS** |
| 2026-08-09 23:20:13 | NORMAL | 池三津 雄哉 | true | null |
| 2026-07-29 23:27:51 | DUPLICATE_SKIP | 林 咲良 | false | null |
| 2026-07-29 23:23:47 | NORMAL | 林 咲良 | true | null |
| 2026-07-22 10:55:16 | NORMAL | 金森 莉奈 | true | null |
| 2026-07-16 14:25:15 | NORMAL | 納富 香梅 | true | null |
| 2026-06-25 03:50:15 | NORMAL | 吉田 涼夏 | true | null |
| 2026-06-11 06:55:17 | NORMAL | 秋山 友里 | true | null |
| 2026-06-02 00:45:17 | NORMAL | 吉田 芽依 | true | null |
| 2026-05-26 05:55:17 | FOREIGN_NG | PHAN HOANG HAI | false | null |
| 2026-05-26 02:05:38 | NORMAL | 中村 恵莉華 | true | null |
| 2026-05-26 00:55:37 | NORMAL | 長坂 梨穂 | true | null |
| 2026-05-23 11:05:24 | NORMAL | 古市 真理香 | true | SUCCESS |
| 2026-05-23 04:30:54 | DUPLICATE_SKIP | 大岡 梨沙 | false | SUCCESS |
| 2026-05-23 04:22:23 | DUPLICATE_SKIP | 大岡 梨沙 | false | SUCCESS |
| 2026-05-23 04:10:14 | NORMAL | 大岡 梨沙 | true | SUCCESS |
| 2026-05-23 02:06:57 | NORMAL | 大岡 梨沙 | true | SUCCESS |
| 2026-05-16 22:17:20 | NORMAL | 木田 朱夏 | true | null |
| 2026-05-16 22:12:23 | DUPLICATE_SKIP | 米澤 弥黎 | false | null |
| 2026-05-16 22:10:47 | NORMAL | 米澤 弥黎 | true | null |
| 2026-05-16 21:29:07 | NORMAL | 米澤 弥黎 | true | null |
| 2026-05-16 20:48:19 | NORMAL | 米澤 弥黎 | true | null |
| 2026-05-16 20:38:15 | AI_FAILED | (null) | false | null |
| 2026-05-16 20:35:11 | AI_FAILED | (null) | false | null |
| 2026-05-16 20:06:06 | AI_FAILED | (null) | false | null |

内訳: NORMAL 17件 / DUPLICATE_SKIP 7件 / AI_FAILED 3件 / FOREIGN_NG 1件。
2026-05-18 以降に限ると20件（うち NORMAL 13件）。**この20件分の応募者について完了通知は一切飛んでいない。**

### 3-7. 処理ログの総数と所属先

| 指標 | 件数 |
|--|--|
| `mynavi_rpa_processing_logs` 全件 | 438 |
| うち COMPLETED バッチに属する | 406 |
| うち RUNNING バッチに属する | 32（実運用28 + T-167ダミー4） |

**処理ログの 92.7%（406/438）は完了済みバッチに属している。** つまり「取り込んだ求職者の記録そのもの」はほぼ失われていない。壊れているのはバッチの状態管理と、そこに紐づく通知だけ。

---

## 4. B（続き）. 未完了がいつから発生しているか

### 4-1. 日別推移（JST日付・抜粋）

| JST日 | COMPLETED | RUNNING | うち処理ログ0件 |
|--|--|--|--|
| 2026-05-16 | 2 | 11 | 3 |
| 2026-05-17 | 1 | 2 | 2 |
| 2026-05-18〜21 | （起動記録なし） | — | — |
| 2026-05-22 | 3 | 41 | 37 |
| 2026-05-23 | 8 | 280 | 280 |
| 2026-05-24 | 8 | 279 | 279 |
| 2026-05-25 | 11 | 239 | 236 |
| 2026-05-26 | 7 | 281 | 281 |
| …（以降ほぼ一定） | 2〜11 | 277〜286 | ほぼ全件 |
| 2026-06-05 | 6 | 281 | 281 |

### 4-2. 完了率の時代比較

**処理ログが1件以上あるバッチ**

| 期間 | COMPLETED | RUNNING | 完了率 |
|--|--|--|--|
| 〜2026-05-17（リリース直後） | 3 | 8 | 27.3% |
| 2026-05-18〜 | 389 | 20 | **95.1%** |

**処理ログが0件のバッチ**

| 期間 | COMPLETED | RUNNING | 完了率 |
|--|--|--|--|
| 〜2026-05-17 | 0 | 3 | 0% |
| 2026-05-18〜 | 13 | 23,188 | **0.06%** |

### 4-3. 境目の解釈

- **「処理ログ0件のバッチが完了しない」問題に境目は無い。初日から一貫して 0% 前後。**
- **「処理ログありのバッチが完了しない」問題には境目がある。** 2026-05-17 を境に 27.3% → 95.1% に改善している。これは portal 側の `batch-finish` 400エラー修正で説明できる（4-4）。
- 件数が爆発した境目は **2026-05-22 → 05-23**（41件 → 280件/日）。これは PAD 側のスケジュールが5分間隔になったタイミングであり、**portal 側のデプロイとは無関係**（4-4）。

### 4-4. 境目前後の portal デプロイ（`git log` 照合）

| 日時（JST） | コミット | 内容 |
|--|--|--|
| 2026-05-16 20:40 | `3d92886` | feat(T-062): マイナビRPA新フロー Phase 1B 一括実装 ← **機能リリース。1件目のバッチはこの直後 2026-05-16 22:22 JST** |
| 2026-05-16 22:39 | `a77ac83` | fix(T-062): pdf-upload API で batchId を URL クエリからも受け取れるように（PAD multipart制約対応） |
| 2026-05-17 05:33〜06:17 | `6f53096` `9be0e82` `914eccd` `f85df53` | pdf-upload の Gemini 直呼び化・JSON ロバスト化・カラム追加 |
| **2026-05-17 06:42** | **`7984683`** | **fix(rpa): reply-sent / batch-finish 400エラー修正（JSON parse 失敗時のクエリパラメータ fallback + 日時フォーマット緩和）** |
| **2026-05-17 07:22** | **`b9a3176`** | **fix(T-062): reply-sent / batch-finish API のバリデーション完全緩和（PAD互換）** |
| 2026-05-17 08:19 | `a1c3355` | feat(rpa): GET /api/rpa/mynavi/last-execution 追加（T-062 Phase 2） |
| 2026-05-18 23:39〜2026-05-21 11:34 | `f7d5004` `23a9727` `1a786d3` `9c2dbee` `e628830` `b5dd034` | すべて RPA 無関係（BS書類・面談・エントリー） |
| **2026-05-21 11:34 〜 2026-05-23 21:26 の間に portal のコミットは1件も無い** | — | **件数が41→280件/日に爆発した 2026-05-22〜23 に portal 側の変更は存在しない** |

→ **2026-05-17 の `7984683` / `b9a3176`（batch-finish の 400 緩和）が「処理ログありバッチの完了率」を 27% → 95% に上げた変更。一方、処理ログ0件バッチの未完了は当時から今日まで一度も直っていない。**

---

## 5. C. `batch-finish` が呼ばれているかの確認

### 5-1. Railway 本番HTTPログの実測

Railway GraphQL `httpLogs`（deploymentId = `8f149cf1-3a16-4cb7-b8cb-9746945b24ff` / commit `92895f3` / 2026-08-18 14:12 UTC デプロイ）を `anchorDate` を変えて3回取得。いずれも同一結果:

- 取得ウィンドウ: **2026-08-18 14:16:04 〜 14:32:53 UTC（16分50秒）／全248リクエスト**
- そのうち `/api/rpa/` 配下:

| 時刻 (UTC) | メソッド | ステータス | パス |
|--|--|--|--|
| 14:20:12.811 | POST | **200** | `/api/rpa/mynavi/batch-start` |
| 14:25:12.016 | POST | **200** | `/api/rpa/mynavi/batch-start` |
| 14:30:13.534 | POST | **200** | `/api/rpa/mynavi/batch-start` |

**`batch-finish` は0件。`pdf-upload` も `reply-sent` も `last-execution` も0件。**

DB 側と完全に一致する（同ウィンドウの `RpaExecutionBatch` 最新5件はすべて RUNNING / 処理ログ0件）:

```
cmsyreyv900020xo857glplju  2026-08-18T14:30:13.505Z  RUNNING  log_count=0
cmsyr8i7u00010xo8gc1sdk3f  2026-08-18T14:25:11.992Z  RUNNING  log_count=0
cmsyr23cp00000xo8rfl9dvuk  2026-08-18T14:20:12.787Z  RUNNING  log_count=0
cmsyqvo0k000g0xms8gd99euz  2026-08-18T14:15:12.980Z  RUNNING  log_count=0
cmsyqp9dh00050xms208c5mk8  2026-08-18T14:10:14.069Z  RUNNING  log_count=0
```

### 5-2. `batch-finish` 内で更新がスキップされている可能性

**「届いているのに完了しない」ではなく「そもそも届いていない」。** 5-1 のとおり `batch-finish` へのリクエスト自体が0件のため、以下はいずれも該当しない:

| 想定されたスキップ要因 | 判定 |
|--|--|
| `batchId` 空 → 400（`batch-finish/route.ts:26-29`） | **非該当**（リクエストが無い） |
| `batchId` 不一致 → 404（同 31-40行） | **非該当** |
| 例外の握り潰し | **非該当**（`catch` は 500 を返し `notifyMynaviError` を出すので握り潰していない。同 84-92行） |
| 認証失敗 → 403（`src/lib/mynavi-rpa/auth.ts`） | **非該当**（403 のリクエスト自体が無い） |

なお `parseRpaRequestBody`（`src/lib/mynavi-rpa/parse-request-body.ts`）は 素JSON → URLエンコードJSON → form-urlencoded → クエリパラメータ の4段フォールバックを持つため、PAD が多少崩れた形式で送っても 400 になりにくい設計になっている（T-167 報告書 A-1）。

### 5-3. 別サービス（staging）に飛んでいる可能性の排除

`bizstudio-portal-staging` は本番と同一 Postgres を共有するため、そちらに `batch-finish` が飛んでいれば DB は更新されるはず。staging サービスの最新デプロイ（`83dcf403-3774-4005-911e-da00756b41ea` / 2026-08-17 04:15 UTC〜）の HTTP ログを取得したところ、全期間で **9リクエスト**しか無く、`/api/rpa/` 配下は **0件**。→ **PAD は本番サービスにしか到達していない。**

### 5-4. `batch-start` と `batch-finish` のリクエスト数比較（同一期間）

| 期間 | batch-start | batch-finish | 出典 |
|--|--|--|--|
| 2026-08-18 14:16:04〜14:32:53 UTC（HTTPログ実測） | **3** | **0** | 5-1 |
| 直近2日（DB から逆算：作成されたバッチ数 vs 完了したバッチ数） | **559** | **11**（成功分のみ） | 3-1 |
| 全期間（同上） | **23,624** | **405**（成功分のみ） | 3-1 |

**注意**: DB からの逆算は「成功した `batch-finish`」の数であり、400/404 で失敗したリクエストは数えられない。ただし 5-1 の実測で「リクエスト自体が0」であることを直接確認しているため、失敗リクエストが大量にある可能性は低い。**ただし直近2日全体の HTTP ログは取得できていない**（Railway は REMOVED デプロイの HTTP ログを返さず、今日だけで7回デプロイしているため。→ 8章）。

---

## 6. D. 波及範囲

### 6-1. バッチ完了通知（LINE WORKS）の発火状況

- 実装: `src/lib/mynavi-rpa/notify.ts:61-134`（`notifyMynaviBatchCompletion`）。呼び出しは `src/app/api/rpa/mynavi/batch-finish/route.ts:81` の**1箇所のみ**。
- 本番環境変数は設定済み（コンテナ上で確認）: `LINEWORKS_MYNAVI_BOT_ID`=設定あり / `LINEWORKS_MYNAVI_CHANNEL_ID`=設定あり / `PORTAL_BASE_URL`=`https://bizstudio-portal-production.up.railway.app`。→ `getMynaviChannel()`（`notify.ts:10-18`）の早期 return には掛からない。
- **直近2日の発火回数は 11回**（COMPLETED 件数と1対1）。うち 2回は処理ログ0件のバッチ（3-3 の #8 #9）なので「処理件数: 0件」という中身の薄い通知が出ているはず。
- **飛んでいない通知**: 直近2日で 548回分（うち処理ログありは 4回分）。全期間では 23,219回分（うち処理ログありは 28回分）。
- 「マイナビ転職応募取り込み 完了」の実メッセージがトークルームに存在するかは portal 側から確認できない（8章）。

### 6-2. `RpaExecutionBatch.status` を参照している画面・API・集計（全列挙）

| # | 場所 | 参照内容 | 未完了バッチが混ざることで数字が狂うか |
|--|--|--|--|
| 1 | `src/app/api/rpa/mynavi/last-execution/route.ts:18-22` | `findFirst({ where: { status: "COMPLETED" }, orderBy: { startedAt: "desc" } })` → 最新完了バッチの `startedAt` を返す | **狂わない（設計どおり）。ただし副作用が大きい** → 6-3 |
| 2 | `src/app/api/rpa-error/executions/route.ts:22-30` | `findMany` + `count`（status では絞らない） | **狂う。一覧の総件数が 23,625 になり実用性を失う** → 6-4 |
| 3 | `src/app/api/rpa-error/executions/[batchId]/route.ts:18-28` | 単一バッチ取得（status 非依存） | 狂わない |
| 4 | `src/app/(app)/rpa-error/executions/page.tsx:24-33, 133-141` | `status` を「実行中/完了/失敗」バッジに変換 | **狂わない（表示は正しい）が、ほぼ全行が「実行中」になる** |
| 5 | `src/app/(app)/rpa-error/executions/[batchId]/page.tsx:39-43` | 同上（詳細画面のバッジ） | 狂わない |
| 6 | `src/app/api/rpa/mynavi/batch-finish/route.ts:31-40, 65-79` | 完了処理そのもの | 狂わない |
| 7 | `src/app/api/rpa/mynavi/pdf-upload/route.ts:172-178` | `findUnique` で存在確認のみ（status 不問） | 狂わない |

`/rpa-error/stats`（統計タブ）や `/rpa-error/logs`（エラー一覧）は `RpaErrorLog` 系を見ており、`RpaExecutionBatch` は参照していない（`grep -rn "rpaExecutionBatch" src/` の全ヒットが上表のみ）。**件数系の集計（`totalCount` 等）は未完了バッチでは全て 0 のままなので、合計値を汚さない。**

### 6-3. `last-execution` への副作用（重要）

`last-execution` は「最新の **COMPLETED** バッチの `startedAt`」を返し、PAD 側はそこから現在までの範囲でメールを取得する設計（`route.ts:8-12` のコメント）。COMPLETED が2日で11件しかないため、**返る値が数時間〜1日以上前になる**。

COMPLETED バッチ間の間隔が12時間を超えたケース（上位）:

| 前回 COMPLETED | 次の COMPLETED | 間隔 |
|--|--|--|
| 2026-05-17 13:15 | 2026-05-23 01:11 | **131.95時間** |
| 2026-06-30 17:35 | 2026-07-02 10:30 | 40.92時間 |
| 2026-06-21 09:05 | 2026-06-23 00:05 | 39.00時間 |
| 2026-07-28 06:40 | 2026-07-29 14:40 | 32.00時間 |
| 2026-08-15 07:55 | 2026-08-16 09:30 | 25.58時間 |
| 2026-08-13 08:10 | 2026-08-14 09:10 | 25.00時間 |

24時間超の間隔が 8回発生している。PAD 側が「null のときは24時間前にフォールバック」する設計（`route.ts:11`）である以上、**24時間を超える間隔は想定を外れている**。ただし `DUPLICATE_SKIP` 判定があるため二重取り込みには至っていない（3-6 に DUPLICATE_SKIP が7件記録されており、実際にこの機構が働いている）。

**なお、5-1 の16分50秒の観測ウィンドウでは `last-execution` へのリクエストが0件だった。** 現行 PAD フローがこのエンドポイントを使っているかどうかは未確認（8章）。

### 6-4. 実行バッチ一覧画面の実用性

- 一覧は `TAKE = 20`（`src/app/(app)/rpa-error/executions/page.tsx:36`）、`startedAt` 降順、ステータス絞り込みフィルタは**無い**（`machineNumber` のみ。同 47-51行）。
- 総件数 23,625 → **総ページ数 1,182ページ**。
- 直近2日で意味のあるバッチは 11件／559件（2.0%）。**1ページ目20行はすべて「実行中・件数すべて0」で埋まる。** 直近の実バッチ（2026-08-18 11:15 UTC）にたどり着くには 14:30 時点で約39行＝2〜3ページめくる必要がある。
- **実用性を損なっている、と断定できる。** 表示自体はコード上正しく（`STATUS_LABEL` は `RUNNING → "実行中"`）、バグではなくデータ汚染の問題。

---

## 7. 修正案（実装しない・提案のみ）

### 7-1. 直すべきは portal 側か RPA（PAD）側か

**主因の修正は RPA（PAD）側。ただし portal 側にも通知抑制の追随修正が必須。**

理由:
- portal は「`batch-start` で作る」「`batch-finish` で閉じる」しか持たず、`batch-finish` が来ない以上、portal 単独では閉じようがない（2-4）。
- 「対象メールが0件だった」ことを知っているのは PAD だけ。portal 側はバッチが空のまま終わったのか、まだ走っているのかを区別できない。

### 7-2. 案

#### 案1（推奨・主対応）: PAD 側で `batch-finish` を必ず呼ぶ ＋ portal 側で0件通知を抑制

**PAD 側の具体的な指示（将幸さん向け）**

対象フロー: 7号機 `01.応募者一次返信・情報取り込み`

1. **「対象メール0件で終了する分岐」に `batch-finish` 呼び出しを追加する。**
   - 現状（推定）: `batch-start` で `%BatchId%` を取得 → Outlook からメール取得 → **件数0なら以降をスキップしてフロー終了**（この経路に `batch-finish` が無い）。
   - 追加位置: メール件数を判定する `If` の **0件側（Else）**、フロー終了アクションの直前。
   - 追加するアクション: 「Web サービスの呼び出し」（既存の `batch-finish` 呼び出しアクションをコピーするのが確実）
     - URL: `https://bizstudio-portal-production.up.railway.app/api/rpa/mynavi/batch-finish`
     - メソッド: `POST`
     - カスタムヘッダー: `x-rpa-secret: <既存と同じ値>` / `Content-Type: application/json`
     - 本文: `{"batchId":"%BatchId%"}`
   - `errorMessage` は付けないこと（付けると `status="FAILED"` になる。`batch-finish/route.ts:69`）。

2. **異常終了時にも `batch-finish` を呼ぶ。**
   - フロー全体を囲む「ブロックエラー発生時（On block error）」の処理に同じ Web サービス呼び出しを追加し、本文を `{"batchId":"%BatchId%","errorMessage":"%LastError%"}` にする。
   - これにより `status="FAILED"` として記録され、3-6 のような「処理ログはあるのに RUNNING のまま」のケースが今後は FAILED として可視化される。
   - 現状 `FAILED` は全期間0件（3-1）＝**この経路が一度も使われていない**ことの裏返しでもある。

3. **`%BatchId%` を必ずフロー変数に保持しておく。** 早期終了パスでも参照できるようにする（既にそうなっている場合は不要）。

**portal 側の追随修正（必須）**

- 案1をそのまま入れると、`batch-finish` が5分ごとに成功し、**LINE WORKS に「📊 マイナビ転職応募取り込み 完了 / 処理件数: 0件」が1日288回飛ぶ**ことになる。
- 対策: `src/app/api/rpa/mynavi/batch-finish/route.ts:81` の `notifyMynaviBatchCompletion(updated)` を、**`totalCount > 0` または `errorMessage` がある場合のみ**呼ぶよう条件を付ける。1行の追加で済む。
- 影響: 0件実行の通知だけが消える。T-167 の「送信失敗: N件」は `totalCount > 0` の場合にしか発生しないので影響なし。

**副次的な影響（要判断）**

- `last-execution`（`route.ts:18-22`）が返す `startedAt` が5分ごとに前進するようになる。これは本来の設計意図（「前回実行以降のメールを取る」）に近づくが、**現行 PAD が実際にこのエンドポイントを使っているか未確認**（8章）。使っている場合、メール取得ウィンドウが「数時間」から「5分」に一気に縮むため、**PAD の変更と同時に取りこぼしが起きないか実機で確認する必要がある**。

#### 案2（副次・portal 側の保険）: 未完了バッチの自動クローズ cron

- 新規 cron（例: 30分ごと）で「`status="RUNNING"` かつ `startedAt` が30分以上前」のバッチを一括クローズする。
- クローズ時の扱いを2分岐:
  - 処理ログ0件 → `status="NO_TARGET"`（新しい値）に更新し、**通知しない**。
  - 処理ログ1件以上 → `status="FAILED"` + `errorMessage="バッチが完了通知されないまま放置されました"` に更新し、**完了通知を発火**（これで 3-6 の取りこぼしが救済される）。
- 利点: PAD を触らずに済み、PAD 修正後も「取りこぼし保険」として機能する。既存の cron 実装パターン（`/api/internal/bookmarks/resubmit-stale`）を流用できる。
- 欠点: 対症療法。`finishedAt` が実際の終了時刻ではなくなる。

#### 案3（UI のみ）: 実行履歴一覧に状態フィルタを足す

- `/api/rpa-error/executions` に `status` / `hasLogs` クエリを追加し、画面のデフォルトを「処理ログありのみ」にする。
- 利点: 最小コスト（1画面 + 1API）。運用の痛みは即座に消える。
- 欠点: 根本原因は残る。完了通知が飛ばない問題（6-1）は解決しない。

**推奨の組み合わせ: 案1（PAD 修正 + portal の通知抑制）を本命とし、案2 を保険として同時に入れる。案3 は案2で `NO_TARGET` が付けば `status` フィルタだけで済むので、案2に含めて実装するのが効率的。**

### 7-3. 既存の未完了バッチ 23,219件（直近2日分 547件を含む）の扱い

| 案 | 内容 | 影響 |
|--|--|--|
| **A. 放置** | 何もしない | 一覧画面は1,182ページのまま使えない。集計値は汚れない（`totalCount` 等は全て0）。`last-execution` にも影響なし。**運用の痛みが残り続ける** |
| **B. 一括クローズ（新ステータス）** | 処理ログ0件の RUNNING 23,190件を `status="NO_TARGET"` に UPDATE。処理ログありの28件は `status="FAILED"` + `errorMessage` を付与 | 一覧に状態フィルタを足せば実用性が戻る。**`last-execution` は `COMPLETED` のみを見るので影響なし（重要）**。`STATUS_LABEL` / `STATUS_STYLE`（`executions/page.tsx:24-33`、`[batchId]/page.tsx:39-43`）に `NO_TARGET` のラベル追加が必要 |
| **C. 一括 COMPLETED 化** | 処理ログ0件の RUNNING を `status="COMPLETED"` に UPDATE | **危険。非推奨。** `last-execution` が返す `startedAt` が「最後のカラ実行」に飛び、PAD のメール取得ウィンドウが意図せず変わる。過去の実行が「正常完了した」と誤って記録される |
| **D. 物理削除** | 処理ログ0件の RUNNING 23,190行を DELETE | 一覧が完全に実用的になり、テーブルも軽くなる。FK は `onDelete: Cascade` だが対象は処理ログ0件なので巻き添え削除は起きない。**ただし「RPA が5分ごとに起動していた」死活記録が失われる**（RPA が止まったことに気づく手掛かりが消える） |

**推奨: 案B（`NO_TARGET` への一括クローズ）。** 削除せずに済み、`last-execution` を壊さず、死活記録も残る。実行前に `SELECT count(*)` で対象件数を確認し、`status='RUNNING' AND NOT EXISTS (処理ログ)` の条件で UPDATE する。処理ログありの28件は件数が少ないので、個別に確認してから FAILED 化するのが安全。

**注意: T-167 検証用ダミー `t167-verify-20260818`（処理ログ4件・RUNNING）は一括処理の対象から除外すること。**

---

## 8. 未確認事項

推測で埋めず、確認できていないことを列挙する。

1. **PAD フローの内部構造。** 本調査で確認できたのは「`batch-start` は portal に届いているが `batch-finish` は届いていない」という事実のみ。**「対象メール0件のときに早期終了して `batch-finish` を呼ばない」という因果は portal 側からは直接確認していない。** PAD のフロー図（分岐構造）を開いて確認する必要がある。
2. **処理ログ0件なのに COMPLETED になった13件（3-5）が通ったパス。** 何が通常の空振り実行と違ったのか特定できていない。特に 2026-07-31 05:00:30 開始・14:23:13 完了（9時間23分）の1件は挙動が異質。
3. **処理ログがあるのに RUNNING で残った28件（3-6）の原因。** PAD の異常終了か、`batch-finish` のリクエストがネットワーク的に届かなかったのか、区別できていない。`FAILED` が全期間0件であることから、少なくとも「PAD が `errorMessage` 付きで `batch-finish` を呼ぶ経路」は一度も動いていない。
4. **毎時02〜03分ごろの追加起動（3-3）が何のトリガーか。** 5分周期とは別系統の起動が存在するが、Power Automate Cloud のどのフロー／スケジュールに対応するか未確認。
5. **`GET /api/rpa/mynavi/last-execution` が現行 PAD から呼ばれているか。** 16分50秒の観測ウィンドウでは0件だったが、これだけでは「使われていない」と断定できない。案1を入れる前に確認が必要（7-2 の副次的影響に直結）。
6. **直近2日全体の HTTP リクエスト履歴。** Railway は REMOVED デプロイの `httpLogs` を返さず（過去5デプロイで COUNT 0 を確認）、2026-08-18 だけで7回デプロイしているため、**取得できたのは 14:16:04〜14:32:53 UTC の16分50秒分のみ**。「直近2日で `batch-finish` が何回・どのステータスで届いたか」は HTTP ログとしては未確認（DB からの逆算では成功11回）。
7. **LINE WORKS トークルーム「マイナビ転職応募取り込み」の実メッセージ。** portal 側から確認できるのは `sendBotMessage` を呼んだかどうかまで。`notify.ts:131-133` は送信例外を `console.error` で握るため、送信自体が失敗していても DB 上は COMPLETED になる。実際にメッセージが届いているかはトークルームを目視する必要がある。
8. **`RpaExecutionBatch.machineNumber` が常に 7 である理由。** `batch-start/route.ts:19-20` は body の `machineNumber` を読むが、実データは全件7。PAD が送っていないため既定値7になっているのか、実際に7を送っているのかは未確認。

---

## 9. 実装記録（Step2 / 2026-08-18）

### 9-1. 方針

**portal 側のみで完結。RPA（PAD）側は一切変更していない。**
「一定時間経っても RUNNING で、かつ処理ログが0件」のバッチを新しい状態値 **`NO_TARGET`（対象なし）** に畳む。

`COMPLETED` にはしない。`last-execution` が「最新 COMPLETED の `startedAt`」をメール取得ウィンドウの基点として返すため（6-3）、空振りバッチを COMPLETED にすると取りこぼしが発生する。

### 9-2. 状態カラムの型とマイグレーションの有無

**`RpaExecutionBatch.status` は Prisma enum ではなく `String`（`prisma/schema.prisma:1369`、`@default("RUNNING")`、DB制約なし）。**
したがって **マイグレーションは不要**。スキーマ変更も行っていない（コメント上の宣言値のみ `NO_TARGET` を追加）。

### 9-3. 追加・変更ファイル

| ファイル | 内容 |
|--|--|
| `src/lib/mynavi-rpa/no-target.ts` | **新規**。状態値定数 `RPA_BATCH_STATUS_NO_TARGET`、しきい値の env 読み取り、判定条件ビルダ `buildNoTargetWhere()`、クローズ実行 `closeStaleNoTargetBatches()` |
| `src/app/api/rpa/mynavi/batch-start/route.ts` | バッチ作成直後に `closeStaleNoTargetBatches()` を呼ぶ。try/catch で隔離し、掃除が失敗しても batch-start 本体は 200 を返す |
| `src/app/api/rpa-error/executions/route.ts` | 既定で `status != NO_TARGET` に絞る。`?includeNoTarget=1` で解除 |
| `src/app/(app)/rpa-error/executions/page.tsx` | `NO_TARGET` → ラベル「対象なし」・グレーバッジ。「対象なし（空振り）も表示」チェックボックス追加（既定OFF）。件数表示に「（対象なしを除く）」を併記 |
| `src/app/(app)/rpa-error/executions/[batchId]/page.tsx` | 詳細画面のバッジラベルに「対象なし」を追加 |
| `scripts/close-no-target-batches-t168.ts` | **新規**。過去分の一括クリーンアップ（`--dry-run` 既定 / `--execute`） |

### 9-4. 自動クローズの判定条件と設定値

発火場所は **`batch-start` 内**（新規 cron を増やさない／5分に1回必ず呼ばれるので実質リアルタイム）。

判定条件（全て AND、`updateMany` 1発の WHERE に全部含めて SELECT→UPDATE のレースを回避）:

- `status = "RUNNING"`
- `processingLogs: { none: {} }`（処理ログ0件）
- `startedAt < now - staleMinutes`
- `id NOT IN (今作成したバッチ)`

更新内容は `status = "NO_TARGET"` / `finishedAt = now` のみ。他カラムは触らない。

| 設定 | 環境変数 | 既定 |
|--|--|--|
| 経過時間しきい値（分） | `RPA_NO_TARGET_STALE_MINUTES` | 30 |
| 1回の掃除の上限件数 | `RPA_NO_TARGET_CLOSE_LIMIT` | 500 |

日時比較は UTC instant 同士（経過時間の比較なので JST 変換は不要。罠#17 は表示・暦日比較の話）。
掃除件数は 0件でも `[rpa/mynavi/batch-start] no-target cleanup: closed=N ...` としてログ出力する。

### 9-5. 過去分一括クリーンアップの実行結果（本番）

実行経路: `railway ssh --service bizstudio-portal` 上で `npx tsx`（`railway run` は不使用）。

| 項目 | 値 |
|--|--|
| dry-run 実行時刻 | 2026-08-18 14:54:19 UTC |
| dry-run 対象件数 | **23,189 件**（Step1 の 23,190件と一致。差分は 30分ウィンドウ内の直近6件） |
| `--execute` 更新件数 | **23,189 件**（1,000件チャンク × 24回 + 空振り確認1回） |

実行前後の件数:

| status | 実行前 | 実行後 |
|--|--|--|
| RUNNING | 23,224（うち処理ログあり **29**） | **35**（うち処理ログあり **29**） |
| NO_TARGET | 0 | **23,189** |
| COMPLETED | 405 | 405 |
| FAILED | 0 | 0 |

- **処理ログありの RUNNING は 29件のまま不変**（実運用28件 + T-167 検証ダミー1件）。28件の原因調査対象は温存されている。
- **`t167-verify-20260818` は `RUNNING` / `finishedAt=NULL` のまま**残っている（実行後スナップショットで確認）。
- 実行後 RUNNING 35件 = 処理ログあり29件 + 30分ウィンドウ内の直近6件。後者は次回以降の `batch-start` が畳む。

### 9-6. `last-execution` の実行前後比較

```
BEFORE last-execution: {"lastStartedAt":"2026-08-18T11:15:16.268Z"}
AFTER  last-execution: {"lastStartedAt":"2026-08-18T11:15:16.268Z"}
```

**完全一致。** COMPLETED のみを参照しており、NO_TARGET 化はウィンドウに影響しない（設計どおり）。

### 9-7. D-2（6-2）の status 参照箇所への影響確認

| # | 場所 | NO_TARGET 追加の影響 | 対応 |
|--|--|--|--|
| 1 | `last-execution` | なし（`status: "COMPLETED"` 固定） | 対応不要（9-6 で実測確認） |
| 2 | `rpa-error/executions` API | 一覧・総件数に 23,189件が混ざる | **修正**（既定で除外・`includeNoTarget=1` で表示） |
| 3 | `rpa-error/executions/[batchId]` API | なし（単一取得・status 非依存） | 対応不要 |
| 4 | 一覧画面 `page.tsx` | ラベル未定義だと生の `NO_TARGET` が出る | **修正**（「対象なし」＋グレーバッジ） |
| 5 | 詳細画面 `[batchId]/page.tsx` | 同上 | **修正**（「対象なし」） |
| 6 | `batch-finish` | `where: { id }` のみで status 不問。NO_TARGET 化後に PAD が遅れて `batch-finish` を呼べば COMPLETED に上書きされる | **対応不要・むしろ正しい挙動**。PAD は5分間隔・しきい値は30分なので実運用で起こらない。起きた場合も「本物の完了が勝つ」で整合 |
| 7 | `pdf-upload` | なし（存在確認のみ・status 不問） | 対応不要 |

件数系の集計（`totalCount` 等）は NO_TARGET バッチでは全て 0 のままなので合計値を汚さない。`/rpa-error/stats` と `/rpa-error/logs` は `RpaErrorLog` 系のみを見ており `RpaExecutionBatch` を参照していない。

### 9-8. 残る課題

- **処理ログありで RUNNING の 28件は未解決のまま。** 本改修の対象外（原因調査のため意図的に温存）。この28件に紐づく応募者の完了通知は今後も飛ばない。
- 空振り時に `batch-finish` を呼ばない PAD 側の挙動そのものは直していない。portal 側で毎回1件ずつ NO_TARGET が積み上がる（1日約288件）が、一覧の既定フィルタで隠れるため実用性は損なわれない。

### 9-9. 本番デプロイ後の実機確認（コミット `52d5ddf` / 2026-08-18 15:0x UTC）

**① `batch-start` 内の自動クローズが実際に動いた（Railway ログ実測）**

```
[rpa/mynavi/batch-start] no-target cleanup: closed=2 staleMinutes=30 limit=500 threshold=2026-08-18T14:30:18.797Z
[rpa/mynavi/batch-start] no-target cleanup: closed=0 staleMinutes=30 limit=500 threshold=2026-08-18T14:35:12.290Z
```

デプロイ後の1回目の PAD 起動で、30分しきい値を超えた空振り2件を畳んだ。2回目は対象なしで `closed=0`（0件でもログを出す仕様どおり）。以降は毎回1件ずつ畳まれ、RUNNING が溜まらなくなる。

**② デプロイ後の DB 状態**

| status | 件数 |
|--|--|
| COMPLETED | **405**（変化なし） |
| RUNNING | **36**（うち処理ログあり **29** / 処理ログなし 7 = 30分ウィンドウ内） |
| NO_TARGET | **23,191**（一括 23,189 + 自動クローズ 2） |
| FAILED | 0 |

- `NO_TARGET` かつ処理ログありの件数 = **0件**。処理ログのあるバッチは一切触れていないことを直接確認。
- `t167-verify-20260818` → `{"status":"RUNNING","finishedAt":null}`。**RUNNING のまま温存されている。**

**③ 一覧 API の既定フィルタ（本番・実セッションで実測）**

| リクエスト | HTTP | total |
|--|--|--|
| `GET /api/rpa-error/executions?take=1` | 200 | **441** |
| `GET /api/rpa-error/executions?take=1&includeNoTarget=1` | 200 | **23,632** |

441 = COMPLETED 405 + RUNNING 36。**総ページ数 1,182 → 23 ページに縮小**し、1ページ目に意味のあるバッチが並ぶようになった。トグルONで従来どおり全件（23,632）が見える。

**④ `last-execution`（デプロイ後）**

```
{"lastStartedAt":"2026-08-18T11:15:16.268Z"}
```

一括クリーンアップ前・後・デプロイ後の3時点で完全一致。

---

# 10. 処理ログありで未完了の28件 詳細調査（Step3 / 2026-08-19）

- 調査日: 2026-08-19（DB スナップショット 2026-08-18 15:4x UTC＝2026-08-19 00:4x JST）
- 対象リポジトリ: bizstudio-portal（branch master / HEAD `dd3889b`）
- 調査範囲: **本番DBの SELECT のみ**・Railway GraphQL の `httpLogs` / `deployments` 読み取り・コード読み取り。
  **製品コードの変更・マイグレーション・DB書き込みは一切していない。`railway run` も未使用。28件の `status` は RUNNING のまま。**
- 対象は「`status="RUNNING"` かつ処理ログ1件以上」の **29件から T-167 検証用ダミー `t167-verify-20260818`（処理ログ4件）を除外した 28件**。ダミーには一切触れていない。
- 日時表示はすべて **JST**（`toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'})`。罠#17 のため `toISOString().slice()` 系は不使用）。HTTPログの生タイムスタンプのみ UTC 表記（`Z` 付き）。

---

## 10-1. 結論サマリ

### 1. 実害のある応募者（返信されないまま埋もれた人）

**「返信されないまま埋もれた」と断定できる応募者は 0 人。断定できないが要確認が 5 人。**

- 28件の処理ログに現れる実在の応募者は **15 名**（うち返信対象＝`canSendReply=true` の経験があるのは 13 名）。
- そのうち **portal 側に返信記録（`replySentAt` または `CandidateSettingsHistory`）が一切ない**のは **10 名**。
- その10名のうち **5 名は面談まで到達済み**（実害なし・後から救済済み）。残り **5 名は現在も `supportStatus=BEFORE` かつ面談0件**。
- ただし **`replySentAt` の欠測は「返信していない」証拠にならない**。2026-05-25〜2026-07-19 の約8週間、**完了済み（COMPLETED）バッチでも `reply-sent` がほぼ呼ばれておらず**（2026-06 の記録率 2.0%）、記録の欠落が当時の常態だったため（10-4-4）。
- 記録率が回復した 2026-07-20 以降に限れば、記録欠落は明確な異常。該当は **金森 莉奈・林 咲良の2名**（10-5-6）。
- **portal は「マイナビ管理画面で実際に返信メッセージが送られたか」を知る手段を持たない。** したがって最終的な実害判定は7号機／マイナビ管理画面側の確認が必要（10-8）。

要確認の5名（会員No は `Candidate.mynaviMemberNo`。空欄は未取得）:

| 氏名 | 求職者番号 | マイナビ会員No | 応募日(JST) | 現在の支援ステータス | 面談 | 判定の強さ |
|--|--|--|--|--|--|--|
| 金森 莉奈 | 5008278 | 1011179725 | 2026-07-22 | BEFORE（担当CA未設定） | 0件 | **強**（当時の記録率 97%） |
| 林 咲良 | 5008322 | （なし） | 2026-07-29 | BEFORE（担当CA未設定） | 0件 | **強**（当時の記録率 93%） |
| 納富 香梅 | 5008249 | 1012368327 | 2026-07-16 | BEFORE（担当CA未設定） | 0件 | 弱（当時の記録率ほぼ0%） |
| 吉田 涼夏 | 5008125 | （なし） | 2026-06-25 | BEFORE（担当CA未設定） | 0件 | 弱（同上） |
| 吉田 芽依 | 5008016 | （なし） | 2026-06-02 | BEFORE（担当CA未設定） | 0件 | 弱（同上） |

### 2. 原因の仮分類の内訳

| 分類 | 件数 | 根拠 |
|--|--|--|
| **PAD の異常終了**（`pdf-upload` のクライアント側タイムアウト → 後続API 400 → フロー中断） | **4** | Railway HTTPログに `pdf-upload` の **499**（クライアント切断）が記録され、以降 `batch-finish` が来ていない（10-6-2） |
| **PAD の異常終了**（`pdf-upload` は 200 で返っているのに以降の呼び出しが無い） | **6** | HTTPログで `batch-start`→`pdf-upload 200` まで確認、`reply-sent` / `batch-finish` の**リクエスト自体が存在しない**（10-6-2） |
| **PAD の異常終了**（`reply-sent` 200 の後で停止） | **1** | `batch-start`→`pdf-upload`→`reply-sent` すべて 200、`batch-finish` のみ無し（10-3-1） |
| **既知の400エラー（2026-05-17 修正前・再デプロイ中）** | **8** | 全8件のバッチ実行窓の中に portal の本番デプロイが入っている。修正コミット `7984683` / `b9a3176` の当日分（10-4-3, 10-6-5） |
| **不明**（HTTPログが取得できず、DBからは経路を特定できない） | **9** | 2026-05-23（5件）/ 05-26（3件）/ 06-02（1件） |

**「通信断（`batch-finish` は呼ばれたが portal に届かなかった）」に該当すると確認できたものは 0 件。** ただし Railway の HTTPログはエッジ到達時点の記録なので、PAD の端末〜Railway 間で完全にパケットが落ちた場合も同じく「記録なし」になる。**この2つは portal 側からは区別できない**（10-8）。

### 3. 直すべきは portal 側か RPA（PAD）側か

**主因は PAD（7号機）側。** 28件すべてで `batch-finish` の HTTP リクエストが portal に届いていない（届いた形跡のあるものは0件）。portal 側は `batch-start` / `pdf-upload` / `reply-sent` に対して **一度も拒否していない**（4xx を返したのは「`processingLogId` が空の `reply-sent`」だけで、これは PAD が変数未設定のまま呼んだもの）。

**ただし portal 側だけでも通知の取りこぼしは塞げる。** Step2 で入れた `NO_TARGET` 自動クローズと同じ場所に「処理ログありの stale バッチ」の分岐を足せばよい（10-9-1 案A）。

---

## 10-2. A. 28件の一覧

`t167-verify-20260818`（`flow_name` = `01.応募者一次返信・情報取り込み【T-167検証用ダミー】`・処理ログ4件・RUNNING）は **本表から除外**した。DB上もそのまま RUNNING で温存されている（触っていない）。

28件は **すべて処理ログ1件**。`machineNumber`=7 / `flowName`=`01.応募者一次返信・情報取り込み` / `finishedAt`=NULL / `errorMessage`=NULL / 7カウンタすべて0 で共通。

| # | batchId | 開始(JST) | ログ数 | 最終ログ `processedAt`(JST) | 経過 | ログ `status` 内訳 | `replySentAt` 有/無 | `replyResult` 内訳 | 氏名 |
|--|--|--|--|--|--|--|--|--|--|
| 1 | `cmsygq5yp01ef0xllkf87ge3f` | 2026-08-18 18:31:00 | 1 | 2026-08-18 18:32:43 | 1分43秒 | DUPLICATE_SKIP 1 | 0 / 1 | NULL 1 | 掛須 美音 |
| 2 | `cmsyghf3a01ec0xllso842ruq` | 2026-08-18 18:24:12 | 1 | 2026-08-18 18:25:47 | 1分35秒 | DUPLICATE_SKIP 1 | 0 / 1 | NULL 1 | 掛須 美音 |
| 3 | `cmsyg7g2m01e90xllfyv2vwgp` | 2026-08-18 18:16:26 | 1 | 2026-08-18 18:17:50 | 1分24秒 | DUPLICATE_SKIP 1 | 0 / 1 | NULL 1 | 掛須 美音 |
| 4 | `cmsyfstvi01cz0xll9tmgqp6c` | 2026-08-18 18:05:04 | 1 | 2026-08-18 18:06:38 | 1分33秒 | NORMAL 1 | 1 / 0 | SUCCESS 1 | 掛須 美音 |
| 5 | `cmsmfdvnx00sa0xt2bgnbwtj5` | 2026-08-10 08:20:13 | 1 | 2026-08-10 08:22:23 | 2分10秒 | NORMAL 1 | 0 / 1 | NULL 1 | 池三津 雄哉 |
| 6 | `cms6ptbwo02x00xm9wcsi8uus` | 2026-07-30 08:27:51 | 1 | 2026-07-30 08:31:11 | 3分20秒 | DUPLICATE_SKIP 1 | 0 / 1 | NULL 1 | 林 咲良 |
| 7 | `cms6po3ya02wv0xm91dvhrxf4` | 2026-07-30 08:23:47 | 1 | 2026-07-30 08:27:13 | 3分26秒 | NORMAL 1 | 0 / 1 | NULL 1 | 林 咲良 |
| 8 | `cmrvyujgk00ax1dqvwizw2nhs` | 2026-07-22 19:55:16 | 1 | 2026-07-22 19:56:48 | 1分32秒 | NORMAL 1 | 0 / 1 | NULL 1 | 金森 莉奈 |
| 9 | `cmrnlpham010d1dmivumsvhu4` | 2026-07-16 23:25:15 | 1 | 2026-07-16 23:28:25 | 3分10秒 | NORMAL 1 | 0 / 1 | NULL 1 | 納富 香梅 |
| 10 | `cmqsyryir005c1dt6jmaq9inm` | 2026-06-25 12:50:15 | 1 | 2026-06-25 12:54:25 | 4分11秒 | NORMAL 1 | 0 / 1 | NULL 1 | 吉田 涼夏 |
| 11 | `cmq957zr3000d1doafkzlrcbs` | 2026-06-11 15:55:17 | 1 | 2026-06-11 15:59:46 | 4分29秒 | NORMAL 1 | 0 / 1 | NULL 1 | 秋山 友里 |
| 12 | `cmpvx1iiw00181dpmi10cfve2` | 2026-06-02 09:45:17 | 1 | 2026-06-02 09:49:50 | 4分33秒 | NORMAL 1 | 0 / 1 | NULL 1 | 吉田 芽依 |
| 13 | `cmpm817ma000e1dpauct0s4q6` | 2026-05-26 14:55:17 | 1 | 2026-05-26 14:59:00 | 3分43秒 | FOREIGN_NG 1 | 0 / 1 | NULL 1 | PHAN HOANG HAI |
| 14 | `cmplztvlg00851dplydqnnq4n` | 2026-05-26 11:05:38 | 1 | 2026-05-26 11:08:52 | 3分14秒 | NORMAL 1 | 0 / 1 | NULL 1 | 中村 恵莉華 |
| 15 | `cmplxbu6e00741dpltgamxjwr` | 2026-05-26 09:55:37 | 1 | 2026-05-26 09:57:32 | 1分54秒 | NORMAL 1 | 0 / 1 | NULL 1 | 長坂 梨穂 |
| 16 | `cmpi8sgc400411dpc73xo4eig` | 2026-05-23 20:05:24 | 1 | 2026-05-23 20:08:14 | 2分51秒 | NORMAL 1 | 1 / 0 | SUCCESS 1 | 古市 真理香 |
| 17 | `cmphup52w002j1dpczmghyo3n` | 2026-05-23 13:30:54 | 1 | 2026-05-23 13:33:40 | 2分45秒 | DUPLICATE_SKIP 1 | 1 / 0 | SUCCESS 1 | 大岡 梨沙 |
| 18 | `cmphue6a0002h1dpc5qh9ok6r` | 2026-05-23 13:22:23 | 1 | 2026-05-23 13:25:01 | 2分39秒 | DUPLICATE_SKIP 1 | 1 / 0 | SUCCESS 1 | 大岡 梨沙 |
| 19 | `cmphtyk9t002c1dpcuhqzv8fp` | 2026-05-23 13:10:14 | 1 | 2026-05-23 13:13:00 | 2分45秒 | NORMAL 1 | 1 / 0 | SUCCESS 1 | 大岡 梨沙 |
| 20 | `cmphpk03s001p1dpc7rjb45nf` | 2026-05-23 11:06:57 | 1 | 2026-05-23 11:09:20 | 2分23秒 | NORMAL 1 | 1 / 0 | SUCCESS 1 | 大岡 梨沙 |
| 21 | `cmp8wpm2900061drslylyberh` | 2026-05-17 07:17:20 | 1 | 2026-05-17 07:17:33 | 13秒 | NORMAL 1 | 0 / 1 | NULL 1 | 木田 朱夏 |
| 22 | `cmp8wj8ke00041drs5jnp1hlz` | 2026-05-17 07:12:23 | 1 | 2026-05-17 07:12:29 | 6秒 | DUPLICATE_SKIP 1 | 0 / 1 | NULL 1 | 米澤 弥黎 |
| 23 | `cmp8wh6ta00001drs95psz16q` | 2026-05-17 07:10:47 | 1 | 2026-05-17 07:12:15 | 1分28秒 | NORMAL 1 | 0 / 1 | NULL 1 | 米澤 弥黎 |
| 24 | `cmp8uzlfn00001dqlj18u922y` | 2026-05-17 06:29:07 | 1 | 2026-05-17 06:29:18 | 11秒 | NORMAL 1 | 0 / 1 | NULL 1 | 米澤 弥黎 |
| 25 | `cmp8tj4vp00001dp2x8tinezf` | 2026-05-17 05:48:19 | 1 | 2026-05-17 05:48:31 | 12秒 | NORMAL 1 | 0 / 1 | NULL 1 | 米澤 弥黎 |
| 26 | `cmp8t673e00001dmyzlc1kryc` | 2026-05-17 05:38:15 | 1 | 2026-05-17 05:38:26 | 11秒 | AI_FAILED 1 | 0 / 1 | NULL 1 | (null) |
| 27 | `cmp8t295m00021dmjjhbvwlc4` | 2026-05-17 05:35:11 | 1 | 2026-05-17 05:35:13 | 2秒 | AI_FAILED 1 | 0 / 1 | NULL 1 | (null) |
| 28 | `cmp8s0u4a00001dmjbvhuuwst` | 2026-05-17 05:06:06 | 1 | 2026-05-17 05:06:08 | 2秒 | AI_FAILED 1 | 0 / 1 | NULL 1 | (null) |

**集計**

| 指標 | 値 |
|--|--|
| バッチ数 | 28（すべて処理ログ1件・合計28ログ） |
| 処理ログ `status` 内訳 | NORMAL 17 / DUPLICATE_SKIP 7 / AI_FAILED 3 / FOREIGN_NG 1 |
| `replySentAt` あり / なし | **6 / 22** |
| `replyResult` 内訳 | NULL 22 / SUCCESS 6 / **FAILED 0** |
| `canSendReply` true / false | 19 / 9 |
| 開始→最終ログの経過時間 | 最短 2秒・最長 4分33秒・中央値 約2分45秒 |
| `candidateId` が NULL のログ | **11件**（AI_FAILED 3・DUPLICATE_SKIP 5・NORMAL 3） |

`candidateId` が NULL の NORMAL 3件（#23 #24 #25 米澤 弥黎）は、RPA が採番した求職者番号 5007913 / 5007914 / 5007915 が **現在 `candidates` に存在しない**（重複として後から削除され、`onDelete: SetNull` で NULL 化された）。同姓同名の実レコードは 2026-05-15 登録の 5007904。#7（林 咲良）も同様で、RPA が採番した 5008321 は現在**別人（西田 萌香）**に再利用されており、林 咲良の実レコードは 2026-07-30 10:05 に手動登録された 5008322（`applicationRoute="紹介"`）。

**付随発見（本チケット対象外）: `replySentAt` の値が9時間ずれている。** 例: #4 は処理が 2026-08-18 18:06:38 JST なのに `replySentAt` は 2026-08-19 03:06:58 JST として保存されている。原因は `src/app/api/rpa/mynavi/reply-sent/route.ts:16-21` の `parseDateLoose()` で、`"2026/08/18 18:06:58"` 形式を `new Date(y, mo-1, d, h, mi, s)`（**サーバのローカル時刻**）として解釈しているため。本番コンテナの TZ は未設定＝UTC（`process.env.TZ=(unset)` / `getTimezoneOffset()=0` を実機確認）なので、PAD が送る JST 壁時計値が UTC として保存され +9時間ずれる。**罠#17 の典型。T-167 の領域なので本調査では修正しない。**

---

## 10-3. B. 止まり方のパターン分類

`canSendReply=false` のログ（DUPLICATE_SKIP / AI_FAILED / FOREIGN_NG）は**そもそも一次返信の対象外**なので、「`replySentAt` なし」を単純に「返信の途中で止まった」と数えると誤る。そこで指定の3分類に `canSendReply` の軸を足して集計した。

| 分類 | 件数 | 内訳 |
|--|--|--|
| **1. 処理ログが全て `replySentAt` あり**（返信まで終わっているのに完了通知だけ来ていない） | **6** | #4 #16 #17 #18 #19 #20 |
| **2. 処理ログの一部または全部が `replySentAt` なし**（返信の途中で止まった） | **22** | 下記2つに細分 |
| &nbsp;&nbsp;2-a. `canSendReply=true` なのに `replySentAt` なし＝**返信記録が落ちている** | 13 | #5 #7 #8 #9 #10 #11 #12 #14 #15 #21 #23 #24 #25 |
| &nbsp;&nbsp;2-b. `canSendReply=false`＝**そもそも返信対象外**（記録が無いのは正常） | 9 | #1 #2 #3 #6 #13 #22 #26 #27 #28 |
| **3. その他** | **0** | — |

### 10-3-1. パターン1の代表例（実データ）

**#4 `cmsyfstvi01cz0xll9tmgqp6c`（2026-08-18 18:05:04 開始 / 掛須 美音）**

Railway HTTPログ（deploymentId `f8f323c2-7213-4c5b-b9a9-2d6cebf52d38` / commit `7ee8fcd`）で全経路を確認できた:

```
2026-08-18T09:05:04.855Z POST 200 /api/rpa/mynavi/batch-start
2026-08-18T09:06:38.348Z POST 200 /api/rpa/mynavi/pdf-upload
2026-08-18T09:06:59.289Z POST 200 /api/rpa/mynavi/reply-sent
（以降 batch-finish のリクエストは存在しない）
```

DB 側:

```
処理ログ  status=NORMAL  canSendReply=true  replyResult=SUCCESS
          processedAt = 2026-08-18 18:06:38 JST
          updatedAt   = 2026-08-18 18:06:58 JST   ← reply-sent が書き込んだ時刻
CandidateSettingsHistory  candidateId=cmsyfuo8q01d50xllc1visbm4（掛須 美音 / 5008438）
          sendType=MYNAVI_FIRST_REPLY  sendResult=SUCCESS
          templateName=【日程調整】初回メッセージ  senderName=藤本 夏海
          createdAt = 2026-08-18 18:06:59 JST
バッチ     status=RUNNING  finishedAt=NULL  totalCount=0
```

→ **一次返信は完了しており、実害は無い。落ちているのはバッチのクローズと完了通知だけ。**

**#20 `cmphpk03s001p1dpc7rjb45nf`（2026-05-23 11:06:57 開始 / 大岡 梨沙）**

```
処理ログ  status=NORMAL  canSendReply=true  replyResult=SUCCESS
          processedAt = 2026-05-23 11:09:20 JST / updatedAt = 11:09:22 JST
CandidateSettingsHistory  candidateId=cmphpmykx001q1dpccwswnnqe（大岡 梨沙 / 5007940）
          MYNAVI_FIRST_REPLY / SUCCESS / createdAt = 2026-05-23 11:09:22 JST
バッチ     status=RUNNING  finishedAt=NULL
```

同じく返信は完了。以後 #19 → #18 → #17 と同一電話番号 08084551016 が3回再処理され、いずれも `replyResult=SUCCESS` を記録している（うち2回は DUPLICATE_SKIP にもかかわらず SUCCESS）。

### 10-3-2. パターン2の代表例（実データ）

**#8 `cmrvyujgk00ax1dqvwizw2nhs`（2026-07-22 19:55:16 開始 / 金森 莉奈）** — 2-a の代表

Railway HTTPログ（commit `5293561`・当該窓は全区間取得）:

```
2026-07-22T10:55:16.508Z POST 200 /api/rpa/mynavi/batch-start
2026-07-22T10:56:48.896Z POST 200 /api/rpa/mynavi/pdf-upload
（このバッチに対する reply-sent / batch-finish は無い）
2026-07-22T11:00:24.273Z POST 200 /api/rpa/mynavi/batch-start   ← 次の実行
2026-07-22T11:01:10.367Z POST 400 /api/rpa/mynavi/reply-sent    ← processingLogId 空
2026-07-22T11:01:12.013Z POST 200 /api/rpa/mynavi/batch-finish  ← 次の実行は完了（処理ログ0件）
```

DB 側: 処理ログは `NORMAL` / `canSendReply=true` / `replySentAt=NULL` / `replyResult=NULL`。
**この電話番号（08036709810）の処理ログは全期間でこの1件のみ**＝後続バッチでの再処理も無い。

**#10 `cmqsyryir005c1dt6jmaq9inm`（2026-06-25 12:50:15 開始 / 吉田 涼夏）** — 2-a のうち `pdf-upload 499` 型

```
2026-06-25T03:50:15.193Z POST 200 /api/rpa/mynavi/batch-start
2026-06-25T03:52:55.585Z POST 400 /api/rpa/mynavi/reply-sent   ← processingLogId 空のまま呼ばれている
2026-06-25T03:53:26.163Z POST 499 /api/rpa/mynavi/pdf-upload   ← クライアント（PAD）が接続を切った
（batch-finish は無い）
処理ログ processedAt = 2026-06-25 12:54:25 JST  ← 切断の 59 秒後に portal 側が書き込み完了
```

→ **PAD は `pdf-upload` の応答を待ち切れずに打ち切っており、portal はその後も処理を続けて処理ログを書いている。** 「処理ログはあるのに未完了」の典型的な作られ方。

---

## 10-4. C. 発生時期・時間帯の偏り

### 10-4-1. 発生日（JST）

| 日 | 曜日 | 件数 |
|--|--|--|
| 2026-05-17 | 日 | **8** |
| 2026-05-23 | 土 | **5** |
| 2026-05-26 | 火 | 3 |
| 2026-06-02 | 火 | 1 |
| 2026-06-11 | 木 | 1 |
| 2026-06-25 | 木 | 1 |
| 2026-07-16 | 木 | 1 |
| 2026-07-22 | 水 | 1 |
| 2026-07-30 | 木 | 2 |
| 2026-08-10 | 月 | 1 |
| 2026-08-18 | 火 | **4** |

**特定の日に集中している。** 11日間に分散しており、上位3日（05-17 / 05-23 / 08-18）で **17件（60.7%）** を占める。しかも各日の発生は**連続した時間帯にかたまっている**（例: 08-18 は 18:05 / 18:16 / 18:24 / 18:31 の27分間、05-23 は 13:10 / 13:22 / 13:30 の20分間）。**「毎日少しずつ起きる慢性的な事象」ではなく、「ある日ある時間帯に連続して起きるバースト」である。**

参考: 2026-05-18 以降で処理ログを持つバッチは 409件、そのうち未完了が 20件（4.9%）。

### 10-4-2. 時間帯（JST の時）と分

| 時 | 件数 | | 時 | 件数 |
|--|--|--|--|--|
| 05時 | 4 | | 13時 | 3 |
| 06時 | 1 | | 14時 | 1 |
| 07時 | 3 | | 15時 | 1 |
| 08時 | 3 | | 18時 | **4** |
| 09時 | 2 | | 19時 | 1 |
| 11時 | 2 | | 20時 | 1 |
| 12時 | 1 | | 23時 | 1 |

**深夜・早朝への偏りは無い。** 05〜07時台の8件はすべて 2026-05-17 の1日分（＝別要因）で、これを除くと 08〜23時台にほぼ均等に散っている。**「毎時02〜03分」への偏りも無い**（分 mod 5 の内訳は 0:15件 / 1:4件 / 2:4件 / 3:3件 / 4:2件で、5分グリッド上の通常起動が過半）。

### 10-4-3. 2026-05-17 の `batch-finish` 修正より前かどうか

修正コミットと本番デプロイ完了時刻（Railway `deployments` から実測）:

| コミット | 内容 | 本番デプロイ(JST) |
|--|--|--|
| `7984683` | reply-sent / batch-finish 400エラー修正 | 2026-05-17 06:42:54 |
| `b9a3176` | reply-sent / batch-finish バリデーション完全緩和 | 2026-05-17 07:22:17 |

| 区分 | 件数 | 該当 |
|--|--|--|
| **`7984683` デプロイ前（06:42:54 より前に開始）** | **5** | #24 #25 #26 #27 #28（05:06 / 05:35 / 05:38 / 05:48 / 06:29） |
| `7984683` 後・`b9a3176` 前（緩和が途中） | 3 | #21 #22 #23（07:10 / 07:12 / 07:17） |
| **`b9a3176` デプロイ後（＝修正後）** | **20** | 2026-05-23 以降のすべて |

**修正当日（＝原因が別・既知の400エラー）は 8件、修正後は 20件。** さらに、**この8件はすべてバッチ実行窓の中に portal の本番デプロイが入っている**（10-6-5）。デプロイ中はコンテナが差し替わるため、`batch-finish` が旧コードや停止中インスタンスに当たったと考えて矛盾しない。

一方 **修正後の20件は、実行窓の中に portal のデプロイが1件も無い**（28件中デプロイが重なるのは 05-17 の8件のみ）。**「デプロイによる再起動」は修正後の20件の説明にならない。**

### 10-4-4. 曜日の偏り

| 曜日 | 件数 |
|--|--|
| 日 | 8（すべて 2026-05-17） |
| 火 | 8（05-26 ×3 / 06-02 ×1 / 08-18 ×4） |
| 土 | 5（すべて 2026-05-23） |
| 木 | 5（06-11 / 06-25 / 07-16 / 07-30 ×2） |
| 水 | 1 |
| 月 | 1 |

**独立した曜日の偏りは無い。** 日曜8件・土曜5件はいずれも単一日（05-17 / 05-23）の集中がそのまま出たもので、10-4-1 の「特定日への集中」の裏返しにすぎない。母数が28件しかないため、曜日単独では有意な傾向を読み取れない。

### 10-4-5. `reply-sent` の記録率の時代差（実害判定の前提として重要）

`MynaviRpaProcessingLog` 全438件（バッチ status を問わない）について、`canSendReply=true` のログに `replySentAt` が入っている割合:

| 週（JST・月曜起点） | `canSendReply=true` | うち `replySentAt` あり | 記録率 |
|--|--|--|--|
| 2026-05-11 | 6 | 2 | 33.3% |
| 2026-05-18 | 18 | 18 | 100% |
| **2026-05-25** | 37 | 5 | **13.5%** |
| **2026-06-01** | 27 | 0 | **0%** |
| **2026-06-08** | 20 | 1 | 5.0% |
| **2026-06-15** | 18 | 0 | **0%** |
| **2026-06-22** | 28 | 0 | **0%** |
| **2026-06-29** | 27 | 1 | 3.7% |
| **2026-07-06** | 20 | 1 | 5.0% |
| **2026-07-13** | 29 | 1 | 3.4% |
| **2026-07-20** | 36 | 35 | **97.2%** |
| 2026-07-27 | 15 | 14 | 93.3% |
| 2026-08-03 | 39 | 38 | 97.4% |
| 2026-08-10 | 27 | 26 | 96.3% |
| 2026-08-17 | 9 | 6 | 66.7%（未記録3件は T-167 検証ダミー） |

月次では 2026-05: 41.0% / **2026-06: 2.0%** / 2026-07: 40.7% / 2026-08: 93.6%。

**2026-05-25〜2026-07-19 の約8週間、`reply-sent` は完了済みバッチでもほぼ呼ばれていない。** COMPLETED バッチに属する NORMAL・`canSendReply=true` のログですら 2026-06 は 93件中91件が `replySentAt` NULL。
→ **この期間の「`replySentAt` が無い」は異常ではなく常態であり、返信の有無を判断する材料にならない。** 10-1 の実害判定はこの事実に基づく。

---

## 10-5. D. 実害の確認

### 10-5-1. 処理ログの `candidateId`

| 区分 | 件数 |
|--|--|
| `candidateId` が入っている | 17 |
| `candidateId` が NULL | **11**（AI_FAILED 3 / DUPLICATE_SKIP 5 / NORMAL 3） |

`candidateId` が NULL の NORMAL 3件（米澤 弥黎）と DUPLICATE_SKIP のほとんどは、電話番号（`phoneNormalized`）で実在の求職者に到達できる。到達できないのは **AI_FAILED 3件のみ**（氏名も電話番号も NULL＝PDF解析自体が失敗しており、誰の応募かを portal 側から特定する手段が無い。→ 10-8）。

### 10-5-2. 後続バッチでの再処理の有無（電話番号ベースの全数照合）

28件に現れた電話番号15件について、**全期間・全バッチ**の処理ログを照合した。

| 応募者 | 電話 | 全処理ログ | うち未完了バッチ | 後続バッチでの再処理 | 返信記録（`replySentAt` / `CandidateSettingsHistory`） |
|--|--|--|--|--|--|
| 米澤 弥黎 | 08016814479 | 4 | 4 | なし（全部が未完了バッチ） | **なし** |
| 木田 朱夏 | 08030801745 | 4 | 1 | **あり**（05-17 07:25 / 16:02 / 22:15 の COMPLETED 3件） | **あり**（3件とも `replyResult=SUCCESS`） |
| 大岡 梨沙 | 08084551016 | 4 | 4 | なし | **あり**（4件とも SUCCESS・設定履歴1件） |
| 古市 真理香 | 08094846015 | 1 | 1 | なし | **あり**（SUCCESS・設定履歴1件） |
| 長坂 梨穂 | 07023276847 | 2 | 1 | **あり**（05-26 11:25 の COMPLETED） | **なし**（再処理分も `replySentAt` NULL） |
| 中村 恵莉華 | 09055817723 | 1 | 1 | なし | **なし** |
| PHAN HOANG HAI | 07089947399 | 1 | 1 | なし | **なし**（FOREIGN_NG＝返信対象外） |
| 吉田 芽依 | 07085451310 | 1 | 1 | なし | **なし** |
| 秋山 友里 | 08037371126 | 1 | 1 | なし | **なし** |
| 吉田 涼夏 | 09085060608 | 1 | 1 | なし | **なし** |
| 納富 香梅 | 08046042486 | 1 | 1 | なし | **なし** |
| 金森 莉奈 | 08036709810 | 1 | 1 | なし | **なし** |
| 林 咲良 | 08085828696 | 2 | 2 | なし | **なし** |
| 池三津 雄哉 | 08024879673 | 1 | 1 | なし | **なし** |
| 掛須 美音 | 08078262930 | 5 | 4 | **あり**（08-18 18:39 の COMPLETED） | **あり**（SUCCESS・設定履歴1件） |

`CandidateSettingsHistory` は該当15名で **3件のみ**（大岡 梨沙・古市 真理香・掛須 美音、いずれも `MYNAVI_FIRST_REPLY` / `SUCCESS`）。参考: 同テーブル全体は SUCCESS 160件 / FAILED 3件（FAILED 3件はすべて T-167 の検証用ダミー）。

### 10-5-3. 実害の分類

| 分類 | 人数 | 応募者 |
|--|--|--|
| **A. 実害なし（返信記録あり）** | 4 | 木田 朱夏 / 大岡 梨沙 / 古市 真理香 / 掛須 美音 |
| **B. 実害なし（返信対象外）** | 1 + 匿名3 | PHAN HOANG HAI（FOREIGN_NG）／ AI_FAILED 3件（応募者を特定できず。返信対象外） |
| **C. 実害なし（返信記録は無いが、その後 面談まで到達＝実質救済済み）** | 5 | 米澤 弥黎 / 長坂 梨穂 / 中村 恵莉華 / 秋山 友里 / 池三津 雄哉 |
| **D. 要確認（返信記録が無く、現在も BEFORE・面談0件）** | **5** | 金森 莉奈 / 林 咲良 / 納富 香梅 / 吉田 涼夏 / 吉田 芽依 |

### 10-5-4. 「D. 要確認」5名の現在の状態

| 氏名 | 求職者番号 | マイナビ会員No | 応募日(JST) | 支援ステータス | サブ | 担当CA | 面談記録 | タスク | ファイル | 最終更新(JST) |
|--|--|--|--|--|--|--|--|--|--|--|
| 金森 莉奈 | 5008278 | 1011179725 | 2026-07-22 | BEFORE | — | 未設定 | **0件** | 0件 | 1件（応募PDFのみ） | 2026-07-23 09:57 |
| 林 咲良 | 5008322 | （なし） | 2026-07-29 | BEFORE | — | 未設定 | **0件** | 0件 | 1件（応募PDFのみ） | 2026-07-30 10:05 |
| 納富 香梅 | 5008249 | 1012368327 | 2026-07-16 | BEFORE | — | 未設定 | **0件** | 0件 | 1件（応募PDFのみ） | 2026-07-21 08:40 |
| 吉田 涼夏 | 5008125 | （なし） | 2026-06-25 | BEFORE | — | 未設定 | **0件** | 0件 | 1件（応募PDFのみ） | 2026-07-05 11:57 |
| 吉田 芽依 | 5008016 | （なし） | 2026-06-02 | BEFORE | — | 未設定 | **0件** | 0件 | 1件（応募PDFのみ） | 2026-06-02 09:49 |

参考（C分類・面談まで進んだ5名）:

| 氏名 | 求職者番号 | 支援ステータス | 面談記録 | 最終面談日 |
|--|--|--|--|--|
| 米澤 弥黎 | 5007904 | ENDED（当社判断 / OFFER_DECLINED_OTHER） | 3件 | 2026-05-20 |
| 長坂 梨穂 | 5007968 | ACTIVE（求人紹介） | 1件 | 2026-06-07 |
| 中村 恵莉華 | 5007971 | ENDED（当社判断 / NO_MATCHING_JOBS） | 1件 | 2026-05-29 |
| 秋山 友里 | 5008061 | ENDED（当社判断 / NO_CONTACT） | 4件 | 2026-06-18 |
| 池三津 雄哉 | 5008394 | ACTIVE（求人紹介） | 1件 | 2026-08-14 |

### 10-5-5. 「BEFORE かつ面談0件」は実害の証拠になるか — 対照群

**ならない。** 正常に完了したバッチで正常に処理された応募者でも、同じ状態の人が4〜5割いる。

COMPLETED バッチ・`status=NORMAL`・`canSendReply=true` のログに紐づく求職者の現在の状態:

| 月 | `replySentAt` | 人数 | うち BEFORE | うち面談0件 | 面談0件の率 |
|--|--|--|--|--|--|
| 2026-05 | なし | 27 | 14 | 11 | 40.7% |
| 2026-05 | あり | 18 | 12 | 8 | 44.4% |
| 2026-06 | なし | 93 | 37 | 35 | 37.6% |
| 2026-07 | なし | 67 | 21 | 19 | 28.4% |
| 2026-07 | あり | 47 | 25 | 24 | 51.1% |
| 2026-08 | あり | 71 | 43 | 33 | 46.5% |

→ **返信が確実に記録されている群（`replySentAt` あり）でも、面談まで進まない人が 44〜51% いる。** したがって「BEFORE・面談0件」だけでは埋もれた証拠にならない。10-5-3 の D 分類を「実害あり」と断定しないのはこのため。

### 10-5-6. D の5名のうち、記録欠落が明確に異常なのは2名

10-4-5 の記録率と突き合わせると:

| 氏名 | 発生週 | その週の `reply-sent` 記録率 | 解釈 |
|--|--|--|--|
| 金森 莉奈 | 2026-07-20 週 | **97.2%（36件中35件記録）** | **この1件だけが記録漏れ。異常。** |
| 林 咲良 | 2026-07-27 週 | **93.3%（15件中14件記録）** | **この1件だけが記録漏れ。異常。** |
| 納富 香梅 | 2026-07-13 週 | 3.4% | 当時の常態。判断材料にならない |
| 吉田 涼夏 | 2026-06-22 週 | 0% | 同上 |
| 吉田 芽依 | 2026-06-01 週 | 0% | 同上 |

**金森 莉奈・林 咲良の2名については、`reply-sent` が正常に機能していた時期に、この2件だけ記録が落ちている。** 両者とも後続バッチでの再処理も無い（10-5-2）。**マイナビ管理画面上で実際に一次返信が送られたかどうかの確認を、この2名について優先して行うべき。**

---

## 10-6. E. ログ照合（Railway 本番ログ）

### 10-6-1. 取得可否

**Railway は REMOVED デプロイの `httpLogs` も返す。**（Step1 8章-6 の「REMOVED デプロイのログは返さない」という記述は誤り。当時は `anchorDate` の与え方が狭かったため0件に見えていた。）ただしデプロイ単位でしか引けず、1回のクエリで返る件数に上限があるため、**当時の本番サービスがどれだけ忙しかったかによって取得できる時間幅が変わる**。

28件の「開始時刻〜最終処理ログの30分後」について、当時稼働していたデプロイを `deployments`（全1,034件・最古 2026-02-13）から特定して `httpLogs` を引いた結果:

| 取得状況 | 窓数 | 該当 |
|--|--|--|
| **全区間取得できた** | **8** | 2026-07-22 / 07-30×2 / 08-10 / 08-18×4 |
| **部分取得（`/api/rpa/` の該当リクエストは取得できた）** | **3** | 2026-06-11 / 06-25 / 07-16 |
| **取得不能**（当該時刻のログが返らない） | **17** | 2026-05-17×8 / 05-23×5 / 05-26×3 / 06-02×1 |

- 2026-05-17 の8件は、当時のデプロイ（`a77ac83` / `6f53096` / `9be0e82` / `f85df53` / `7984683`）いずれも `httpLogs` が **0件**を返す（保持期間切れ）。
- 2026-05-23 / 05-26 / 06-02 は、同時刻に稼働していたデプロイの `httpLogs` は返るものの、返る時間幅が窓を覆わず（例: 2026-05-26 09:55 開始の窓に対し取得できたのは 10:13〜10:25 のみ）、**当該リクエストの有無を確認できない**。**無理に埋めない。**
- staging サービス（`bizstudio-portal-staging`・全600デプロイ）の同時刻デプロイも確認したが、`/api/rpa/` へのリクエストは0件。**PAD が staging に飛んでいた形跡は無い。**

### 10-6-2. 取得できた11窓の実測（`/api/rpa/` のみ抜粋）

**2026-08-18 18:05〜18:41（#1〜#4 + 直後の完了バッチ）** — deployment `f8f323c2` / commit `7ee8fcd`

```
09:02:57.567Z POST 200 batch-start      ← 処理ログ0件で COMPLETED になったバッチ
09:04:20.344Z POST 400 reply-sent       ← processingLogId 空
09:04:23.365Z POST 200 batch-finish     ← 完了（0件）
09:05:04.855Z POST 200 batch-start      ← #4（掛須 NORMAL）
09:06:38.348Z POST 200 pdf-upload
09:06:59.289Z POST 200 reply-sent
                                        ← batch-finish 無し ★#4 が RUNNING のまま
09:16:26.808Z POST 200 batch-start      ← #3
09:17:52.283Z POST 200 pdf-upload
                                        ← 以降なし ★#3
09:24:12.215Z POST 200 batch-start      ← #2
09:25:48.511Z POST 200 pdf-upload
                                        ← 以降なし ★#2
09:31:00.284Z POST 200 batch-start      ← #1
09:32:45.306Z POST 200 pdf-upload
                                        ← 以降なし ★#1
09:38:00.949Z POST 200 batch-start      ← 次の実行
09:39:42.144Z POST 200 pdf-upload
09:41:54.160Z POST 200 reply-sent
09:41:56.579Z POST 200 batch-finish     ← COMPLETED（ここでウィンドウが前進した）
```

**確認できたこと**:
- **`batch-finish` のリクエストが1件も存在しない。** 400 でも 404 でも 500 でもなく、**リクエスト自体が来ていない。**
- 直前の `batch-start` / `pdf-upload` / `reply-sent` はすべて **200**。**portal は一度も拒否していない。**
- 例外・再起動の形跡なし（同窓の全リクエスト 1,169件中 **5xx は 0件**）。
- 同窓に portal のデプロイなし。
- 付随: 09:02:57 の実行が、Step1 8章-2 で「なぜ完了できたのか不明」とされた **「処理ログ0件なのに COMPLETED」13件の1つ**。`reply-sent`（400）→ `batch-finish`（200）と進んでおり、**PDF取込に至らなかった実行でもフローが最後まで走れば完了する**ことを示す。

**2026-07-22 19:55（#8 金森 莉奈）** — commit `5293561`

```
10:55:16.508Z POST 200 batch-start   ← #8
10:56:48.896Z POST 200 pdf-upload
                                     ← 以降なし ★#8
11:00:24.273Z POST 200 batch-start
11:01:10.367Z POST 400 reply-sent
11:01:12.013Z POST 200 batch-finish
```

同窓の 5xx は 0件・デプロイなし。

**2026-07-30 08:23 / 08:27（#7 #6 林 咲良）** — commit `3a03cc2`

```
23:23:47.893Z POST 200 batch-start   ← #7
23:27:13.288Z POST 499 pdf-upload    ← クライアント切断
                                     ← 以降なし ★#7
23:27:51.449Z POST 200 batch-start   ← #6
23:31:12.585Z POST 200 pdf-upload
                                     ← 以降なし ★#6
23:40:11.764Z POST 200 batch-start
23:41:55.141Z POST 200 pdf-upload
23:46:02.142Z POST 200 reply-sent
23:46:16.604Z POST 200 batch-finish
```

**2026-08-10 08:20（#5 池三津 雄哉）** — commit `1ea17db`

```
23:20:13.249Z POST 200 batch-start   ← #5
23:22:23.403Z POST 200 pdf-upload
                                     ← 以降なし ★#5
```

**2026-06-11 15:55（#11） / 2026-06-25 12:50（#10） / 2026-07-16 23:25（#9）** — いずれも同一形

```
（#11）06:55:18.133Z POST 200 batch-start / 06:57:57.089Z POST 400 reply-sent / 06:58:27.393Z POST 499 pdf-upload
（#10）03:50:15.193Z POST 200 batch-start / 03:52:55.585Z POST 400 reply-sent / 03:53:26.163Z POST 499 pdf-upload
（#9） 14:25:16.122Z POST 200 batch-start / 14:27:50.798Z POST 400 reply-sent / 14:28:21.295Z POST 499 pdf-upload
```

**`pdf-upload` が 499（クライアント側切断）で終わっている点が共通。** しかも 499 が記録される時刻は `batch-start` から **185〜206秒後**（#9 185秒 / #10 191秒 / #11 189秒 / #7 206秒）で揃っており、正常に 200 で返る `pdf-upload`（`batch-start` から 90〜100秒後）と明確に分かれる。**PAD 側の HTTP アクションに約3分のタイムアウトがあり、Gemini 解析が長引いた実行で打ち切られている**と読める（PAD の設定値は未確認 → 10-8）。

打ち切り後に `reply-sent` が 400 で呼ばれているのは、`processingLogId`（`pdf-upload` の戻り値）が空のまま次のアクションに進んだため（`reply-sent/route.ts:71-77` の 400 条件は `processingLogId` 空のみ）。**PAD の「Web サービスの呼び出し」が 4xx を例外にしてフローを止めているとすれば `batch-finish` に到達しない**という説明が付くが、PAD 側の設定は未確認（10-8）。

### 10-6-3. `batch-finish` の受信・エラー・タイムアウトの形跡

**取得できた11窓すべてで `batch-finish` のリクエストは 0件。** 400 / 404 / 500 / タイムアウト（499・504）のいずれの形跡も無い。**「呼ばれたが portal が弾いた」ではなく「呼ばれていない」。**

### 10-6-4. 例外・再起動・デプロイの有無

- 取得できた11窓の全 HTTP リクエストのうち **5xx は 0件**。portal 側の例外は起きていない。
- 28窓すべてについて `deployments` を突き合わせた結果、**窓内にデプロイがあったのは 2026-05-17 の8件のみ**（10-6-5）。
- `deploymentLogs`（アプリケーションログ）は REMOVED デプロイでは 0件しか返らず、`environmentLogs` も `batch-finish` を含む行を返さなかった。**アプリログ側からの裏取りは不能。**
- 参考: RPAエラー台帳（`rpa_error_logs`）は全50件で最新が **2026-05-11**。28件の期間に対応する登録は1件も無い（そもそもスカウト検索系フローの台帳で、本フロー用には運用されていない）。

### 10-6-5. 2026-05-17 の8件と本番デプロイの重なり

| # | バッチ開始(JST) | 窓内のデプロイ(JST) / コミット |
|--|--|--|
| 28 | 05:06:06 | 05:33:43 `6f53096` |
| 27 | 05:35:11 | 05:43:36 `9be0e82` |
| 26 | 05:38:15 | 05:43:36 `9be0e82` |
| 25 | 05:48:19 | 06:11:36 `914eccd` / 06:17:12 `f85df53` |
| 24 | 06:29:07 | **06:42:54 `7984683`** |
| 23 | 07:10:47 | **07:22:17 `b9a3176`** |
| 22 | 07:12:23 | **07:22:17 `b9a3176`** |
| 21 | 07:17:20 | **07:22:17 `b9a3176`** |

**8件すべてで窓内にデプロイがある。** 2026-05-23 以降の20件は **0件**。

---

## 10-7. F. 原因の仮分類

| 分類 | 件数 | 該当 # | 根拠 |
|--|--|--|--|
| **PAD の異常終了（`pdf-upload` タイムアウト型）** | **4** | #7 #9 #10 #11 | HTTPログで `pdf-upload` が **499**、直後（#7 以外は直前）に `reply-sent` 400、`batch-finish` 無し。499 の発生タイミングが `batch-start` +185〜206秒で揃っている（10-6-2） |
| **PAD の異常終了（`pdf-upload` 200 後に停止）** | **6** | #1 #2 #3 #5 #6 #8 | HTTPログで `pdf-upload` まで 200 を確認、`reply-sent` / `batch-finish` の**リクエストが存在しない**。同窓 5xx 0件・デプロイ無し（10-6-2） |
| **PAD の異常終了（`reply-sent` 200 後に停止）** | **1** | #4 | `batch-start`→`pdf-upload`→`reply-sent` すべて 200、`batch-finish` のみ無し。返信・設定履歴は正常に記録済み（10-3-1） |
| **既知の400エラー（2026-05-17 修正当日・デプロイ中）** | **8** | #21〜#28 | 修正コミット `7984683` / `b9a3176` の当日分。全件で窓内に本番デプロイあり。経過時間が 2〜88秒と異常に短い（10-6-5, 10-2） |
| **不明** | **9** | #12 #13 #14 #15 #16 #17 #18 #19 #20 | HTTPログが取得できず（2026-05-23×5 / 05-26×3 / 06-02×1）、DB からは `pdf-upload` 以降の経路を復元できない |

**内訳**: PAD の異常終了 **11件** / 既知の400エラー **8件** / 不明 **9件** / 通信断 **0件**。

**「通信断」に分類したものは0件。** 「PAD が `batch-finish` を送ったが Railway のエッジに届かなかった」場合も HTTPログ上は「リクエストなし」になるため、**上記11件の「PAD の異常終了」と通信断は portal 側からは区別できない**。ここでは「PAD 側で `batch-finish` アクションが実行された形跡が portal 側に一切無い」という事実だけを根拠に、「PAD 側でフローが `batch-finish` に到達しなかった」と読める分類名を採っている。**PAD のフロー実行履歴（Power Automate の実行ログ）を見るまで確定はできない**（10-8）。

不明9件のうち #16〜#20（2026-05-23 の5件）は `replyResult=SUCCESS` が4件あり、**返信までは到達していた**ことがDB側から分かる。#12 #14 #15（05-26・06-02）は `replySentAt` NULL だが、記録率が落ち始めた時期にあたるため判断できない。

---

## 10-8. 未確認事項

推測で埋めず、確認できていないことを列挙する。

1. **マイナビ管理画面で実際に一次返信が送られたか。** portal が持つのは `reply-sent` が呼ばれたかどうかだけ。**10-5-3 の D分類5名（特に金森 莉奈・林 咲良）について、実際に返信メッセージが届いているかは portal 側から確認できない。** 実害の最終判定にはマイナビ管理画面または7号機の実行履歴の確認が必要。
2. **PAD のフロー実行履歴。** Power Automate 側でフローが「成功」で終わったのか「失敗」で終わったのか、どのアクションで止まったのかは未確認。これが分かれば 10-7 の「PAD の異常終了」11件と「通信断」の区別が付く。
3. **PAD の HTTP アクションのタイムアウト設定値。** 499 が `batch-start` +185〜206秒に集中していることから約3分と推測されるが、**実際の設定値は未確認**。
4. **PAD の「Web サービスの呼び出し」が 4xx を例外扱いにしているか。** `reply-sent` 400 の直後にフローが終わっているように見えるが、PAD の設定（「エラー時」の扱い）は未確認。
5. **2026-05-23 / 05-26 / 06-02 の9件（不明分）の経路。** Railway の HTTPログが当該時刻を返さないため、`pdf-upload` 以降にどのAPIが呼ばれたか復元できない。
6. **AI_FAILED 3件（#26〜#28）の応募者。** 氏名・電話番号・`candidateId` すべて NULL で、どの応募だったかを portal 側から特定する手段が無い。`errorMessage` は「Gemini レスポンスのJSON解析に失敗しました」1件、「extract_resume 400: candidateId は5から始まる7桁の数字で指定してください。」2件。**退避PDF（`failedPdfFileId`）も NULL** のため実体も残っていない。
7. **2026-05-25〜2026-07-19 に `reply-sent` がほぼ呼ばれなかった理由。** 記録率が 0〜5% に落ちて 2026-07-20 に 97% へ戻っている（10-4-5）。この期間に portal 側の `reply-sent` の変更は無く、**PAD 側の変更が疑われるが未確認**。**この期間の応募者全体（COMPLETED バッチに属する NORMAL・`canSendReply=true` のログだけで 2026-06 に93名）について返信が実際に送られていたのかも未確認。28件とは独立した論点だが、影響範囲は28件よりはるかに大きい。**
8. **`replySentAt` の9時間ずれ（10-2 末尾）を修正した場合の既存データの扱い。** 既存の `replySentAt` は JST 壁時計値が UTC として入っており、修正すると新旧で意味が変わる。移行方針は未検討。
9. **DUPLICATE_SKIP なのに `replyResult=SUCCESS` になっているログ**（#17 #18 と 2026-08-18 18:39 の完了バッチ）。`canSendReply=false` なのに `reply-sent` が呼ばれている。PAD 側の分岐が未確認。

---

## 10-9. 対処案（提案のみ・実装しない）

### 10-9-1. 今後の再発を防ぐ

#### 案A（推奨・portal 側で完結）: 処理ログありの stale バッチも自動クローズし、完了通知を発火する

Step2 で入れた `closeStaleNoTargetBatches()`（`src/lib/mynavi-rpa/no-target.ts`・`batch-start` から呼ばれる）に、**処理ログ1件以上の RUNNING バッチ向けの分岐**を追加する。

- 条件: `status="RUNNING"` かつ `startedAt < now - 30分` かつ **処理ログが1件以上**。
- 更新: `status="FAILED"` / `finishedAt=now` / `errorMessage="バッチ完了通知が届かないまま放置されました（portal 側で自動クローズ）"` + 7カウンタを処理ログから集計してセット。
- 通知: `notifyMynaviBatchCompletion()` を発火し、**未完了だった旨を明示した本文**で LINE WORKS に流す。T-167 の「送信失敗: N件」ブロックもここで載る。
- 併せて **`canSendReply=true` かつ `replySentAt IS NULL` のログがある場合は「一次返信の記録がありません」を通知本文に含める**と、10-5-6 のような取りこぼしがその日のうちに気付ける。

| 観点 | 評価 |
|--|--|
| 実現性 | **高**。既存の `no-target.ts` と `notify.ts` の組み合わせで、新規 cron もマイグレーションも不要（`status` は String で DB 制約なし）。 |
| リスク | **低〜中**。①`FAILED` は現在0件なので、一覧画面の `STATUS_LABEL` / `STATUS_STYLE` にラベル定義があるかの確認が必要。②しきい値内に PAD が遅れて `batch-finish` を呼ぶと COMPLETED に上書きされる（Step2 と同じ挙動で、これは正しい）。③過去分を一括で畳むと28件分の通知が一気に飛ぶので、**一括処理では通知しない**設計にすること。 |
| 限界 | **PAD が落ちること自体は直らない。** 通知が出るだけで、一次返信そのものは飛ばないままになる。 |

#### 案B（portal 側・案Aの上位互換）: 一次返信の記録漏れを日次で検知して通知

- 新規 cron（1日1回）で「`canSendReply=true` かつ `replySentAt IS NULL` かつ `processedAt` が24時間以上前」の処理ログを拾い、氏名・会員No付きで LINE WORKS に通知する。
- 利点: **バッチの完了/未完了と無関係に、取りこぼしそのものを検知できる。** 10-4-5 で見つかった「2026-05-25〜07-19 に記録率が0%だった」ような大規模な異常も即座に気付ける。
- リスク: 過去の欠測が大量にあるため（`canSendReply=true` かつ `replySentAt` NULL は現時点で208件）、**導入時は「導入日以降のログのみ」に限定しないと初回に208件が飛ぶ**。
- 実現性: 高（既存 cron のパターン `/api/internal/bookmarks/resubmit-stale` を流用可）。

#### 案C（portal 側・499 の緩和）: `pdf-upload` を非同期化する

- 現状 `pdf-upload` は Gemini 解析の完了まで応答を返さないため 90〜200秒かかり、PAD 側のタイムアウトに当たっている（10-6-2）。
- 受付だけ即座に 200 で返し（`processingLogId` を先に発行）、解析はバックグラウンドで進める形にすれば 499 は起きなくなる。
- リスク: **中〜高。** PAD 側は `processingLogId` を受け取った後すぐ `reply-sent` に進む想定なので、**解析完了前に返信されると内容が空のまま進む恐れがある**。PAD 側の待ち合わせ設計変更とセットでないと入れられない。
- 実現性: 中。単独では入れるべきでない。

#### 案D: PAD 側の修正

**PAD 側の修正が必要。理由:**

1. **`batch-finish` が呼ばれていないのは PAD 側でフローが途中終了しているためで、portal 側からは呼び出しを発生させられない。** 28件すべてで `batch-finish` の HTTP リクエストが portal に到達していない（10-6-3）。
2. **フロー全体を「ブロックエラー発生時」で囲み、異常終了時にも `batch-finish` を `errorMessage` 付きで呼ぶ経路が存在しない。** `RpaExecutionBatch.status="FAILED"` は全期間0件で、この経路が一度も動いていないことが実データから確認できる（Step1 3-1）。
3. **`pdf-upload` のタイムアウトが解析時間より短い。** 499 が `batch-start` +185〜206秒に集中し、正常応答（+90〜100秒）と分離している（10-6-2）。タイムアウト値の引き上げが必要。
4. **`reply-sent` を `processingLogId` が空のまま呼んでいる。** 400 が定常的に発生している（10-6-2）。空のときは呼ばない分岐が必要。

**7号機の作業は将幸さんが行うため、本報告書では手順書・指示書は作成しない。**

### 10-9-2. 既存28件の後始末

#### `status` をどうするか

| 案 | 内容 | 評価 |
|--|--|--|
| **A. `FAILED` に一括更新（推奨）** | 28件を `status="FAILED"` / `finishedAt=最終処理ログの processedAt` / `errorMessage="完了通知が届かないまま放置（T-168 Step3 で確認済み）"` に更新。**通知は発火しない** | **推奨。** 一覧画面で「実行中」に見えている28件が「失敗」として正しく表示される。`last-execution` は `COMPLETED` のみを見るので影響なし（Step2 9-6 で実測確認済み）。`FAILED` は現在0件なのでラベル定義の確認が必要 |
| B. `COMPLETED` に一括更新 | — | **非推奨。** 実際には完了していない。「正常完了した」という誤記録が残る |
| C. `NO_TARGET` に一括更新 | — | **非推奨。** 処理ログがあるので「対象なし」は事実に反する。Step2 の一覧既定フィルタから消えてしまい追跡できなくなる |
| D. 放置 | — | 一覧に28件が「実行中」で残り続ける。総件数441件なので実用性は損なわれないが、**「今まさに実行中」と誤読される** |

いずれの場合も **T-167 検証用ダミー `t167-verify-20260818` は対象外**とすること（`flowName` に `【T-167検証用ダミー】` を含む条件で除外できる）。

#### 実害ありの応募者への対応

**優先度順**:

1. **金森 莉奈（5008278 / 会員No 1011179725 / 応募 2026-07-22）と 林 咲良（5008322 / 応募 2026-07-29）** — マイナビ管理画面で一次返信の送信有無を確認する。未送信なら手動で送信。応募から3〜4週間経過しているため、通常の初回メッセージではなく遅延を踏まえた文面が必要。
2. **納富 香梅（5008249 / 会員No 1012368327 / 応募 2026-07-16）・吉田 涼夏（5008125 / 応募 2026-06-25）・吉田 芽依（5008016 / 応募 2026-06-02）** — 同様に確認。ただしこの3名は記録欠落が当時の常態のため、**同時期に同じ状態の応募者が他にも多数いる**（2026-06 だけで COMPLETED バッチ分に 93名。10-5-5）。この3名だけを個別対応するより、**10-8 の7番（2026-05-25〜07-19 の記録率0%期間）をまとめて棚卸しする方が筋が良い。**
3. **AI_FAILED 3件（2026-05-17）** — 応募者を特定する手段が無く、退避PDFも残っていない。**対応不能**として記録に留める。

---

## 10-10. 調査に使った手段

- 本番DB: `railway ssh --service bizstudio-portal` 上で `@prisma/client` + `@prisma/adapter-pg` の **SELECT のみ**のスクリプトを `echo <base64> | base64 -d | node` で実行（`railway run` は不使用）。
- Railway: GraphQL `https://backboard.railway.com/graphql/v2` の `deployments` / `httpLogs` / `deploymentLogs` / `environmentLogs` を**読み取りのみ**。User-Agent の明示が必須（既定だと 403）。`httpLogs` の `anchorDate` は `String` 型（`DateTime` を渡すとバリデーションエラー）、`deploymentLogs` は `startDate` / `endDate` / `limit` で `anchorDate` を受け付けない。
- コード: `src/app/api/rpa/mynavi/{batch-start,batch-finish,reply-sent,pdf-upload}/route.ts`、`src/lib/mynavi-rpa/{notify,no-target,parse-request-body,auth}.ts`、`prisma/schema.prisma`。
- **DBへの書き込み・製品コードの変更・マイグレーションは一切行っていない。28件と T-167 ダミーの `status` は RUNNING のまま。**

---

# 11. 実装記録（Step4 / 2026-08-19）

- 対象リポジトリ: bizstudio-portal（branch master / Step3 時点 HEAD `6cb6579`）
- 内容: 「処理ログがあるのに RUNNING のまま残っているバッチ」を **`FAILED`** に整理し、今後同じ状態が出たら自動で FAILED になるようにした。
- **RPA（PAD）側は一切変更していない。** マイグレーションも作成・実行していない（`status` は String のため不要）。`railway run` も不使用。
- 応募者（`Candidate`）・処理ログ（`MynaviRpaProcessingLog`）への書き込みは一切なし。

## 11-1. 方針

Step2 で作った空振り自動クローズ（`NO_TARGET`）に **もう1系統の分岐**を足す形。新しい定期処理は作っていない。

| 状態 | 意味 | 判定 | 一覧の既定表示 |
|--|--|--|--|
| `NO_TARGET` | 取り込み対象メール0件で PAD が `batch-finish` を呼ばずに終了（Step2） | RUNNING かつ **処理ログ0件** かつ 30分以上経過 | **非表示**（`includeNoTarget=1` で表示） |
| `FAILED` | PAD が処理途中で異常終了し `batch-finish` に到達しなかった（Step4） | RUNNING かつ **処理ログ1件以上** かつ 30分以上経過 | **表示**（人が見るべき記録のため隠さない） |

`FAILED` の `finishedAt` には **最後の処理ログの `processedAt`** を入れる（現在時刻ではない）。後から気づいて畳んでいるだけなので、実際に処理が止まった時刻を残す。

**完了通知（LINE WORKS）は発火させない。** リアルタイムの完了報告ではなく、既に運用側で手動対応が済んでいるケースで通知が飛ぶとノイズになるため。

## 11-2. 追加・変更ファイル

| ファイル | 内容 |
|--|--|
| `src/lib/mynavi-rpa/no-target.ts` | **追記**。`RPA_BATCH_STATUS_FAILED` / `RPA_STALE_FAILED_ERROR_MESSAGE` / `buildStaleFailedWhere()` / `closeStaleFailedBatches()` を追加。しきい値（`RPA_NO_TARGET_STALE_MINUTES`・既定30分）と件数上限（`RPA_NO_TARGET_CLOSE_LIMIT`・既定500）は Step2 と**同じ定数を共用** |
| `src/app/api/rpa/mynavi/batch-start/route.ts` | `closeStaleNoTargetBatches()` の後に `closeStaleFailedBatches()` を呼ぶ。**それぞれ独立した try/catch**（片方が落ちてももう片方が走り、batch-start 本体は 200 を返す） |
| `scripts/close-failed-batches-t168.ts` | **新規**。過去分の一括更新（`--dry-run` 既定 / `--execute`）。Step2 の `close-no-target-batches-t168.ts` は**変更していない** |
| `prisma/schema.prisma` | `status` のコメントに `"NO_TARGET"` を追記（**コメントのみ・マイグレーション不要**） |

画面側（一覧・詳細）は **変更なし**。`FAILED` のラベル「失敗」＋赤系バッジ、`errorMessage` の表示は既に定義済みだった（`src/app/(app)/rpa-error/executions/page.tsx:27,34` / `[batchId]/page.tsx:45,120-122`）。一覧APIの既定フィルタは `status != NO_TARGET` なので **FAILED は既定で表示される**（11-5 ③で実測）。

## 11-3. 実装上の要点

- **NO_TARGET 化と FAILED 化は別々の `updateMany`。** 条件も別関数（`buildNoTargetWhere` / `buildStaleFailedWhere`）で、違いは `processingLogs: { none: {} }` と `{ some: {} }` の1点のみ。1つの条件式に詰め込んでいないため、取り違えて逆側を更新する事故が起きない。
- `finishedAt` が行ごとに違うため FAILED 側は `updateMany` 1発では書けない。対象を `findMany`（各行の最終ログ1件を同時取得）してから **1件ずつ `updateMany({ where: { id, status: "RUNNING" } })`**。この `status` ガードにより、SELECT 後に `batch-finish` が届いて COMPLETED になった行を上書きしない（＝本物の完了が勝つ）。
- `t167-verify-20260818` は `buildStaleFailedWhere()` の中で**常に除外**（呼び出し側が渡さなくても効く）。
- 更新するのは `status` / `finishedAt` / `errorMessage` の3カラムのみ。件数系カラムは触らない。
- 日時比較は UTC instant 同士（経過時間の比較なので JST 変換は不要）。スクリプトの**表示**は `toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'})` で JST（罠#17 のため `toISOString().slice()` 系は不使用）。

## 11-4. 過去分の一括更新（本番）

実行経路: `railway ssh --service bizstudio-portal` 上で `npx tsx`（`railway run` は不使用）。

| 項目 | 値 |
|--|--|
| dry-run 実行時刻 | 2026-08-18 16:23:20 UTC（＝2026-08-19 01:23 JST） |
| dry-run 対象件数 | **28件**（Step3 の28件と完全一致） |
| `--execute` 更新件数 | **28件** |

対象28件の内訳（全件・JST）は dry-run 出力どおり。最古 `cmp8s0u4a00001dmjbvhuuwst`（2026-05-17 05:06 開始 / 最終ログ 05:06:08）〜 最新 `cmsygq5yp01ef0xllkf87ge3f`（2026-08-18 18:31 開始 / 最終ログ 18:32:43）。全件が処理ログ1件。

実行前後の件数:

| status | 実行前 | 実行後 |
|--|--|--|
| RUNNING | 35（うち処理ログあり **29**） | **7**（うち処理ログあり **1**） |
| FAILED | 0 | **28** |
| NO_TARGET | 23,207 | 23,207（**不変**） |
| COMPLETED | 405 | 405（**不変**） |
| `MynaviRpaProcessingLog` 総数 | 438 | 438（**不変**） |

- 実行後の「RUNNING かつ処理ログあり」は **1件＝`t167-verify-20260818` のみ**。`{"status":"RUNNING","finishedAt":null,"errorMessage":null}` で温存されている。
- 実行後 RUNNING 7件 = ダミー1件 + 30分ウィンドウ内の空振り6件（次回以降の `batch-start` が NO_TARGET に畳む）。
- **`FAILED` かつ処理ログあり = 28 / 28**、**`NO_TARGET` かつ処理ログあり = 0**。両系統が混ざっていないことを直接確認。

FAILED 化した行のサンプル（`finishedAt` が最終ログ時刻になっていること）:

```
cmp8s0u4a00001dmjbvhuuwst  開始=2026-05-17 05:06:06  完了=2026-05-17 05:06:08  msg=RPA異常終了により未完了（自動判定）
cmp8t295m00021dmjjhbvwlc4  開始=2026-05-17 05:35:11  完了=2026-05-17 05:35:13  msg=RPA異常終了により未完了（自動判定）
cmp8t673e00001dmyzlc1kryc  開始=2026-05-17 05:38:15  完了=2026-05-17 05:38:26  msg=RPA異常終了により未完了（自動判定）
```

## 11-5. 動作確認

**① `npm run build`** — 成功（型エラー・lint エラーなし）。

**② `last-execution` の実行前後比較**（本番コンテナから `x-rpa-secret` 付きで実測）

```
BEFORE last-execution: {"lastStartedAt":"2026-08-18T11:15:16.268Z"}
AFTER  last-execution: {"lastStartedAt":"2026-08-18T11:15:16.268Z"}
```

**完全一致。** COMPLETED のみを参照しているため FAILED 化の影響を受けない（設計どおり）。

**③ 一覧 API の既定表示に FAILED が出ること**（本番・実セッションの cookie で実測）

| リクエスト | HTTP | total | 1ページ目の内訳 |
|--|--|--|--|
| `GET /api/rpa-error/executions?take=50` | 200 | **440** | RUNNING 7 / COMPLETED 39 / **FAILED 4** |
| `GET /api/rpa-error/executions?take=1&includeNoTarget=1` | 200 | 23,647 | — |

440 = COMPLETED 405 + RUNNING 7 + FAILED 28。**FAILED は既定フィルタで隠れず、1ページ目に出る。** 詳細画面で読める `errorMessage` も API レスポンスに乗っている:

```json
{"id":"cmsygq5yp01ef0xllkf87ge3f","startedAt":"2026-08-18T09:31:00.144Z",
 "finishedAt":"2026-08-18T09:32:43.642Z","errorMessage":"RPA異常終了により未完了（自動判定）"}
```

**④ LINE WORKS に通知が飛んでいないこと**

- 確認方法1（コード）: `notifyMynaviBatchCompletion()` の呼び出し箇所は `src/app/api/rpa/mynavi/batch-finish/route.ts:81` の**1箇所のみ**（`grep -rn` で全数確認）。Step4 で追加した `closeStaleFailedBatches()` は `notify.ts` を import しておらず、通知経路を一切持たない。
- 確認方法2（実行経路）: 一括更新は `railway ssh` 上の独立プロセスで、HTTP を介さず Prisma で直接 UPDATE している。`batch-finish` を通らないため通知は構造的に発火し得ない。
- 結果: **通知0件**。

**⑤ 処理ログ件数の不変** — 438 → 438（11-4 の表）。スクリプト側にも変化検知の警告を実装済み（COMPLETED / NO_TARGET / ダミーの状態も同時に検証、警告出力なし）。

**⑥ `t167-verify-20260818`** — RUNNING / `finishedAt=null` のまま。

**⑦ `batch-start` 内の掃除処理ログ（NO_TARGET / FAILED 両方）** — 11-6 に本番デプロイ後の実測を記載。

## 11-6. 本番デプロイ後の実機確認（コミット `d302482` / 2026-08-18 16:26 UTC デプロイ完了）

Railway デプロイ `7a1f858c-331a-4772-adf8-4dae7133c68d` = `d3024829961aa4c4d55919afbc446356f8646461` / status SUCCESS を GraphQL で確認（webhook 取りこぼしの罠対策として commitHash を照合）。

**① `batch-start` 内の掃除処理ログ（NO_TARGET / FAILED の両方が出ること）** — デプロイ後1回目の PAD 起動（2026-08-18 16:30:21 UTC）の実測:

```
[rpa/mynavi/batch-start] no-target cleanup: closed=0 staleMinutes=30 limit=500 threshold=2026-08-18T16:00:13.841Z
[rpa/mynavi/batch-start] failed cleanup: closed=0 staleMinutes=30 limit=500 threshold=2026-08-18T16:00:13.866Z
```

**2系統が独立して出力されている。** どちらも `closed=0`（0件でもログを出す仕様どおり）。FAILED 側が 0 なのは過去分を全て畳んだ直後で新たな異常終了が無いため。NO_TARGET 側が 0 なのは残っていた空振り6件がまだ 30分ウィンドウ内（threshold 16:00 より後の開始）だったため。

**② LINE WORKS 通知が飛んでいないこと（ログ実測）** — デプロイ後の `deploymentLogs` を filter で全数確認:

| filter | ヒット件数 | 内容 |
|--|--|--|
| `batch` | 2件 | 上記の cleanup ログのみ。**`[rpa/mynavi/batch-finish]` は0件** |
| `notify` | **0件** | `[mynavi-rpa/notify]` の出力なし＝通知処理に入っていない |

**③ `last-execution`（デプロイ後）**

```
{"lastStartedAt":"2026-08-18T11:15:16.268Z"}
```

一括更新前・後・デプロイ後の3時点で**完全一致**。

## 11-7. 残る課題・未確認事項

- **PAD（7号機）側の異常終了そのものは直していない。** 本タスクの範囲外（portal 側のみ）。今後も異常終了すれば 30分後に自動で FAILED になり、一覧に「失敗」として残る。
- 自動 FAILED 化されたバッチについて、処理ログはあるが `batch-finish` が来ていない＝**件数系カラム（`totalCount` 等）は 0 のまま**。詳細画面では処理ログテーブルで実際の処理内容が読めるが、集計値と実ログ件数が食い違う。件数を後から埋める処理は入れていない（推測で数字を作らない方針）。
- Step3 で「要確認」とされた応募者5名は運用側でマイナビ管理画面を確認済み・手動対応完了のため、本 Step では救済処理を行っていない。
- Step3 で挙がっている `parseDateLoose` の9時間ズレは**別タスク**（本 Step では触っていない）。
