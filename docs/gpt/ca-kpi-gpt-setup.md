# CA実績 カスタムGPT 登録手順（T-XXX step2）

ChatGPT のカスタムGPT（GPTs）から、ポータルの CA別実績 API（`GET /api/ai/ca-kpi`）と会社KPI API（`GET /api/ai/company-kpi`）を
読み取れるようにする手順。登録するのは大野さん。所要 10 分程度。

- 使うファイル: `docs/gpt/ca-kpi-openapi.yaml`（Actions のスキーマ）と、この文書の §3（指示文）
- 必要なもの: 本番の `AI_READ_API_KEY` の値（Railway の `bizstudio-portal` サービス → Variables）。**値はこの文書やリポジトリに書かない**

---

## 1. GPT を作る

1. ChatGPT 左メニュー「GPT を探す」→ 右上「作成する」（または https://chatgpt.com/gpts/editor ）
2. 上部タブ「構成」を開く
3. 名前: 例「ビズスタジオ CA実績アナリスト」
4. 説明: 例「ポータルの実績データ（面談・紹介・エントリー・選考）をCA別・期間別に取得して分析します」
5. 「指示」欄に §3 の文面を貼る
6. 「会話の開始者」: 例「2026年8月の全CAの実績を月別で出して」「CA 1000001 の直近3か月を週別で見たい」
7. 機能: 「ウェブ参照」「画像生成」は不要なので OFF。「コードインタープリター／データ分析」は ON（表・グラフ作成に使う）

## 2. アクション（API）を登録する

1. 「構成」タブの一番下「アクション」→「新しいアクションを作成する」
2. **認証**（「認証」の歯車）:
   - 認証タイプ: **APIキー**
   - 認証方式: **Bearer**（「Basic」「カスタム」ではない）
   - APIキー: **`AI_READ_API_KEY` の値を貼る**（Railway の Variables からコピー。チャットやメモに残さない）
   - 保存
3. **スキーマ**: `docs/gpt/ca-kpi-openapi.yaml` の中身を丸ごと貼る
   - 貼ると下に `getCaKpi` と `getCompanyKpi` の 2 つが「利用可能なアクション」として出る
   - 「テスト」を押すと ChatGPT が実際に呼ぶ。`from=2026-08-01&to=2026-08-31` で 200 が返れば OK
4. **プライバシーポリシー**: 公開範囲を「自分だけ」または「リンクを知っている人」にする場合は空欄で可。
   「GPT ストアに公開」する場合は必須だが、社内データを扱う GPT なので公開しない
5. 右上「作成する」→ 公開範囲は **「自分だけ」**（社内で共有するなら「リンクを知っている人」。ストアには出さない）

### 動作確認（登録後）

- 「2026年8月の全CAの面談数とエントリー数を表にして」→ `getCaKpi(from=2026-08-01, to=2026-08-31)` が呼ばれ、
  全員行の面談 185・初回 82・エントリー 48 人/229 件・書類通過 26 人・内定 10 人・承諾 9 人/10 件 が出る（step1 報告書 §7-3 の値）
- 「2026年の会社の決定人数は？」→ `getCompanyKpi(year=2026)` が呼ばれる

### うまくいかないとき

| 症状 | 原因と対処 |
|--|--|
| 401 | APIキーの値が違う／認証方式が Bearer になっていない |
| 503 `not_configured` | 本番側に `AI_READ_API_KEY` が無い（Railway の Variables を確認） |
| 400 「期間が長すぎます」「応答が大きすぎます」 | 期間を短くする、`caId` で 1 人に絞る、`granularity` を粗くする（本文の error に具体的な上限が書いてある） |
| 404 | `caId` の社員番号が違う（レスポンスの `cas` に正しい社員番号がある） |
| ChatGPT が「応答が長すぎる」と言う | 全CA × 12 か月のように行数が多い。6 か月ずつに分けるか `groups=interview,entry,selection` で絞る |

キーを替えたときは、Railway の Variables を更新したうえで、GPT 側の「認証」も貼り直す。

---

## 3. 「指示」欄に貼る文面

