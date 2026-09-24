# T-XXX step5 求人評価を Opus 5.5 に切り替え＋評価の中身と結果の保存・変更なしスキップ

- 実施日: 2026-09-25（JST）
- 対象: bizstudio-portal（master）。第1部 → 第2部 → 第3部の順に、staging 確認 → 本番 → 本番確認まで実施
- 動作確認は大野テスト（5999999・`cmmn4jipg00011dqt23w1q3bk`）のみ。確認中は大野テストのほかのブックマーク115件を一時アーカイブし、終了後に全件戻した（`scripts/output/t-xxx-eval-history/`・コミットしない）
- 為替: 1USD = 157.42円（step1〜4 と同じ）。この報告書に載せているのは ID だけ
- 変更していないもの: 評価の判定基準（SKILL）・指示文・総合評価表、評価以外の機能のモデル、既存の表の列・行

## 結論

| 項目 | 結果 |
|--|--|
| 第1部 | 求人評価（手動・自動配信）のモデルを **Opus 5.5・effort low** に切り替え、staging・本番とも確認済み。ログのモデル名は `claude-opus-5-5`、金額は公式料金どおり |
| 第2部 保存 | 新表 `job_eval_parts`（部品・重複なし）と `job_eval_records`（評価1回×求人1件）を追加。見込み容量は **月 約50MB**（上限見積 60MB） |
| 第2部 スキップ | 確認1〜4すべて合格（staging で1〜4、本番で1・4）。2回目の全件分析は AI 呼び出し0・費用0 |
| 第3部 | 見張り用スクリプトを追加し、直近30日（Opus 4.6）の基準値を採取 |
| 確認の AI 費用 | **¥171.5**（上限 ¥500） |

## 第1部 Opus 5.5 への切り替え（920bf07）

### 当てたパッチと調整点

step4 で保管した `part2-switch.patch` と `eval-model.ts.txt` をそのまま当てた（`git apply --check` 無衝突・master は step4 以降進んでいなかった）。調整は1点だけ。

- 自動配信 dry_run の費用試算（`analyze-batch-run.ts` の定数 `PRICE_INPUT_PER_MTOK=5` 等）が Opus 4.6 固定だったため、`EVAL_MODEL` の料金表から引くようにした（課金には影響しない表示用の試算）

### 中身（確認済み）

| 項目 | 内容 |
|--|--|
| 単一ソース | `src/lib/eval-model.ts`。`evalRequestParams()`（model / max_tokens / temperature or output_config）と `evalResponseText()`（text ブロックだけを連結） |
| 環境変数 | `EVAL_MODEL`（既定 `claude-opus-5-5`）・`EVAL_EFFORT`（既定 `low`。low / medium / high / xhigh / max） |
| `EVAL_MODEL=claude-opus-4-6` | 従来どおり temperature 0.7・thinking なし・max_tokens 16,000 |
| Opus 5.5 | `output_config.effort`・max_tokens 32,000・temperature を送らない。応答の先頭が thinking ブロックになるため text ブロックだけを読む |
| 料金表 | `src/lib/claude.ts`（`MODEL_PRICING_PER_MTOK`）と `src/lib/ai-pricing.ts` の両方に追加。入力 $4 / 出力 $20 / 読込 $0.20 / 5分書込 $5 / 1時間書込 input×2 = $8 / Batch は合計×0.5（既存の `computeCostUsd` / `recordAdvisorUsage` の仕組みをそのまま使う） |
| 思考の分 | `usage.output_tokens` に含まれて返るので、出力として1回だけ数える（別に足さない） |
| 途切れ | `stop_reason=max_tokens` は `AdvisorUsageLog.note` に `stop-max_tokens` を残す |
| 対象経路 | 手動評価 `analyze-batch/route.ts`、自動配信の投入 `runAnalyzeSubmit` と回収 `runAnalyzeCollect`（`src/lib/recommend/analyze-batch-run.ts`） |

変更ファイル: `src/lib/eval-model.ts`（新規）/ `src/lib/claude.ts` / `src/lib/ai-pricing.ts` / `src/lib/recommend/analyze-batch-run.ts` / `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts`

### 確認結果（大野テスト・ブックマーク3件）

| 環境 | モデル（ログ） | 入力 / 出力 / 読込 / 書込 | 記録された金額 | 公式料金で計算した金額 | 画面 |
|--|--|--|--:|--:|--|
| staging | `claude-opus-5-5` | 6,660 / 3,848 / 0 / 34,110 | $0.33872（¥53.3） | $0.33872（1h書込 21,523・5分書込 12,587） | 3件ともランク・コメント保存、完了カードあり |
| 本番 | `claude-opus-5-5` | 6,660 / 3,505 / 21,523 / 12,587 | $0.16398（¥25.8） | $0.16398 | 同上 |

