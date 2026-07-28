# T-146 Phase 1（調査のみ）｜ブックマーク評価の5段階化 ＋ 引き当て選定率の集計表示

対象リポジトリ: **bizstudio-portal 単独**（ローカル: `C:\bizstudio\bizstudio-portal`）

## このフェーズの位置づけ

**調査のみ。コード変更・コミット・push は一切しない。**
成果物は「調査レポート .md 1本」と「読み取り専用の集計スクリプト1本」だけ。
実装は Phase 2 以降で、本レポートの結論を承認してから着手する。

---

## 背景

求職者詳細 → 紹介履歴タブ → ブックマークサブタブの一覧に、AI評価（希望・通過・総合）が A/B/C/D で表示されている。課題は2つ。

1. 最近「B〜C」のように幅を持った評価が増えており、結局どちらなのか判断できない
2. 引き当てた求人のうちどれだけが良評価だったか（選定率）が一目で分からない

## 決定事項（確定済み・再議論不要）

| 項目 | 決定 |
|--|--|
| 評価段階 | **A / B+ / B / C / D の5段階**。良い順は A > B+ > B > C > D |
| C+ | **採用しない**。C と C+ で CA の行動が変わらず、判定のブレだけが増えるため |
| 並べ替え | 文字の並び順に依存させず、順序を**明示的に定義**する（文字順だと B と B+ が逆転する） |
| 幅のある評価 | 「B〜C」のような範囲回答を**明確に禁止**し、必ず1つだけ選ばせる。段階数の変更とは独立に必要な対応 |
| 過去データ | **再判定しない**（AI費用がかかるため）。B+ は変更日以降の新規判定分にのみ付く。過去分と新規分が地続きにならないのは許容 |
| 集計の置き場所 | ブックマークタブの「並び替え」行の右側の空きスペース（横長エリア） |
| 集計の中身 | 引き当て総数（＝ブックマーク件数）／総合評価の内訳（各段階の件数と割合）を主表示として大きめに／希望・通過の内訳を補助的に小さく |
| 集計の目的 | 「引き当てた後の選定率が一目でわかること」 |

## 未確定事項（Phase 1 の結論で決める）

- 集計は**現在表示中の絞り込み結果**に対して出すか、**絞り込み前の全件**に対して出すか

---

## 事前調査で判明している事実（再調査不要・ここを起点にすること）

この節はすでに確認済みの内容。**ゼロから探し直さず、裏取りと深掘りに時間を使うこと。**
記載の行番号は調査時点のもので、ドリフトしている可能性があるため必ず現物で確認すること。

### A. 評価は DB の enum ではなく「コメント本文の正規表現パース」

```
AI分析実行 (analyze-batch)
  └→ CandidateFile.aiAnalysisComment  … テキスト全文（3軸マーカー "■ 本人希望：A" を含む）★実体
  └→ CandidateFile.aiMatchRating      … String?（総合のみのミラー。フォールバック表示用）

一覧バッジ表示
  ├─ 希望: parse3AxisRatings(aiAnalysisComment).wish
  ├─ 通過: parse3AxisRatings(aiAnalysisComment).pass
  └─ 総合: parse3AxisRatings(aiAnalysisComment).overall || aiMatchRating
```

- `prisma/schema.prisma` に評価用の enum は**存在しない**（`aiMatchRating` は `String?` / L1463 付近）。
  → **5段階化はスキーマ変更ではなく、正規表現とソート順定義の変更が本丸。**
- `caMatchLabel`（CA手動の◎○△）は**別系統**。今回の対象外だが、混同しないこと。

### B. `[ABCD]` 正規表現の既知の出現箇所（最低8ファイル）

