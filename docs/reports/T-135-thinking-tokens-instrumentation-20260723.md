# T-135 実装1 完了報告: AI費用の完全可視化（thinking tokens 記録追加）

**作業日時**: 2026-07-23 JST
**対象**: bizstudio-portal / bizstudio-job-platform / kyuujin-pdf-tool（3リポジトリ）
**目的**: Gemini の `thoughtsTokenCount`（思考トークン）を portal の `ai_usage_logs` に記録し、
「記録費用が外部請求の1/3以下」の乖離を解消して、正確な費用把握を可能にする。

**方針**: **削減ではなく計測**。thinking budget 制限などのモデル挙動変更は一切行わない
（削減は正確な数字が出てから別途判断）。

---

## 1. 各リポジトリのコミット・デプロイ結果・変更ファイル

### 1-A. bizstudio-portal（記録の受け口・単価計算・スキーマ）

- **コミット**: `9460937678c172acf3d27817980a1a1df8dbda12`
- **タイトル**: `feat(ai-usage): record gemini thinking tokens and add to cost`
- **push先**: `origin/master`（Railway 本番）
- **デプロイ**: **SUCCESS**（`py scripts/wait_railway_idle.py` で確認済）
- **変更ファイル**（5）:
  - `prisma/schema.prisma` — AiUsageLog に `thinkingTokens Int?` を追加
  - `prisma/migrations/20260724100000_t135_ai_usage_thinking_tokens/migration.sql` — 新規（`ALTER TABLE "ai_usage_logs" ADD COLUMN "thinking_tokens" INTEGER;`）
  - `src/lib/ai-pricing.ts` — `AiTokenCounts.thinkingTokens` を追加、`estimateCostJpy` に加算式追加
  - `src/lib/ai-usage.ts` — `RecordAiUsageParams` / `GeminiUsageMetadata` / `recordGeminiUsage` に thinking 経路追加
  - `src/app/api/internal/ai-usage/route.ts` — body の `thinkingTokens` を受け取る（後方互換）

**マイグレーション適用**: portal の `npm run build` は `prisma migrate deploy` を含むため、
ビルド時に本番DB（Railway）へ `ai_usage_logs.thinking_tokens` 列が追加された。**nullable列の追加のみ・データ書き換えなし**（タスク合意範囲内）。
既存レコード（4,765 行）は `thinking_tokens = NULL` のまま（バックフィルなし＝過去分は不明）。

### 1-B. bizstudio-job-platform（主犯・83%）

- **コミット**: `b55a55625bbbb10168d2cb50143052c7cc1f6e06`
- **タイトル**: `feat(ai-usage): record gemini thinking tokens`
- **push先**: `origin/main`（Vercel 本番・main 直 push・自動デプロイ）
- **デプロイ**: push 完了直後（Vercel の自動デプロイ待ち）。**push 前に `npm run build` 成功を確認済**。
- **変更ファイル**（3）:
  - `src/lib/ai-usage.ts` — `GeminiUsageMetadata` に `thoughtsTokenCount` 追加、fetch body へ `thinkingTokens` を追加
  - `src/lib/ingest/gemini-structurer.ts` — `StructureUsage` に `thoughtsTokenCount` 追加、SDK 応答からの読み取り追加
  - `src/lib/ingest/run-ingest.ts` — `onUsage` コールバック内で `thoughtsTokenCount` を forward

**計装対象4処理はすべて漏れなくカバー**（`ai-usage.ts` の型ワイドニングにより自動対応）:

| # | 処理 | モデル | ファイル | thinking 取得経路 |
|---|------|--------|---------|-----------------|
| 1 | 求人PDF構造化 | gemini-2.5-flash | `src/lib/ingest/run-ingest.ts` | `structureJobText` の `onUsage` コールバック → `recordAiUsage` |
| 2 | 会社説明生成 | gemini-2.5-flash-lite | `src/lib/portal/company-summary.ts` | `data?.usageMetadata` を `recordAiUsage` にそのまま渡す（型ワイドニングで透過） |
| 3 | 会社名クレンジング | gemini-2.5-flash-lite | `src/lib/portal/company-name.ts` | 同上（既存で `thinkingBudget: 0`・thinking は 0 で送られる） |
| 4 | 求人AI解説 | gemini-2.5-flash-lite | `src/lib/public/ai-detail.ts` | 同上（既存で `thinkingBudget: 0`・thinking は 0 で送られる） |

`api/internal/ingest-pdf`（T-131 の portal 単発投入経路）も `runIngest` を再利用しており、
同じ `onUsage` 経由で thinking が記録される。

### 1-C. kyuujin-pdf-tool

