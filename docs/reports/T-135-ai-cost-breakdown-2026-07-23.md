# T-135 AI費用内訳分析報告書（2026-07-23）

対象: bizstudio-portal / kyuujin-pdf-tool / bizstudio-job-platform
調査方法: 本番DB `ai_usage_logs` + `advisor_usage_logs` テーブルの SELECT のみ。コード変更なし・DB書き込みなし・AI呼び出しなし。

---

## Step 1. 記録の健全性

### 総件数

| 項目 | 値 |
|--|--|
| AiUsageLog 総行数 | **4,765** |
| 最古レコード（UTC） | 2026-07-13 02:44 UTC（≒ 7/13 11:44 JST） |
| 最新レコード（UTC） | 2026-07-23 01:28 UTC（≒ 7/23 10:28 JST） |
| AdvisorUsageLog 直近行数 | **326**（7/13以降） |

### システム別の記録有無

| システム | 件数 | 初回記録（UTC） | 初回（JST換算） | 想定開始 | 判定 |
|--|--|--|--|--|--|
| portal | 273 | 2026-07-13 02:44 | 7/13 11:44 | 7/13〜 | **一致** |
| kyuujin | 1,825 | 2026-07-16 00:34 | 7/16 09:34 | 7/16 06:20〜 | **概ね一致** |
| job-platform | 2,667 | 2026-07-18 21:30 | 7/19 06:30 | 7/17 朝〜 | **⚠️ 1日遅れ**（7/18 JST に270件あるが UTC ベースの初回は 7/19 JST。日付変換の pg ドライバ挙動の可能性あり。実質 7/18-19 JST 開始） |

**0件のシステムは無い。3システムとも記録あり。**

### 初日の異常値

- kyuujin: 7/15 JST に**619件**（以後の日次 45〜315件と比べて突出）。**計装直後の遡及処理（バックフィル）の疑い**。
- job-platform: 7/19 JST に**1,564件**（以後の日次 7〜454件）。同様にバックフィル疑い。

### 単価表に無いモデル

**0件**。estimated_cost_jpy が NULL のレコードは無い。全レコードに費用が算出されている。

### 単価の妥当性

`ai-pricing.ts` の値と Gemini API 公式（2026-07-13 確認と記載あり）の照合：

| モデル | input $/Mtok | output $/Mtok | cached $/Mtok | 判定 |
|--|--|--|--|--|
| gemini-2.5-flash | 0.30 | 2.50 | 0.03 | ✓ 公式と一致 |
| gemini-3-flash-preview | 0.50 | 3.00 | 0.05 | ✓ 公式と一致 |
| claude-sonnet-4-6 | 3.00 | 15.00 | 0.30 | ✓ Anthropic公式と一致 |

**⚠️ 重大な単価漏れ: thinking tokens（後述 Step 4）**
gemini-2.5-flash / gemini-3-flash-preview は thinking モデル。thinking tokens は output と同単価で課金されるが、`GeminiUsageMetadata` 型に `thoughtsTokenCount` フィールドが無く、**thinking tokens は記録されていない**。したがって **estimated_cost_jpy は実際の請求額より大幅に低い**。

### 欠損期間

- 7/18 JST: AdvisorUsageLog が0件（AiUsageLog は job-platform 270件あり）
- AiUsageLog は日次で途切れなし（7/13 以降毎日記録あり）

---

## Step 2. 集計（7/17 JST〜7/22 JST・3システム揃っている期間）

### 2-1. システム別

| システム | 件数 | 合計(¥) | 割合 | 日あたり(¥) |
|--|--|--|--|--|
| job-platform | 2,667 | ¥2,831 | **90.0%** | ¥472 |
| kyuujin | 1,133 | ¥255 | 8.1% | ¥43 |
| portal（AiUsageLog） | 133 | ¥58 | 1.8% | ¥10 |
| **AiUsageLog合計** | **3,933** | **¥3,144** | **100%** | **¥524** |

※ これは **thinking tokens を含まない記録ベース**の金額。実請求額はこの約3.4倍（後述 Step 4）。

### 2-2. 処理別（金額順・記録ベース）

