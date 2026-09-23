# T-XXX 求人評価 Opus と Sonnet 5 の比較テスト

- 実施日: 2026-09-24（バッチ投入 00:39 JST / 回収・集計 07:10 JST）
- スクリプト: `scripts/compare-eval-models-t-xxx.ts`（1bcd64f）
- 本番のコード・データへの変更なし。DB は読み取り専用接続（`default_transaction_read_only=on` を起動時に `SHOW` で確認）で読んだだけで、`CandidateFile.aiMatchRating`・コメント列・`advisor_chat_messages`・`AdvisorUsageLog` には書いていない
- この報告書は ID のみ。候補者名・求人名・コメント本文は開発機のコミットしない場所（下記「ファイル」）に置いている

## 結論

**Sonnet 5 は切り替え候補に該当しない。** 判定の目安2つをどちらも満たさなかった。

| 目安 | 結果 | 判定 |
|--|--|--|
| B vs A の完全一致率が A vs C（Opus のブレ）から5pt以内 | 39.0% vs 66.7%（**−27.7pt**） | 非該当 |
| 取りこぼし（A が A/B+ → B が C/D）3%以下 | **5.0%**（5/100件） | 非該当 |

- 費用は大きく下がる（1件あたり ¥5.34 → ¥1.34。求人評価の月額は約 ¥29,000 → ¥7,000〜¥10,500 の試算）
- ただしずれは「Opus のブレ」の範囲を明らかに超える。Sonnet 5 は **総合評価テーブルを守らない出力が 10%**（Opus は 0%）あり、本人希望を Opus より厳しめに付ける傾向がある（所見参照）
- Sonnet の総合を自身の2軸から表で機械的に引き直しても、完全一致率は 49%（−17.7pt）、取りこぼしは 5件のままで、結論は変わらない

---

## 1. 本番の評価設定（確認結果）

| 項目 | 内容 |
|--|--|
| モデル | `claude-opus-4-6`（`src/lib/claude.ts` の `CLAUDE_MODEL_ANALYSIS`。2026-06-18 から変更なし） |
| パラメータ | `max_tokens: 16000` / `temperature: 0.7` / thinking・effort の指定なし（＝思考なし） |
| system | 3ブロック: ①固定部（SKILL.md＋middle-career.md＋EVAL_RULES・1h キャッシュ）②候補者情報（`getCandidateContext()` から評価一覧・求人票節を除去・20,000字上限・5分キャッシュ）③バッチ指示（キャッシュなし） |
| user | 求人票（`CandidateFile.extractedText` を各3,000字で切り出し）×最大5件。**求人本文は保存済みテキストを使い、毎回PDFを読み直してはいない** |
| ランクの取り出し | `extractRatingsAndComments()`（`src/lib/analyze-bookmarks.ts`）で会社名見出しごとにセクションを切り、`■ 総合:` を読む。`■本人希望/通過率/総合` の3軸が揃った行だけ保存（fail-closed） |
| 保存先 | `CandidateFile.aiMatchRating`（総合ランク）・`aiAnalysisComment`（コメント）・`aiAnalyzedAt`（評価日時） |
| 5段階化 | T-146 P2-1〜P2-7（801eecd〜95f47f9、2026-07-28〜07-29）。対象期間（2026-08-25〜）は全て5段階以降 |
| 候補者情報の書類読み取り | `getCandidateContext()` が主要書類4件を読む。T-164 以降は `parsedText` 保存済みなら AI を呼ばない。未解析時のみ `parsePdfWithAI`（Gemini）が走る |
| まとめ送り（Message Batches API） | 自動評価の経路 `src/lib/recommend/analyze-batch-run.ts`（`/api/internal/recommend/analyze-submit`・`analyze-collect`）。CA 画面の経路（analyze-batch route）は逐次のリアルタイム呼び出し |

## 2. 比較の方法

- **対象**: 直近30日（2026-08-25〜09-24）に Opus で評価済みのブックマーク 2,121件（3軸揃い 2,121件）から抽出
  - 候補者 105人のうち、主要書類が全て解析済みの 88人に絞った（書類読み取りの費用とその保存書き込みを発生させないため。未解析書類ありの 17人を除外）
  - 過去評価のランク別に各20件（A/B+/B/C/D）、**100件・候補者11人**（1人最大10件）
