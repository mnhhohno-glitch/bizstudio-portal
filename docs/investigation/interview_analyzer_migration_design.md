# candidate-intake 解析ロジック移植 方式検討レポート

**調査日:** 2026-04-21
**調査者:** Claude Opus 4.6

---

## 1. candidate-intake 解析ロジックの構造分析

### プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | Next.js 16.1.6, React 19.2.3, TypeScript 5 |
| リポジトリ | `C:\bizstudio\modules\candidate-intake` |
| AIモデル | `gemini-3-flash-preview`（REST API直接呼び出し、SDK未使用） |
| PDF処理 | pdf-parse → pdfjs-dist → tesseract.js (Japanese OCR) の3段階フォールバック |
| Excel出力 | ExcelJS 4.4.0 |

### ファイル構成

| ファイル | 役割 |
|---------|------|
| `specs/01_common_analysis_prompt.yaml` | メイン解析プロンプト（PDF+面談ログ→構造化JSON） |
| `specs/02_google_form_prompt.yaml` | 不足項目のGoogleフォーム質問生成 |
| `specs/03_filemaker_excel_prompt.yaml` | Excel出力用の2シート変換プロンプト |
| `specs/04_hearing_question_text_prompt.yaml` | フォローアップ質問テキスト生成 |
| `specs/05_structured_extract_prompt.yaml` | 学歴・資格・住所の機械的抽出 |
| `specs/06_achievement_category_followup.yaml` | 職種別実績質問 |
| `specs/インポートExcelプロンプト_正本.yaml` | Excel入力仕様 |
| `src/services/geminiClient.ts` | Gemini API呼び出し（fetch直接、温度0.1/0.2） |
| `src/services/extractText.ts` | PDF→テキスト抽出（3段階フォールバック） |
| `src/services/excelBuilder.ts` | ExcelJS でXLSX生成 |
| `src/constants/flags.ts` | フラグ定義の Single Source of Truth（全64カラム名＋全選択肢enum） |
| `src/services/flagListSchema.ts` | JSON Schema バリデーション（flags.tsから自動生成） |

### 解析フロー（マルチパス）

```
入力: PDF履歴書 + 面談ログ(.txt) + フラグリスト
    ↓
[Pass 1] 01_common_analysis（温度0.1）
  → analysis_thought（推論過程）
  → extracted_facts（構造化データ）
  → filemaker_mapping（64カラム値）
  → missing_items（不足項目）
    ↓
[Pass 2] 退職理由リトライ（Pass 1で空の場合のみ）
    ↓
[並列] → Googleフォーム質問 / Excel出力JSON / ヒアリング質問テキスト
    ↓
Excel (.xlsx) ダウンロード
```

### 依存パッケージ（移植対象）

- Gemini API: `fetch` 直接呼び出し（SDKなし）
- PDF: `pdf-parse`, `pdfjs-dist`, `tesseract.js`
- YAML: `js-yaml`（プロンプト読み込み）
- Excel: `exceljs`
- 画像変換: `@napi-rs/canvas`, `canvas`（PDF→画像、OCR用）

---

## 2. Portal InterviewForm とのカラムマッピング

### 基本情報シート（64列）→ InterviewDetail フィールド