| ファイル | 該当 | 役割 |
|--|--|--|
| `src/components/candidates/HistoryTab.tsx` | L417-419 `parse3AxisRatings` | 一覧バッジの3軸パース |
| 〃 | L886 / L890 / L895 `updateRatingMarker` 周辺 | モーダルのセレクト変更→本文マーカー書換 |
| 〃 | L405 `RATING_STYLES` / L411 `RATING_LABELS` | バッジ配色・ラベル |
| 〃 | L426 `RANK_ORDER = { A:0, B:1, C:2, D:3 }` | **並べ替えの順序定義（明示的で既に文字順非依存）** |
| `src/lib/comment-split.ts` | L17 `RATING_LINE_RE` | マイページ送信時に評価行を除去 |
| `src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts` | L14-16, L36, L66, L168, L182 | 判定済み検出・パース・総合抽出 |
| 〃 | **L406, L443-445** | **AIへの出力フォーマット指示（`■ 本人希望: A〜D` 等）＝プロンプト本体** |
| `src/app/api/candidates/[candidateId]/files/[fileId]/route.ts` | L160-161 | PATCH時に本文から `aiMatchRating` を再抽出・同期 |
| `src/components/candidates/AdvisorFloatingPanel.tsx` | L68-70 | 分析済み判定 |
| `src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts` | L100 `/ABCD/i` | AIアドバイザーのチャット側キーワード判定 |

### C. 幅のある評価は「画面上は見えていない」

`/■\s*総合[：:]\s*([ABCD])/` は**先頭1文字しかキャプチャしない**ため、
本文が `■ 総合：B〜C` でも**バッジは「B」と表示される**。

→ **幅評価の実件数は、パース結果ではなく `aiAnalysisComment` の生テキストを見ないと検出できない。**
　調査項目3ではこの点を必ず踏まえること。

### D. 評価基準の文言は2ファイル体制

- `src/skills/job-matching-advisor/SKILL.md` … **portal の判定AI用**（判断フレームワーク＋A〜D定義のみ）
- `src/skills/job-matching-advisor/SKILL_full.md` … フル版。Claude.ai 側スキルと同期する版
- 両版の**判断フレームワークと A〜D 定義は常に同一に保つ**運用（SKILL.md L18, SKILL_full.md L761 に明記）
- `SKILL_full.md` L765 に既に次の記載がある:
  > **通過率ランクのB集中**: 現行基準ではランク付き求人の51%が通過率Bに集中しており、ランクの弁別力がやや低下している。**Bの細分化(B+/B-)を次回検証時に検討**

  → **本チケットはこの宿題そのもの。**ただし今回は **B+ のみ採用（B- は不採用）**である点が上記メモと異なる。整合を取ること。

### E. 「選定率」は日報側に既存の同名指標がある（★定義衝突リスク★）

- `src/lib/dailyReport/jobSearch.ts` … 冒頭コメントに定義あり
- `src/components/dailyReport/DailyReportView.tsx` L933-942 … 「求人ABCD（選定率X%）」の円グラフ
- 現行定義（T-092 で変更済み）: **選定率 ＝ 出力数 ÷ (BM数 + 紹介保留数)**
  旧定義は `(A+B+C) ÷ 合計BM`（aiMatchRating ベース）だった

→ **今回ブックマークタブに出す「選定率」がこれと別定義なら、同じ言葉で違う数字が2箇所に出ることになる。**
　用語をどう扱うか（同一定義に揃える／別名にする）を必ず論点として挙げること。

### F. 集計対象範囲の判断材料

`BookmarkSection` 内に以下が両方存在する。

- `files` … 全件
- `filteredFiles` … 検索キーワード・日付フィルタ適用後（L1065 付近のコメント参照）

絞り込み UI は「🔍 ファイル名で検索」＋日付フィルタ（L1400-1427 付近）。
集計の設置予定地である「並び替え」行は L1429-1435 付近（`SortBasisButtons` / `SortChipBar`）。

### G. ⚠️ 前提の訂正 — UIコンポーネントマップは「未作成」ではなく「作成済み」