- **入力の固定**: 本番の自動評価経路と同じ組み方（候補者ごと・1リクエスト＝求人最大5件・非最終バッチの指示文・system 3ブロックとキャッシュ指定も同一）で **21リクエスト**を1回だけ組み立て、同じ入力を2モデルに送った
  - 本番の関数（`buildAnalyzeFixedSystem` / `buildAnalyzeCandidateContext` / `buildBatchInstruction` / `buildAnalyzeJobsSection` / `buildAnalyzeBatchSystemBlocks` / `extractRatingsAndComments` / `hasValidThreeAxisMarkers`）は import で呼んだだけ。スクリプトへの写しは無し
- **A**: `claude-opus-4-6`（本番と同じパラメータ）
- **B**: `claude-sonnet-5`。本番との違いは次の2点だけ
  - `temperature` を外した（Sonnet 5 は受け付けず 400 になる）
  - `thinking: {type: "disabled"}` を明示（Sonnet 5 は未指定だと adaptive thinking が有効になる。本番 Opus 4.6 の「思考なし」に揃えた）
- **C**: 保存済みの過去の Opus 評価。A と C のずれ＝Opus 自身のブレ
- 送り方: Message Batches API（半額）。A・B とも 21/21 成功、stop_reason は全件 `end_turn`
- C との比較は、評価後に候補者の書類・面談記録が更新された組を除いた（判定: 面談ログ要約の更新／BOOKMARK 以外のファイル追加／CA メモの作成・更新／面談ガイドの更新のいずれかが `aiAnalyzedAt` より後）。**除外 4件**（すべて書類追加）
  - 参考として、応募履歴（JobEntry）の更新も除外する厳しめの定義（85件）でも集計した

## 3. 結果

### 一致率

| 比較 | 件数 | 完全一致率 | 1段差以内率 | 上振れ / 下振れ（左が右より） |
|--|--:|--:|--:|--|
| **A（Opus 再実行）vs C（過去の Opus）＝Opus のブレ** | 96 | **66.7%** | **90.6%** | 上 16 / 下 16 |
| **B（Sonnet 5）vs A（Opus 再実行）** | 100 | **39.0%** | **87.0%** | 上 33 / 下 28 |
| **B（Sonnet 5）vs C（過去の Opus）** | 96 | **45.8%** | **85.4%** | 上 22 / 下 30 |
| （参考・厳しめ）A vs C 応募履歴更新も除外 | 85 | 65.9% | 90.6% | 上 16 / 下 13 |
| （参考・厳しめ）B vs C 応募履歴更新も除外 | 85 | 48.2% | 89.4% | 上 17 / 下 27 |
| （参考）B の総合を自身の2軸から表で引き直し vs A | 100 | 49.0% | 91.0% | — |

- 1段差以内率は Sonnet でも 85〜87% あるが、5段階のうち隣の段へのずれが 1件あたりの紹介判断を変える（B+ と C の境目は紹介するかどうかの境目）ため、完全一致率を主指標にした
- A vs C の上振れ・下振れが 16/16 で釣り合っているのに対し、B は段ごとに偏る（混同表参照）

### 取りこぼし／押し上げ

| | 件数 | 比較100件に対する率 | 条件付きの率 | 参考: Opus のブレ（A→C）で同じ動き |
|--|--:|--:|--:|--:|
| 取りこぼし（A が A/B+ → B が C/D） | **5件** | **5.0%** | A が A/B+ の36件中 13.9% | 2件 / 96件 |
| 押し上げ（A が C/D → B が A/B+） | **2件** | **2.0%** | A が C/D の40件中 5.0% | 1件 / 96件 |

### 混同表 A（Opus 再実行・行）× B（Sonnet 5・列）

| A ＼ B | A | B+ | B | C | D | 計 |
|--|--:|--:|--:|--:|--:|--:|
| A | **6** | 11 | 0 | 1 | 0 | 18 |
| B+ | 2 | **9** | 3 | 4 | 0 | 18 |
| B | 0 | 11 | **6** | 6 | 1 | 24 |
| C | 0 | 2 | 4 | **13** | 2 | 21 |
| D | 0 | 0 | 5 | 9 | **5** | 19 |

- Opus の A を Sonnet は B+ に落としやすく（11/18）、Opus の B は B+ と C に割れる（11 と 6）
- Opus の D を Sonnet は C・B に上げやすい（14/19）。主因は総合評価テーブル違反（所見1）

### 参考: 混同表 C（過去の Opus・行）× A（Opus 再実行・列）