| # | Excel カラム | Portal InterviewDetail フィールド | 状況 |
|---|------------|----------------------------------|------|
| 1 | エージェント利用フラグ | `agentUsageFlag` | ✅ 一致 |
| 2 | エージェント利用メモ | `agentUsageMemo` | ✅ 一致 |
| 3 | 転職時期フラグ | `jobChangeTimeline` | ✅ 一致 |
| 4 | 転職時期メモ | `jobChangeTimelineMemo` | ✅ 一致 |
| 5 | 転職活動期間フラグ | `activityPeriod` | ✅ 一致 |
| 6 | 転職活動期間メモ | `activityPeriodMemo` | ✅ 一致 |
| 7 | 現在応募求人数 | `currentApplicationCount` | ✅ 一致 |
| 8 | 応募種別フラグ | `applicationTypeFlag` | ✅ 一致 |
| 9 | 応募状況メモ | `applicationMemo` | ✅ 一致 |
| 10 | 学歴フラグ | `educationFlag` | ✅ 一致 |
| 11 | 学歴メモ | `educationMemo` | ✅ 一致 |
| 12 | 卒業年月 | `graduationDate` | ✅ 一致 |
| 13 | 面談メモ | `InterviewRecord.interviewMemo` | ✅ 一致（親モデル） |
| 14 | 希望職種フラグ | `desiredJobType1` | ✅ 一致 |
| 15 | 希望職種メモ | `desiredJobType1Memo` | ✅ 一致 |
| 16 | 希望業種フラグ | `desiredIndustry1` | ✅ 一致 |
| 17 | 希望業種メモ | `desiredIndustry1Memo` | ✅ 一致 |
| 18 | 希望エリアフラグ | `desiredArea` | ✅ 一致 |
| 19 | 希望都道府県 | `desiredPrefecture` | ✅ 一致 |
| 20 | 希望市区 | `desiredCity` | ✅ 一致 |
| 21 | 希望エリアメモ | `desiredAreaMemo` | ✅ 一致 |
| 22 | 現在年収 | `currentSalary` | ✅ 一致 |
| 23 | 希望下限年収 | `desiredSalaryMin` | ✅ 一致 |
| 24 | 希望年収 | `desiredSalaryMax` | ✅ 一致 |
| 25 | 現年収メモ | `currentSalaryMemo` | ✅ 一致 |
| 26 | 下限年収メモ | `desiredSalaryMinMemo` | ✅ 一致 |
| 27 | 希望年収メモ | `desiredSalaryMaxMemo` | ✅ 一致 |
| 28 | 希望曜日フラグ | `desiredDayOff` | ✅ 一致 |
| 29 | 希望曜日メモ | `desiredDayOffMemo` | ✅ 一致 |
| 30 | 希望最大残業フラグ | `desiredOvertimeMax` | ✅ 一致 |
| 31 | 希望最大残業メモ | `desiredOvertimeMemo` | ✅ 一致 |
| 32 | 希望転勤フラグ | `desiredTransfer` | ✅ 一致 |
| 33 | 希望転勤メモ | `desiredTransferMemo` | ✅ 一致 |
| 34 | 自動車免許フラグ | `driverLicenseFlag` | ✅ 一致 |
| 35 | 自動車免許メモ | `driverLicenseMemo` | ✅ 一致 |
| 36 | 語学フラグ | `languageSkillFlag` | ✅ 一致 |
| 37 | 語学スキルフラグ | ※ `languageSkillFlag` に統合？ | ⚠️ 要確認 |
| 38 | 語学スキルメモ | `languageSkillMemo` | ✅ 一致 |
| 39 | 日本語スキルフラグ | `japaneseSkillFlag` | ✅ 一致 |
| 40 | 日本語スキルメモ | `japaneseSkillMemo` | ✅ 一致 |
| 41 | PCスキル_タイピングフラグ | `typingFlag` | ✅ 一致 |
| 42 | PCスキル_タイピングメモ | `typingMemo` | ✅ 一致 |
| 43 | PCスキル_Excelフラグ | `excelFlag` | ✅ 一致 |
| 44 | PCスキル_Excelメモ | `excelMemo` | ✅ 一致 |
| 45 | PCスキル_Wordフラグ | `wordFlag` | ✅ 一致 |
| 46 | PCスキル_Wordメモ | `wordMemo` | ✅ 一致 |
| 47 | PCスキル_PPTフラグ | `pptFlag` | ✅ 一致 |
| 48 | PCスキル_PPTメモ | `pptMemo` | ✅ 一致 |
| 49 | 応募書類状況フラグ | `documentStatusFlag` | ✅ 一致 |
| 50 | 応募書類状況メモ | `documentStatusMemo` | ✅ 一致 |
| 51 | 応募書類サポートフラグ | `documentSupportFlag` | ✅ 一致 |
| 52 | 応募書類サポートメモ | `documentSupportMemo` | ✅ 一致 |
| 53 | LINE設定フラグ | `lineSetupFlag` | ✅ 一致 |
| 54 | LINE設定メモ | `lineSetupMemo` | ✅ 一致 |
| 55 | 求人送付フラグ | `jobReferralFlag` | ✅ 一致 |
| 56 | 求人送付予定時期 | `jobReferralTimeline` | ✅ 一致 |
| 57 | 求人送付メモ | `jobReferralMemo` | ✅ 一致 |
| 58 | 次回面談設定フラグ | `nextInterviewFlag` | ✅ 一致 |
| 59 | 次回面談予定日 | `nextInterviewDate` | ✅ 一致 |
| 60 | 次回面談予定時刻 | `nextInterviewTime` | ✅ 一致 |
| 61 | 次回面談予定メモ | `nextInterviewMemo` | ✅ 一致 |
| 62 | フリーメモ | `freeMemo` | ✅ 一致 |
| 63 | 初回面談まとめ | `initialSummary` | ✅ 一致 |
| 64 | インポート用照合キー | ※ Portal では不要（DB上のリレーションで管理） | ➖ 不要 |

