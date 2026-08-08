# T-135 AI費用帳簿① 基盤＋portal計装（完了報告）

- 日付: 2026-07-13
- コミット: `eb10e60`
- Railway 本番（bizstudio-portal）: **SUCCESS**
- 対象: bizstudio-portal（②kyuujin・③job-platform は本タスクの成果物を使って別途計装）

## 背景

費用調査Aで、Gemini 月次 ¥32K のうち **65%（約 ¥21K）が kyuujin/portal 側**で発生しているのに、
これらのシステムが AI 使用量を一切記録しておらず「何に・いくら」が事後に特定できないと判明した。
本タスクはその記録基盤（帳簿・共通受け口・単価表）と、portal 自身の全 Gemini 呼び出しの計装。

方針（確定事項）:
- **今後の記録のみ**。過去分の遡及推定はしない。
- 記録自体は AI を呼ばない（費用増ゼロ）。
- **記録失敗が本処理を止めない**（fire-and-forget / try-catch 隔離）。

---

## 1. AiUsageLog スキーマ

migration: `prisma/migrations/20260713120000_t135_ai_usage_log/`（**追加のみ**・既存テーブル無変更）

| カラム | 型 | 内容 |
|---|---|---|
| `id` | String (cuid) | PK |
| `createdAt` | DateTime | 記録時刻 |
| `system` | String | `portal` / `kyuujin` / `job-platform` |
| `endpoint` | String | 処理の識別子（自由文字列）。`resume-parse` / `job-structuring` 等 |
| `model` | String | 実際に API へ投げたモデルID。単価表のキー |
| `inputTokens` | Int? | **非キャッシュ**入力トークン |
| `outputTokens` | Int? | 出力トークン |
| `cachedInputTokens` | Int? | キャッシュヒットした入力トークン |
| `estimatedCostJpy` | Decimal(12,6)? | 推定費用（円）。単価未登録モデルは **null**（後から単価を足せば再計算可能） |
| `meta` | Json? | 付帯情報（candidateId・件数・finishReason 等） |

インデックス: `[createdAt]` / `[system, createdAt]` / `[system, endpoint, createdAt]`

既存の `AdvisorUsageLog`（T-126）は**残置**する。あれは portal のアドバイザー系 Anthropic 専用で
既存レポート（`scripts/advisor-usage-report.ts`）が依存しているため。`diagnosis-extract` のみ両方に入る。

---

## 2. 記録受け口の仕様（②③はこれを叩く）

```
POST https://bizstudio-portal-production.up.railway.app/api/internal/ai-usage
Header: x-api-key: <INTERNAL_API_KEY>     ← 既存 internal API と同一鍵（Railway 環境変数に既存）
        content-type: application/json
```

body:

```json
{
  "system": "kyuujin",            // 必須: portal | kyuujin | job-platform
  "endpoint": "job-structuring",  // 必須: 処理の識別子（自由文字列）
  "model": "gemini-2.5-flash",    // 必須: 実際に投げたモデルID
  "inputTokens": 12345,           // 任意: 非キャッシュ入力
  "outputTokens": 678,            // 任意
  "cachedInputTokens": 0,         // 任意: キャッシュヒット分
  "meta": { "jobId": 123 }        // 任意: 何でも
}
```

レスポンス:

| status | body | 意味 |
|---|---|---|
| 200 | `{"ok":true,"knownModel":true}` | 記録成功 |
| 200 | `{"ok":true,"knownModel":false}` | 記録したが**単価表に無いモデル**（費用 null）。単価追加が必要 |
| 400 | `{"ok":false,"error":"..."}` | body 不正（記録せず・副作用なし） |
| 401 | `{"ok":false,"error":"Unauthorized"}` | 認証NG |
| 500 | `{"ok":false,"error":"..."}` | 記録失敗（副作用なし） |

**呼び出し側の鉄則**: この API の失敗で本処理を止めないこと（`await` しない、または try-catch で握り潰す）。

### Gemini の usageMetadata を渡すときの注意（重要）

Gemini の `promptTokenCount` は**キャッシュヒット分を含んだ総入力**。単価が違うので、
`cachedContentTokenCount` を差し引いて渡すこと:

```
inputTokens       = promptTokenCount - cachedContentTokenCount
outputTokens      = candidatesTokenCount
cachedInputTokens = cachedContentTokenCount
```

portal 内ではこの正規化を `recordGeminiUsage()`（`src/lib/ai-usage.ts`）が吸収している。

---

## 3. 単価表（`src/lib/ai-pricing.ts`）

出典: Gemini API 公式料金ページ https://ai.google.dev/gemini-api/docs/pricing （2026-07-13 確認・Paid tier / text 系）
換算レート: **1 USD = ¥160**（`USD_TO_JPY` で1箇所定義）

