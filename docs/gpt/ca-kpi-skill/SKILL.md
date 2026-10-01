---
name: bizstudio-ca-kpi-analysis
description: 株式会社ビズスタジオの CA（キャリアアドバイザー）別の実績（面談・求人紹介・エントリー・選考・内定・承諾・売上）を分析するときに使う。「CAの実績」「面談数」「エントリー数」「通過率」「内定」「承諾」「決定人数」「粗利」「月別」「週別」「CA別」「○月の実績」などの質問で、MCP アプリ「ビズスタジオ CA実績」のツール（get_metric_definitions / list_cas / get_ca_kpi / get_company_kpi）を正しい順番と解釈ルールで使うための手順。
---

# ビズスタジオ CA実績 分析スキル

ポータル（bizstudio-portal）の実績データを、MCP アプリ「ビズスタジオ CA実績」のツールで取得して分析するときの手順と解釈ルール。
数値はツールで取得したものだけを使い、推測で数字を作らない。求職者の個人情報は返ってこない（件数・人数・CA の社員番号と表示名だけ）。

## ツール（すべて読み取り専用）

| ツール | 返るもの | いつ使うか |
|--|--|--|
| `get_metric_definitions` | 各数値の定義・基準日付・信頼できる開始日・注意点、応答の上限、担当CA替えの記録開始日、データの最終更新時刻 | **分析の最初に必ず 1 回**。引数なし |
| `list_cas` | CA 一覧（employeeNumber＝社員番号・name・status・inDefaultAggregation） | CA を名前で指定されたとき、CA別に比べるとき。引数なし |
| `get_ca_kpi` | 区切り（月/週/日）× CA（全員行 `ALL` ＋各CA）の実績 rows と definitions / caveats | CA別・期間別の面談・紹介・エントリー・選考・評価分布・取得時点の選考状況 |
| `get_company_kpi` | 年（1/1〜）と月の会社KPI（請求売上・粗利・目標・決定人数など。全社＋CA別） | 売上・粗利・目標・決定人数の話題。売上はこのツールにしか無い |

## 手順

1. `get_metric_definitions` を呼び、`caKpi.definitions`・`caKpi.caveats`・`companyKpi.definitions` を読む。以後の解釈はこれに従う
2. CA を指定されたら `list_cas` で社員番号（`employeeNumber`）を確かめる。名前が曖昧なら候補を出して確認する
3. `get_ca_kpi` を呼ぶ
   - `from` / `to` は JST の `YYYY-MM-DD`（両端を含む）。`granularity` は `month`（既定）/ `week`（月曜〜日曜）/ `day`
   - 期間の上限: day は 92 日、week/month は 400 日
   - 応答の上限: 全CA × 月別は既定の項目で **8 か月まで**。1 年分は 2 回に分ける。日別・週別で全CAを見るときは期間を短くするか、`caId` で 1 人に絞るか、`groups` で項目を減らす（例 `["interview","entry","selection"]`）
   - エラーが返ったら本文に上限と対処が書いてあるので、それに従って条件を変えて呼び直す
4. 売上・粗利・目標・決定人数は `get_company_kpi`（`year=YYYY`、`month=YYYY-MM`）
5. 出力の最初に、取得した期間・粒度・対象CA・attribution（current_ca）を 1 行で示す。数値の後ろに該当する注意点を短く添える

## 必ず守る解釈ルール