### 職歴シート（12列）→ InterviewDetail フィールド

| # | Excel カラム | Portal InterviewDetail フィールド | 状況 |
|---|------------|----------------------------------|------|
| 1 | 求職者NO | `Candidate.candidateNumber` | ✅ 親モデル |
| 2 | 何社目 | ※Portal は1レコード分のみ | ⚠️ 下記参照 |
| 3 | 企業名 | `companyName` | ✅ 一致 |
| 4 | 事業内容 | `businessContent` | ✅ 一致 |
| 5 | 在籍期間_年 + _ヶ月 | `tenure` | ✅ 一致（結合形式） |
| 6 | 職種フラグ | `jobTypeFlag` | ✅ 一致 |
| 7 | 職種メモ | `jobTypeMemo` | ✅ 一致 |
| 8 | 退職理由_大 | `resignReasonLarge` | ✅ 一致 |
| 9 | 退職理由_中 | `resignReasonMedium` | ✅ 一致 |
| 10 | 退職理由_小 | `resignReasonSmall` | ✅ 一致 |
| 11 | 転職理由メモ | `jobChangeReasonMemo` | ✅ 一致 |

### マッピング結果サマリー

| 分類 | 件数 |
|------|------|
| ✅ 完全一致 | 62/64（基本情報）+ 10/12（職歴） |
| ⚠️ 要確認 | 語学スキルフラグ（#37: 2段階enum → 1フィールド統合の可能性） |
| ➖ Portal不要 | インポート用照合キー（#64）、求職者NO（#1: 親モデルで管理） |
| ⚠️ 構造差異 | 職歴シートは複数行（1社=1行）だが、Portal の InterviewDetail は1レコードに1社分のみ |

### 職歴の構造差異について

**candidate-intake:** 職歴シートは1社=1行、複数社の場合は複数行
**Portal:** InterviewDetail は1レコードに `companyName`, `businessContent`, `tenure`, `jobTypeFlag` 等を1セットのみ保持

**対応策:**
- AI解析時に「直近の職歴（最も重要な1社）」を InterviewDetail に入れ、全職歴は `careerSummary` テキストフィールドに格納
- または AI が `InterviewRecord.summaryText` に全社分の構造化テキストを出力

---

## 3. 4方式の比較

| 項目 | 方式A: 完全移植 | 方式B: API呼び出し | 方式C: npmパッケージ化 | 方式D: 吸収統合 |
|------|----------------|-------------------|---------------------|----------------|
| **概要** | 解析ロジックをPortalにコピー | candidate-intakeにAPIを切ってPortalから呼ぶ | 解析コアをnpmパッケージ化 | candidate-intakeをPortal内ページに統合 |
| **コード重複** | ⚠️ あり（2箇所に同じロジック） | ✅ なし（1箇所） | ✅ なし（パッケージ1箇所） | ✅ なし（統合） |
| **初期作業コスト** | 中（プロンプト+サービス+定数をコピー） | **小**（API 1本追加） | 大（パッケージ切り出し+registry設定） | 大（全機能移植） |
| **保守コスト** | ⚠️ 高（2箇所の同期が必要） | **低**（1箇所だけ更新） | 中（バージョン管理が必要） | **低**（1アプリ） |
| **依存関係** | Portalのみ | Portal + candidate-intake両方稼働必須 | Portal + npmパッケージ | Portalのみ |
| **通信オーバーヘッド** | なし | あり（PDF送信で大きい） | なし | なし |
| **デプロイ** | Portal Railway のみ | 2サービスのデプロイ管理 | Portal + npm publish | Portal Railway のみ |
| **1人開発との相性** | ○ 良い | ◎ 最も良い | △ 管理負荷高い | △ 移植量が多い |
| **段階的移行** | ○ 可能 | ◎ 最も容易 | △ 初期構築が大 | △ 一括移行必要 |
| **将来の拡張** | △ 2箇所メンテ | ◎ 解析ロジック集約 | ◎ 再利用可能 | ○ 1アプリで完結 |

