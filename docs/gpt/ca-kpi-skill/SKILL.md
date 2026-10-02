---
name: bizstudio-ca-kpi-analysis
description: 株式会社ビズスタジオの CA（キャリアアドバイザー）のあらゆる分析と予測売上に使う。CA別の実績（面談・求人紹介・エントリー・選考・内定・承諾・売上・粗利）、初回面談月や応募月ごとのコホート分析（通過率・日数）、今の進行中案件、承諾売上と承諾後辞退、希望職種・年収帯などの切り口、日次スナップショットの推移、予測売上の組み立てまで。「CAの実績」「面談数」「エントリー数」「通過率」「内定」「承諾」「決定人数」「粗利」「予測売上」「見込み」「コホート」「進行中」「切り口」「月別」「CA別」などの質問で、MCP アプリ「ビズスタジオ CA実績」の 13 ツールを正しい順番と解釈ルールで使うための手順。
---

# ビズスタジオ CA実績 分析スキル

ポータル（bizstudio-portal）の実績データを、MCP アプリ「ビズスタジオ CA実績」のツールで取得して分析するときの手順と解釈ルール。
ゴールは **CA のあらゆる分析と予測売上**。数値はツールで取得したものだけを使い、推測で数字を作らない。求職者の個人情報は返ってこない（件数・人数・割合・分布・CA の社員番号と表示名だけ。人数 5 未満のグループは伏せられる）。

## ツール（すべて読み取り専用）

### 基本（step2〜3）

| ツール | 返るもの | いつ使うか |
|--|--|--|
| `get_metric_definitions` | 各数値の定義・基準日付・信頼できる開始日・注意点、応答の上限、担当CA替えの記録開始日、データの最終更新時刻 | 基本の実績（get_ca_kpi / get_company_kpi）を使う前に 1 回。引数なし |
| `list_cas` | CA 一覧（employeeNumber＝社員番号・name・status・inDefaultAggregation） | CA を名前で指定されたとき。引数なし |
| `get_ca_kpi` | 区切り（月/週/日）× CA（全員行 `ALL` ＋各CA）の実績 rows（面談・紹介・エントリー・選考段階・評価分布・取得時点の選考状況） | CA別・期間別の件数・人数の推移 |
| `get_company_kpi` | 年（1/1〜）と月の会社KPI（請求売上・粗利・目標・決定人数など。全社＋CA別） | 売上・粗利・目標・決定人数の月次 |

### 分析（step5・集計値のみ・少人数は伏せる）

| ツール | 返るもの | いつ使うか | 分母 |
|--|--|--|--|
| `get_data_quality` | 項目ごとの入力率、各記録の開始日（historySince）、CA の入社日・退職日の登録状況、既知の注意点 | **深い分析の最初に必ず 1 回** | 期間の初回面談人数・エントリー件数・承諾件数 |
| `get_ca_roster` | CA 一覧と在籍期間（入社日・退職日・在籍月数）、**稼働しない期間（inactivePeriods・日付だけ）と月ごとの稼働日数・稼働人月（availabilityByMonth の fte）**、今の担当人数・活動中・選考中・承諾済み未入社 | どの CA をどの期間で比べてよいか決めるとき・**CA 平均と 1人あたりの分母を取るとき** | 在籍CA＝job_category='CA' |
| `get_cohort_funnel` | **初回面談した月ごと**に同じ求職者群を追った、提案→応募→書類通過→企業面接→内定→承諾→入社の人数と率、各段階までの日数の分布、観測中（observing）と終了（ended） | 初回面談からの歩留まり・CA ごとの進み方・日数 | その月に初回面談した人数 |
| `get_selection_conversion` | **応募した月ごと**に同じ案件群を追った、段階ごとの到達件数・人数・率、日数の分布、取得時点の結果（承諾・承諾後辞退・辞退・見送り・クローズ・選考中・不明） | 応募からの通過率・辞退と見送りの内訳 | その月にエントリーした案件数（1 案件 1 行） |
| `get_pipeline_now` | 今の進行中案件を段階別 × CA別に件数・人数と段階に入ってからの日数、活動中の求職者数、今後の面談予約（初回/継続）、承諾済み未入社（入社予定月別） | 今どれだけ動いているか・予測の母数・停滞 | 有効なエントリー（辞退/見送り/クローズ/入社済を除く） |
| `get_accept_revenue` | 承諾月 × CA別の承諾件数・人数、承諾売上（税抜・円）・求人DB費・仕入・粗利、単価の分布、課金方式、入社日の入力状況、**承諾後辞退を分けた値と net** | 売上・粗利・単価・承諾後辞退 | 承諾日がある案件 |
| `get_forecast_inputs` | 予測の材料: 各段階→承諾の割合（全体分母 / 結果が出た分母）と残り日数、初回面談→承諾の割合と日数、単価・粗利の分布、承諾後辞退の割合、今の進行中案件、今後の面談予約、観測終了日、結果待ち件数。**予測そのものは返さない** | 予測売上・見込みの件数 | 学習期間の案件・コホート |
| `get_segment_breakdown` | 希望職種・経験職種・現年収帯・希望年収帯・転職時期・最終学歴区分・希望勤務地・希望雇用形態・活動期間・他社エージェント利用で分けた、初回面談数・提案・応募・企業面接・内定・承諾と日数 | 切り口ごとの差 | その区分の初回面談人数 |
| `get_snapshot_history` | 毎日 23:50 JST に保存した進行中案件の日次スナップショット（活動中・段階別の選考中・承諾済み未入社・面談予約）の推移 | 先週との比較・予測の答え合わせ | 記録開始日以降の保存値 |