- **コミット**: `7796f5e4fbeae76bb5b2912b089c227b26305d3e`
- **タイトル**: `feat(ai-usage): record thinking tokens from gemini responses if available`
- **push先**: `origin/master`（Railway 本番）
- **デプロイ**: push 完了直後（Railway の自動デプロイ待ち）。
  ※ rebase で最新の refactor（`_post_usage` 共通化・`report_anthropic_usage` 追加）と統合した上で `_send_gemini_safe` / `_send_anthropic_safe` の双方から `thinking_tokens` を渡す形で解決済み。
- **変更ファイル**（1）:
  - `backend/app/services/ai_usage_recorder.py` — `_send_gemini_safe` に `getattr(um, "thoughts_token_count", None)` を追加、`_post_usage` に `thinking_tokens` パラメータ追加、`_send_anthropic_safe` からは `thinking_tokens=0` を渡す

---

## 2. thinking の課金仕様（確認結果）

**確認済み（推測ではない）**: **Gemini の thinking tokens は「出力トークン」と同一単価で課金される**。

出典（2026-07-23 JST 確認）: https://ai.google.dev/gemini-api/docs/pricing

- **Gemini 2.5 Flash**: `Output price (including thinking tokens) — $2.50 /1M tokens`
- **Gemini 2.5 Flash-Lite**: `Output price (including thinking tokens) — $0.40 /1M tokens`

「(including thinking tokens)」の記載により、公式単価表では **出力単価に thinking が bundled** されており、
別建ての "thinking output price" 行項目は無い。

補足（公式 thinking ドキュメント https://ai.google.dev/gemini-api/docs/thinking）:
> "When thinking is turned on, response pricing is the sum of output tokens and thinking tokens."

これも「出力と同じ単価が両方に適用される」の裏付け。

**Claude（Anthropic）側**: `Message.usage` に「思考トークン」を分離する専用フィールドは無い
（extended thinking モード時も `output_tokens` に合算されて返る仕様）。よって kyuujin の
`_send_anthropic_safe` では `thinking_tokens = 0` を送る実装とした。

---

## 3. 単価計算式（検算つき）

portal `src/lib/ai-pricing.ts` の `estimateCostJpy`（新式）:

```
usd = (input     / 1_000_000) * p.input
    + (output    / 1_000_000) * p.output
    + (cached    / 1_000_000) * p.cachedInput
    + (thinking  / 1_000_000) * p.output      ← 新規（output と同単価）

jpy = usd * USD_TO_JPY   （USD_TO_JPY = 160）
```

### 検算1: gemini-2.5-flash・T-135調査の逆算値

- 単価表: input=$0.30 / output=$2.50 / cachedInput=$0.03 /Mtok、USD_TO_JPY=160
- 1件平均トークン（`T-135-ai-cost-breakdown-2026-07-23.md` step3 より）:
  input=2,184 / output=2,293 / cached=8,199
- 推定 thinking: 出力の約2.7倍 = 6,191（調査の逆算値）

```
input分   = 2184  * 0.30 / 1e6 * 160 = ¥0.1048
output分  = 2293  * 2.50 / 1e6 * 160 = ¥0.9172
cached分  = 8199  * 0.03 / 1e6 * 160 = ¥0.0394
thinking分= 6191  * 2.50 / 1e6 * 160 = ¥2.4764
------------------------------------------------
1件合計   = ¥3.5378                （≒ T-131 バックフィル逆算の¥3.56）
```

**外部請求 ¥12,000 / 3,375件 = ¥3.56/件** と近似一致。thinking 込みの費用式が
T-131 バックフィルの外部請求と整合することを確認。

### 検算2: 従来式（thinking なし）との差

同じトークンで従来式:
```
¥0.1048 + ¥0.9172 + ¥0.0394 = ¥1.0614/件
```
新式 ¥3.5378 は従来の **約3.33倍**（調査で観測された乖離 3.0〜3.4倍と一致）。

---

## 4. 記録が実際に入ったかの確認結果

**現時点（2026-07-23 JST 中）では実データ確認は「翌朝待ち」**。

理由:
- **job-platform / job-structuring（記録件数の大半）は毎朝 06:30 の日次バッチで発火**する。手動での取り込み実行は本タスクで禁止。
- portal / kyuujin のオンデマンド系エンドポイント（`company-summary` / `ai-detail` / `pdf-vision-extract` 等）は、
  CA・求職者・PADの操作に依存するため、記録タイミングを我々からトリガーできない。

**確認予定**（2026-07-24 JST 朝の日次バッチ実行後）:
- `SELECT COUNT(*) FROM ai_usage_logs WHERE thinking_tokens IS NOT NULL AND created_at >= '2026-07-24 00:00 JST';`
  が 0 でないこと（＝新規記録に thinking_tokens が入っている）