| モデル | input $/1M | output $/1M | cached input $/1M |
|---|---|---|---|
| **gemini-3-flash-preview** | **0.50** | **3.00** | 0.05 |
| gemini-2.5-flash | 0.30 | 2.50 | 0.03 |
| gemini-2.5-flash-lite | 0.10 | 0.40 | 0.01 |
| gemini-2.5-pro | 1.25 | 10.00 | 0.125 |
| gemini-2.0-flash | 0.10 | 0.40 | 0.025 |
| claude-opus-4-6 | 5 | 25 | 0.5 |
| claude-sonnet-4-6 | 3 | 15 | 0.3 |
| claude-haiku-4-5 | 1 | 5 | 0.1 |

### ⚠️ 発見: 既存の単価が誤っていた

portal の主力モデルは `gemini-3-flash-preview` だが、既存の `src/lib/claude.ts` の
`MODEL_PRICING_PER_MTOK` はこれに **input 0.3 / output 2.5**（= 2.5 Flash の単価）を当てていた。
公式の 3 Flash は **input 0.5 / output 3.0** で、**入力1.67倍・出力1.2倍の過小評価**だった。
本帳簿は正しい単価を使う。既存 AdvisorUsageLog の `costUsd` は旧単価のままなので、
両者の数字を比較するときは注意（本帳簿が正）。

単価表に無いモデルは費用 `null` で記録され、後から単価を足して再計算できる（記録は落とさない）。

---

## 4. portal 計装したエンドポイント一覧

Gemini を叩く **10ファイル・14コールサイト**を全て計装。加えて画像OCRの Anthropic 1箇所も同じ帳簿へ。

| # | endpoint | 実装箇所 | モデル | 備考 |
|---|---|---|---|---|
| 1 | `interview-analyze` | `api/interviews/analyze/route.ts` | 3-flash-preview | **1リクエストで最大3コール**（本体＋退職理由2パス目＋職歴2パス目）。`meta.pass` で区別 |
| 2 | `diagnosis-extract` | `lib/advisor/diagnosis-extract.ts` | 3-flash-preview | AdvisorUsageLog にも従来どおり記録（非回帰） |
| 3 | `schedule-agent-extract` | `lib/schedule-agent/extract-message.ts` | 3-flash-preview | |
| 4 | `ai-health-ping` | `api/ai/health/route.ts` | 3-flash-preview | 疎通確認 |
| 5 | `resume-parse` | `lib/gemini-resume-parser.ts` | 3-flash-preview | マイナビRPA (`rpa/mynavi/pdf-upload`) から |
| 6 | `candidate-resume-parse` | `api/candidates/parse-resume/route.ts` | 3-flash-preview | 求職者新規登録モーダル |
| 7 | **`file-parse`** | `lib/file-parser.ts` | 3-flash-preview / haiku | **後述の主要な穴** |
| 8 | `employee-resume-parse` | `lib/employee-resume-parser.ts` | 3-flash-preview | 社員履歴書 |
| 9 | `interview-organize` | `api/candidates/[id]/interviews/ai-organize/route.ts` | **2.0-flash** | |
| 10 | `task-organize` | `api/tasks/ai-organize/route.ts` | **2.0-flash** | |
| 11 | `guide-axis` | `api/guides/generate-axis/route.ts` | 3-flash-preview | |
| 12 | `guide-resume-parse` | `api/guides/parse-resume/route.ts` | 3-flash-preview | |
| 13 | `announcement-format` | `api/admin/announcements/ai-format/route.ts` | **2.0-flash** | |

### `file-parse` — 調査Aで見えていなかった主要な穴

`lib/file-parser.ts` の OCR は、**アドバイザー系フロー（advisor-context / greeting / チャット添付 /
analyze-batch）から添付ファイルごとに呼ばれる**。特に `advisor-context.ts` は候補者の主要書類を
**最大4ファイル、アドバイザー呼び出しのたびに毎回** OCR する。

呼び出し元はこれまで **Anthropic のコストしか記録していなかった**ため、この Gemini 費用は
帳簿上まったく存在しなかった。今回 `meta.candidateId` と `meta.caller`
（`advisor-context` / `advisor-greeting` / `advisor-chat-attachment`）を付けて記録するようにしたので、
**どの候補者のどのフローで何回 OCR が走っているか**が1週間の観測で分かる。ここが高コストの
有力候補と見ている。

### 計装漏れを防ぐ構造

`src/lib/ai/gemini-client.ts` は `log: { endpoint }` パラメータを受け取り、**内部で自動記録する**。
このクライアント経由の呼び出しは記録が保証される（新規呼び出しで `log` を付け忘れない限り）。
直 fetch している箇所は各々に `recordGeminiUsage()` を差し込んだ。

**変更禁止ファイル `src/services/geminiClient.ts` はリポジトリに存在しない**（`src/services/` ディレクトリ自体が無い）ため、抵触なし。

### 記録タイミングの設計判断（重要）

usage の記録は**応答の検証より前**に行う。空 candidates（safety ブロック / thinking トークンによる
`MAX_TOKENS` 枯渇）でも**入力トークンは課金される**ため、throw してから記録すると「見えない費用」が
残るからである。実際、動作確認で `/api/ai/health` の ping が `finishReason=MAX_TOKENS`・出力0トークンで
**失敗しているのに入力27トークン分は課金されている**ことが記録から判明した（既存の不具合。
`maxOutputTokens: 100` が thinking トークンに食われている。本タスクの範囲外だが要修正）。