CA の月の行には `availability`（`calendarDays`・`activeDays`＝稼働日数・`inactiveDays`・`fte`＝稼働人月）、期間合計の行には `activeMonths`（稼働人月の合計）が付く。退職した CA の退職後の成果は `postExit`（元担当 CA ごと）に分けて返る。

すべての分析ツールは共通で `definitionVersion`・`generatedAt`（JST）・`observationEnd`・`period`・`cas`・`exclusions`・`suppression`・`dataFreshness`・`historySince`・`counts`（件数・除外・欠損率）・`warnings`・`definitions`（分母と定義）を返す。出力の最初にこれらから「対象期間・対象CA・観測終了日・主な警告」を 1〜2 行で示す。

## 分析の順序

1. **`get_data_quality`** を呼ぶ。使える項目の入力率と、各記録の開始日（`historySince`）を確かめる。開始日より前の履歴は存在しない
2. **`get_ca_roster`** を呼ぶ。在籍期間（入社月〜退職月）・稼働しない期間・月ごとの稼働人月（`availabilityByMonth` の `fte`）と「入社日未登録」の警告を見て、CA 別に比べてよい月と分母を決める。入社日未登録の CA は全期間が返るので、比較のときはその旨を書く
3. 目的に応じて呼ぶ
   - 歩留まり・日数・CA ごとの進み方 → `get_cohort_funnel`（初回面談月起点）／`get_selection_conversion`（応募月起点）
   - 今の状況 → `get_pipeline_now`、推移 → `get_snapshot_history`
   - 売上・粗利・単価・承諾後辞退 → `get_accept_revenue`（月次の会社KPIとの突合は `get_company_kpi`）
   - 切り口 → `get_segment_breakdown`
   - 基本の件数・人数の推移 → `get_metric_definitions` → `get_ca_kpi`
4. 期間は `YYYY-MM`（JST の月・両端を含む）。既定は 2026-05〜今月、1 回に最長 18 か月。応答が大きいときは期間を分ける・`caId` で 1 人に絞る・`byCa=false` にする
5. エラーが返ったら本文に上限と対処が書いてあるので、それに従って条件を変えて呼び直す

## 予測売上の手順（`get_forecast_inputs`）

1. `get_forecast_inputs`（既定の学習期間 2026-05〜今月）を呼ぶ。全体（`ALL`）と CA 別の `scopes` が返る
2. **進行中案件からの見込み**: `pipelineNow` の段階別件数 × `stageToAcceptance` のその段階の承諾率 × 単価（`revenue.unitPrice` の中央値、粗利なら `grossPerDeal`）。段階ごとに計算して足す
   - 承諾率は幅で扱う: **保守的**＝`acceptanceRateAmongAll`（選考中を分母に入れる）、**好調**＝`acceptanceRateAmongResolved`（結果が出た分だけ）、**標準**＝その中間
   - 承諾後辞退を引く: 承諾件数 × (1 − `acceptedThenDeclinedRate`)
   - いつ承諾になるかは `daysToAcceptance` の四分位（p25〜p75）で「早ければ／遅ければ」の月を示す
3. **今後の面談予約からの見込み**: `pipelineNow.upcomingInterviews.first`（初回）× `firstInterviewToAcceptance` の率 × 単価。**継続面談（existing）の人は進行中案件に含まれていることが多いので、二重に数えない**（進行中案件が無い人の分だけに使うか、継続は数えないと明記する）
4. 2 と 3 を足し、**保守的／標準／好調**の 3 本で示す。点の予測を断定しない
5. CA 別に割って分布が伏せられた（`suppressed: true` / `null`）切り口は、**全体（`ALL`）の率と単価を使い、その前提を書く**
6. 必ず添える: 観測終了日（`observationEnd`）、結果待ち件数（`pending`）、学習期間、承諾件数が少ないこと（5 か月で数十件）

