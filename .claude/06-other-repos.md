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

### ⚠️ SSoT 同期警告: flags.ts ↔ candidate-flags.ts

candidate-intake `src/constants/flags.ts` と portal `src/constants/candidate-flags.ts` は**同一内容の独立コピー**。
片方だけ更新すると AI 解析結果と UI 選択肢が乖離する。

**更新時の必須手順**:
1. FLAG_DEFINITIONS の enum 配列を両ファイルで同一に揃える
2. FLAG_LIST_TSV の該当行も両ファイルで同時更新する（Gemini プロンプトに TSV が直接渡されるため）
3. candidate-intake は master push でデプロイ、portal も master push でデプロイ（本番＝master ブランチ）— 両方デプロイして初めて同期完了

**関連ケース**: T-051 Step 2（2026/5/10）で 4 フラグ + 6 TSV行を両ファイル同時更新

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

## daily-report-advisor skill（日報AI・T-069③）

日報AIアシスト用スキル。portal リポジトリ内に新設（Claude.ai プロジェクトには無い・portal専用）。
- パス: `src/skills/daily-report-advisor/SKILL.md`（references なし）。ローダ `src/lib/load-daily-report-skill.ts:getDailyReportSkill()`（`getJobMatchingSkill` 同型・モジュールキャッシュ）。
- 利用: `POST /api/daily-report/assist`（Claude `claude-sonnet-4-6`）の system に **job-matching-advisor skill と併せて** 注入（cache_control: ephemeral）。
- 役割: CAの所感（■1〜■6）＋当日集計を受け、6項目構造を保った整理本文＋上司視点アドバイス。数字は集計値のみ（捏造禁止）。BM目安＝支援中(ACTIVE)求職者数×0.8〜1.2件/日・選定率80%・エントリー率70%。

## job-matching-skill

CA求人マッチングスキル。Claude.ai プロジェクトと bizstudio-portal の両方で使用される。

### 基本情報
- 開発用ローカルパス: `C:\claude\skill\`（Claude.ai プロジェクトに登録するスキルの編集用）
- portal リポジトリ内コピー: `src/skills/job-matching-advisor/SKILL.md` + `src/skills/job-matching-advisor/references/middle-career.md`
- 構成: SKILL.md + references/middle-career.md + data/cases/

### 利用箇所
1. Claude.ai プロジェクト `job-matching-advisor` スキル（個人開発時のClaude会話で使用）
2. bizstudio-portal の AIアドバイザー チャット API（`src/app/api/candidates/[candidateId]/advisor/sessions/[sessionId]/messages/route.ts`）
3. bizstudio-portal の全件分析 API（`src/app/api/candidates/[candidateId]/bookmarks/analyze-batch/route.ts`）
4. bizstudio-portal の挨拶文生成 API は SKILL.md を使用しない（関連性低のため対象外）

### 読み込みヘルパー
- `src/lib/load-job-matching-skill.ts` — `getJobMatchingSkill()` でモジュールロード時1回だけ `fs.readFileSync`、メモリにキャッシュ
- SKILL.md と references/middle-career.md を結合して返す（references は付録として末尾に追加）

### 反映フロー
1. `C:\claude\skill\` で SKILL.md を編集
2. Claude.ai プロジェクトの「置き換え」操作で更新
3. portal リポジトリの `src/skills/job-matching-advisor/SKILL.md`（および references/middle-career.md）に同内容をコピー
4. portal で commit → master push で本番反映（検証が必要な場合のみ staging へ merge）
5. AIアドバイザーのチャット履歴をクリアして検証（過去履歴の few-shot 汚染を回避、詳細は `12-pitfalls.md` 参照）
6. 更新頻度: 1〜2ヶ月に1回程度（エントリー実績の蓄積に応じて）

### 主要機能
- 7-phase CA matching framework
- 6タイプ志向性分析
- ABCDマトリックスによるマッチング評価
- 検索戦略・面談テクニック
- 実績データに基づく予測精度（2026年4月時点で本人希望ランクの方向性確認済み）

### 関連
- 12-pitfalls.md の罠「SKILL.md の更新は2箇所への反映が必要」「SKILL.md 更新後はチャット履歴クリアが必要」を必ず参照
- T-056 で portal への SKILL.md 反映の仕組みを構築（2026/5/14）