| C ＼ A | A | B+ | B | C | D | 計 |
|--|--:|--:|--:|--:|--:|--:|
| A | **15** | 1 | 4 | 0 | 0 | 20 |
| B+ | 3 | **12** | 3 | 2 | 0 | 20 |
| B | 0 | 4 | **11** | 4 | 1 | 20 |
| C | 0 | 1 | 5 | **13** | 1 | 20 |
| D | 0 | 0 | 1 | 2 | **13** | 16 |

### 形式崩れ

| | 件数 |
|--|--:|
| Opus（A） | 0件 |
| Sonnet 5（B） | 0件 |

どちらも全100件で会社名見出し・3軸マーカー・`◆` セクションが揃い、本番の保存条件（fail-closed）を満たした。

## 4. 費用

### テストの実費（Batch 50%込み）

| | Opus（A） | Sonnet 5（B） |
|--|--:|--:|
| 入力合計（非キャッシュ＋書込＋読取） | 796,209 | 805,081 |
| うち非キャッシュ | 212,099 | 213,535 |
| うちキャッシュ書込 | 329,975 | 157,468 |
| うちキャッシュ読取 | 254,135 | 434,078 |
| 出力 | 106,311 | 76,635 |
| 実費 | $3.393（¥534） | $0.853（¥134） |
| **1件あたり** | **¥5.34** | **¥1.34** |

- 同じ文章を Sonnet 5 が数えるトークン数: Opus 4.6 の **101.1%**（count_tokens・21リクエスト合計。ほぼ同じ）
- 出力トークン: Sonnet 5 は Opus の **72.1%**（コメントが短い）
- 費用比 B/A = **25.1%**
  - ただし Batch のキャッシュ参照はベストエフォートで、今回は B の方がキャッシュ読取が多く（入力の54% vs A の32%）有利に出た。キャッシュ条件を A と同じとみなした概算では **約36%**（入力は単価比40%×トークン比1.011、出力は単価比40%×出力比0.721 で A の実費内訳に掛けた値）
- **テスト総費用 ¥668**（うち書類読み取り ¥0＝解析済み候補者のみ対象）。事前見積もり ¥797 との差 **−¥129**
  - 見積もりは count_tokens の実数に、本番の自動評価（recommend-analyze）の直近30日の入力内訳（非キャッシュ20.6%／読取42.1%／書込37.3%・書込は全て1h単価で計算）と、1件あたり出力の実績（1,084トークン×1.2倍）を当てて出した

### 月額試算

直近30日の AI 費用実績（`AdvisorUsageLog`・2026-08-25〜、¥157.42/USD）:

| 機能(endpoint) | モデル | コール数 | 費用 |
|--|--|--:|--:|
| analyze-batch（CA 画面の求人評価） | claude-opus-4-6 | 920 | ¥27,330 |
| advisor-chat | claude-sonnet-4-6 | 183 | ¥4,593 |
| recommend-analyze（自動評価・Batch） | claude-opus-4-6 | 87 | ¥1,950 |
| daily-report-assist | claude-sonnet-4-6 | 112 | ¥1,792 |
| interview-task-detect | claude-sonnet-4-6 | 107 | ¥806 |
| advisor-log-ingest | claude-sonnet-4-6 | 49 | ¥578 |
| greeting | claude-sonnet-4-6 | 38 | ¥369 |
| その他（haiku・gemini） | | 213 | ¥72 |
| 計 | | | ¥37,488 |

| | 30日あたり |
|--|--:|
| 求人評価の現状（analyze-batch＋recommend-analyze・Opus 4.6） | **¥29,280** |
| Sonnet 5 に切り替えた場合（費用比25.1%・今回の実測） | ¥7,361（−¥21,919） |
| Sonnet 5 に切り替えた場合（費用比約36%・キャッシュ条件を揃えた概算） | 約 ¥10,500（約 −¥18,800） |

- 記録されている AI 費用（¥37,488/30日）の **78%** が求人評価。従量課金の月約4.9万円との差は `AdvisorUsageLog` に記録されない呼び出し（他リポジトリ・記録対象外の経路）と見られる
- CA 画面の経路（analyze-batch）はリアルタイム呼び出しで Batch の半額が効いていない。費用比はモデルの単価差なので、経路によらず同じ比率で効く

### 単価・為替

