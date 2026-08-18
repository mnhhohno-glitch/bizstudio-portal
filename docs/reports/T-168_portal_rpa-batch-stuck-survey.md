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