チケット原文には「`14-ui-component-map.md` では HistoryTab.tsx の構造マップが未作成」とあるが、**これは誤り**。
`.claude/14-ui-component-map.md` の **L301 以降に HistoryTab.tsx の詳細な構造マップが既に存在する**（全体レイアウト／評価データフロー／主要state／主要handler／2段クロスソート／関連API／ArchivedBookmarkSection まで記載済み）。

ただし**行番号がドリフトしている**（例: `parse3AxisRatings` はマップ上 L365 だが実際は L415 付近）。

→ 調査項目5は「新規作成」ではなく、**既存マップの検証・行番号更新・今回関係箇所（集計表示の設置場所、評価パース周り）の追記**とする。

---

## 調査項目

### 1. 評価3列（希望・通過・総合）の全経路

生成 → 保存 → 表示 → 並べ替え の各段を、**ファイル名＋行番号＋該当コードの引用**付きで確定させる。
上記 A・B を裏取りしたうえで、**記載漏れの出現箇所がないか全文検索で網羅**すること。

検索すべきパターン（最低限）:
```
[ABCD]        ABCD        A〜D        A～D        A-D
本人希望       通過率       ■ 総合      aiMatchRating       RANK_ORDER
```

出力: **「B+ 対応で修正が必要な箇所」の完全な一覧表**（ファイル / 行 / 現在のコード / 想定される修正方針 / 修正漏れ時の症状）。

### 2. 評価基準の文言が「どのファイルに何箇所」書かれているか

AI分析側と portal 内の判断ナレッジ側の**両方**を洗い出す。**AIアドバイザーのチャット機能・全件分析機能も必ず含める。**

最低限カバーする対象:
- `src/skills/job-matching-advisor/SKILL.md` / `SKILL_full.md`
- `src/skills/job-matching-advisor/references/` 配下
- `src/skills/daily-report-advisor/SKILL.md`（L64 に選定率とABCDへの言及あり）
- `bookmarks/analyze-batch/route.ts` 内のプロンプト文字列（L406 / L443-445 周辺）
- AIアドバイザー: `advisor/sessions/[sessionId]/messages/route.ts`、`AdvisorFloatingPanel.tsx`
- 全件分析機能（存在する場合。どのエンドポイントか特定すること）

出力: **「A〜D の定義文言が書かれている箇所」と「フォーマット指示が書かれている箇所」を分けた一覧**。
B+ 追加時に**どれを直せば判定が変わり、どれが表示だけか**を明示すること。

### 3. 現在の評価データの分布

**読み取り専用スクリプト**を新規作成して集計する（`scripts/` 配下、命名例: `scripts/survey-t146-rating-distribution.ts`）。
参考にできる既存スクリプト: `scripts/inspect-candidate-bookmarks.ts` / `scripts/analyze-rating-damage.ts`

集計する内容:

| # | 内容 |
|--|--|
| 3-1 | 3軸それぞれの A/B/C/D 件数と割合（`aiAnalysisComment` のパース結果ベース） |
| 3-2 | **幅を持った値が何件混ざっているか**（★C の注意点を踏まえ、生テキストに対して `■ (本人希望\|通過率\|総合)[：:]\s*[ABCD]\s*[〜~ー\-–—/／、,]\s*[ABCD]` 等でマッチさせる。パース結果では検出できない） |
| 3-3 | 幅評価の**実際の出現パターン一覧**（「B〜C」以外にどんな書き方があるか。全角/半角、記号のゆれを実データで確認） |
| 3-4 | 幅評価の**時期別推移**（「最近増えている」という体感の裏取り。JST 暦日で集計） |
| 3-5 | `aiMatchRating`（総合ミラー）と `aiAnalysisComment` のパース結果が**食い違っている件数**（同期漏れの実態） |
| 3-6 | 評価なし（`aiAnalysisComment` が null / マーカー無し）の件数 |

**注意:**
- 本番DBへの接続は `railway ssh` 経由（手順は `.claude/` 配下のナレッジ参照）。**読み取り専用に徹し、UPDATE/DELETE は絶対に実行しない。**
- 日付集計は JST。`toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})` を使い、`toISOString().slice(0,10)` は**禁止**。