```
あなたは株式会社ビズスタジオの CA（キャリアアドバイザー）実績を分析するアシスタントです。
数値はすべて、登録されたアクション（getCaKpi / getCompanyKpi）で取得したものだけを使い、推測で数字を作らないでください。

## データの取り方
- CA別・期間別の実績は getCaKpi を使う（from/to は JST の YYYY-MM-DD、granularity は month が既定。週別は week、日別は day）。
- 会社全体の売上・粗利・目標・決定人数は getCompanyKpi を使う（year=YYYY、month=YYYY-MM）。
- 全CAの月別は既定の項目で最大 8 か月まで一度に取れる。1 年分は 2 回に分けて取る。日別・週別で全CAを見るときは期間を短くするか、caId で 1 人に絞るか、groups で項目を減らす（例 groups=interview,entry,selection）。
- 400 が返ったら本文の error を読み、期間や粒度を変えて取り直す。
- 当月は「今日まで」の値で、未来の面談予約や未入力の分だけ動く。確定値の比較は過去の月で行う。

## 必ず守る解釈ルール（レスポンスの definitions / caveats も毎回読むこと）
1. CA別の数値は求職者の「現在の担当CA」で集計されている。担当替えの記録は caAssignmentHistorySince 以降にしか無く、担当が替わると前の担当の時期の実績も新しい担当に付く。CA間の比較ではこの点を必ず注記する。
2. 件数（records・社数）と人数（candidates・求職者ユニーク）を混同しない。company-kpi の entryCount は人数。
3. 面談時間（minutesTotal / minutesAvg）は予約枠の長さ（30 分・60 分）であり、実際の面談の長さではない。
4. ABCD判定の履歴（aiRatingHistory）は 2026-09-25 以降のみ。ブックマークの今の評価（bookmarkRatingCurrent）は AI の判定か CA の修正かを区別できない。
5. 二次面接は日付の入力が少ない。書類提出日は 2026-06 以降。求人ツールへの出力は 2026-09 以降 0 件（出力廃止）なので、紹介は introduced（マイページへの紹介）で見る。
6. 選考ステータスの変更履歴は無い。辞退・見送りには日付が無い（entryOutcomeNow と currentStatus は「取得時点」の状態）。選考中の案件を不合格として数えない。通過率を出すときは「その段階の日付がある件数」で数え、直近 1〜2 か月のコホートは「未確定」と明記する。
7. 2026-05 より前は FileMaker から移行したデータが混ざるため参考値として扱う。
8. 5 か月程度のデータで季節性を断定しない。月ごとの差は CA の人数や業務・機能の変化（2026-06 書類提出日の入力開始、2026-09 出力廃止など）でも生じる。
9. 売上・請求・入金の分析は getCompanyKpi の範囲（CA売上のみ・会社全体ではない）に限る。grossProfit は粗利、invoiceRevenue は請求売上（税抜）で別物。revenueTarget は粗利ベースの目標。

## 出力の仕方
- まず取得した期間・粒度・対象CA・attribution（current_ca）を 1 行で示す。
- 表はコードインタープリターで整形してよい。グラフは求められたときだけ。
- 数値の後ろに、該当する注意点（上のルール）を短く添える。注意点を省略して断定しない。
- CA の個人評価（優劣の断定・人事的な判断）はしない。事実（数値と定義）と、確認が必要な点を分けて書く。
```

---

## 4. MCP アプリ＋スキル方式（推奨・T-XXX step3）

カスタムGPT の Actions（§1〜§3）の代わりに、ChatGPT の「MCP アプリ」でポータルの MCP 入口（`/api/mcp/<秘密>`）に接続し、
分析の手順は「スキル」として登録する方式。普段のチャット（GPT を切り替えずに）で使えるのが利点。§1〜§3 の方式も引き続き使える。

- MCP 入口のコード: `src/app/api/mcp/[secret]/route.ts`（入口）、`src/lib/mcp/caKpiServer.ts`（ツール 4 本）
- ツール: `get_metric_definitions`（定義・注意点）、`list_cas`（CA 一覧）、`get_ca_kpi`（CA別実績＝`/api/ai/ca-kpi` と同じ）、`get_company_kpi`（会社KPI＝`/api/ai/company-kpi` と同じ）。すべて読み取り専用
- 認証: ChatGPT の MCP アプリは「OAuth」か「認証なし」しか選べないため、**認証なし＋推測できない長い秘密のURL**で接続する。
  秘密は Railway の `bizstudio-portal` サービスの環境変数 `MCP_PATH_SECRET`。**URL・秘密の値はこの文書・リポジトリ・チャットに書かない**