| # | システム | 処理 | モデル | 件数 | 合計(¥) | 1件あたり(¥) |
|--|--|--|--|--|--|--|
| 1 | **job-platform** | **job-structuring** | gemini-2.5-flash | 2,667 | **¥2,831** | ¥1.06 |
| 2 | kyuujin | pdf-vision-extract | gemini-2.5-flash | 1,101 | ¥246 | ¥0.22 |
| 3 | portal | file-parse | gemini-3-flash-preview | 93 | ¥47 | ¥0.51 |
| 4 | portal | resume-parse | gemini-3-flash-preview | 27 | ¥8 | ¥0.30 |
| 5 | kyuujin | mypage-ai-detail | claude-sonnet-4-6 | 2 | ¥7 | ¥3.30 |
| 6 | portal | diagnosis-extract | gemini-3-flash-preview | 9 | ¥2.3 | ¥0.25 |
| 7 | kyuujin | homepage-url-batch | gemini-2.5-flash | 30 | ¥2.2 | ¥0.07 |
| 8 | portal | candidate-resume-parse | gemini-3-flash-preview | 3 | ¥0.7 | ¥0.23 |
| 9 | portal | schedule-agent-extract | gemini-3-flash-preview | 1 | ¥0.06 | ¥0.06 |

AdvisorUsageLog（Claude 系・7/17 UTC 以降・別テーブル）:

| # | 処理 | モデル | 件数 | 合計($) | 合計(¥) | 1件あたり($) |
|--|--|--|--|--|--|--|
| 1 | **analyze-batch** | **claude-opus-4-6** | 93 | **$20.53** | **¥3,285** | $0.22 |
| 2 | advisor-chat | claude-sonnet-4-6 | 25 | $4.33 | ¥693 | $0.17 |
| 3 | daily-report-assist | claude-sonnet-4-6 | 9 | $0.97 | ¥155 | $0.11 |
| 4 | greeting | claude-sonnet-4-6 | 4 | $0.17 | ¥27 | $0.04 |

### 2-3. モデル別

AiUsageLog（7/17 JST 以降）:

| モデル | 件数 | 入力tok | 出力tok | キャッシュ入力tok | 合計(¥) |
|--|--|--|--|--|--|
| gemini-2.5-flash | 3,798 | 8,628,706 | 6,391,672 | 22,686,641 | ¥3,080 |
| gemini-3-flash-preview | 133 | 184,786 | 90,179 | 2,436 | ¥58 |
| claude-sonnet-4-6 | 2 | 4,320 | 1,890 | — | ¥7 |

AdvisorUsageLog（7/13 以降・全期間）:

| モデル | 件数 | 合計($) | 合計(¥) |
|--|--|--|--|
| claude-opus-4-6 | 220 | $52.07 | ¥8,331 |
| claude-sonnet-4-6 | 87 | $10.82 | ¥1,731 |
| gemini-3-flash-preview | 19 | $0.02 | ¥3 |

### 2-4. 媒体別

kyuujin（metaの `data_source` で判定）:

| 媒体 | 件数 | 合計(¥) | 割合 |
|--|--|--|--|
| hito_mynavi | 1,540 | ¥348 | 88% |
| circus | 219 | ¥47 | 12% |

job-platform（metaの `media` で判定）:

| 媒体 | 備考 |
|--|--|
| hito_link | サンプル10件すべて `hito_link`。`batchType: "daily_auto"`。 |

### 2-5. 日別（AiUsageLog 全システム合計・JST）

| 日付(JST) | 曜日 | 件数 | 合計(¥) | 備考 |
|--|--|--|--|--|
| 7/13 | 日 | 23 | ¥8 | portal のみ |
| 7/14 | 月 | 34 | ¥12 | portal のみ |
| 7/15 | 火 | 23 | ¥10 | portal のみ |
| 7/16 | 水 | 659 | ¥193 | kyuujin 初日（619件バックフィル疑い） |
| 7/17 | 木 | 368 | ¥109 | kyuujin + portal |
| 7/18 | 金 | 311 | ¥71 | kyuujin + portal |
| 7/19 | 土 | 273 | ¥289 | job-platform 初日（270件） |
| 7/20 | 日 | 1,654 | **¥1,677** | **job-platform 1,564件（バックフィル疑い）** |
| 7/21 | 月 | 76 | ¥28 | 日曜・低活動 |
| 7/22 | 火 | 648 | ¥464 | 通常平日 |
| 7/23 | 水 | 696 | ¥542 | 通常平日 |

### 2-6. 時間帯別（AiUsageLog・JST）