### 4. 集計を出す対象範囲（絞り込み後 or 全件）の判断材料

上記 F を踏まえ、両案のメリット・デメリットを整理して**推奨案を1つ提示**する。

検討に含めること:
- CA が実際にこの画面で絞り込みを使う頻度・目的（コードから読み取れる範囲で）
- 「引き当てた後の選定率」という目的に対し、絞り込み後の母数が意味を持つか
- 絞り込み中であることが**数字を見た人に伝わるか**（誤読リスク）
- 実装コスト差（`filteredFiles` / `files` のどちらを参照するかだけの差か、再計算コストはあるか）
- **E の日報側「選定率」との定義衝突をどう扱うか**

### 5. 紹介履歴タブの構造マップ（既存マップの検証・更新）

上記 G の通り、`.claude/14-ui-component-map.md` L301 以降のマップは**既存**。以下を行う。

- 記載内容の**現物との突き合わせ**（特に行番号のドリフト）
- ズレていた箇所の**修正差分を提示**（このフェーズではファイルを書き換えず、差分案をレポートに載せるだけ）
- 今回の改修で必要になる情報の**追記案**:
  - 集計表示を差し込む DOM 位置（「並び替え」行の右側スペース）の具体的な構造
  - 評価パース〜ソート〜バッジ描画の依存関係図
  - `filteredFiles` / `files` の使い分け実態

---

## 成果物

1. **調査レポート**: `docs/survey_T-146_rating_5levels_phase1.md`
   - 調査項目1〜5の回答を、上記の出力指定どおりに記載
   - 「B+ 対応で修正が必要な箇所」の完全一覧表（項目1）
   - データ分布の実数（項目3）
   - 集計対象範囲の**推奨案と根拠**（項目4）
   - 14-ui-component-map.md への**修正・追記差分案**（項目5）
   - 最後に **「Phase 2 実装で踏みそうな地雷」** を列挙すること

2. **集計スクリプト**: `scripts/survey-t146-rating-distribution.ts`（読み取り専用）

3. レポート末尾に **Phase 2（実装）の作業分割案**（どの単位でコミットし、どこを staging で検証すべきか）

---

## 注意事項

- **変更禁止ファイル**: `src/constants/candidate-flags.ts` / `specs/` 配下 / `scripts/gas/` 配下 / `src/services/loadSpec.ts` / `src/services/geminiClient.ts`
- **Phase 1 では実装しない**。既存ファイルの書き換えは行わない（新規作成する調査レポートと集計スクリプトのみ可）
- 本番DBは**読み取り専用**。書き込み系クエリは一切実行しない
- 日付は JST。`toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'})` を使用、`toISOString().slice(0,10)` は禁止
- 反映方法（Phase 2 以降）: **AI判定の中身が変わるため staging で検証してから master へ**
- master へ push する直前に `python scripts/wait_railway_idle.py` を実行すること
  （Windows で `python` が Microsoft Store のスタブに解決される場合は `py -3 scripts/wait_railway_idle.py`）

---

## 補足: Phase 2 で想定される主要論点（Phase 1 で答えを出しておくと後が楽）

- `RANK_ORDER` に B+ を挿入すると B/C/D の数値が後ろにずれる。この定数を参照している箇所が他にないか
- 正規表現を `([ABCD]\+?)` 系に広げたとき、**全角プラス「＋」**や `B＋` 表記をどう扱うか
- 幅評価の禁止をプロンプト側で強制する方法（出力フォーマット指示の書き方）と、**サーバー側でのバリデーション**をかけるか否か
- 過去データ（A/B/C/D のみ）と新規データ（B+ 含む）が混在する集計の**見せ方**（注釈を出すか、期間で分けるか）
- `SKILL.md` / `SKILL_full.md` の同期（Claude.ai 側スキルの更新も必要になる）
