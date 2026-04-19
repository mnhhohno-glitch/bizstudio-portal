# Phase 2 実施レポート

実施日: 2026-04-19
ブランチ: staging

## 1. 実施内容サマリー

candidate-intake のコアライブラリを bizstudio-portal に移植。AI解析基盤の設置のみで、既存機能には一切影響なし。

## 2. 配置されたファイル一覧

### src/constants/
- `candidate-flags.ts` (756行) — フラグ定義・FileMakerマッピング・TSV生成

### src/lib/ai/
- `gemini-client.ts` (180行) — Gemini API クライアント (gemini-3-flash-preview)
- `load-spec.ts` (330行) — YAMLプロンプト読み込み・変数展開
- `flag-list-schema.ts` (264行) — レスポンスJSONスキーマ生成
- `extract-text.ts` (110行) — PDF テキスト抽出 (pdf-parse)
- `extract-text-pdfjs.ts` (107行) — PDF テキスト抽出 (pdfjs-dist)
- `extract-text-pdf-ocr.ts` (113行) — PDF OCR抽出 (tesseract.js)
- `pdf-to-images.ts` (100行) — PDF→画像変換 (canvas)

### src/lib/ai/specs/
- `01_common_analysis_prompt.yaml` (161行)
- `02_google_form_prompt.yaml` (36行)
- `03_filemaker_excel_prompt.yaml` (167行)
- `04_hearing_question_text_prompt.yaml` (287行)
- `05_structured_extract_prompt.yaml` (29行)
- `06_achievement_category_followup.yaml` (156行)
- `インポートExcelプロンプト_正本.yaml` (108行)

### src/types/ai/
- `common-analysis.ts` (41行) — 共通解析結果型
- `excel-export.ts` (16行) — Excelエクスポート型
- `google-form.ts` (21行) — Google Form型

### src/types/
- `pdf-parse.d.ts` (4行) — pdf-parse モジュール型定義

### src/app/api/ai/
- `health/route.ts` (58行) — ヘルスチェックエンドポイント

### public/ai/
- `jpn.traineddata` (29,010行/約2.9MB) — Tesseract OCR 日本語学習データ

## 3. 追加された依存関係

### dependencies
- `@napi-rs/canvas`: ^0.1.99
- `canvas`: ^3.2.3
- `js-yaml`: ^4.1.1
- `pdf-parse`: ^1.1.1
- `pdfjs-dist`: ^5.6.205
- `tesseract.js`: ^7.0.0

### devDependencies
- `@types/js-yaml`: ^4.0.9

### 既存で維持（Phase 2では追加していない）
- `@anthropic-ai/sdk`, `openai`, `xlsx`, `exceljs` — 既存機能で使用中のため変更なし

## 4. next.config.ts の変更

```typescript
serverExternalPackages: ["@napi-rs/canvas", "canvas", "tesseract.js", "pdfjs-dist"]
```

Node.js ネイティブモジュールをサーバーサイドのみで動作させるための設定。

## 5. 動作検証結果

### ビルド
- `npm run build`: **成功**
- コンパイル時間: 18.0秒
- 全134ページ生成完了

### ヘルスチェック (/api/ai/health)

```json
{
  "ok": true,
  "phase": "Phase 2: Core library installed",
  "timestamp": "2026-04-19T13:26:56.469Z",
  "checks": {
    "geminiApiKey": true,
    "flagDefinitionsCount": 26,
    "filemakerMappingKeysCount": 64,
    "flagListTsvLength": 32196,
    "responseSchemaBuilt": true,
    "responseSchemaHasProperties": true,
    "commonAnalysisPromptLoaded": true,
    "geminiApiPingSuccess": true,
    "geminiApiResponsePreview": "Here is the"
  }
}
```

## 6. 既知の問題・懸念点

- `pdf-parse` の `Buffer()` 非推奨警告がビルド時に表示される（動作には影響なし）
- `flagDefinitionsCount` が26（元リポジトリの実際の値。仕様書の「約30」との差は定義数の違い）
- `filemakerMappingKeysCount` が64（仕様書の67との差は元リポジトリの実際のマッピング数）

## 7. Railway staging 環境変数設定依頼

将幸さんへのお願い：

Railway の bizstudio-portal-staging 環境変数に以下を追加してください：

- `GEMINI_API_KEY` = （candidate-intake と同じ値）

設定後、stagingデプロイを待ってから以下URLで動作確認：

```
https://bizstudio-portal-staging-production.up.railway.app/api/ai/health
```

## 8. 次のフェーズ

Phase 3: Prisma スキーマ拡張（InterviewRecord / InterviewAttachment / CandidateProfile）