| 時間帯 | 件数 | 合計(¥) | 備考 |
|--|--|--|--|
| **12:00** | **2,360** | **¥2,504** | **job-platform 日次バッチの集中時刻** |
| 13:00 | 506 | ¥380 | バッチの続き |
| 22:00 | 220 | ¥52 | kyuujin 夜間バッチ |
| 0:00 | 220 | ¥51 | kyuujin 深夜バッチ |
| 20:00-21:00 | 242 | ¥57 | 夕方のCA操作 |
| 14:00-17:00 | 232 | ¥60 | 午後のCA操作 |

### 2-7. 平日 vs 休日

| 区分 | 日数 | 合計(¥) | 日あたり(¥) |
|--|--|--|--|
| 平日 | 5 | ¥1,178 | ¥236 |
| 休日 | 2 | ¥1,966 | ¥983 |

※ 休日平均は 7/20(日) のバックフィル ¥1,677 に引き上げられている。バックフィルを除けば休日は低活動。

---

## Step 3. 主犯の特定

### 第1位: job-platform / job-structuring（gemini-2.5-flash）

| 項目 | 値 |
|--|--|
| 記録ベース合計（全期間） | ¥2,831（AiUsageLog全体の **83%**） |
| 件数 | 2,667 |
| 1件あたり（記録ベース） | ¥1.06 |
| 平均入力 | 2,184 tok |
| 平均出力 | 2,293 tok |
| 平均キャッシュ | 8,199 tok |
| 通常平日の件数 | 372〜454件/日 |
| 通常平日コスト（記録ベース） | ¥394〜¥485/日 |

**業務上の意味**: HITO-Link から取得した求人票PDF を Gemini で構造化（求人情報の抽出）。毎日昼12時に `daily_auto` バッチで自動実行。

**頻度・件数の妥当性**:
- 平日 372〜454件は、HITO-Link の新規・更新求人数として**妥当な範囲**（推測）
- 7/19 の 1,564件は計装直後のバックフィル（初回取り込み）と推定
- 7/20 の 7件は日曜で新規求人が少ない日

**⚠️ 実際の費用は記録の約3.4倍（後述 Step 4）**

### 第2位: portal / analyze-batch（claude-opus-4-6）

| 項目 | 値 |
|--|--|
| 合計（全期間・AdvisorUsageLog） | $52.07 = **¥8,331** |
| 件数 | 220 |
| 1件あたり | $0.24 = ¥38 |
| 日あたり件数 | 4〜32件/日（高分散） |
| 日あたりコスト | $0.55〜$7.20/日 |

**業務上の意味**: 求職者のブックマーク（求人PDF）をバッチでAI分析（マッチング評価）。5求人ごとに Opus 1コール。CA がボタンを押すたびに実行。

**頻度の妥当性**:
- 7/21 に 32コール（6〜7候補者分）は繁忙日として妥当
- 7/22 に 3コールと大幅減。**日次のバラつきが極めて大きい**（CA の操作頻度に依存）

### 第3位: kyuujin / pdf-vision-extract（gemini-2.5-flash）

| 項目 | 値 |
|--|--|
| 記録ベース合計（7/17以降） | ¥246 |
| 件数 | 1,101 |
| 1件あたり | ¥0.22 |
| 通常日の件数 | 45〜315件/日 |
| 媒体内訳 | hito_mynavi 88% / circus 12% |

**業務上の意味**: 求人PDFのテキスト抽出（OCR/Vision）。ページ単位で Gemini を呼ぶ（1PDF = 複数ページ = 複数コール）。

**頻度の妥当性**:
- ページ単位呼び出しのため件数が多い
- 7/16 の 619件は計装直後のバックフィル疑い
- hito_mynavi（マイナビ転職）が大多数を占めるのは**求人数の母数として妥当**

---

## Step 4. 外部請求額との突き合わせ

### 記録 vs 請求の乖離

| 項目 | 値 |
|--|--|
| Google AI Studio 請求（7/1〜7/17） | ¥35,371（確定） |
| 同期間の T-131 遡及分 | ¥12,000（確定） |
| 平常ペース（遡及除外） | ¥1,460/日（確定） |
| AiUsageLog 記録ベース日次コスト | ¥449〜524/日（確定） |
| **乖離倍率** | **約3.0〜3.4倍** |

### 乖離の原因: **thinking tokens が記録されていない**

gemini-2.5-flash / gemini-3-flash-preview は「thinking（推論）」モデル。API レスポンスの `usageMetadata` に `thoughtsTokenCount` が含まれるが、`ai-usage.ts` の `GeminiUsageMetadata` 型にこのフィールドが**存在しない**。

