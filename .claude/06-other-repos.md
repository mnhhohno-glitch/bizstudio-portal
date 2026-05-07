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

### generate_form API の per-company 対応（T-035）

候補者単位の単一 `achievementCategory` だけでなく、会社別 `companyCategoryMap` を受け取って per-company にテンプレ展開できる。

#### 入力

```typescript
type GenerateFormInput = {
  candidateId: string;
  candidateName: string;
  resumeData: ResumeData;
  interviewLog: string;
  achievementCategory: string;                    // デフォルトカテゴリ（必須）
  achievementCategoryOtherLabel: string | null;   // "other" 自由記述（グローバル 1 つ）
  companyCategoryMap?: Record<string, string>;    // T-035 追加（optional）
};
```

#### companyCategoryMap の挙動

- キー: work_history 配列インデックスの文字列（例: `"0"`, `"1"`, `"2"`）
- 値: サブカテゴリコード（例: `"sales_corporate"`, `"office_general"`, `"other"`）
- undefined / `{}` / 該当キー無し → `achievementCategory`（default）にフォールバック
- `mindset_section` は会社単位ではなく defaultCategory（`achievementCategory`）を流用
- `"other"` の自由記述はグローバル `achievementCategoryOtherLabel` を共有

#### 後方互換性

`companyCategoryMap` 未指定時は T-029 Phase D-2 と完全に同じ出力。
portal モーダルが Phase 4 で更新されたため、現在は常に `companyCategoryMap` が送信される運用だが、API 側で旧形式互換を維持。

#### 関連コミット

- candidate-intake staging: 3a0a5b4
- portal master: fdb20a9

### generate_form のサブカテゴリ管理

- 管理ファイル: candidate-intake の `specs/generate_form_prompt.yaml`
- 構造: `target_subcategories` リスト + `subcategories` セクション（各サブカテゴリは `duties_choices` / `mindset_choices` / `kpi_questions` を持つ）
- `kpi_questions` の type 値: `short_text` / `long_text`
- portal 側との連携: `bizstudio-portal/src/constants/google-form-categories.ts` の SERVICE 等カテゴリ定数とサブカテゴリコードを揃える必要あり
- 新サブカテゴリ追加時の影響範囲: candidate-intake YAML + bizstudio-portal `google-form-categories.ts` の **両方を同期更新**

#### サブカテゴリ追加履歴

- 2026/5/8 (T-036): `service_ground_staff`（空港グランドスタッフ）を SERVICE グループに追加

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