- staging の1回目は Opus 5.5 のキャッシュが無かったため全量書込（1h ブロック 21,523 トークン×$8 ＋ 5分ブロック 12,587×$5）。本番の1回目は staging が書いた 1h キャッシュを読込（21,523×$0.20）できており、金額は計算値と一致
- エラーなし。応答 36〜44 秒

### 自動配信の経路

大野テストで手動起動できる仕組みは無い（自動配信 OFF・「今すぐ探す」は job-platform 側の即時引き当て API 未実装 [[T-189]]）。翌朝の定時（投入 07:30 JST・回収 07:45〜）を次で確かめる。

```
cd C:\bizstudio\bizstudio-portal
npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts --days 1
```

- [A] の「自動配信」行のモデルが `claude-opus-5-5` で、1件あたり費用が Opus 4.6 の ¥5.2 より下がっていること（Batch 半額）
- [B] の「自動配信」行に `評価(SAVED)` が付き、`未回収` が 0 になっていること（投入時 PENDING → 回収時 SAVED）

## 第2部 評価の中身と結果の保存・変更なしスキップ（15c1c19 / 停止スイッチ 9ce6f91）

### 追加した表（追加のみ・既存の表は変えていない）

`prisma/migrations/20260925100000_t_xxx_job_eval_history`（`CREATE TABLE IF NOT EXISTS`・冪等）

**`job_eval_parts`** — AI に送った中身の部品。内容の SHA-256 を主キーにして同じ中身は1回だけ保存する

| kind | 中身 |
|--|--|
| `fixed` | 共通部分（SKILL 定義＋評価ルール）。23,607字 |
| `instruction` | バッチ指示（system 第3ブロック・件数と位置の数字を含む実文） |
| `context_core` | 求職者情報のうち「アップロード済みファイル」一覧のブックマーク行を除いた部分 |
| `context_files` | 求職者情報のブックマーク一覧の行だけ |
| `job` | 求人本文（ファイル名＋抽出テキスト3,000字。位置番号は含めない） |

**`job_eval_records`** — 評価1回 × 求人1件で1行

| 列 | 内容 |
|--|--|
| `route` | `full`（全件分析）/ `incremental`（追加分析）/ `invalid-only`（未評価・破損のみ）/ `auto`（自動配信） |
| `status` | `SAVED`（結果を保存）/ `REUSED`（変更なしで前回の結果を使用・費用0・`reused_from_id`）/ `SKIPPED`（AI は応答したが3点セット不揃いで保存せず）/ `FAILED` / `PENDING`（自動配信の投入済み・未回収） |
| 結果 | `desire_rating`・`pass_rating`・`overall_rating`・`comment`（全文）・`evaluated_at` |
| 費用 | `cost_usd`（送信全体の費用 ÷ 送信件数）・`usage_log_id`（`AdvisorUsageLog.id`） |
| 部品参照 | `fixed_hash`・`instruction_hash`・`instruction_template_hash`（数字を固定した指示文のハッシュ＝文言が変わった時だけ変わる）・`context_core_hash`・`context_files_hash`・`job_hash` |
| 束ね | `request_key`（手動 = `sessionId:batchIndex`、自動 = 台帳 id）・`ledger_id`（自動配信の `RecommendAnalyzeBatch.id`） |

書き込みは `src/lib/eval-history.ts` に集約。保存に失敗しても評価は止めない（warn ログのみ）。手動・自動配信の両方で保存する（自動配信は投入時に `PENDING`、回収時に結果と費用を埋める。失敗・期限切れは `FAILED`）。

### 1か月あたりの容量の見込み

直近30日の実績（手動 2,952件 + 自動配信 375件 = 3,327件・約1,004送信・106人）から:

| 内訳 | 見込み |
|--|--:|
| 評価行（コメント平均 約950字 + メタ） | 約 12MB |
| 求人本文の部品（1件 約2,100字・求人ごとに1回） | 約 17MB |
| 求職者情報の部品（送信ごとに変わりうる。1件 約10,000〜20,000字） | 約 15〜25MB |
| 指示文・ブックマーク一覧・共通部分 | 1MB 未満 |
| **合計** | **約 45〜55MB／月**（インデックス込み・TOAST 圧縮前） |

