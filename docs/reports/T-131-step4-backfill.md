# T-131 step4: 過去アップPDFの遡及フルデータ化バッチ（夜間実行スクリプト）

**日付**: 2026-07-04 ／ **対象**: bizstudio-portal（master）
**前提**: T-131-step2-portal.md（投入クライアント `submitPdfToJobPlatform`）・T-131-company-name-fix.md（job-platform 会社名対策）
**書き込み内容**: `externalJobRef`/`platformSubmittedAt` の書き戻し（portal）＋ job-platform への**非公開求人登録**のみ。**削除なし・破壊的操作なし**。

---

## 1. 実装: `scripts/t131-backfill-all.ts`

step2 の `t131-resubmit-stale.ts` を土台に、全期間・並列・レジューム・失敗管理・時間帯退避を備えた長時間バッチとして新設。

| 要素 | 実装 |
|---|---|
| 対象 | PDF由来ブックマーク（`sourceType=NULL`・`category=BOOKMARK`・`archivedAt=NULL`）＋`externalJobRef=NULL`＋`extractedText`あり＋`driveFileId`あり。**日付フィルタなし（全期間）** |
| 既定 | **DRY-RUN**（件数・候補者数・概算費用・概算所要のみ。DB/HTTP非接触） |
| 本実行 | `--execute`。`--workers N`（既定4）で並列度、`--limit N` で件数上限 |
| 投入経路 | step2 と同一の `submitPdfToJobPlatform`（multipart→`POST /api/internal/ingest-pdf`・`X-Internal-Key`・**タイムアウト120秒**※） |
| レジューム | 処理済/失敗のIDを `verify/t131-backfill-progress.jsonl` に**1件ずつ追記**。再実行時は既済をスキップし未処理だけ継続 |
| リトライ | 429/5xx/タイムアウト/ネットワーク断は**指数バックオフ（2s→8s→32s上限＋jitter）で最大3回**。なお失敗はスキップして `status:"failed"` 記録（全体を止めない） |
| 進捗ログ | **60秒ごと**に「処理数/残数/失敗数/経過秒/完了予測時刻(JST)」を出力 |
| 時間帯退避 | daily-ingest（JST 6:30）との競合回避で **JST 06:00–06:45 は自動一時停止→06:45再開**（各ワーカーが投入前に判定・1分ごと再確認） |
| 中断耐性 | SIGINT で新規投入を止め実行中を待って終了。ハードkill/電源断でも次回再実行で復旧 |

※ タイムアウトは共有クライアント `submitPdfToJobPlatform` の既定120秒をそのまま使用（プロンプト指定「90秒」以上で安全側。共有クライアントを分岐させない判断）。

### 安全弁（二重防御 — 三層）

1. **本クエリが `externalJobRef!=NULL` を除外** … 一度成功した行は再実行の対象母集団から外れる（DB由来のレジューム）。
2. **`progress.jsonl` の既済スキップ** … 失敗行（`externalJobRef` は NULL のまま）の無限リトライを防ぐ。
3. **job-platform 側の内容ハッシュ dedup** … 同一媒体×同一PDF内容(sha256)は Gemini を呼ばず既存 `sourceJobId` を `status:"duplicate"` で返す。→ 万一の再送でも**二重登録にならない**（下記試走で実地作動を確認）。

> jsonl は実行環境のファイル。Railwayコンテナは再起動でファイルが消えるが、その場合も**層1（DBの externalJobRef 除外）**が効くため、再実行で成功済みは必ずスキップされる（失敗分のみ再試行＝望ましい挙動）。jsonl は「失敗の永続スキップ」と監査用の副次層。

---

## 2. 検証

### 検証1: DRY-RUN（本番DB実測）

```
対象(全期間・未紐付け・抽出済・Drive実体あり): 4189件 / 候補者 210名
概算費用: 全体¥2472（×¥0.59/件）
概算所要（並列4）: 約11.9時間（41秒/件÷4）
```
（参考: 抽出未済で除外19件・既紐付け3件・Drive実体なし0件）

### 検証2＋3: `--execute --limit 20` 実試走＋レジューム（実測）

**中断耐性を兼ね、以下の手順で実施**（`railway run` で本番envを注入しローカルの当スクリプトを実行）:

1. `--execute --limit 20` を起動 → **7件成功した時点で node をハードkill**（電源断相当＝SIGINTより強い中断）。`progress.jsonl` に7件の `ok` が残る。
2. `--execute --limit 13` で再開 → ログ冒頭 **「進捗ファイル済み: 7件（ok=7 / failed=0）」** を認識し、**その7件を1件もスキップせず処理せず**、新規13件のみ処理。