## 必ず守る解釈ルール

1. **担当CAは「現在の担当」で数えている**（attribution=current_ca）。担当替えの記録は `historySince.caAssignment` 以降にしか無く、担当が替わると前の担当の時期の実績も新しい担当に付く。CA間の比較ではこの点を必ず注記する
2. **件数（records・社数）と人数（candidates / people・求職者ユニーク）を混同しない**。同じ月に 1 人が 3 社へエントリーすると records=3・people=1。期間のユニーク人数は月の人数の合計と一致しない
3. **同じ月の通過数 ÷ 応募数を通過率にしない**。通過率は `get_selection_conversion`（応募月起点）か `get_cohort_funnel`（初回面談月起点）の到達率で出し、直近 1〜2 か月は「未確定（観測中が多い）」と明記する
4. **選考中（inProgress / observing）を不合格に数えない**。率を出すときは「全体分母」と「結果が出た分母」を分けて示す
5. **少数例で CA の能力を断定しない**。人数 5 未満は伏せられる。伏せられていなくても月 10 件程度の差は偶然の範囲として扱う
6. **相関を因果としない**。切り口（職種・年収帯など）の差は担当CA・時期・媒体と絡む
7. **記録開始日（`historySince`）より前の履歴は無い**。辞退・見送りの日付、支援状況の変化、希望条件の変更、日次スナップショットは開始日以降だけ。それより前を聞かれたら「記録が無い」と答える
8. **承諾後辞退を分ける**。既存の `get_company_kpi` / `get_ca_kpi` の承諾件数・売上には承諾後辞退分が含まれる。`get_accept_revenue` の `acceptedThenDeclined` と `net` で分けて示す
9. **承諾売上は請求・入金ではない**。`job_entries.revenue`（税抜・円）を承諾日の月で合計したもの。確定/見込・取消・返金・減額の列は無い。`grossProfit` は 売上 − 求人DB費 − 仕入
10. **初回面談**は「辞退・日程再調整を除いた、その求職者で最も早い実施済み面談」。`get_ca_kpi` の `interview.first`（interview_count=1）とは少しずれる（取り直した人）
11. **在籍CA**: 入社月〜退職月だけが CA 別の行に出る。入社前の月は 0 実績ではなく「行が無い」。入社日未登録の CA は `warnings` に出るので、平均や比較ではその旨を書く
12. 面談時間（minutesTotal / minutesAvg）は予約枠の長さ（30 分・60 分）であり実際の長さではない。ABCD判定の履歴は 2026-09-25 以降のみ
13. 2026-05 より前は FileMaker から移行したデータが混ざるため参考値（`reference: true`）。5 か月程度のデータで季節性を断定しない
14. 当月は「今日まで」の値で動く。確定値の比較は過去の月で行う
15. CA の個人評価（優劣の断定・人事的な判断）はしない。事実（数値と定義）と、確認が必要な点を分けて書く
16. **CA を比べる・平均するときは稼働日数で割る**。CA 平均・「CA1人あたり」は、件数の合計 ÷ 稼働人月（`fte` の合計。期間合計の行は `activeMonths`）で出す。CA の人数（`caCount`）や月数で割らない。`fte` は「入社日〜退職日の在籍日 − 稼働しない期間の日」を暦日で按分した値（月の半分なら 0.5）
17. **稼働しない期間（休業など）を活動 0 として評価しない**。`fte=0` の月は CA 平均の分母にも比較にも入れない。月の途中で始まる・終わる月は `fte` で按分して比べる。稼働しない期間の理由は記録されていないので、理由を推測して書かない。その期間に記録された活動があれば `warnings` に件数が出る（捨てずに数えている）
18. **退職後の成果は会社全体に含め、元担当に分けて示す**。退職した CA の担当で退職日より後に決まったエントリー・承諾・承諾売上・今の進行中案件は、`ALL`（会社全体・`get_company_kpi` の全社）に入っている。CA の行には入らず `postExit` に元担当 CA ごとに返るので、CA 別の表では「○○さん（退職後の成果）」として別の行に書く。退職後の月は稼働人月 0 なので、活動の平均の分母に入れない（新規の面談などの活動は退職日まで）。予測売上は `ALL` を使えば退職後の分も入る。CA 別に積み上げるときは `postExit` の進行中案件を足す