- 接続URL: `https://bizstudio-portal-production.up.railway.app/api/mcp/<MCP_PATH_SECRET の値>`（設定時にデスクトップの `portal-mcp-url.txt` に 1 行で書き出してある。ChatGPT に貼ったら削除する）

### 4-1. MCP アプリを作る

1. ChatGPT 左下の自分の名前 → 設定 → **プラグイン**（または「アプリ」）→ **追加** → **MCP アプリを作成**
2. 名前: **ビズスタジオ CA実績**
3. 接続タイプ: **サーバーURL** → デスクトップの `portal-mcp-url.txt` の 1 行（`https://…/api/mcp/…`）を貼る
4. 認証: **認証なし**
5. 「このアプリを信頼する」等の注意事項にチェック → **作成**
6. 作成後、ツール一覧に `get_metric_definitions` / `list_cas` / `get_ca_kpi` / `get_company_kpi` の 4 つが出れば接続できている
7. `portal-mcp-url.txt` を削除する

### 4-2. スキルを登録する

1. `docs/gpt/ca-kpi-skill/` を zip にする（PowerShell）:
   ```powershell
   Compress-Archive -Path "C:\bizstudio\bizstudio-portal\docs\gpt\ca-kpi-skill\*" -DestinationPath "$env:USERPROFILE\Desktop\ca-kpi-skill.zip" -Force
   ```
   zip はリポジトリにコミットしない
2. ChatGPT → **スキル** → **作成** → **コンピュータからアップロード** → `ca-kpi-skill.zip` を選ぶ → 保存
3. スキル名 `bizstudio-ca-kpi-analysis` が一覧に出る

### 4-3. 動作確認

新しいチャットで、MCP アプリ「ビズスタジオ CA実績」を有効にして:

- 「2026年8月・全CAの面談数とエントリー数を表にして」
  → `get_metric_definitions` → `get_ca_kpi(from=2026-08-01, to=2026-08-31)` が呼ばれ、全員行で **面談 185・初回 82・エントリー 48 人／229 件・書類通過 26 人・内定 10 人・承諾 9 人／10 件** が出る（step1 報告書 §7-3・step2 本番確認と同じ値）
- 「CA の一覧を出して」→ `list_cas` が呼ばれ、社員番号と表示名（在籍 8 名が inDefaultAggregation=true）が出る
- 「2026年の会社の決定人数と粗利は？」→ `get_company_kpi(year=2026)` が呼ばれる

### 4-4. うまくいかないとき

| 症状 | 原因と対処 |
|--|--|
| 接続できない・404 | URL が違う（末尾の秘密が欠けている／変わった）。Railway の `MCP_PATH_SECRET` と一致する URL を貼り直す。本番側に `MCP_PATH_SECRET` が無いときも 404 |
| 429 | 1 分 60 回の回数制限。1 分待って再試行 |
| ツールが「応答が大きすぎます」「期間が長すぎます」と返す | 期間を分ける、`caId` で 1 人に絞る、`granularity` を粗くする、`groups` を減らす（文に上限が書いてある） |
| ツール一覧が出ない | 接続URLの先頭が `https://bizstudio-portal-production.up.railway.app/api/mcp/` になっているか確認。staging ではない |

### 4-5. URL が漏れた疑いがあるときの止め方

秘密のURLを知っている人は誰でも（認証なしで）この入口を呼べる。漏れた疑いがあれば **秘密を作り直す**だけで旧URLは即座に 404 になる:

1. PowerShell で新しい秘密を作って Railway に設定する（値は画面に出さない）:
   ```powershell
   $s = -join ((1..48) | ForEach-Object { [char[]]"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" | Get-Random })
   railway variables --set "MCP_PATH_SECRET=$s" --service bizstudio-portal | Out-Null
   "https://bizstudio-portal-production.up.railway.app/api/mcp/$s" | Set-Content -Encoding ascii "$env:USERPROFILE\Desktop\portal-mcp-url.txt"
   Remove-Variable s
   ```
   （設定で本番の再デプロイが走る。完了まで 3〜5 分）
2. ChatGPT のプラグイン → 「ビズスタジオ CA実績」→ 接続URLを `portal-mcp-url.txt` の内容に差し替える → ファイルを削除
3. 入口を一時的に完全に止めたいときは、Railway で `MCP_PATH_SECRET` を削除する（未設定＝常に 404）

秘密は 48 文字以上の英数字にする（32 文字未満の値は入口側で無効扱い＝404 になる）。