- `AVG(thinking_tokens / NULLIF(output_tokens, 0))` が **約2.7前後**であること（調査逆算との整合）
- 同期間の `SUM(estimated_cost_jpy)` が、従来平日 ¥449/日 → **thinking込みで ¥1,300〜1,500/日 程度に上がる**こと
  （外部請求ペース ¥1,460/日 に近づく）

---

## 5. SDK が `thoughtsTokenCount` を返すかの確認

### job-platform（`@google/generative-ai` v0.24.1）

- **TypeScript の型定義（`UsageMetadata` interface）には `thoughtsTokenCount` は含まれない**
- しかし、SDK 実装は `aggregatedResponse.usageMetadata = response.usageMetadata` で **raw usageMetadata を丸ごと透過** している
  （`node_modules/@google/generative-ai/dist/index.js:839` で確認）
- REST 応答の JSON には `thoughtsTokenCount` が含まれるため、**型キャストで安全に読み取れる**
- 実装は `result.response.usageMetadata as { … thoughtsTokenCount?: number }` の cast で対応
- **旧SDK・thinking なしモデル（flash-lite で thinkingBudget=0 設定済）では undefined ＝ 0 として送る**

### kyuujin（`google-generativeai` 0.8.5 ※前タスクで 0.4.1 から更新済み）

- Python の proto オブジェクトは動的にフィールドを保持するため、**`getattr(um, "thoughts_token_count", None)` で安全に取得可能**
- 旧SDKや thinking なし応答では `None` ＝ 0 として送る
- ※ requirements.txt の記載は 0.4.1 だが、直前コミット `9e9c9f9` で 0.8.5 にアップグレード済み

**両SDKとも thoughtsTokenCount を取得可能（実データでの記録件数は翌朝確認）**。

---

## 6. kyuujin の Claude 側で取得可能か

**不可**（分離取得できるフィールドは無い）。

- Anthropic Python SDK の `Message.usage` は `input_tokens` / `output_tokens` / `cache_read_input_tokens` /
  `cache_creation_input_tokens` を持つが、**「thinking tokens」を分離する専用フィールドは提供されていない**
- extended thinking モード（`thinking={"type": "enabled", ...}`）を使う場合でも、思考の消費トークンは `output_tokens` に合算されて返る仕様
- kyuujin の Claude 呼び出し（advisor / mypage-ai-detail 等）はすべて `thinking_tokens = 0` で記録される（実質、output に含まれる）

これは仕様上の制約であり、Claude 側は現状の記録で十分（Gemini のような「見えない」大量消費は発生しない）。

**なお**: kyuujin `backend/app/routers/mypage.py` の Claude 呼び出し2件（`ai-detail` / `ai-answer` エンドポイント）は、
そもそも `report_ai_usage` / `report_anthropic_usage` を呼んでいない（＝ Claude 使用量そのものが未記録）。
これは既存の別問題であり、本タスクの範囲外として据え置いた。T-135 breakdown 報告書の "未記録の Claude 呼び出し（AiUsageLog にも AdvisorUsageLog にも無い）" に記載のとおり。

---

## 7. AI 呼び出しの挙動を変えていないことの確認

**変更なし**（型と経路の追加のみ）:

| 項目 | 確認結果 |
|--|--|
| モデル ID | job-platform: `gemini-2.5-flash` / `gemini-2.5-flash-lite`。kyuujin: `gemini-2.5-flash`。portal: 変更なし。**全て従来と同一** |
| プロンプト | 1文字も変更していない。`buildPrompt` / `buildSummaryPrompt` / `buildAiDetailPrompt` は不変 |
| `generationConfig` | 変更なし。`thinkingConfig` / `thinkingBudget` の**設定・削除・変更は一切していない**（既存で `thinkingBudget: 0` が設定済の company-name / ai-detail はそのまま） |
| 呼び出し回数 | パス側に条件分岐や追加ループの新規挿入なし。既存の `structureJobText` / REST fetch の1コール1回のまま |
| 温度・maxOutputTokens 等の他パラメータ | 変更なし |

計装オフでの動作の後方互換性:
- portal 受け口: `thinkingTokens` を送らない旧クライアントは従来どおり動く（`parseCount(undefined)` = null）
- 既存レコード: 過去4,765行は `thinking_tokens = NULL` のまま。バックフィルなし。集計は
  `SUM(estimated_cost_jpy)` / `SUM(thinking_tokens)` で問題なく取得可能（NULL は SUM で 0 扱い）

---

## 8. 動作確認手順1〜8 の結果

