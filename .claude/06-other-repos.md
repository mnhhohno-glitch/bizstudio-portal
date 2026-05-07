# 06. その他のリポジトリ仕様

## candidate-intake

面談ログ・PDFからの AI 解析エンジン。TypeScript / Gemini API / Glitch。

### 変更禁止ファイル
- `specs/`配下
- `scripts/gas/`配下
- `src/services/loadSpec.ts`
- `src/services/geminiClient.ts`

### 重要な仕様
- portal の `src/constants/candidate-flags.ts` と AI解析の選択肢が連動
- PDF Vision フォールバック実装（閾値200文字未満で起動）

### portal → candidate-intake の連携パターン

#### 既存パターン: analyze-with-intake/route.ts

ファイル: `src/app/api/interviews/[id]/analyze-with-intake/route.ts`

- 認証: `x-portal-secret` ヘッダー + 環境変数 `PORTAL_SHARED_SECRET`
- URL フォールバック: `CANDIDATE_INTAKE_URL` → `NEXT_PUBLIC_CANDIDATE_INTAKE_URL` → ハードコード production URL
- 送信形式: JSON + base64 PDF（**Supabase Storage** から取得）
- エンドポイント: `POST {INTAKE_URL}/api/portal/analyze-interview`

#### Phase D-2 新規パターン: google-form/* 3 endpoint

ファイル:
- `src/app/api/candidates/[candidateId]/google-form/extract-resume/route.ts`（multipart/form-data）
- `src/app/api/candidates/[candidateId]/google-form/generate-form/route.ts`（JSON）
- `src/app/api/candidates/[candidateId]/google-form/create-form/route.ts`（JSON + InterviewRecord 永続化）

特徴:
- 認証: 既存パターン踏襲（`x-portal-secret`）
- 入力ファイル取得元: **CandidateFile（Google Drive）** ← 既存 analyze-with-intake の Supabase とは別系統
- extract-resume だけ multipart/form-data（candidate-intake 側の仕様、`create_form_v2` / `generate_form` は JSON）
- create-form は成功時に InterviewRecord（isLatest=true）に `google_form_*` を update
- 関連: `12-pitfalls.md` 罠ポイント #28（extract_resume の multipart 必須）

## ai-resume-generator

履歴書・職務経歴書の自動生成。TypeScript / Gemini / LibreOffice。

## bizstudio-website

コーポレートサイト。Astro / Vercel / bizstudio.co.jp。

## bizstudio-finance

経理・会計システム。Railway。Phase 1-2 完了。

## scout-scheduler

日程調整アプリ。Vercel / schedule.bizstudio.co.jp。

## offerbox-scout-generator

OfferBox スカウト文章生成。Railway。master 直 push。