---

## 4. 推奨方式と理由

### 推奨: **方式B（candidate-intake に API エンドポイントを切って Portal から呼び出す）**

### 理由

1. **初期作業コストが最小**
   - candidate-intake には既に `POST /api/intake/analyze` が存在。Portalからのリクエストを受けてJSONを返す処理をそのまま活用できる
   - Portal側は「添付ファイルをPOST → レスポンスJSONをフォームに反映」のUI部分だけ実装すればよい

2. **ロジックの一元管理**
   - プロンプトYAML、フラグ定義、Gemini呼び出しロジックが candidate-intake 内に1箇所だけ
   - 解析精度の改善は candidate-intake だけで完結し、Portal は自動的に恩恵を受ける

3. **1人開発に最適**
   - 方式Cのnpmパッケージ管理や方式Dの全機能移植は、1人開発ではオーバーヘッドが大きい
   - 方式Aのコード重複は保守負荷が高く、片方の改善がもう片方に反映されないリスクがある

4. **既存インフラの活用**
   - candidate-intake は既に Railway にデプロイ済み
   - Portal → candidate-intake の通信は、既に `NEXT_PUBLIC_PORTAL_API_URL` で相互参照パターンが確立済み

5. **段階的に進められる**
   - Step 1: candidate-intake に Portal 向けAPIを追加（認証付き）
   - Step 2: Portal の InterviewForm に「ログ解析」ボタン追加
   - Step 3: レスポンスJSON → InterviewDetail フィールドへのマッピング
   - 各ステップが独立しているため、途中で方針変更もしやすい

### 懸念点と対策

| 懸念 | 対策 |
|------|------|
| PDF送信の通信量 | Railway 内部通信なら問題なし。外部間通信ならBase64エンコードで10MB以下に制限 |
| candidate-intake がダウンした場合 | Portal 側で「解析に失敗しました」エラーハンドリング。手動入力は常に可能なので機能全体が止まるわけではない |
| 認証・アクセス制御 | Portal → candidate-intake 間の共有シークレット（APIキー）で簡易認証。Railway 内部ネットワークならIPベース制限も可 |

---

## 5. 推奨方式の実装ステップ（概要）

### Step 1: candidate-intake 側（APIエンドポイント追加）

```
POST /api/portal/analyze-interview
```

- 入力: `{ pdfBuffer: Base64, interviewLog: string, candidateNumber: string }`
- 処理: 既存の `01_common_analysis_prompt.yaml` を使って解析
- 出力: `{ filemaker_mapping: {...64フィールド}, work_history: [...], missing_items: [...] }`
- 認証: ヘッダーに `X-Portal-Secret` を要求
- 推定作業量: 1-2時間

### Step 2: Portal 側（UIボタン追加）

InterviewForm.tsx の添付タブに「📊 ログを解析して自動入力」ボタンを追加。
- 添付済みの `.txt` ファイル（面談ログ）と `.pdf` ファイル（履歴書）を自動検出
- クリック → candidate-intake APIにPOST → ローディング表示
- 推定作業量: 2-3時間

### Step 3: Portal 側（マッピング処理）

APIレスポンスの `filemaker_mapping` を InterviewDetail の各フィールドに反映。
- Excel 64カラム → InterviewDetail フィールドの変換マップ定数を作成
- `setDetail(fieldName, value)` を一括呼び出し
- 職歴は直近1社を個別フィールドに、全体を `careerSummary` に格納
- 推定作業量: 3-4時間

### Step 4: テスト・調整

- 実際の面談ログ + 履歴書PDFで動作確認
- フラグ値のenum一致確認（candidate-intake の flags.ts と Portal のドロップダウン選択肢）
- エラーハンドリング確認
- 推定作業量: 2-3時間

**合計推定作業量: 8-12時間（1-2日）**