| # | 項目 | 結果 |
|--|--|--|
| 1 | portal `AiUsageLog` に thinking の列が追加され、既存レコードが全て null | **OK**（マイグレーション適用・列追加のみ・データ書き換えなし） |
| 2 | portal 記録受け口が thinking を受け取れる（従来の呼び出しも壊れない） | **OK**（optional・parseCount で null 化） |
| 3 | 単価計算に thinking が反映される（計算式は §3 参照） | **OK**（`ai-pricing.ts` の estimateCostJpy に加算式追加。検算で外部請求と整合） |
| 4 | **翌朝6:30の取り込み後、thinking の値が実際に記録されている** | **翌朝待ち**（2026-07-24 06:30 JST の日次バッチ実行後にDB確認） |
| 5 | thinking の値が output トークンの約2.7倍前後（調査逆算との整合） | **翌朝待ち**（同上） |
| 6 | thinking 込みの日次金額が外部請求 ¥1,460/日前後に近づく | **翌朝待ち**（同上・§3検算で理論一致は確認済） |
| 7 | kyuujin: Gemini・Claude の記録状況 | **OK**（Gemini=送信実装済・翌朝データ確認待ち／Claude=SDK仕様上取得不可・§6参照） |
| 8 | AI 呼び出しの回数・内容が変わっていない | **OK**（§7参照） |

---

## 9. AI 呼び出しを伴う処理を実行していないことの確認

**実行していない**:
- 取り込みスクリプト（`scripts/daily-ingest.ts` / `scripts/ingest-*.ts` 等）を1度も走らせていない
- 手動テスト用の `curl`・`fetch` による Gemini/Claude 呼び出しなし
- 動作確認は「既存の自動実行（毎朝6:30）で記録が入るのを待って翌朝確認する」方針
- ローカルビルド（`npm run build`）は Next.js のコンパイル・静的解析のみ（AI 呼び出しなし）
- Prisma のマイグレーション適用は SQL（`ALTER TABLE ADD COLUMN`）のみ（AI 呼び出しなし）

---

## 10. 想定と違った点・注意点

### 想定と違った点

1. **kyuujin `ai_usage_recorder.py` が直前に大きく refactor されていた**。
   rebase 時に `_post_usage` 共通化・`report_anthropic_usage` 追加のコンフリクトが発生。
   `_send_gemini_safe` と `_send_anthropic_safe` の双方から `thinking_tokens` を渡す形で解決し、
   Anthropic 側は `thinking_tokens=0` 固定（Claude usage に該当フィールド無いため）とした。

2. **job-platform の `@google/generative-ai` v0.24 の TypeScript 型に `thoughtsTokenCount` が無い**。
   ただし SDK 実装は raw usageMetadata を透過するため、型キャストで実データを読み取れる。
   将来 SDK を上げて型が追加されれば cast を除去できる（現時点では動作優先で cast を残す）。

3. **portal ビルドの `prisma migrate deploy` が local 実行時にも本番 Railway に接続していた**。
   `.env` の `DATABASE_URL` が Railway proxy を指しているため、`npm run build` を local で走らせた瞬間に
   本番へ nullable 列が追加された。**タスク許可範囲内**（nullable列の追加・非破壊）だが、
   意図しないタイミングで本番スキーマに影響しうるパイプラインになっている点は将来的な留意事項。

### 注意点

1. **翌朝の確認が実装完了の必須条件**。
   本作業では実データによる記録確認が未了。2026-07-24 朝の日次バッチ後に以下を確認し、想定と異なれば追加調査が必要:
   ```sql
   -- 新規記録に thinking_tokens が入っているか
   SELECT
     DATE(created_at AT TIME ZONE 'Asia/Tokyo') AS jst_date,
     system,
     COUNT(*)                                   AS n,
     COUNT(thinking_tokens)                     AS n_with_thinking,
     AVG(thinking_tokens)::int                  AS avg_thinking,
     AVG(NULLIF(output_tokens, 0))::int         AS avg_output,
     ROUND(AVG(thinking_tokens::float / NULLIF(output_tokens, 0))::numeric, 2) AS ratio,
     SUM(estimated_cost_jpy)::int               AS total_jpy
   FROM ai_usage_logs
   WHERE created_at >= NOW() - INTERVAL '24 hours'
   GROUP BY 1, 2
   ORDER BY 1, 2;
   ```

2. **記録費用が3倍以上に見えるようになる**。現行ダッシュボード・レポートで「日次 ¥449 → ¥1,400 前後」に増えて見えるが、
   これは**外部請求と一致する正しい値**（従来が過小評価だった）。CA・代表への伝達が必要。

3. **thinking の削減判断は別タスク**。将幸さん方針は「まず見える化・その上でジャッジ」。
   本タスクでは `thinkingConfig` / `thinkingBudget` を触っていない（＝ 2026-07-23 以前と挙動同一）。
   翌朝の実データを見て、`job-structuring` の thinking が過剰と判断した場合に別タスクで検討。