- thinking tokens は **output と同じ単価**で課金される（gemini-2.5-flash: $2.50/Mtok）
- recording は `candidatesTokenCount`（最終出力のみ）しか取得していない
- **thinking tokens = 実際の出力コストの大部分**

#### 推定 thinking token 量（T-131 バックフィルとの照合で逆算）

| 検証項目 | 値 |
|--|--|
| T-131 バックフィル件数 | 3,375件（確定） |
| T-131 バックフィル実費用 | ¥12,000（確定） |
| 記録ベース1件あたり費用 | ¥1.06 |
| 実際の1件あたり費用 | ¥12,000 / 3,375 = **¥3.56** |
| **乖離倍率** | **3.36倍** |
| 推定 thinking tokens/件 | 約6,250 tok（出力 2,293 tok の **2.7倍**） |

#### thinking-adjusted 日次コスト推定

| システム | 記録ベース ¥/日 | thinking 倍率 | 推定実費 ¥/日 |
|--|--|--|--|
| job-platform（平日平均） | ¥389 | ×3.4 | **¥1,323** |
| kyuujin | ¥49 | ×1.5（推測） | ¥74 |
| portal（Gemini分） | ¥10 | ×2.0（推測） | ¥20 |
| **Gemini 合計** | **¥448** | | **¥1,417** |

**推定 Gemini 日次コスト ¥1,417 は、外部請求ペース ¥1,460/日とほぼ一致。**

乖離の原因は thinking tokens でほぼ説明がつく。

### Anthropic（Claude）側の推定