確認中の実測: 30行・11部品で 408KB（インデックス込み）。

### 変更なしスキップ

「全件分析」「追加分析」では、次が**すべて前回（最新の `SAVED`）と同じ**求人は AI に送らず前回の結果をそのまま残す（`REUSED` 行を作る）:

- 共通部分（SKILL 等）・指示文（テンプレート）・求職者情報（ブックマーク一覧を除く）・求人本文・モデル・effort
- 加えて、`CandidateFile` に今も同じ総合ランクと3軸マーカー付きコメントが残っていること（消されていれば評価し直す）

つまり書類・面談記録・応募履歴・求人本文のどれかが変われば評価し直し、**ブックマークの増減だけでは評価し直さない**。保存データが無い評価（この仕組みより前）は従来どおり評価する。「未評価/破損のみ」・T-182 の dryRun・自動配信はスキップしない。バッチの全件が前回の結果で足りる場合は AI を呼ばない（費用0）。

**あわせて直した点**: run の先頭バッチ（batchIndex=0）では求職者情報を必ず組み立て直すようにした。従来は同じチャットセッションで30分以内に押し直すと前の run の求職者情報を使い回していたため、書類を更新して押し直しても評価に反映されず、スキップ判定も「変わっていない」と誤判定するため。run 内（2バッチ目以降）は従来どおり再利用する。

**「追加分析」の基準時刻のずれ**（step3）: 追加分析の対象選び（最後の【求人分析】カード以降に作られたブックマーク）は変えていない。途中で止まった run の後の追加分析で評価済みの求人まで対象に入っても、サーバ側のスキップで AI には送られない（下の確認3で、古い基準時刻を渡して確かめた）。

**個別の評価ボタン**: 存在しない（求人評価の経路は `analyze-batch` の全件分析／追加分析／未評価・破損のみ の3つだけ）。追加はしていない。

**完了表示の文言**: 完了トースト `全N件の分析が完了しました（変更がないためM件は前回の結果を使用）`／`追加N件の分析が完了しました（…）`、チャットの完了カード `【求人分析 完了】N件を評価しました（変更がないためM件は前回の結果を使用）`。

### 確認結果（大野テスト）

| # | 確認 | staging | 本番 |
|--|--|--|--|
| 1 | 全件分析を2回続けて実行 | 1回目: 3件を AI 評価（¥16.7・SAVED 3行）。2回目: **3件とも REUSED・AI 呼び出し0・費用0**（応答3秒）。カードに「（変更がないため3件は前回の結果を使用）」 | 1回目: 4件を AI 評価（¥28.8）。2回目: **4件とも REUSED・AI 呼び出し0・費用0** |
| 2 | 面談記録（MEETING の txt・`parsedText`）の先頭に1行足して全件分析 | **4件すべて評価し直し**（`context_core_hash` が変わり SAVED 4行・¥28.1）。確認後に元へ戻し、byte 一致を確認 | （staging のみ） |
| 3 | ブックマークを1件追加して追加分析（基準時刻を 2026-09-01 に戻して4件を対象にした） | **追加した1件だけ AI 評価**（¥18.7）・ほか3件は REUSED。`context_files_hash` だけが変わり `context_core_hash` は不変。カード「4件を評価しました（変更がないため3件は前回の結果を使用）」 | （staging のみ） |
| 4 | 表に評価の行と部品が入り、部品が重複していない | 部品 11・行 30（全確認の累計）・**重複ハッシュ 0**。同じ共通部分・求人本文は複数の行から同じハッシュで参照 | 同じ（本番も同じ DB） |

- 確認2の1回目は、追記を面談テキストの末尾に足したため 8,000字の切り詰めで AI に届かず「変更なし」と判定された。仕組みの誤りではなく（AI に送る中身が本当に同じだった）、先頭に足し直して合格。**送る中身が変わらない編集はスキップされる**ということでもある
- 途中で止まった run の押し直し: 評価済みの求人は上の判定で REUSED になり、未評価の分だけ AI に送られる（確認3と同じ経路）
- 確認3の「追加」は、一時アーカイブしていた1件を復活させ `createdAt` を現在時刻にして作った（大野テストの1行のみ・元に戻していない）

## 第3部 見張り用スクリプト

`scripts/eval-rank-watch-t-xxx.ts`（読み取りのみ・AI を呼ばない）

```
cd C:\bizstudio\bizstudio-portal
npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts --days 30
npx tsx --env-file=.env scripts/eval-rank-watch-t-xxx.ts --from 2026-09-25 --to 2026-10-08   # 切り替え後の期間
```