| 確認 | 結果 |
|---|---|
| 再開時に既済を認識 | `進捗ファイル済み: 7件` を表示。run1の7 fileId は run2 で**再処理ゼロ**（fileId突合で重複0） |
| 合計 | 7 + 13 = **20件すべて `ok`・`failed=0`**（jsonl 20行・distinct fileId 20） |
| 内容ハッシュ dedup の実地作動 | 13件中**3件が `deduped=true`（status=duplicate）**＝過去テスト登録と同一内容PDFを Gemini を呼ばず既存IDで返却。二重登録なし |
| portal 書き戻し | **externalJobRef 20/20 書き戻し済み**・`platformSubmittedAt` 全件セット・jsonlの sourceJobId と DB値の**不一致0** |
| job-platform 登録 | 20件すべて **`visibility=private`**（public=0）・`status=active` |
| **公開検索±0** | jobs全体 74455 / **public 74430（step2時点の74430から不変）** / private 25。20件は全て private のため公開検索の母数に入らない |

> 試走20件は**テストデータではなく実運用の遡及分**（実在候補者の実ブックマークPDF）。削除せず正規のバックフィル成果として残置（4189件のうち最初の20件が完了済み）。

### 検証4: 会社名の品質（試走20件・多様レイアウトでの初実地確認）

**ファイル名まる写し 0件**。マイナビ形ファイル名（`27715_株式会社マイナビ.pdf` / `27607_株式会社マイナビ.pdf`）も会社名は clean な「株式会社マイナビ」で、**プレフィックス `27715_` の混入なし**＝company-name-fix の防御チェーンが実データで機能。

| # | source_job_id | vis | 会社名 |
|---|---|---|---|
| 1 | own-sn2k1e | private | ワークスアイディ株式会社 |
| 2 | own-hk4tth | private | 東栄ホームサービス株式会社 |
| 3 | own-eo66p0 | private | ランサーズ・ワンズソリューション株式会社 |
| 4 | own-lbl2k4 | private | レバレジーズプランニングサポート株式会社 |
| 5 | own-ujdr34 | private | ディーエムソリューションズ株式会社 |
| 6 | own-n8f7r4 | private | アルティウスリンク株式会社 |
| 7 | own-t4lx0p | private | マーケティングパートナー株式会社 |
| 8 | own-e7zeix | private | ジェイオーコスメティックス株式会社 |
| 9 | mynavi_jobshare-1ns708 | private | 株式会社マイナビ（元ファイル名 `27715_株式会社マイナビ.pdf`） |
| 10 | own-ma59ra | private | 株式会社スタートライン |
| 11 | own-5pzamk | private | 株式会社アド・プロ |
| 12 | own-0kbl4h | private | 株式会社Casa |
| 13 | own-kuxpg8 | private | 株式会社ネオ・ストラクト |
| 14 | mynavi_jobshare-l51dh7 | private | 株式会社マイナビ（元ファイル名 `27607_株式会社マイナビ.pdf`） |
| 15 | own-7rz86t | private | 株式会社レコフデータ |
| 16 | own-yb6cbr | private | 株式会社メドレー |
| 17 | own-o71r6y | private | 泰榮エンジニアリング株式会社 |
| 18 | own-4p2otr | private | アスメディックス株式会社 |
| 19 | own-nvfsjr | private | ジェイオーコスメティックス株式会社 |
| 20 | circus-ys1ec0 | private | アクサ損害保険株式会社 |

- **ファイル名まる写し疑い: 0件**（`.pdf`残存・`^\d{3,}_`プレフィックス・数字列混入 いずれも0）。
- **補正フォールバック発動件数**: 20件すべて最終会社名が clean のため補正は不要だった可能性が高い。ただし発動有無は job-platform 側 Vercel ランタイムログにのみ記録され、投入APIレスポンス（sourceJobId/status/deduped/confidence）からは判別不可のため、ここでは**「結果として0 artifact」**を確証事実として報告する（発動回数の厳密値は Vercel ログ参照が必要）。

---

## 2.5. 全量実行中に発覚した job-platform 側バグと対処（2026-07-04）

全量 `--execute` を実行したところ、約3,300件処理時点で **約10.7%（489件）が同一エラー**で失敗した:

```
HTTP 422: jobs upsert失敗: unsupported Unicode escape sequence
```

- **原因**: 一部PDFの抽出テキストに NUL（U+0000）が混入し、job-platform の `jobs.raw_data`（JSONB）への upsert を PostgreSQL が拒否（`text`/`jsonb` は NUL 非対応）。**job-platform 側の系統的バグ**（portal スクリプトの問題ではない）。
- **対処**: job-platform `src/lib/ingest/run-ingest.ts` に `deepStripPgUnsafe()` を追加し、upsert 直前に NUL/孤立サロゲートを全文字列から除去（commit **`4bfc49f`**・Vercel 反映済み・非退行）。詳細は job-platform `docs/reports/T-131-ingest-nul-fix.md`。
- **本番実地検証**: 以前 NUL で失敗した実PDF（`株式会社Second Game_No326071.pdf`）を再投入 → `circus-hfaas3` で**登録成功**。修正がライブかつ実データで有効。
- **バックフィルの復旧**: 失敗501件（489 NUL＋13 timeout=504）の進捗記録を `progress.jsonl` から除去（＝再対象化）し、`--execute` で**再開**。再開後の新規処理は**NULエラー再発0**。失敗行を除いた縮約前のjsonlは `verify/t131-backfill-progress-with-failures-20260704.jsonl.bak` に退避。
- **失敗分の再試行手順（レジューム設計の実運用例）**: 「`progress.jsonl` から `"status":"failed"` 行を削除 → 同じ `--execute` を再実行」で、未紐付け（externalJobRef=NULL）の行だけが再処理される。二重登録は内容ハッシュ dedup が防ぐ。

> この事象は step4 スクリプトのレジューム設計（失敗を記録しつつ全体を止めない／失敗行削除で再試行）が、実運用の系統的失敗に対して機能することの実証にもなった。

---

## 3. 夜間の起動コマンドと朝の確認方法

将幸さんの手元 portal リポジトリ（`railway` が bizstudio-portal/production にリンク済み）で実行。**本番envを注入してローカル実行**する方式（`progress.jsonl` が手元に残り、切断・PCスリープからの再開が確実）。

### 夜間の起動（1行・夕方に実行しPCをスリープさせない）
```
railway run npx tsx scripts/t131-backfill-all.ts --execute
```
- 並列を落とす場合: `railway run npx tsx scripts/t131-backfill-all.ts --execute --workers 2`
- 全量4189件で約11.9時間（並列4）。JST 06:00–06:45 は自動一時停止し 06:45 再開（daily-ingest 回避）。
- **途中で切断・中断しても、同じコマンドを再実行すれば残りから再開**（成功分は必ずスキップ）。

### 朝の確認（同じコマンドから `--execute` を外すだけ＝DRY-RUN で残数表示）
```
railway run npx tsx scripts/t131-backfill-all.ts
```
→ `進捗ファイル済み: N件（ok=.. / failed=..）` と `今回の未処理: M件` を表示。**M が 0 なら完了**。`failed` が残る場合は `verify/t131-backfill-progress.jsonl` の該当 `"status":"failed"` 行を削除して再度 `--execute` すれば失敗分だけ再試行。

### 補足（別方式）
`railway ssh` でコンテナ内実行（`nohup npx tsx scripts/t131-backfill-all.ts --execute > /tmp/t131.log 2>&1 &`）も可。ただしコンテナ再起動で jsonl が消えるため、その場合はDBレジューム（成功分スキップ）に依存する。手元 `railway run` の方が jsonl 継続の点で確実。

---

## 4. 変更ファイル / Git

- `scripts/t131-backfill-all.ts`（新規）
- `docs/reports/T-131-step4-backfill.md`（本レポート）
- `.gitignore`（`verify/t131-backfill-progress.jsonl` を追記＝実行時生成物をコミット対象外に）
- コミット: **`953ac03`**
- 試走で登録済みの実バックフィル20件（実候補者分）は**残置**。scratch検証スクリプトは削除済み。

## 5. Git / デプロイ
- コミット **`953ac03`**（scripts/t131-backfill-all.ts ＋ 本レポート ＋ .gitignore）。パス指定add（`git add -A` 不使用）。
- push前ゲート `py scripts/wait_railway_idle.py` → 本番idle（exit 0）
- Railway 本番（bizstudio-portal）: **SUCCESS**（`origin/master` HEAD=`953ac03`）。スクリプト追加のみ・アプリ挙動不変・`prisma migrate deploy` は no-op。
