# T-169 一次返信の送信日時が9時間ずれている問題の修正

- 対象リポジトリ: bizstudio-portal（branch `master`）
- 作業日: 2026-08-19（JST）
- 前提チケット: T-167（E-4 節）/ T-168（Step3 節）
- 罠#17（Railway UTC 環境での JST 日付ずれ）の典型例

## 結論（先に）

| 項目 | 結果 |
|--|--|
| Phase 1（パーサ修正） | **完了**。真理値表 13/13 期待どおり。`npx tsc --noEmit` 0件・`npm run build` 成功。コミット `c2e3470` を master へ push 済み |
| Phase 2（過去分の判定・dry-run） | **完了**。補正対象 **336件**（`CandidateSettingsHistory` 159 / `MynaviRpaProcessingLog` 177） |
| Phase 3（自動判定ゲート） | 初回は **G4 不通過**（G2 は4回目の再デプロイで充足）→ 案A 承認後に**再判定して G1〜G8 全通過** |
| Phase 4（補正実行） | **完了**。**336件**を補正。除外3件（センチネル値）・ダミー・大野テストは不変 |

**初回に満たせなかった条件（→ 案A で解消）**

| # | 条件 | 実データ |
|--|--|--|
| **G4** | 判定不能なレコードが 0件 | **`MynaviRpaProcessingLog` に 3件**。`reply_sent_at = 1901-01-01T00:00:00Z` の行（T-167 E-4 の2で既報）。差は約 **−65,940,000分（≒ −125年）** で「9時間ずれ」にも「正常」にも当てはまらない |

**2026-08-19 に案A が承認された**（この3件を「判定不能」ではなく **「除外（センチネル値）」** として母数から外し、残りを補正する。3件自体は UPDATE / DELETE しない）。再判定で G1〜G8 が全通過し、Phase 4 を実行した。詳細は 9 章。

> G2 は当初 Railway のデプロイ障害で3回連続 FAILED だったが、**4回目の再デプロイで SUCCESS**（2026-08-18T22:14:09Z）。本番は現在 `c2e3470` で稼働している。経緯は 2-3 に残す。

**最終状態**: パーサ修正が本番に載り（新規レコードは正しい instant で保存される）、過去分336件も補正済み。**設定履歴タブの「送信日時」は実データ全件が正しい値を表示する**。意図的に触っていないのは、センチネル値3件（`candidateId=null` で画面に出ない）・T-167 検証ダミー1件・大野テストの設定履歴4件のみ。

---

## 1. 原因（再確認）

`src/app/api/rpa/mynavi/reply-sent/route.ts` の `parseDateLoose()`。

RPA（PAD）は `sentAt` を **JST の壁時計値**（例 `"2026/08/18 23:10:00"`）で送ってくる。旧実装はこれを

```ts
return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
```

＝**サーバーのローカル時刻**として構築していた。Railway 本番コンテナは `TZ=UTC`（実測: `Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"`。本調査でも再確認済み）なので、JST の壁時計値がそのまま UTC 値になり、真の instant より **9時間進んだ値**が保存される。

影響カラム:

| テーブル | カラム | 読み出し先 |
|--|--|--|
| `CandidateSettingsHistory` | `sentAt` | **設定履歴タブ（`SettingsHistoryTab.tsx`）の「送信日時」** ← 画面に出ている唯一の影響 |
| `MynaviRpaProcessingLog` | `replySentAt` | **どこからも読まれていない**（T-167 Step1 で確定。書き込みは reply-sent の1箇所のみ） |

`CandidateSettingsHistory` の書き込み元も `reply-sent/route.ts` の1箇所のみ（`grep` で確認済み。他は `settings-history` の GET と `hard-delete` の `groupBy`）。`sendType` は全163件が `MYNAVI_FIRST_REPLY`。

---

## 2. Phase 1: パーサの修正

### 2-1. 修正内容

TZ 表記を持たない入力を **JST(+09:00) として解釈**する。TZ 表記（末尾 `Z` / `+09:00` / `+0900`）を含む入力は従来どおりその表記に従う。パース不能な入力の挙動（現在時刻を返す）は不変。