---

## 5. 動作確認（6点すべて実施・本番）

| # | 内容 | 結果 |
|---|---|---|
| 1 | 認証付きサンプルPOST → 記録＋費用算出 | ✅ HTTP 200。`gemini-2.5-flash` / in 1,000,000・out 100,000・cached 200,000 → **¥88.96**。手計算 `(1.0×0.30 + 0.1×2.50 + 0.2×0.03) × 160 = ¥88.96` と一致 |
| 2 | 認証なしPOST | ✅ **401** `{"ok":false,"error":"Unauthorized"}` |
| 2b | body 不正（`system: "bogus"`） | ✅ **400**・記録件数が増えない（副作用なし） |
| 2c | 単価表に無いモデル | ✅ 200 `{"knownModel":false}`・費用 **null** で記録（後から再計算可能） |
| 3 | portal の実 Gemini 機能を実行 | ✅ `/api/ai/health` → `system=portal` / `endpoint=ai-health-ping` / `gemini-3-flash-preview` / in=27 / ¥0.00216<br>✅ `/api/guides/generate-axis` → `endpoint=guide-axis` / **in=1214 out=796** / **¥0.4792**（単価表どおり・出力トークンを伴う実コールも正しく計上） |
| 4 | 記録が失敗しても本処理が完走するか | ✅ 不正な create を故意に起こしても例外を投げず `false` を返す（try-catch 隔離）。実運用の証跡として `/api/ai/health` は記録が入る前に HTTP 200 を返している（`await` していない＝本処理を待たせない） |
| 5 | 未計装の Gemini 呼び出しが残っていないか | ✅ `generativelanguage.googleapis.com` を含む src/ 内 **10ファイル全てに記録あり**（grep で確認）。gemini-client 経由の **4呼び出し元・6コールサイト全てに `log:` あり** |
| 6 | テストデータ掃除 | ✅ 合成POST 2行を削除。実コール2行（実際に課金が発生した本物）は帳簿の正確性のため残置 |

---

## 6. ②kyuujin・③job-platform への引き継ぎ

### 各システムから叩く手順

1. **環境変数**を追加（両システムとも）:
   - `PORTAL_INTERNAL_API_URL` = `https://bizstudio-portal-production.up.railway.app`
   - `PORTAL_INTERNAL_API_KEY` = portal の `INTERNAL_API_KEY` と**同じ値**
     （Railway `bizstudio-portal` の環境変数から取得。job-platform には既に
     `PORTAL_INTERNAL_API_KEY` が Vercel に設定済み — 求職者選択モードで使用中）

2. **記録ヘルパを作る**（各システムに1つ）。必ず fire-and-forget にする:

```ts
// 例（TypeScript / job-platform 側）
async function recordAiUsage(p: {
  endpoint: string; model: string;
  inputTokens?: number; outputTokens?: number; cachedInputTokens?: number;
  meta?: Record<string, unknown>;
}) {
  try {
    void fetch(`${process.env.PORTAL_INTERNAL_API_URL}/api/internal/ai-usage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.PORTAL_INTERNAL_API_KEY! },
      body: JSON.stringify({ system: "job-platform", ...p }),
    }).catch(() => {});   // ← 失敗は握り潰す。本処理を絶対に止めない
  } catch { /* 無視 */ }
}
```

kyuujin は Python（FastAPI）なので `httpx` で同等のものを作り、
`system: "kyuujin"` を付ける。**同期で await せず、失敗を握り潰すこと**。

3. **Gemini レスポンスの usageMetadata を正規化して渡す**（前述）:
   `inputTokens = promptTokenCount - cachedContentTokenCount`

4. **記録は応答検証より前**に置く（空応答でも入力は課金されるため）。

5. `endpoint` 名は処理が識別できるものにする。想定:
   - kyuujin: `pdf-vision-extract` / `job-structuring` / `mypage-*` など
   - job-platform: `job-structuring`（daily-ingest の Gemini 抽出）/ `list-fee-parse` など

6. **モデルIDが単価表に無いと費用が null になる**。レスポンスの `knownModel: false` で気付けるので、
   その場合は `src/lib/ai-pricing.ts` の `AI_MODEL_PRICING` にモデルを追加すること（portal 側で1行追加＋デプロイ）。

### 1週間の観測後の集計

```sql
-- system × endpoint 別の費用
SELECT system, endpoint, COUNT(*) AS calls,
       SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok,
       ROUND(SUM(estimated_cost_jpy), 2) AS jpy
FROM ai_usage_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY system, endpoint
ORDER BY jpy DESC NULLS LAST;
```

`meta` に candidateId / caller が入っているので、`file-parse` の内訳（どの候補者・どのフローで
何回 OCR したか）まで掘れる。
