# Phase 4b 実施レポート

実施日: 2026-04-19
ブランチ: staging

## 1. 実施内容サマリー

既存の面談AI解析APIをPhase 2のコアライブラリ（gemini-client, load-spec, flag-list-schema, extract-text）に統合し、添付ファイル管理APIを新規作成。

## 2. 改修した既存APIファイル（1ファイル）

| ファイル | 変更内容 |
|---|---|
| `src/app/api/interviews/analyze/route.ts` | Phase 2ライブラリに全面置き換え。ハードコードプロンプト→YAML spec、直接fetch→gemini-client.ts、JSON手動パース→parseJsonResponse。2パスロジック（退職理由・職歴）完全移植。DB保存（aiAnalysisResult/aiAnalysisAt）対応 |

## 3. 新規作成したAPIファイル（3ファイル）

| ファイル | メソッド | エンドポイント | 機能 |
|---|---|---|---|
| `src/app/api/interviews/[id]/attachments/route.ts` | GET/POST | `/api/interviews/:id/attachments` | 添付ファイル一覧/アップロード（Supabase Storage） |
| `src/app/api/interviews/[id]/attachments/[attachmentId]/route.ts` | GET/PATCH/DELETE | `/api/interviews/:id/attachments/:attachmentId` | 添付ファイル詳細/メモ更新/削除 |
| `src/app/api/interviews/[id]/attachments/[attachmentId]/analyze/route.ts` | POST | `/api/interviews/:id/attachments/:attachmentId/analyze` | 添付ファイルAI解析 |

## 4. API仕様サマリー

### 面談AI解析API (`POST /api/interviews/analyze`)

- candidate-intakeの361行パイプラインを完全移植
- Phase 2ライブラリ使用: `gemini-client.ts`, `load-spec.ts`, `flag-list-schema.ts`, `extract-text.ts`
- 入力: FormData (`resumePdf`, `transcript`/`interviewLog`, `interviewRecordId`)
- 処理フロー:
  1. PDF テキスト抽出 (`extractTextFromPdf`)
  2. プロンプト構築 (`buildCommonAnalysisPrompt` + `FLAG_LIST_TSV`)
  3. レスポンススキーマ生成 (`buildCommonAnalysisResponseSchema`)
  4. Gemini API呼び出し + リトライ（MAX_RETRIES=2、スキーマフォールバック対応）
  5. レスポンス正規化 (`adaptGeminiResponseToCommonAnalysis`)
  6. 2パス条件分岐:
     - 退職理由が空 → 再抽出パス
     - 職歴が空 → 職歴再抽出パス
  7. InterviewRecord.aiAnalysisResult/aiAnalysisAt に保存

### 添付ファイルアップロードAPI (`POST /api/interviews/:id/attachments`)

- Supabase Storage `interview-attachments` バケット使用
- 最大20MB、許可MIME: PDF/画像/Word/Excel/CSV/テキスト
- ストレージパス: `interviews/{recordId}/{uuid}.{ext}`
- InterviewAttachment テーブルにメタデータ保存

### 添付ファイル操作API (`/api/interviews/:id/attachments/:attachmentId`)

- GET: メタデータ取得
- PATCH: メモ更新
- DELETE: Supabase Storage + DB 両方から削除

### 添付ファイルAI解析API (`POST /api/interviews/:id/attachments/:attachmentId/analyze`)

- Supabase Storageからファイルダウンロード
- ファイル種類に応じたテキスト抽出:
  - PDF → `extractTextFromPdf`
  - XLSX → `extractTextFromXlsx`
  - テキスト/CSV → UTF-8デコード
  - 画像 → ファイル名表示（将来OCR拡張可能）
- `buildStructuredExtractPrompt` でプロンプト構築
- 解析結果をInterviewAttachment.analysisResult/analysisStatus/analyzedAt に保存
- ステータス管理: pending → processing → completed/failed

## 5. ビルド結果

- `npm run build`: **成功**
- コンパイル時間: 21.0秒
- 新ルート: +3（attachments, attachments/[id], attachments/[id]/analyze）
- 既存ルート: analyze は改修のみ（ルート数変化なし）

## 6. 既存への影響

- Prisma スキーマ: **変更なし**
- InterviewDetail / InterviewRating: **変更なし**
- 既存UI: **変更なし**
- Phase 2ライブラリ (gemini-client, load-spec, flag-list-schema, extract-text): **読み取り専用使用、変更なし**
- プロンプトYAML / flags.ts: **変更なし**
- Geminiモデル名: **変更なし** (`gemini-3-flash-preview`)

## 7. 次のフェーズ

### Phase 5: 統合UI実装
- 面談記録画面にAI解析実行ボタン追加
- 添付ファイルアップロード/管理UI
- 解析結果の表示・InterviewDetail自動入力
- メモ管理UI（面談メモ・求職者メモ）