- [A] `AdvisorUsageLog` + `CandidateFile`: 日別・経路別（手動／自動配信）・モデル別の呼出数・評価件数・費用・1件あたり費用・総合ランク分布・通過率ランク分布・D 自動除外・途切れ・失敗。切り替え前（Opus 4.6）の基準値もこれで出る。ランク分布は `CandidateFile` に今残っている行（上書きされた評価は含まない）
- [B] `JobEvalRecord`（今回以降）: 日別・経路別（全件／追加／未評価・破損／自動配信）・モデル/effort 別の評価件数（SAVED）・スキップ（REUSED）・不揃い・失敗・未回収・費用・ランク分布・D 自動除外

### 基準値（切り替え前・2026-08-26〜2026-09-24 JST・Opus 4.6）

| 経路 | 呼出 | 評価件数 | 費用 | 1件あたり | 総合（残存 n） | 通過率（残存） | D 自動除外 |
|--|--:|--:|--:|--:|--|--|--:|
| 手動 | 917 | 2,952 | ¥27,136.9 | **¥9.2** | n=2,390 A:13% B+:27% B:27% C:27% D:6% | A:34% B:47% C:12% D:6% | 0 |
| 自動配信 | 87 | 375 | ¥1,949.7 | **¥5.2** | n=329 A:3% B+:9% B:12% C:33% D:43% | A:10% B:19% C:18% D:52% | 137 |

1〜2週間後に `--from 2026-09-25 --to <その日>` で同じ表を出し、通過率 C/D の割合（Opus 5.5 は厳しめに付く見込み）・D 自動除外の件数・1件あたり費用（手動の目安 ¥4.5 前後、自動配信はその半額）・[B] のスキップ件数を比べる。

## 戻し方

| 戻したいもの | 方法 |
|--|--|
| モデルを Opus 4.6 に戻す | Railway の環境変数 `EVAL_MODEL=claude-opus-4-6`（本番 `bizstudio-portal` と staging の両サービス）。再デプロイ不要・再起動で反映。従来どおり temperature 0.7・思考なし・max_tokens 16,000 になる |
| effort を変える | `EVAL_EFFORT=medium` など（Opus 5.5 のときだけ効く） |
| 変更なしスキップを止める | 環境変数 `EVAL_SKIP_UNCHANGED=0`（履歴の保存は続く）。コードで止めるなら `findReusableEvaluations` が空を返すようにする |
| 保存を止める | 第2部のコミット（15c1c19）を revert。表は残しても害はない（読む人がいないだけ） |

## 確認の AI 費用

| 実行 | 金額 |
|--|--:|
| 第1部 staging（3件・キャッシュ書込あり） | ¥53.3 |
| 第1部 本番（3件） | ¥25.8 |
| 第2部 staging 確認1（3件）・確認3（1件）・確認2（4件） | ¥16.7 + ¥18.7 + ¥28.1 |
| 第2部 本番 確認1（4件） | ¥28.8 |
| **合計** | **¥171.5**（上限 ¥500） |

スキップされた実行（確認1の2回目×2・確認2の1回目・確認3の再利用分）は AI を呼んでいないため費用0。

## ファイル

| 項目 | 内容 |
|--|--|
| 第1部 | `920bf07` feat(ai): T-XXX switch job evaluation to Opus 5.5 (effort low) |
| 第2部 | `15c1c19` feat(ai): T-XXX save evaluation inputs/results and skip unchanged re-evaluation |
| 停止スイッチ | `9ce6f91` feat(ai): T-XXX add EVAL_SKIP_UNCHANGED switch（`src/lib/eval-history.ts`） |
| 第3部 | 本報告書と `scripts/eval-rank-watch-t-xxx.ts` |
| 新規ファイル | `src/lib/eval-model.ts` / `src/lib/eval-history.ts` / `prisma/migrations/20260925100000_t_xxx_job_eval_history/migration.sql` |
| 変更ファイル | `src/lib/claude.ts` / `src/lib/ai-pricing.ts` / `src/lib/advisor-usage.ts`（保存した行の id と費用を返す）/ `src/lib/recommend/analyze-batch-run.ts` / `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts` / `src/components/candidates/AdvisorFloatingPanel.tsx`（完了トースト）/ `prisma/schema.prisma` |
| コミットしないもの | `scripts/output/t-xxx-eval-history/`（確認用スクリプト・一時アーカイブの ID・面談テキストのバックアップ・基準値の生出力） |