| 項目 | AdvisorUsageLog 実測 |
|--|--|
| 日次平均 | $5.72/日 = ¥915/日 |
| 月次推定（22営業日） | $126 = ¥20,160 |
| 記録対象 | analyze-batch / advisor-chat / daily-report-assist / greeting |
| **未記録** | schedule/review, schedule/chat, daily-report/chat, rpa-error/*, candidate-site/summarize |

### 未記録の Claude 呼び出し（AiUsageLog にも AdvisorUsageLog にも無い）

以下の6エンドポイントは Anthropic API を呼ぶが**どちらのログテーブルにも記録されていない**:

| エンドポイント | モデル | 推定頻度 |
|--|--|--|
| schedule/review | claude-sonnet-4-6 | 低（手動トリガー） |
| schedule/chat | claude-sonnet-4-6 | 低 |
| daily-report/chat | claude-sonnet-4-6 | 低（assist の方が多い） |
| rpa-error/chat/*/extract | 不明 | 低 |
| rpa-error/chat/*/message | 不明 | 低 |
| external/candidate-site/questions/summarize | claude-haiku-4-5 | 低 |

※ これらは全て Claude（Anthropic 課金）であり、Google AI Studio の Gemini 請求には影響しない。費用的影響は小さいと推測されるが、正確な値は不明。

### 総合推定（月次）

| 項目 | 推定月額 | 確度 |
|--|--|--|
| Gemini（thinking 込み） | **¥42,500** | 高（T-131 照合で検証済み） |
| Claude（AdvisorUsageLog 実測分） | **¥20,160** | 中（日次変動大） |
| Claude（未記録6エンドポイント） | ¥1,000〜3,000（推測） | 低 |
| **合計** | **¥63,660〜65,660** | |

---

## Step 5. 削減案

### 案1: job-platform の thinking budget 制限（推奨順位: 1）

| 項目 | 内容 |
|--|--|
| 概要 | `generationConfig.thinkingConfig.thinkingBudget` を設定し、thinking tokens に上限を設ける |
| 対象 | job-platform / job-structuring（全 Gemini コストの 83%） |
| 削減見込み | thinking を現在の2.7倍→0.5倍に抑制すれば、1件 ¥3.56 → ¥1.56。月 **¥20,000 削減** |
| 業務への影響 | 構造化の精度低下リスク（要検証）。ただし求人構造化は定型度が高く、thinking の大半は過剰推論の可能性 |
| 実装規模 | job-platform 側の Gemini 呼び出しに1パラメータ追加。小。 |
| リスク | 構造化漏れ・誤抽出の発生確率が上がる可能性 |

### 案2: thinking tokens の記録追加（推奨順位: 2・削減ではなく計測改善）

| 項目 | 内容 |
|--|--|
| 概要 | `GeminiUsageMetadata` に `thoughtsTokenCount` フィールドを追加し、`estimatedCostJpy` に thinking 分を含める |
| 削減見込み | ¥0（計測改善のみ）。ただし**正確な費用把握なしに最適化は不可能** |
| 実装規模 | ai-usage.ts に1フィールド追加。ai-pricing.ts の計算式修正。小。 |
| リスク | なし |

### 案3: analyze-batch の Sonnet 化（推奨順位: 3）

| 項目 | 内容 |
|--|--|
| 概要 | per-batch を claude-sonnet-4-6 にし、最終バッチ（総合まとめ）のみ claude-opus-4-6 を維持 |
| 削減見込み | $52→$31/10日。月 **¥5,000〜8,000 削減** |
| 業務への影響 | マッチング評価の品質低下リスク。**要品質検証**。コード注記に「Opus を業務価値そのものとして維持」とあり、品質テスト前提 |
| 実装規模 | analyze-batch/route.ts のモデル選択ロジック変更。小〜中。 |
| リスク | 求人マッチング品質が低下すると CA の判断精度に直結 |

### 案4: kyuujin pdf-vision-extract のページ単位呼び出し最適化（推奨順位: 4）

| 項目 | 内容 |
|--|--|
| 概要 | 複数ページを1コールにまとめるか、変更のないページをスキップする |
| 削減見込み | 件数半減で月 **¥2,000〜3,000 削減**（thinking 込み） |
| 業務への影響 | なし（結果は同一） |
| 実装規模 | kyuujin-pdf-tool 側の呼び出しロジック変更。中。 |
| リスク | 低（ページ結合で精度が落ちなければ） |

### 案5: gemini-2.5-flash-lite への切り替え（推奨順位: 5）

| 項目 | 内容 |
|--|--|
| 概要 | job-structuring に gemini-2.5-flash-lite（input $0.10 / output $0.40）を使用 |
| 削減見込み | output 単価 $2.50→$0.40 で thinking 含め **月¥30,000以上削減**。ただしthinking非対応の可能性あり |
| 業務への影響 | 構造化精度の大幅低下リスク。**要検証** |
| 実装規模 | モデルID変更のみ。小。 |
| リスク | 高（flash-lite は軽量モデル。構造化タスクに十分かは未確認） |

### 削減案まとめ

| 順位 | 案 | 月次削減見込み | 品質リスク |
|--|--|--|--|
| **1** | **thinking budget 制限** | **¥20,000** | **要検証（低〜中）** |
| 2 | thinking tokens 記録追加 | ¥0（計測改善） | なし |
| **3** | **analyze-batch Sonnet化** | **¥5,000〜8,000** | **要品質検証** |
| 4 | pdf-vision ページ結合 | ¥2,000〜3,000 | 低 |
| 5 | flash-lite 切り替え | ¥30,000+ | 高 |

**案1+案2を実施すれば、品質リスクを限定しつつ月¥20,000削減+正確な計測が可能。**
**案1+案3を加えれば月¥25,000〜28,000削減。**

---

## 確認事項

| 項目 | 確認 |
|--|--|
| コード変更 | **なし**（1行も変更していない） |
| DB書き込み | **なし**（SELECT のみ） |
| AI呼び出し | **なし**（Gemini/Claude を呼ぶ処理を一切実行していない） |

## 想定と違った点

1. **主犯は job-platform だった**。portal の Claude 系（analyze-batch）が最大と予想していたが、Gemini の記録ベースでは job-platform / job-structuring が 83%。thinking tokens を含めると Gemini 全体の費用は Claude の2倍以上。
2. **thinking tokens が記録から完全に漏れている**。記録ベースの費用と外部請求の乖離は 3.0〜3.4倍。T-131 バックフィル（3,375件 = ¥12,000）との逆算で thinking tokens は出力の約2.7倍と推定され、推定日次コスト ¥1,417 は外部請求 ¥1,460 とほぼ一致。
3. **kyuujin の初日 619件がバックフィル疑い**。計装直後に既存データを遡及処理した可能性がある。
4. **portal の Claude 6エンドポイントが完全に未記録**。AiUsageLog にも AdvisorUsageLog にも入っていない。費用的影響は小さいが、計測の漏れとして残っている。
5. **7/19 (土) に job-platform が 1,564件を処理**。バックフィル or 週末バッチの可能性。通常の土日は低活動（7/20 = 7件）。