| 項目 | 値 | 出典 |
|--|--|--|
| Claude Opus 4.6 | 入力 $5 / 出力 $25 / 5分書込 $6.25 / 1h書込 $10 / 読取 $0.50（/MTok） | https://platform.claude.com/docs/en/about-claude/pricing（2026-09-24 取得） |
| Claude Sonnet 5 | 入力 $2 / 出力 $10 / 5分書込 $2.50 / 1h書込 $4 / 読取 $0.20（/MTok）。$2/$10 は導入価格から標準価格に確定済み | 同上 |
| Batch API | 入出力・キャッシュとも 50% 割引（キャッシュ倍率と重ねがけ） | 同上 |
| 為替 | ¥157.42/USD | open.er-api.com（2026-09-23 00:02 UTC 更新値 157.415417） |

## 5. 所見（Sonnet 5 のコメントで目立った弱点）

1. **総合評価テーブルを守らない（10/100件・Opus は 0件）**
   EVAL_RULES の表は「本人希望 D × 任意 → 総合 D」「C × A〜B → 総合 C」だが、Sonnet は「本人希望 D × 通過率 A → 総合 B」（4件）、「D × B → 総合 C」（5件）、「C × A → 総合 B」（1件）と出した。本人希望 D の理由（例: 勤務地が通勤圏外で×）を自分で書いていながら総合を上げており、コメント内で矛盾する。Opus の D を Sonnet が C・B に上げた14件の主因。
   例: `cmti4ajxz00bu0xpiu52bur52`（C=D / A=D / B=B）、`cmti0zavm007i0xpi5g013lom`、`cmnoebggd001s1drqtj81y3ry`
2. **本人希望を厳しめに付け、有望求人を C に落とす（取りこぼし5件の主因）**
   本人希望の軸単独で B vs A 一致 63/100、Sonnet が低い 23件・高い 14件。業務内容や志向性の「方向性のずれ」を▲として本人希望を B→C に下げ、通過率 A・B でも総合 C にする。Opus は同じ求人を本人希望 B・総合 B+ と見ている。
   例: `cmu9c5a7o01p60xqwejf55qx2`（C=A / A=A / B=C）、`cmtme59n702qv0xp2gvqbf9kq`（C=B+ / A=B+ / B=C）、`cmu9c5fxs01p90xqwa4d8qih9`（C=B+ / A=B+ / B=C）
3. **必須要件の判定がぶれる（×と▲の付け分け）**
   Opus が「必須要件未充足＝×」で通過率 D にした求人を Sonnet は▲扱いで通過率 B にした例（`cmtb69wwj01220xmkym4saotw`・C=D / A=D / B=B）と、逆に Opus が必須要件を満たすと判断した求人を Sonnet が×で D にした例（`cmu6a4y2a034r0xtd1hpzzhid`・C=D / A=B / B=D）の両方がある。コメントも Opus より約3割短く（出力72%）、▲・×の個数と判定根拠の書き分けが薄い。

補足: 所見1はプロンプトの工夫か、総合を2軸から表で機械的に引く後処理で直せる可能性がある。ただし表で引き直しても B vs A の完全一致率は 49%（Opus のブレ基準 66.7% から −17.7pt）、取りこぼしは 5件のままで、2軸そのもののずれ（所見2・3）が残る。Sonnet 5 の adaptive thinking を有効にした条件は今回は試していない（費用が上がり、本番 Opus の「思考なし」と条件が揃わないため）。

## 6. ファイル

| 種類 | 場所 |
|--|--|
| スクリプト（コミット1） | `scripts/compare-eval-models-t-xxx.ts`（1bcd64f） |
| 報告書（コミット2） | `docs/reports/T-XXX_opus-vs-sonnet-eval.md`（この文書） |
| 全件明細 CSV（コミットしない） | `C:\bizstudio\bizstudio-portal\scripts\output\t-xxx-eval-compare\detail.csv` |
| 読み比べ HTML（コミットしない・ずれ10件＋一致5件） | `C:\bizstudio\bizstudio-portal\scripts\output\t-xxx-eval-compare\compare.html` |
| 集計・固定入力・生応答（コミットしない） | 同フォルダの `summary.md` / `plan.json` / `results.json` / `state.json` |
| 3軸・テーブル準拠の追加集計（コミットしない） | 同フォルダの `axis-check.ts` |
| Message Batch ID | A: `msgbatch_016cn2oi6Rw16oaAuSbmN7jm` / B: `msgbatch_018pXbTnR3QawgL4innBhkXo` |

`scripts/output/` は既存の `.gitignore` 対象（`.gitignore` の変更なし）。