```ts
const hasTz = /([zZ])$|([+-]\d{2}:?\d{2})$/.test(s);
if (!hasTz) {
  const m = s.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?)?$/,
  );
  if (m) {
    const p = (n: string | undefined) => String(Number(n ?? 0)).padStart(2, "0");
    const jst = new Date(`${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${p(m[5])}:${p(m[6])}+09:00`);
    if (!isNaN(jst.getTime())) return jst;
  }
  const withJst = new Date(`${s}+09:00`);
  if (!isNaN(withJst.getTime())) return withJst;
}
const parsed = new Date(s);
return isNaN(parsed.getTime()) ? new Date() : parsed;
```

- 文字列に `+09:00` を付与して `new Date()` に解釈させる方式（`src/lib/schedule-tasks.ts` の `parseJstDefaultDate()` と同じパターン）。
- `toISOString().slice()` 系は**使っていない**（罠#17）。
- `SettingsHistoryTab.tsx` の**表示ロジックは一切変更していない**（表示側で足し引きすると新旧混在時に破綻するため）。

### 2-2. 真理値表（DB書き込みなし・`TZ=UTC` で実行）

ソースから `parseDateLoose` の定義を抽出して評価するオフラインスクリプトで確認（コピペ乖離を防ぐため）。

| 入力 | 期待する保存 instant | 実際 | 判定 |
|--|--|--|--|
| `"2026/08/18 23:10:00"` | `2026-08-18T14:10:00.000Z` | `2026-08-18T14:10:00.000Z` | OK |
| `"2026/8/18 6:29:20"` | `2026-08-17T21:29:20.000Z` | `2026-08-17T21:29:20.000Z` | OK |
| `"2026-08-18T23:10:00Z"` | `2026-08-18T23:10:00.000Z`（不変） | `2026-08-18T23:10:00.000Z` | OK |
| `"2026-08-18T23:10:00+09:00"` | `2026-08-18T14:10:00.000Z`（不変） | `2026-08-18T14:10:00.000Z` | OK |
| `"2026-08-18T23:10:00+0900"` | `2026-08-18T14:10:00.000Z`（不変） | `2026-08-18T14:10:00.000Z` | OK |
| `"2026-08-18 23:10:00"` | `2026-08-18T14:10:00.000Z` | `2026-08-18T14:10:00.000Z` | OK |
| `"2026-08-18T23:10:00"` | `2026-08-18T14:10:00.000Z` | `2026-08-18T14:10:00.000Z` | OK |
| `"2026/08/18 23:10:00.500"` | `2026-08-18T14:10:00.000Z` | `2026-08-18T14:10:00.000Z` | OK |
| `"2026-08-18"`（日付のみ） | `2026-08-17T15:00:00.000Z`（JST 0時） | `2026-08-17T15:00:00.000Z` | OK |
| `"これは日付ではない"` | 従来どおり現在時刻 | 現在時刻 | OK |
| `""` | 従来どおり現在時刻 | 現在時刻 | OK |
| `null` | 従来どおり現在時刻 | 現在時刻 | OK |
| `undefined` | 従来どおり現在時刻 | 現在時刻 | OK |

**OK=13 / NG=0**（G1 充足）

`npx tsc --noEmit` エラー **0件** / `npm run build` **成功**。

### 2-3. 本番反映（G2 = 4回目で充足）

コミット `c2e3470` を master へ push（2026-08-19 06:39 JST）。その後のデプロイ状況:

| 開始（UTC） | deployment id | status | configErrors |
|--|--|--|--|
| 2026-08-18T21:39:44Z | `98e620d8-…` | **FAILED** | `Failed to connect before the deadline` |
| 2026-08-18T21:51:17Z | `2222ed9f-…` | **FAILED** | `Failed to connect before the deadline` |
| 2026-08-18T22:00:58Z | `a6f490f9-…` | **FAILED** | `Failed to connect before the deadline` |
| 2026-08-18T22:14:09Z | `24d7a2ff-…` | **SUCCESS** | — |

判断材料:

- **ビルドは成功している**。`buildLogs` に `npm run build` の完走出力（ルート一覧）と `containerimage.digest` / `image push` まで残っている。
- **`deploymentLogs` / `environmentLogs`（`@deployment:` フィルタ）が 0 件**。Next.js は起動時に必ずバナーを出すので、**コンテナが一度も起動していない**ことを意味する。
- 本番 DB は健全（`/api/health` → `{"status":"ok","db":"ok","latencyMs":14}`）。罠#41 の Postgres ホスト過負荷ではない。
- 稼働中の本番は旧デプロイのまま生きている（`/login` が HTTP 200、コンテナ内 `.next/BUILD_ID` のタイムスタンプが 8/18 16:33 UTC ＝ `cbe6a77` のもの）。**サービス断は発生していない。**
- 変更内容は API ルート内の純粋関数1つで、起動処理に一切関与しない。

→ **`.claude/08-bug-patterns.md` の 2026-08-10 のケース**（redeploy を3回試して全て FAILED・ログも空 → Railway 側の負荷が収まって自然復旧）と**同じ現れ方**。Railway 側の一時障害と判断し、**コードは一切変えずに同一コミットを4回目の再デプロイ**（`serviceInstanceDeployV2`・40桁フル SHA）したところ **SUCCESS** になった。

**反映確認（G2 充足）**

| 確認項目 | 結果 |
|--|--|
| 本番デプロイの `commitHash` | `c2e347025739b17b1f4c40f8ec4f585a938837d8`（= Phase 1 のコミット） |
| `status` | **SUCCESS**（2026-08-18T22:14:09Z ＝ 2026-08-19 07:14 JST） |
| 稼働コンテナ内 `.next/BUILD_ID` のタイムスタンプ | 8/18 21:42 UTC（`c2e3470` のビルド。旧デプロイの 16:33 から更新） |
| 稼働コンテナ内のソース | `reply-sent/route.ts` に `T-169` コメント 1件・`hasTz` 2件を検出 |
| `/login` | HTTP 200 |

---

## 3. Phase 2: 過去分の対象特定（SELECT のみ / 初回判定）

`railway ssh --service bizstudio-portal` 経由でコンテナ上の Node / Prisma から実行（`railway run` は不使用）。スナップショット時刻 **2026-08-19 06:43 JST**。

### 3-1. 判定基準（プロンプト 2-1 のまま。裁量で動かしていない）

- `CandidateSettingsHistory`: 差 = `sentAt − createdAt`
- `MynaviRpaProcessingLog`: 差 = `replySentAt − processedAt`

| 分類 | 差の範囲 |
|--|--|
| 正常（NORMAL） | −10分 〜 +10分 |
| ずれ（SHIFTED） | +8時間50分 〜 +9時間10分 |
| 判定不能（UNKNOWN） | 上記以外すべて |
| 対象外 | `sentAt` / `replySentAt` が NULL |

### 3-2. 差の分布ヒストグラム（10分刻み・全件）

**`CandidateSettingsHistory`（判定対象 163件）**

| 帯 | 件数 |
|--|--|
| 530分 以上 540分 未満 | 147 |
| 540分 以上 550分 未満 | 16 |

実測の最小 **539.93分** / 最大 **544.09分**。**山は「約9時間」の1つだけで、中間帯（10分〜8時間50分、および9時間10分以上）は 0件。**

**`MynaviRpaProcessingLog`（判定対象 181件）**

| 帯 | 件数 |
|--|--|
| −65,941,280分 以上 −65,941,270分 未満 | **1** |
| −65,940,910分 以上 −65,940,900分 未満 | **1** |
| −65,940,390分 以上 −65,940,380分 未満 | **1** |
| 530分 以上 540分 未満 | 13 |
| 540分 以上 550分 未満 | 165 |

「約9時間」の山（178件）と、**大きな負の外れ値3件**。中間帯（10分〜8時間50分、および9時間10分以上の正側）は 0件。

> 補足: 「約0分」の山が両テーブルとも 0件なのは、**このスナップショット時点の既存レコードが全て旧パーサ由来**だから。G3 の実務上の要件（中間帯にレコードが無い）は満たしている。「2つの山」は Phase 1 反映後に新規レコードが入って初めて現れる。
>
> 本番反映後（2026-08-19 07:17 JST）に dry-run を再実行したが、この間に新規の一次返信が発生しなかったため **数値は完全に同一**（総件数 163 / 438、SHIFTED 163 / 178、UNKNOWN 0 / 3、補正対象 336）。

### 3-3. 判定不能（UNKNOWN）3件の実データ ※後に「除外（センチネル値）」へ再分類

| id | batchId | candidateId | processedAt | replySentAt | 差 | status / replyResult |
|--|--|--|--|--|--|--|
| `cmp8x0k7l00011dpsvi3obyvc` | `cmp8x0bdj00001dpscurrw56w` | **null** | 2026-05-17 07:25:51 JST | **1901-01-01 09:00:00 JST** | −65,940,385.9分 | DUPLICATE_SKIP / SUCCESS |
| `cmp9fh8xy00061dmtsyvuotjv` | `cmp9f8ay200011dmtlf3obtbd` | **null** | 2026-05-17 16:02:43 JST | **1901-01-01 09:00:00 JST** | −65,940,902.7分 | NORMAL / SUCCESS |
| `cmp9ssczm000b1dmtvyvxjr5z` | `cmp9ss1yu00081dmtkcgh71ry` | **null** | 2026-05-17 22:15:16 JST | **1901-01-01 09:00:00 JST** | −65,941,275.3分 | NORMAL / SUCCESS |

- 3件とも `candidateId = null`。したがって **`CandidateSettingsHistory` は作られておらず、画面には一切出ていない**（`sentAt < 1990` の `CandidateSettingsHistory` は **0件**で確認済み）。`replySentAt` 自体もどこからも読まれない。
- `replySentAt < 1990-01-01` の行はこの3件のみ（DB全体で確認済み）。
- 発生は 2026-05-16〜17 に集中。T-167 E-4 の2で既報の「RPA から不正な `sentAt` が来た痕跡」と同一。**T-167 では「木田 朱夏」と記録されていたが、本調査では3件とも `candidateId` が null**（この食い違いの原因は**未確認**）。
- **9時間減算しても意味のある値にはならない**ため、機械的な補正対象にしてはならない。→ **G4 不成立の直接原因**。

### 3-4. 件数の内訳

**`CandidateSettingsHistory`**

| 項目 | 件数 |
|--|--|
| 総件数 | **163** |
| 対象外（`sentAt` が NULL） | 0 |
| 約9時間ずれ（SHIFTED） | **163** |
| 正常（NORMAL） | 0 |
| 判定不能（UNKNOWN） | **0** |
| うち除外対象（大野テスト 5999999 / T-167 ダミー） | **4**（全て SHIFTED） |
| **補正対象** | **159** |
| SHIFTED の最古 `sentAt` | 2026-05-23 20:09:19 JST（補正後 2026-05-23 11:09:19 JST） |
| SHIFTED の最新 `sentAt` | 2026-08-19 08:13:00 JST（補正後 2026-08-18 23:13:00 JST） |

**`MynaviRpaProcessingLog`**

| 項目 | 件数 |
|--|--|
| 総件数 | **438** |
| 対象外（`replySentAt` が NULL） | **257** |
| 約9時間ずれ（SHIFTED） | **178** |
| 正常（NORMAL） | 0 |
| 判定不能（UNKNOWN） | **3** |
| うち除外対象（T-167 ダミー `t167-verify-log4`） | **1**（SHIFTED） |
| **補正対象** | **177** |
| SHIFTED の最古 `replySentAt` | 2026-05-23 20:09:19 JST |
| SHIFTED の最新 `replySentAt` | 2026-08-19 08:13:00 JST |

**補正対象 合計 336件**

除外対象の内訳:

| 除外対象 | 実体 | 該当件数 |
|--|--|--|
| 求職者「大野 テスト」（`candidateNumber=5999999` / id `cmmn4jipg00011dqt23w1q3bk`） | `CandidateSettingsHistory` 4件（全て SHIFTED） | 4 |
| T-167 検証用ダミー（`batchId = t167-verify-20260818` / id prefix `t167-verify-log`） | 処理ログ4件。うち `replySentAt` 非NULL は `t167-verify-log4` の1件のみ（`2026-08-18T23:13:00Z`、SHIFTED）。4件とも `candidateId` は大野テスト | 1 |

### 3-5. 補正スクリプト

`scripts/fix-sent-at-timezone-t169.ts`

- `--dry-run`（既定）/ `--execute` の2モード。
- **`--execute` 時は書き込み直前に UNKNOWN 件数を再判定し、1件でもあれば書き込まずに終了**（dry-run と execute の間に新規レコードが増えても安全）。
- 対象は SHIFTED と判定できるレコードのみ。UNKNOWN は**触らない**。
- 補正内容は当該カラムから **9時間を減算**するのみ。他カラム・INSERT・DELETE は無し。
- 変更前の値を CSV に出力（ロールバック用）。ファイル名に JST 実行時刻サフィックス、`fs.writeFileSync(..., { flag: "wx" })` ＋ `existsSync` チェックで**既存CSVを上書きしない**。
- 500件チャンク＋`$transaction`。
- T-167 ダミー・大野テストを除外。

### 3-6. dry-run 結果

実行: `npx tsx scripts/fix-sent-at-timezone-t169.ts --csv-dir=/tmp/t169 --print-csv`（コンテナ上）

```
=== T-169 送信日時9時間ずれ補正 [DRY-RUN] ===
開始: 2026-08-19 06:43:54 JST / container TZ = UTC
=== 補正対象 合計: 336 件 ===
[idempotent検証] 補正後 NORMAL: 336/336 / 再び SHIFTED になる件数: 0
ロールバックCSV: /tmp/t169/T-169_rollback_dry-run_20260819-064354.csv (336 行)
DRY-RUN のため書き込みは行いませんでした。
```

**サンプル10件（現在値 → 補正後・JST）**

| テーブル.カラム | id | 現在値 | 補正後 | 基準列 |
|--|--|--|--|--|
| CandidateSettingsHistory.sentAt | `cmphpn44j001t1dpcuf3u7209` | 2026-05-23 20:09:19 | 2026-05-23 11:09:19 | createdAt 2026-05-23 11:09:22 |
| CandidateSettingsHistory.sentAt | `cmrudmitb00dw1dprg1l66akh` | 2026-07-22 02:13:22 | 2026-07-21 17:13:22 | createdAt 2026-07-21 17:13:24 |
| CandidateSettingsHistory.sentAt | `cms3urpgo002i0xqvwmihkkc9` | 2026-07-28 17:23:14 | 2026-07-28 08:23:14 | createdAt 2026-07-28 08:23:15 |
| CandidateSettingsHistory.sentAt | `cmsgqqoc100qa0xsduvl6zo1p` | 2026-08-06 17:51:28 | 2026-08-06 08:51:28 | createdAt 2026-08-06 08:51:28 |
| CandidateSettingsHistory.sentAt | `cmspciunk00500xnqrgy6c9x3` | 2026-08-12 18:23:25 | 2026-08-12 09:23:25 | createdAt 2026-08-12 09:23:24 |
| MynaviRpaProcessingLog.replySentAt | `cmpi4dq1m00351dpcukh3gf0w` | 2026-05-24 03:01:57 | 2026-05-23 18:01:57 | processedAt 2026-05-23 18:01:58 |
| MynaviRpaProcessingLog.replySentAt | `cmru8xgdj009g1dprkcl4z0gk` | 2026-07-22 00:03:21 | 2026-07-21 15:03:21 | processedAt 2026-07-21 15:01:56 |
| MynaviRpaProcessingLog.replySentAt | `cms2p3tse00840xmox5vnygp9` | 2026-07-27 21:58:20 | 2026-07-27 12:58:20 | processedAt 2026-07-27 12:56:56 |
| MynaviRpaProcessingLog.replySentAt | `cmsebxz3y00cu0xo4yu0vitkb` | 2026-08-05 01:23:07 | 2026-08-04 16:23:07 | processedAt 2026-08-04 16:21:42 |
| MynaviRpaProcessingLog.replySentAt | `cmsmjq5qc00vk0xt206so6gz2` | 2026-08-10 19:23:14 | 2026-08-10 10:23:14 | processedAt 2026-08-10 10:21:44 |

（すべて JST 表記）

**idempotent 性の検証**: 補正対象336件の差は 539.93〜544.09分。9時間（540分）を引くと **−0.07〜+4.09分**となり、全件が NORMAL（±10分）に入り SHIFTED 条件（≥530分）から外れる。したがって**再実行時の対象は0件になる＝ idempotent は成立する**（G6 充足）。

**ロールバック CSV**

| 項目 | 値 |
|--|--|
| コンテナ上の出力先 | `/tmp/t169/T-169_rollback_dry-run_20260819-064354.csv` |
| 行数 | **336 行**（＋ヘッダ1行） |
| リポジトリに保存した控え | `docs/reports/T-169_rollback_dryrun_20260819-064354.csv` |
| 列 | `table,id,candidate_id,column,base_column,base_value_utc,old_value_utc,new_value_utc,old_value_jst,new_value_jst,diff_minutes` |

CSV の検算: 336行／`CandidateSettingsHistory` 159・`MynaviRpaProcessingLog` 177／**大野テストの `candidate_id` 混入 0件・`t167-verify-log*` の混入 0件**（G7 充足）。

---

## 4. Phase 3: 自動判定ゲートの判定（初回・2026-08-19 07:00 JST 頃）

| # | 条件 | 判定 | 根拠 |
|--|--|--|--|
| G1 | 真理値表が全件期待どおり | **✅** | OK=13 / NG=0（2-2） |
| G2 | Phase 1 の修正が本番反映済み（commitHash 一致・status=SUCCESS） | **✅** | 3回連続 FAILED の後、4回目の再デプロイで `commitHash=c2e3470…` / `status=SUCCESS`。稼働コンテナのソースでも確認（2-3） |
| G3 | 中間帯（10分〜8時間50分／9時間10分以上）にレコードが存在しない | **✅** | 両テーブルとも中間帯 0件（3-2）。ただし「約0分」の山は Phase 1 未反映のため現時点で 0件 |
| G4 | 判定不能なレコードが 0件（両テーブル） | **❌** | `MynaviRpaProcessingLog` に **3件**（3-3） |
| G5 | dry-run 対象件数 ＝ ずれ件数 − 除外のうちずれに分類された分 | **✅** | CSH: 163−4=**159** / Log: 178−1=**177** / 合計 **336** = dry-run 336 |
| G6 | idempotent 性が成立 | **✅** | 補正後 336/336 が NORMAL・再 SHIFTED 0件（3-6） |
| G7 | 除外対象が対象に含まれていない | **✅** | CSV 検算で混入0件（3-6） |
| G8 | ロールバック CSV が書き出せる | **✅** | 336行を出力・上書きガード動作（3-6） |

**G4 が不成立のため、Phase 4（`--execute`）は実行していない。**（G2 は充足済み）

---

## 5. 人の判断を仰いだ点（→ 案A で決着）

### 5-1. G4: 判定不能な3件（`1901-01-01`）をどう扱うか ← **案A が採択された**

3件とも `candidateId = null` ＝ **設定履歴タブには一切出ていない**、かつ `replySentAt` はどこからも読まれない。**放置しても画面・業務への実害はない。**

提示した選択肢:

| 案 | 内容 | 備考 |
|--|--|--|
| **A（採択）** | 判定基準に「`replySentAt < 1990-01-01` は補正対象外・判定不能から除外して母数から外す」という**明示的な第4分類**を足し、G4 の分母から外す | 基準を「広げる」のではなく「不正値として明示的に隔離する」。プロンプトの「基準を広げて通す」禁止には抵触しないと考えるが、**基準の変更なので人の承認が必要** |
| B | 3件の `replySentAt` を `NULL` に落としてから補正を実行 | データの書き換えなので別途承認が必要。`replyResult` は `SUCCESS` のまま残る |
| C | 3件を残したまま Phase 4 をスキップし続ける | 現状維持。9時間ずれは補正されない |

### 5-2. 決着

**案A が採択され、そのとおり実施した**（9章）。B（3件を NULL に落とす）・C（現状維持）は採らなかった。

なお `scripts/fix-sent-at-timezone-t169.ts` は**デプロイ済みイメージに含まれない**ため、実行のたびにコンテナへ base64 転送して置く必要がある（`railway ssh` 上で `npx tsx`）。

---

## 6. 設定履歴タブの表示例（実データ）

Phase 4 実行後に実画面で確認済み（9-6）。

T-168 Step3 で例示された処理ログ `cmsykj1nq01pr0xll2mdinb2a` の応募者:

| 項目 | 値 |
|--|--|
| 応募者 | 山手 あかり（`5008440` / id `cmsykix8o01pp0xllmflj38uq`） |
| 処理ログ `processedAt` | `2026-08-18T11:17:26.438Z` = **2026-08-18 20:17:26 JST**（正しい instant） |
| 処理ログ `replySentAt`（補正前） | `2026-08-18T20:18:49.000Z` = **2026-08-19 05:18:49 JST** → 補正後 `2026-08-18T11:18:49.000Z` |
| 設定履歴 `createdAt` | `2026-08-18T11:18:50.079Z` = **2026-08-18 20:18:50 JST**（正しい instant） |
| 設定履歴 `sentAt`（補正前） | `2026-08-18T20:18:49.000Z` → 補正後 `2026-08-18T11:18:49.000Z` |

| 設定履歴タブの「送信日時」 | 表示 |
|--|--|
| **補正前** | **2026/08/19 05:18** ← 実際より9時間進んでいた |
| **補正後（実 DB・実画面で確認済み）** | **2026/08/18 20:18** ← `createdAt` の 20:18:50 と1秒差で整合 |

---

## 7. 実施したこと / していないこと

**実施したこと**

- `src/app/api/rpa/mynavi/reply-sent/route.ts` の `parseDateLoose()` を修正し、master へ push（`c2e3470`）。
- `scripts/fix-sent-at-timezone-t169.ts` を新規作成し、dry-run → `--execute` を実行（**336件を UPDATE**）。
- 本番 DB に対する調査は **SELECT のみ**（`railway ssh` 経由。`railway run` は不使用）。書き込みは上記スクリプトの `sentAt` / `replySentAt` UPDATE のみ。
- Railway GraphQL の `deployments` / `deployment` / `buildLogs` / `deploymentLogs` / `environmentLogs` の**読み取り**、および `serviceInstanceDeployV2` による**同一コミットの再デプロイ**。

**していないこと**

- `SettingsHistoryTab.tsx` の表示ロジック変更なし。
- マイグレーションの作成・実行なし（スキーマ変更不要）。
- T-168 の FAILED / NO_TARGET 関連コードへの変更なし。
- T-167 ダミー・大野テスト関連レコードへの操作なし。
- センチネル値3件（`1901-01-01`）への UPDATE / DELETE なし（分類を変えて除外しただけ）。
- `sentAt` / `replySentAt` 以外のカラムへの変更なし。INSERT / DELETE なし。
- `railway run` / `git add -A` の使用なし。
- 変更禁止ファイルへの変更なし。

## 8. 未確認事項

- Railway 側のデプロイ障害（3回連続 FAILED）の正確な原因。Railway サポートへの問い合わせは行っていない。4回目が成功した理由も**未確認**（同一コミット・同一設定で再試行しただけ）。
- Phase 1 反映後の**新規**レコードが実際に「約0分」の山に入ることの実測。反映（07:14 JST）から Phase 4 完了（07:49 JST）までの間に一次返信が1件も発生しなかったため、**新規レコードでの確認は未実施**。補正済みの過去分は全件 ±10分に入っている（9-2）。
- `1901-01-01` の3件について、RPA（PAD）が実際に何を送ったかの生値。当時のリクエストログは残っていない。T-167 が「木田 朱夏」と記録していたのに対し本調査では `candidateId` が3件とも null である食い違いの理由。
- ロールバックの**実行手順**は用意していない（CSV に旧値を持っているだけ。戻す場合は `old_value_utc` を書き戻すスクリプトを別途書く必要がある）。

---

# 9. Phase 4: 補正の実行記録（2026-08-19 / 案A 承認後）

Phase 3 の停止を受け、**案A（`1901-01-01` の3件は「判定不能」ではなく「除外（センチネル値）」として母数から外し、残りを補正する）** が承認された。3件そのものは **UPDATE / DELETE していない**。

## 9-1. スクリプトの変更（案A の実装）

`scripts/fix-sent-at-timezone-t169.ts` に第4の分類 `SENTINEL` を追加した。

```ts
/** RPA が不正な sentAt を送った痕跡。9時間引いても意味を成さないので母数から外す。触らない。 */
const SENTINEL_BEFORE = new Date("1990-01-01T00:00:00Z");

function classify(value: Date, diffMs: number): Klass {
  // センチネル値は差を見る前に除外する（母数から外す）。
  if (value.getTime() < SENTINEL_BEFORE.getTime()) return "SENTINEL";
  if (diffMs >= NORMAL_LO && diffMs <= NORMAL_HI) return "NORMAL";
  if (diffMs >= SHIFTED_LO && diffMs <= SHIFTED_HI) return "SHIFTED";
  return "UNKNOWN";
}
```

- `sentAt` / `replySentAt` が **1990-01-01 より前**なら、差を計算する前に `SENTINEL` として母数から外す。
- `SENTINEL` は `SHIFTED` になり得ないので、**補正対象には絶対に入らない**。
- 除外した id は毎回ログに出す（下記 9-2 の出力を参照）。
- `--execute` 直前の安全ゲートは従来どおり **`UNKNOWN` が1件でもあれば書き込まず終了**。`SENTINEL` はこのゲートの分母に入れない。
- `NORMAL` / `SHIFTED` の数値基準は**一切変更していない**（−10分〜+10分 / +8時間50分〜+9時間10分）。

`npx tsc --noEmit` エラー 0件。

## 9-2. 再 dry-run（案A 適用後・2026-08-19 07:47:26 JST）

```
判定基準: NORMAL=[-10分,+10分] / SHIFTED=[8h50m,9h10m] / <1990-01-01=SENTINEL(除外) / それ以外=UNKNOWN(触らない) / 補正=-9時間

########## CandidateSettingsHistory ##########
テーブル総件数: 163 / 対象外(NULL): 0 / 除外(センチネル値<1990): 0 / 判定対象: 163
  SHIFTED(約9時間ずれ): 163  NORMAL(正常): 0  UNKNOWN(判定不能): 0
  うち除外対象で SHIFTED: 4 / 補正対象: 159

########## MynaviRpaProcessingLog ##########
テーブル総件数: 438 / 対象外(NULL): 257 / 除外(センチネル値<1990): 3 / 判定対象: 178
  SHIFTED(約9時間ずれ): 178  NORMAL(正常): 0  UNKNOWN(判定不能): 0
  うち除外対象で SHIFTED: 1 / 補正対象: 177
  --- SENTINEL（1990年より前の不正値・母数から除外・触らない） ---
  id=cmp8x0k7l00011dpsvi3obyvc replySentAt=1901-01-01T00:00:00.000Z (1901-01-01 09:00:00 JST) processedAt=2026-05-16T22:25:51.441Z
  id=cmp9fh8xy00061dmtsyvuotjv replySentAt=1901-01-01T00:00:00.000Z (1901-01-01 09:00:00 JST) processedAt=2026-05-17T07:02:43.078Z
  id=cmp9ssczm000b1dmtvyvxjr5z replySentAt=1901-01-01T00:00:00.000Z (1901-01-01 09:00:00 JST) processedAt=2026-05-17T13:15:16.546Z

=== 補正対象 合計: 336 件 ===
[idempotent検証] 補正後 NORMAL: 336/336 / 再び SHIFTED になる件数: 0
```

**該当3件が `SENTINEL` に分類され、両テーブルとも `UNKNOWN` が 0件になった。**

## 9-3. ゲートの再判定（G1〜G8 全通過）

| # | 条件 | 判定 | 根拠 |
|--|--|--|--|
| G1 | 真理値表が全件期待どおり | ✅ | OK=13 / NG=0（2-2。パーサは変更していないので初回と同一） |
| G2 | Phase 1 の修正が本番反映済み | ✅ | `commitHash=c2e347025739b17b1f4c40f8ec4f585a938837d8` / `status=SUCCESS`、稼働コンテナのソースでも確認（2-3） |
| G3 | 中間帯にレコードが存在しない | ✅ | 両テーブルとも 530〜550分の帯のみ。10分〜8時間50分／9時間10分以上は 0件 |
| **G4** | **判定不能が 0件** | **✅** | CSH 0件 / Log 0件（案A でセンチネル3件を母数から除外） |
| G5 | dry-run 件数 ＝ ずれ − 除外 | ✅ | CSH 163−4=**159** / Log 178−1=**177** / 合計 **336** ＝ dry-run 336 |
| G6 | idempotent 性が成立 | ✅ | 補正後 336/336 が NORMAL・再 SHIFTED 0件。実行後の再 dry-run でも実証（9-5） |
| G7 | 除外対象が対象に含まれていない | ✅ | CSV 検算で 大野テスト0 / T-167ダミー0 / センチネル0 |
| G8 | ロールバック CSV が書き出せる | ✅ | 336行を出力（9-7） |

## 9-4. `--execute` の実行

実行経路: `railway ssh --service bizstudio-portal` 上で `npx tsx`（`railway run` は不使用）。

| 項目 | 値 |
|--|--|
| 実行時刻 | 2026-08-19 **07:48:24** JST |
| 直前の再 dry-run | 07:47:26 JST（対象 **336件**）→ 確認後 **1回だけ**実行 |
| 補正対象 | **336件**（dry-run と一致） |
| 更新結果 | `336/336 更新完了` → `完了: 336 件を補正しました。` |
| チャンク | 500件チャンク × 1回 |
| 補正内容 | `sentAt` / `replySentAt` から 9時間を減算（他カラム不変・INSERT/DELETE なし） |

## 9-5. 実行後の確認

### (a) 件数が実行前後で不変（UPDATE のみ）

| テーブル | 実行前 | 実行後 |
|--|--|--|
| `CandidateSettingsHistory` | 163 | **163** |
| `MynaviRpaProcessingLog` | 438 | **438** |
| `MynaviRpaProcessingLog`（`replySentAt` 非NULL） | 181 | **181** |

### (b) 補正後の差の分布 — 「約9時間」の山が消えた

**`CandidateSettingsHistory`（n=163）**

| 帯 | 実行前 | 実行後 |
|--|--|--|
| −10分 以上 0分 未満 | 0 | **147** |
| 0分 以上 10分 未満 | 0 | **12** |
| 530分 以上 540分 未満 | 147 | 0 |
| 540分 以上 550分 未満 | 16 | **4** ← 大野テスト（意図的に除外） |

実測 min **−0.07分** / max 545.29分（max は除外した大野テスト4件のもの）。**±10分以内 = 159/163**（残り4件＝大野テスト）。

**`MynaviRpaProcessingLog`（センチネル3件を除く n=178）**

| 帯 | 実行前 | 実行後 |
|--|--|--|
| −10分 以上 0分 未満 | 0 | **13** |
| 0分 以上 10分 未満 | 0 | **164** |
| 530分 以上 540分 未満 | 13 | 0 |
| 540分 以上 550分 未満 | 165 | **1** ← `t167-verify-log4`（意図的に除外） |

実測 min **−0.04分** / max 546.78分（max は除外した T-167 ダミーのもの）。**±10分以内 = 177/178**（残り1件＝T-167 ダミー）。

→ **補正対象とした336件は全件 ±10分以内**に収まった。範囲外に残る5件は、いずれも意図的に除外したレコード（大野テスト4 / T-167 ダミー1）。

### (c) 再 dry-run（idempotent の実証・07:48:56 JST）

```
########## CandidateSettingsHistory ##########
  SHIFTED(約9時間ずれ): 4  NORMAL(正常): 159  UNKNOWN(判定不能): 0
  うち除外対象で SHIFTED: 4 / 補正対象: 0

########## MynaviRpaProcessingLog ##########
  SHIFTED(約9時間ずれ): 1  NORMAL(正常): 177  UNKNOWN(判定不能): 0
  うち除外対象で SHIFTED: 1 / 補正対象: 0

=== 補正対象 合計: 0 件 ===
```

**補正対象 0件。** 残る SHIFTED 5件は全て除外対象（大野テスト4 / T-167 ダミー1）で、`補正対象: 0` になっている。

### (d) 不変であるべきレコード

**センチネル値3件** — `replySentAt` / `processedAt` / `replyResult` すべて実行前と完全一致。

| id | replySentAt（実行前＝実行後） | processedAt | replyResult |
|--|--|--|--|
| `cmp8x0k7l00011dpsvi3obyvc` | `1901-01-01T00:00:00.000Z` | `2026-05-16T22:25:51.441Z` | SUCCESS |
| `cmp9fh8xy00061dmtsyvuotjv` | `1901-01-01T00:00:00.000Z` | `2026-05-17T07:02:43.078Z` | SUCCESS |
| `cmp9ssczm000b1dmtvyvxjr5z` | `1901-01-01T00:00:00.000Z` | `2026-05-17T13:15:16.546Z` | SUCCESS |

**T-167 検証ダミー処理ログ4件** — 実行前後で一致。

| id | replySentAt | processedAt |
|--|--|--|
| `t167-verify-log1` | null | `2026-08-18T14:03:13.406Z` |
| `t167-verify-log2` | null | `2026-08-18T14:04:13.406Z` |
| `t167-verify-log3` | null | `2026-08-18T14:05:13.406Z` |
| `t167-verify-log4` | `2026-08-18T23:13:00.000Z` | `2026-08-18T14:06:13.406Z` |

**大野テスト（5999999）の設定履歴4件** — 実行前後で一致（9時間ずれたまま温存）。

| id | sentAt（実行前＝実行後） | JST 表示 |
|--|--|--|
| `cmsyqlyzq00010xmsy6kgqt8s` | `2026-08-18T23:10:00.000Z` | 2026-08-19 08:10:00 |
| `cmsyqlzfp00020xmsetggmvs2` | `2026-08-18T23:11:00.000Z` | 2026-08-19 08:11:00 |
| `cmsyqlzvb00030xms30gf7w4u` | `2026-08-18T23:12:00.000Z` | 2026-08-19 08:12:00 |
| `cmsyqm0ay00040xmsbc8xg0oi` | `2026-08-18T23:13:00.000Z` | 2026-08-19 08:13:00 |

## 9-6. 設定履歴タブの実画面確認（実データ）

対象: **山手 あかり（`5008440`）** — T-168 Step3 で例示された処理ログ `cmsykj1nq01pr0xll2mdinb2a` の応募者。**大野テストではない実データ。**

| 項目 | 補正前 | 補正後 |
|--|--|--|
| `CandidateSettingsHistory.sentAt` | `2026-08-18T20:18:49.000Z` | **`2026-08-18T11:18:49.000Z`** |
| `MynaviRpaProcessingLog.replySentAt` | `2026-08-18T20:18:49.000Z` | **`2026-08-18T11:18:49.000Z`** |
| `createdAt`（不変・正しい instant） | `2026-08-18T11:18:50.079Z` = 2026-08-18 20:18:50 JST | 同左 |
| **設定履歴タブの「送信日時」** | **2026/08/19 05:18** | **2026/08/18 20:18** |

本番 API のレスポンス（`GET /api/candidates/cmsykix8o01pp0xllmflj38uq/settings-history`）:

```json
{"histories":[{"id":"cmsykku7301q30xll6z7z2scv","candidateId":"cmsykix8o01pp0xllmflj38uq",
"sentAt":"2026-08-18T11:18:49.000Z","sendType":"MYNAVI_FIRST_REPLY","sendResult":"SUCCESS",
"templateName":"【日程調整】初回メッセージ","senderName":"藤本 夏海","createdAt":"2026-08-18T11:18:50.079Z"}]}
```

ブラウザで本番の設定履歴タブ（`/candidates/cmsykix8o01pp0xllmflj38uq?view=settings-history`）を開いて実表示を確認:

| 送信日時 | 送信種別 | 送信結果 | 送信文章名 | 送信担当者 |
|--|--|--|--|--|
| **2026/08/18 20:18** | マイナビ一次返信 | 成功 | 【日程調整】初回メッセージ | 藤本 夏海 |

RPA の処理時刻（`processedAt` 20:17:26 JST）および `createdAt`（20:18:50 JST）と整合している。

## 9-7. ロールバック CSV

| 項目 | 値 |
|--|--|
| コンテナ上の出力先 | `/tmp/t169exec/T-169_rollback_execute_20260819-074824.csv` |
| リポジトリに保存した控え | **`docs/reports/T-169_rollback_execute_20260819-074824.csv`** |
| 行数 | **336行**（＋ヘッダ1行） |
| 内訳 | `CandidateSettingsHistory` 159 / `MynaviRpaProcessingLog` 177 |
| 検算 | 大野テスト混入 **0** / T-167 ダミー混入 **0** / センチネル値混入 **0** |
| 列 | `table,id,candidate_id,column,base_column,base_value_utc,old_value_utc,new_value_utc,old_value_jst,new_value_jst,diff_minutes` |

戻す場合は `old_value_utc` を該当 `id` の `column` に書き戻す。**ロールバック用スクリプトは用意していない**（必要になったら別途書く）。

なお、dry-run 時の CSV も `docs/reports/T-169_rollback_dryrun_20260819-064354.csv`（336行）として残してある。内容は execute 版と同一。