1. **担当CAは「現在の担当」で数えている**（attribution=current_ca）。担当替えの記録は `caAssignmentHistorySince` 以降にしか無く、担当が替わると前の担当の時期の実績も新しい担当に付く。CA間の比較ではこの点を必ず注記する
2. **件数（records・社数）と人数（candidates・求職者ユニーク）を混同しない**。同じ月に 1 人が 3 社へエントリーすると records=3・candidates=1。`get_company_kpi` の `entryCount` は人数
3. **面談時間（minutesTotal / minutesAvg）は予約枠の長さ（30 分・60 分）**であり、実際の面談の長さではない
4. **ABCD判定の履歴（aiRatingHistory）は 2026-09-25 以降のみ**。ブックマークの今の評価（bookmarkRatingCurrent）は AI の判定か CA の修正かを区別できない
5. 二次面接は日付の入力が少ない。書類提出日は 2026-06 以降。求人ツールへの出力は 2026-09 以降 0 件（出力廃止）なので、紹介は `introduced`（マイページへの紹介）で見る
6. **選考ステータスの変更履歴は無い。辞退・見送りには日付が無い**（`entryOutcomeNow` と `currentStatus` は「取得時点」の状態）。**選考中の案件を不合格として数えない**。通過率を出すときは「その段階の日付がある件数」で数え、直近 1〜2 か月のコホートは「未確定」と明記する
7. 2026-05 より前は FileMaker から移行したデータが混ざるため参考値として扱う
8. **5 か月程度のデータで季節性を断定しない**。月ごとの差は CA の人数や業務・機能の変化（2026-06 書類提出日の入力開始、2026-09 出力廃止など）でも生じる
9. 売上・請求・入金の分析は `get_company_kpi` の範囲（CA売上のみ・会社全体ではない）に限る。`grossProfit` は粗利、`invoiceRevenue` は請求売上（税抜）で別物。`revenueTarget` は粗利ベースの目標
10. 当月は「今日まで」の値で、未来の面談予約や未入力の分だけ動く。確定値の比較は過去の月で行う
11. CA の個人評価（優劣の断定・人事的な判断）はしない。事実（数値と定義）と、確認が必要な点を分けて書く

## よく使う質問と呼び方の例

| 質問 | 呼び方 |
|--|--|
| 2026年8月の全CAの面談数とエントリー数を表にして | `get_ca_kpi(from="2026-08-01", to="2026-08-31", granularity="month")` → 全員行 `ALL` と各CAの `interview.total` / `entry.records` / `entry.candidates` |
| CA ○○さんの直近3か月を週別で | `list_cas` で社員番号 → `get_ca_kpi(from, to, granularity="week", caId="1000001")` |
| 2026年5月〜9月の月別推移（全CA） | `get_ca_kpi(from="2026-05-01", to="2026-09-30", granularity="month")`（5 区切り × 9 行で上限内） |
| 2026年の 1 年分を全CA月別で | 8 か月を超えるので 2 回に分ける（例 1〜6 月、7〜12 月） |
| 今月の書類通過率 | `selection.documentPass` と `entry` を同じ区切りで出し、「その月に起きた通過件数 ÷ その月のエントリー件数」であること、コホート（エントリー月起点）とは違うことを明記 |
| 2026年の会社の決定人数・粗利・目標 | `get_company_kpi(year="2026")` → `year.decidedCandidateCount` / `year.grossProfit` / `year.revenueTarget` |
| 初回面談のランク分布 | `get_ca_kpi(..., groups=["interview","rating"])` → `interviewRank`（合計は `interview.first` と一致） |

確認用の質問: 「2026年8月・全CAの面談数とエントリー数」→ 全員行で面談 185・初回 82・エントリー 48 人／229 件・書類通過 26 人・内定 10 人・承諾 9 人／10 件。

## うまくいかないとき

| 症状 | 対処 |
|--|--|
| 「応答が大きすぎます」 | 期間を分ける、`caId` で 1 人に絞る、`granularity` を粗くする、`groups` を減らす |
| 「期間が長すぎます」 | day は 92 日、week/month は 400 日以内にする |
| 「caId に該当する社員が見つかりません」 | `list_cas` で `employeeNumber` を確かめる |
| ツールが見つからない・接続できない | MCP アプリ「ビズスタジオ CA実績」が有効になっているか確認する。接続URLが変わった可能性もある（管理者に確認） |

---

## このスキルの登録方法（管理者向け・ChatGPT には不要）

1. このフォルダ（`docs/gpt/ca-kpi-skill/`）を zip にする。PowerShell:
   ```powershell
   Compress-Archive -Path "C:\bizstudio\bizstudio-portal\docs\gpt\ca-kpi-skill\*" -DestinationPath "$env:USERPROFILE\Desktop\ca-kpi-skill.zip" -Force
   ```
   zip の中身は `SKILL.md` 1 ファイル。zip はリポジトリにコミットしない（デスクトップに作る）
2. ChatGPT → スキル → 作成 → コンピュータからアップロード → `ca-kpi-skill.zip` を選ぶ
3. スキルの name は `bizstudio-ca-kpi-analysis`。MCP アプリ「ビズスタジオ CA実績」と組み合わせて使う（手順は `docs/gpt/ca-kpi-gpt-setup.md` §4）