## よく使う質問と呼び方の例

| 質問 | 呼び方 |
|--|--|
| 2026年8月の全CAの面談数とエントリー数を表にして | `get_ca_kpi(from="2026-08-01", to="2026-08-31", granularity="month")` → 全員行 `ALL` と各CAの `interview.total` / `entry.records` / `entry.candidates` |
| 5月以降に初回面談した人のうち何割が承諾まで進んだ？ | `get_data_quality` → `get_cohort_funnel(cohortFrom="2026-05", cohortTo=今月)` → `byMonth` の `ALL` 行の `rates.acceptance` と `outcome.observing`。直近 2 か月は未確定と明記 |
| 応募した案件の書類通過率を月ごとに | `get_selection_conversion(from, to)` → `reached.documentPass.rate`（応募月起点）。同じ月の通過数÷応募数ではない |
| 今の進行中案件と今後の面談予約 | `get_pipeline_now()` → `rows` の `ALL` と各CA |
| 今月の承諾売上と粗利、承諾後辞退を除いた値 | `get_accept_revenue(from=今月, to=今月)` → `ALL` の `revenue` / `grossProfit` / `net`。会社KPIとの突合は `get_company_kpi(month=今月)` |
| 来月の予測売上 | 上の「予測売上の手順」。`get_forecast_inputs()` → 進行中案件 × 段階→承諾率 × 単価 ＋ 面談予約 × 初回面談→承諾率 × 単価（二重に数えない）→ 保守的／標準／好調 |
| 希望職種ごとの承諾率 | `get_segment_breakdown(segment="desiredJobType")` → `scopes[ALL].segments`（少人数は伏せられる） |
| 先週と比べて選考中は増えた？ | `get_snapshot_history(from, to)` → `rows` の `ALL` の `inSelection`（記録開始日以降のみ） |
| CA ○○さんの直近3か月を週別で | `list_cas` で社員番号 → `get_ca_kpi(from, to, granularity="week", caId="1000001")` |
| CA 1人あたりの月平均エントリー数 | `get_ca_roster()` で各 CA の月の `fte` → `get_selection_conversion(from, to)` の CA 行の `records` 合計 ÷ `fte` の合計（`fte=0` の月を除く）。休業中・入社前・退職後の月を分母に入れない |
| 退職した CA の担当分はどうなった？ | `get_accept_revenue` / `get_pipeline_now` / `get_forecast_inputs` の `postExit`。会社全体（ALL）には含まれている |

確認用の質問: 「2026年8月・全CAの面談数とエントリー数」→ 全員行で面談 185・初回 82・エントリー 48 人／229 件・書類通過 26 人・内定 10 人・承諾 9 人／10 件。

## うまくいかないとき

| 症状 | 対処 |
|--|--|
| 「応答が大きすぎます」 | 期間を分ける、`caId` で 1 人に絞る、`byCa=false`、`granularity` を粗くする、`groups` を減らす |
| 「期間が長すぎます」 | 分析ツールは最長 18 か月（`get_snapshot_history` は 120 日）、`get_ca_kpi` は day 92 日・week/month 400 日 |
| 「caId に該当する社員が見つかりません」 | `get_ca_roster` / `list_cas` で `employeeNumber` を確かめる |
| `suppressed: true` / `null` が多い | 人数 5 未満のグループは伏せられる。期間をまとめる・CA 別をやめて全体で見る |
| ツールが見つからない・接続できない | MCP アプリ「ビズスタジオ CA実績」が有効になっているか確認する。接続URLが変わった可能性もある（管理者に確認） |

---

## このスキルの登録方法（管理者向け・ChatGPT には不要）

1. このフォルダ（`docs/gpt/ca-kpi-skill/`）を zip にする。PowerShell:
   ```powershell
   Compress-Archive -Path "C:\bizstudio\bizstudio-portal\docs\gpt\ca-kpi-skill\*" -DestinationPath "$([Environment]::GetFolderPath('Desktop'))\ca-kpi-skill.zip" -Force
   ```
   zip の中身は `SKILL.md` 1 ファイル。zip はリポジトリにコミットしない（デスクトップに作る）
2. ChatGPT → スキル → 作成 → コンピュータからアップロード → `ca-kpi-skill.zip` を選ぶ（更新時は既存のスキルを削除してから再アップロード）
3. スキルの name は `bizstudio-ca-kpi-analysis`。MCP アプリ「ビズスタジオ CA実績」と組み合わせて使う（手順は `docs/gpt/ca-kpi-gpt-setup.md` §4）
