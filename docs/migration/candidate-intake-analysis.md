# candidate-intake 仕様調査レポート

調査日: 2026-04-19
調査対象: `C:\bizstudio\modules\candidate-intake` (master ブランチ)

---

## 1. エグゼクティブサマリー

candidate-intake は Next.js 16 (TypeScript) で構築された求職者面談インテーク自動化ツールで、Railway にデプロイされている。中核機能は Gemini API (gemini-3-flash-preview) を用いた PDF履歴書＋面談メモの AI 解析で、解析結果を Googleフォーム質問文・FileMaker 用 Excel として出力する。フラグマスタは Excel ファイルではなく `src/constants/flags.ts` にTSV形式で埋め込み済みで、アップロード不要化されている。データストアはファイルベース (JSON + キャッシュ xlsx) で DB は使用していない。

### 主要な移植ポイント
- **Gemini プロンプト群 (YAML 7本)**: そのままコピー可能。最重要は `01_common_analysis_prompt.yaml` と `04_hearing_question_text_prompt.yaml`
- **フラグ定数 (`flags.ts`)**: TSV 埋め込みの 757 行ファイル。Response Schema 構築ロジックごと移植が必要
- **GAS スクリプト**: 質問文→Googleフォーム変換。GAS は外部で独立動作するため、呼び出し部分のみ移植
- **データストア**: ファイルベース → Portal の DB に統合すれば不要

### 想定工数ざっくり評価
- AI 解析機能の移植: 3〜5日 (プロンプト＋Gemini呼び出し＋フラグ定数＋Response Schema)
- Googleフォーム連携: 1日 (GAS 呼び出しコードのみ)
- 質問文生成: 2〜3日 (2ステップ処理＋出力自己検査)
- Excel 出力: 廃止予定なら 0日、移植なら 1〜2日
- UI統合 (Portal面談タブ): 3〜5日

---

## 2. リポジトリ概要

### 2.1 ディレクトリ構造

```
candidate-intake/
├── .env.example              # 環境変数テンプレート
├── .env.local                # ローカル環境変数
├── package.json              # Next.js 16 + 依存関係
├── next.config.ts            # serverExternalPackages 設定
├── tsconfig.json             # TypeScript設定 (ES2017)
├── jpn.traineddata           # Tesseract.js 日本語OCRデータ (3MB)
├── scripts/
│   └── gas/
│       ├── CreateGoogleFormFromQuestionText.js  # GAS本体
│       ├── appsscript.json                       # GASマニフェスト
│       └── README.md
├── specs/                    # Geminiプロンプト定義 (YAML)
│   ├── 01_common_analysis_prompt.yaml
│   ├── 02_google_form_prompt.yaml
│   ├── 03_filemaker_excel_prompt.yaml
│   ├── 04_hearing_question_text_prompt.yaml
│   ├── 05_structured_extract_prompt.yaml
│   ├── 06_achievement_category_followup.yaml
│   └── インポートExcelプロンプト_正本.yaml
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── drive-files/route.ts          # Google Driveファイル取得
│   │   │   ├── health/route.ts               # ヘルスチェック
│   │   │   ├── intake/
│   │   │   │   ├── analyze/route.ts          # ★AI解析 (メインパイプライン)
│   │   │   │   ├── create-google-form/route.ts # GAS呼び出し
│   │   │   │   ├── excel/route.ts            # Excel生成
│   │   │   │   ├── hearing-question-text/route.ts # ★質問文生成
│   │   │   │   └── questions/route.ts        # フォーム質問定義生成
│   │   │   └── records/                      # CRUD操作
│   │   ├── page.tsx                          # 一覧画面
│   │   ├── register/page.tsx                 # 求職者登録画面
│   │   └── records/[candidateId]/page.tsx    # 詳細・解析・出力画面
│   ├── components/
│   │   ├── PreviewEditor.tsx    # 質問リスト編集
│   │   ├── RecordRegister.tsx   # 新規登録フォーム
│   │   ├── ResultPanel.tsx      # パイプライン進捗表示
│   │   └── UploadPanel.tsx      # ファイルアップロード
│   ├── constants/
│   │   └── flags.ts            # ★フラグマスタ定数 (757行)
│   ├── lib/
│   │   ├── google-drive.ts     # Google Drive API
│   │   ├── portalApi.ts        # Portal API連携
│   │   └── recordsStore.ts     # ファイルベースデータストア
│   ├── services/
│   │   ├── candidateNoFromFilename.ts  # ファイル名→求職者番号
│   │   ├── excelBackfill.ts    # Excel補完ロジック
│   │   ├── excelBuilder.ts     # ExcelJS でxlsx生成
│   │   ├── extractText.ts      # PDF/Excel テキスト抽出
│   │   ├── extractTextPdfJs.ts # pdfjs-dist 抽出
│   │   ├── extractTextPdfOcr.ts # Tesseract.js OCR
│   │   ├── flagListSchema.ts   # Response Schema構築
│   │   ├── geminiClient.ts     # ★Gemini API クライアント
│   │   ├── loadSpec.ts         # ★YAMLプロンプト読込＋組立
│   │   └── pdfToImages.ts      # PDF→PNG変換
│   └── types/
│       ├── commonAnalysis.ts   # 共通解析JSON型
│       ├── excelExport.ts      # Excel出力型
│       └── googleForm.ts       # Googleフォーム型
└── docs/                       # 運用ドキュメント群
```

### 2.2 技術スタック

| カテゴリ | 技術 | バージョン/備考 |
|---|---|---|
| フレームワーク | Next.js (App Router) | 16.1.6 |
| 言語 | TypeScript | 5.x (ES2017 target) |
| AI | Gemini API (REST直叩き) | gemini-3-flash-preview |
| PDF解析 | pdf-parse → pdfjs-dist → Tesseract.js (3段階フォールバック) | |
| PDF→画像 | pdfjs-dist + @napi-rs/canvas | DPI200 相当 |
| Excel | ExcelJS | 4.4.0 |
| Google APIs | googleapis (Drive), GAS (Forms) | |
| CSS | Tailwind CSS | 4.x |
| DB/Storage | **なし** (ファイルベース JSON + キャッシュ xlsx) | `data/records.json` |
| デプロイ | Railway | `next start -H 0.0.0.0 -p $PORT` |

### 2.3 エンドポイント一覧

| メソッド | パス | 機能 | ファイル |
|---|---|---|---|
| POST | `/api/intake/analyze` | PDF＋面談メモ → 共通解析JSON生成 | `src/app/api/intake/analyze/route.ts` |
| POST | `/api/intake/hearing-question-text` | 質問文テキスト生成 | `src/app/api/intake/hearing-question-text/route.ts` |
| POST | `/api/intake/questions` | Googleフォーム質問定義JSON生成 | `src/app/api/intake/questions/route.ts` |
| POST | `/api/intake/excel` | FileMaker用Excel生成 | `src/app/api/intake/excel/route.ts` |
| POST | `/api/intake/create-google-form` | GAS経由でGoogleフォーム実体作成 | `src/app/api/intake/create-google-form/route.ts` |
| GET | `/api/drive-files` | Google Driveファイルダウンロード | `src/app/api/drive-files/route.ts` |
| GET | `/api/records` | レコード一覧取得 | `src/app/api/records/route.ts` |
| POST | `/api/records` | レコード新規作成 | `src/app/api/records/route.ts` |
| GET | `/api/records/[candidateId]` | レコード取得 | `src/app/api/records/[candidateId]/route.ts` |
| PATCH | `/api/records/[candidateId]` | レコード更新 | `src/app/api/records/[candidateId]/route.ts` |
| DELETE | `/api/records/[candidateId]` | レコード削除 | `src/app/api/records/[candidateId]/route.ts` |
| POST | `/api/records/[candidateId]/cache` | Excel・添付情報キャッシュ保存 | `src/app/api/records/[candidateId]/cache/route.ts` |
| GET | `/api/records/[candidateId]/excel` | キャッシュ済みExcelダウンロード | `src/app/api/records/[candidateId]/excel/route.ts` |
| POST | `/api/records/bulk-delete` | 一括削除 | `src/app/api/records/bulk-delete/route.ts` |
| GET | `/api/health` | ヘルスチェック | `src/app/api/health/route.ts` |

### 2.4 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | ◎ | Gemini API キー |
| `GAS_WEB_APP_URL` | △ | GAS ウェブアプリURL (Googleフォーム作成機能用) |
| `GAS_INVOKE_TOKEN` | △ | GAS 認証トークン |
| `NEXT_PUBLIC_PORTAL_API_URL` | △ | Portal API URL (デフォルト: `https://bizstudio-portal-production.up.railway.app`) |
| `DATA_DIR` | △ | データ保存ディレクトリ (デフォルト: `./data`) |
| `HEARING_GATE_MIN_CHARS` | △ | 質問文生成の品質ゲート最小文字数 (デフォルト: 1) |
| `HEARING_GATE_QUALIFICATION_SUBSTRINGS` | △ | 資格文字列チェック (デフォルト: なし) |
| `HEARING_GATE_ADDRESS_SUBSTRINGS` | △ | 住所文字列チェック (デフォルト: なし) |

---

## 3. AI解析機能 (最重要)

### 3.1 解析フロー概要

```
[ユーザー] → PDF + 面談メモ(.txt) アップロード
                ↓
[/api/intake/analyze] POST (FormData: pdf, interviewLog, candidateId)
                ↓
        ┌───────────────────────────┐
        │ 1. PDF テキスト抽出       │
        │    pdf-parse → pdfjs → OCR│
        │ 2. フラグリストTSV取得    │
        │    (定数から直接)         │
        │ 3. プロンプト組立         │
        │    (01_common_analysis)    │
        │ 4. Gemini API 呼び出し    │
        │    ・Response Schema使用   │
        │    ・temperature=0.1       │
        │    ・maxOutputTokens=16384 │
        │ 5. 結果正規化             │
        │ 6. 退職理由2パス(条件付)  │
        │ 7. 職歴2パス(条件付)      │
        │ 8. 結果キャッシュ保存     │
        └───────────────────────────┘
                ↓
[共通解析JSON] → Excel生成 / 質問文生成 / フォーム生成 に流れる
```

**2パス処理の条件:**
- **退職理由の2パス目**: 面談メモが100文字以上あるのに退職理由が空の場合、同じプロンプト＋追加指示で再実行し、結果をマージ
- **職歴の2パス目**: 面談メモが500文字以上あるのに work_history が空配列の場合、同じく再実行

### 3.2 Gemini API呼び出し詳細

**ファイル**: `src/services/geminiClient.ts`

```typescript
// モデル定義 (8行目)
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// リクエスト構造 (34-59行目)
function buildRequestBody(params, options?) {
  return {
    system_instruction: { parts: [{ text: params.systemInstruction }] },
    contents: [{ parts: [
      // pdfBase64 がある場合は inlineData で添付
      // imageBase64 がある場合は PNG として添付
      { text: params.userPrompt }
    ]}],
    generationConfig: {
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: params.maxOutputTokens ?? 32768,
      responseMimeType: params.responseMimeType ?? "application/json",
      // responseSchema がある場合は含める
    },
  };
}
```

**共通解析での呼び出しパラメータ** (`src/app/api/intake/analyze/route.ts:240-247`):
- `responseMimeType: "application/json"`
- `maxOutputTokens: 16384`
- `temperature: 0.1`
- `responseSchema`: `buildCommonAnalysisResponseSchema()` で動的生成 (400エラー時はスキーマなしでリトライ)
- 最大リトライ: 2回

**3つの呼び出しパターン**:
1. `generateWithGemini` — テキストのみ (共通解析、Excel生成、フォーム質問生成)
2. `generateWithGeminiWithPdf` — PDF添付 (質問文生成のフォールバック)
3. `generateWithGeminiWithImage` — 画像添付 (質問文生成のPDF→画像→Vision)

**JSONパースと修復** (`src/services/geminiClient.ts:127-180`):
- マークダウンコードブロック除去
- 最初の `{` または `[` を検出
- 途中で切れたJSONの修復 (閉じ括弧補完)

### 3.3 使用プロンプト全文 (コードブロックで丸ごと引用)

#### 3.3.1 共通解析プロンプト (01_common_analysis_prompt.yaml)

**ファイル**: `specs/01_common_analysis_prompt.yaml`

```yaml
# ① 共通解析プロンプト（Gemini 3.0 Flash Deep Think 対応版）
# 準備する資料: 面談の通話文字起こしメモ / Web履歴書PDF（テキスト抽出済み） / フラグリスト.xlsx
# 
# 【重要】このプロンプトは「最上級キャリアコンサルタント」として振る舞い、
# PDFの視覚レイアウトとログの微細なニュアンスを解読する。

role: |
  あなたは転職支援会社で15年以上の経験を持つ最上級キャリアコンサルタントです。
  年間500名以上の求職者と面談し、その真意を読み解いてきた経験があります。
  
  【あなたの専門性】
  - PDFの視覚レイアウトから情報を正確に抽出する能力
  - 面談ログの微細なニュアンスと行間を読む洞察力
  - 「建前」と「本音」を見抜き、真の退職理由を特定する力
  - 転職市場での求職者のポジショニングを的確に判断する経験
  
  【ミッション】
  求職者の真の意向を読み解き、FileMakerインポート用の「共通解析JSON」を生成します。
  単なるデータ転記ではなく、プロの洞察に基づいた高精度な分析を行います。

tone: |
  プロフェッショナル。洞察力を持って分析する。
  根拠のない推測は禁止だが、発話の行間を読む姿勢は必須。
  「言っていないこと」も重要な情報として捉える。
  安易に null や「不明」を返さず、周囲の文脈から最も妥当な値を推論する。

absolute_rules:
  - 出力は必ず valid JSON のみ。説明文・マークダウンは含めない
  - フラグ項目は JSON Schema の enum 値と完全一致させる。言い換え・要約禁止
  - 「analysis_thought」を最初に出力し、分析過程を言語化してからフラグを選ぶ
  - filemaker_mapping のキーは基本情報シートの列名と一字一句一致させる
  - 求職者NOは5で始まる7桁。インポート用照合キーは求職者NO+1の8桁数値
  - 資料に直接記述がない項目も、周囲の文脈から最も妥当な値をプロとして推論し、フラグを埋めよ

three_step_reasoning:
  step_1_fact_collection:
    name: "事実収集"
    description: |
      PDFの建前データとログの本音データを分離抽出する。
      - PDF：職歴（会社名・期間・職種）、学歴、資格、スキル、自己PR
      - 面談ログ：発話内容、感情トーン、躊躇や言い淀み、具体的なエピソード
      - 両者を「建前」と「本音」として明確に区別して記録する
    output_to: "analysis_thought.evidence_clues"

  step_2_contradiction_resolution:
    name: "矛盾解消"
    description: |
      PDFと面談ログに食い違いがある場合、ログ（本音）を優先して判定する。
      - 退職理由：PDFに書かれた理由 vs 面談で語った本音 → ログ優先
      - 希望条件：控えめに書いた希望 vs 本当の優先順位 → ログ優先
      - スキル：自己評価 vs 実際の経験談 → 具体的エピソードを重視
    output_to: "analysis_thought.pdf_vs_interview_gap"

  step_3_inference:
    name: "妥当値推論"
    description: |
      資料に直接記述がない項目も、周囲の文脈から最も妥当な値をプロとして推論する。
      - 「〜という発言から、〜と推測される」の形式で論理を明示
      - 安易に null や「不明」を返さない
      - 複数の選択肢がある場合は、最も蓋然性の高いものを選択
    output_to: "analysis_thought.inference_logic"

resignation_category_guide:
  過去型:
    description: "過去の出来事・環境への不満が主因。「逃げ」のニュアンス"
    indicators:
      - "〜だった"
      - "〜していた"
      - "〜が嫌だった"
      - "退職済みで、過去の不満を中心に語る"
      - "ネガティブな経験が転職の主要な動機"
    中分類:
      会社都合: "業績不振、部署閉鎖、契約満了など会社側の事情"
      個人都合: "人間関係、評価不満、給与不満、仕事内容のミスマッチ"
      環境要因: "通勤、家庭事情、ワークライフバランス"
  未来型:
    description: "将来への期待・成長意欲が主因。「攻め」のニュアンス"
    indicators:
      - "〜したい"
      - "〜を目指して"
      - "〜にチャレンジ"
      - "在職中または前向きな理由を中心に語る"
      - "ポジティブな目標が転職の主要な動機"
    中分類:
      キャリア志向: "挑戦、成長、スキルアップ、マネジメント"
      働き方の見直し: "リモート、地元、WLB重視"
      将来設計: "夢実現、海外、起業、家業継承"

output_structure:
  analysis_thought:
    required: true
    description: "【最初に出力】AIの分析思考プロセス"
    fields:
      career_summary: "求職者の経歴・現状の要約（AIによる事前解釈）"
      evidence_clues: "判断の根拠となった面談ログの具体的な発言やPDFの記載"
      inference_logic: "明記がない情報をプロの洞察でどう推論したかの論理過程"
      pdf_vs_interview_gap: "PDFの建前と面談の本音の食い違い分析"
      resignation_analysis: "退職理由の分析（過去型/未来型、カテゴリ選定理由）"
      tense_determination: "時制判定の根拠"

  extracted_facts:
    required: true
    description: "抽出された事実情報"
    fields:
      candidate_no: "5で始まる7桁"
      candidate_name: "氏名"
      work_history: "職歴配列（在籍順）"
      tense: "未来/過去/混在/不明"
      reading_targets: "読むべき内容・確認すべき論点"

  filemaker_mapping:
    required: true
    description: "基本情報シートの列名と完全一致するキーでマッピング"
    rule: "フラグ列は enum の文言をそのまま使用。メモ列は1-2文の要約"

  missing_items:
    required: true
    description: "3つの資料すべてに記載がなかった項目のリスト"

procedure: |
  【Phase 1: Deep Read（深い読み込み）】
  1. 面談ログを全文読み、発話者ごとに重要発言をマーク
  2. PDF本文を全文読み、職歴・学歴・スキル・希望を構造化
  3. フラグリストの選択肢を把握（退職理由カテゴリ、職種、業種、エリア等）
  4. 「建前」（PDF）と「本音」（ログ）を分離して認識

  【Phase 2: Deep Think（深い思考）】
  5. 事実収集：PDFとログから客観的事実を抽出し、analysis_thought.evidence_clues に記載
  6. 矛盾解消：建前と本音のギャップを分析し、analysis_thought.pdf_vs_interview_gap に記載
  7. 妥当値推論：不明項目を文脈から推論し、analysis_thought.inference_logic に記載
  8. 退職理由・時制の分析を analysis_thought に記載

  【Phase 3: JSON構築】
  9. analysis_thought を最初に出力（Chain of Thought）
  10. extracted_facts に候補者情報と職歴を出力
  11. filemaker_mapping に各フラグとメモを出力（列名完全一致、enum厳守）
  12. missing_items に不明項目を出力（安易に項目を追加しない）

  【Phase 4: 品質チェック】
  13. 退職理由が面談ログにあるのに空欄になっていないか確認
  14. 時制が「不明」のまま放置されていないか確認（推論で埋める）
  15. フラグ値が enum 外の値になっていないか確認
  16. 初回面談まとめに求職者NO等のキー情報が含まれていないか確認

final_instruction: |
  あなたは最上級キャリアコンサルタントとして、求職者の真意を読み解いてください。
  
  【3ステップ推論を必ず実行】
  1. 事実収集：PDFの建前とログの本音を分離抽出
  2. 矛盾解消：食い違いがある場合はログ（本音）を優先
  3. 妥当値推論：直接記述がない項目も文脈から推論し、安易にnullを返さない
  
  【出力順序】
  1. まず analysis_thought で分析過程を言語化する（これが最重要）
  2. 次に事実情報（extracted_facts）を整理する
  3. 最後にフラグリストへマッピング（filemaker_mapping）する
  
  フラグの選択は enum の値と完全一致させること。
  「〜ような」「〜系」などの言い換えは禁止。フラグリストの文言をそのままコピーすること。
  
  出力は valid JSON のみ。前置き・説明文・マークダウンは絶対に含めないこと。
```

#### 3.3.2 構造化抽出プロンプト (05_structured_extract_prompt.yaml)

**ファイル**: `specs/05_structured_extract_prompt.yaml`

```yaml
system_prompt: |
  あなたはWEB履歴書PDFと面談メモのテキストから、指定項目のみを機械的に抽出する担当です。
  PDF・面談メモは最初から最後まで必ず読み切ってから判定すること。先頭のみの参照や要約で判定しないこと。
  推測・補完・言い換えは禁止です。記載が無ければ不明・false・空配列にしてください。
  資格はPDF/メモに書かれている文言をそのまま漏れなく列挙してください。
  住所は「現住所」「住所」欄の全文を確認し、番地（丁目・番地・数字-数字）・建物名（マンション名・ビル名・エステート等）・部屋番号（号室・〇〇室・数字）の有無を正確に判定すること。

output_instruction: |
  以下のJSON形式のみを出力してください。説明文・マークダウンは不要です。
  {
    "highest_education_category": "高校|専門|短大|大学|大学院|不明",
    "qualifications_list": ["資格名1", "資格名2"],
    "address_full": "抽出した住所全文（無ければ空文字）",
    "address_has_banchi": trueまたはfalse,
    "address_has_building": trueまたはfalse,
    "address_has_room": trueまたはfalse,
    "education_has_faculty_keywords": trueまたはfalse
  }
  - highest_education_category: 最終学歴の区分。記載が無ければ「不明」
  - qualifications_list: 資格名の配列。記載が無ければ[]
  - address_full: 住所として抽出できた文字列
  - address_has_banchi: 番地（丁目・番地・数字-数字・〇-〇-〇等）が含まれるか
  - address_has_building: 建物名が含まれるか。マンション・アパート・ビル・ハイツ・タワー・レジデンス・コート・パーク・グランド・エステート・ピア・ドエル・ガーデン・ヒルズ・プラザ・スクエア等の語、またはそれに類する建物名が住所内に含まれていれば true
  - address_has_room: 部屋番号が含まれるか。号室・〇〇室・〇〇号室・3〜4桁の数字（101, 205, 1001等）が住所末尾や建物名の直後にあれば true
  - education_has_faculty_keywords: 学部・学科・専攻・課程・コース・プログラム・研究科・専修・分野・領域・学類・学群のいずれかが含まれるか
  【重要】住所は「現住所」「住所」欄の全文を必ず読み、番地・建物名・部屋番号の有無を漏れなく判定すること。表記ゆれも建物名・部屋番号として認識すること。
```

#### 3.3.3 質問文生成プロンプト (04_hearing_question_text_prompt.yaml)

**ファイル**: `specs/04_hearing_question_text_prompt.yaml` (全284行)

> 全文は本レポートの付録 9.2 に掲載すると膨大になるため、YAML の `base_prompt` フィールド全体をそのまま引用する。

```yaml
base_prompt: |
  # 【最重要】候補者WEB履歴書PDF解析・追加情報ヒアリング用プロンプト
  （Markdown版／丁寧な聞き方厳守／必須確認：高校・資格取得年月・住所詳細）

  ---

  ## ■ このプロンプトの目的

  候補者のWEB履歴書PDFおよび面談メモを解析し、
  **すでに記載されている情報は一切聞かず、
  不足・不明・抽出崩れがある項目のみを、
  候補者がLINE等で回答しやすい「丁寧な質問文」で確認する**ことを目的とする。

  ---

  ## ■ このプロンプト単体で完結すべき前提

  - 本プロンプトは「初回投入」を前提とする
  - 過去の運用・従来ルール・暗黙知は一切存在しない
  - 「何を聞くか」「何を聞かないか」「どう聞くか」は
    **すべて本プロンプト内の記述のみを根拠に判断すること**

  ---

  ## ■ 絶対に守る前提条件

  - PDFおよび面談メモを**最初から最後まで必ず読み切ってから**質問を生成すること。
  - PDF・面談メモに**明確に記載されている情報は、理由を問わず再質問しない**
  - 質問対象は「不足・不明・抽出崩れ」がある項目に限る
  - ただし「必須固定確認」として定義された3点は例外とする
  - 質問文を勝手に要約・簡略化・Yes/No化してはいけない

  ---

  ## ■ あなたの役割

  - あなたは転職コンサルタントである
  - 候補者の魅力を正確に、過不足なく書類へ反映する責任を持つ
  - 情報の「推測」「補完」「言い換え」は行わない
  - 必ず事実確認として質問を行う

  ---

  ## ■ 「何を聞くか」の判定ロジック（明文化）

  ### ① 原則ルール
  - PDF・面談メモに **明確に存在する情報は質問しない**
  - 以下のいずれかに該当する場合のみ質問対象:
    - 情報が存在しない
    - 情報が途中で途切れている
    - 抽出崩れにより正確性が担保できない
    - 書類作成に必要な粒度に達していない

  ### ② 例外ルール
  - 「必須固定確認」として定義された3点は、条件に該当する場合は必ず質問する

  ---

  ## ■ グローバル出力ルール

  - 出力は **候補者に送る質問本文のみ**
  - 各質問の末尾には必ず `回答：` を付ける
  - 該当する全てのブロックを省略せず、最後まで必ず出力すること

  ## ■ 出力順（厳守）

  1) 高校情報の確認（該当時）
  2) 資格の取得年月の確認（該当時）
  3) 住所の詳細確認（該当時）
  4) **直後**に 追加実績ヒアリング（achievement_category に応じたブロック。該当時のみ）
  5) 部署名・役職の確認（該当時）
  6) 仕事において意識していたこと（固定）
  7) 自己PR（固定）
  8) 証明写真データの提出（固定）

  ---

  ## ■ 【最重要】必須固定確認（必ず判定）

  ### 1) 高校情報の確認
  - 最終学歴が「高校卒業」**以外**の場合 → 必ず出力
  - 固定文言使用（言い換え禁止）

  ### 2) 資格の取得年月の確認
  - PDFに記載されている資格はすべて漏れなく列挙
  - 各資格名の横に仮の取得年月として `20○○年○月` を付ける

  ### 3) 住所の詳細確認
  - ケースA：番地なし → 「丁目・番地未記入のため教えてください」
  - ケースB：番地あり、建物・部屋なし → 「戸建てという認識でよろしいでしょうか」
  - ケースC：番地・部屋あり、建物なし → 「建物名の記載をお願い」
  - 全て揃っている場合 → 住所確認は一切出力しない

  ---

  ## ■ 丁寧ヒアリング用 固定テンプレート

  ### 仕事で意識していたこと（固定・7択チェックボックス形式）
  ### 自己PR（固定・10項目から3つ選択）
  ### 証明写真データ（固定・撮影注意点つき）

input_instruction: |
  以下を入力として解析し、上記プロンプトに従い候補者に送る質問本文のみを出力してください。
```

#### 3.3.4 追加実績ヒアリング (06_achievement_category_followup.yaml)

**ファイル**: `specs/06_achievement_category_followup.yaml`

4カテゴリ:
- **営業・販売**: 目標/実績、達成率、社内順位、新規/既存割合、商材単価、工夫、改善数値 (7問)
- **事務・サポート職**: 月間件数、効率化、ミス削減、マニュアル作成、影響範囲 (5問)
- **専門・技術職**: プロジェクト、成果、業務範囲、品質改善、表彰 (5問)
- **マネジメント職**: チーム人数、売上、達成率、育成実績、組織改善 (5問)

全質問に `回答：` 区切りと「不明な場合は空白可」の記載あり。

#### 3.3.5 Googleフォーム質問生成プロンプト (02_google_form_prompt.yaml)

```yaml
role: |
  あなたは転職支援会社の業務システムにおいて、
  共通解析JSON（common_analysis_json）を入力として、
  Googleフォーム用の「質問定義JSON」を出力するAIです。

absolute_rules:
  - 入力は common_analysis_json のみ。PDF・面談ログ・フラグリストの生データは参照しない
  - missing_items や不足している情報を補うための質問を生成する
  - 出力はJSONのみ。説明文は含めない

output_structure:
  form_metadata: { title, description }
  questions: [{ id, title, required, type, options? }]
```

#### 3.3.6 FileMaker用Excel出力プロンプト (03_filemaker_excel_prompt.yaml)

```yaml
prompt: |
  system:
    role: FileMakerへインポートするExcel出力データ生成AI
    absolute_rules:
      - 入力（common_analysis_json）以外の情報源を参照しない
      - 推測で値を埋めない。根拠がない場合は必ず空欄（null）
      - 出力形式・列名・列順を勝手に変更しない
    
  sheets:
    基本情報シート: 66列 (エージェント利用フラグ〜インポート用照合キー)
    職歴シート: 12列 (求職者NO, 何社目, 企業名, 事業内容, 在籍期間_年/月, 職種フラグ/メモ, 退職理由_大/中/小, 転職理由メモ)

  output: excel_files JSON (sheets[].columns + sheets[].rows)
  
  critical_rules:
    - インポート用照合キー = 求職者NO + 1
    - 初回面談まとめに求職者NOを含めない
    - 職歴シートは work_history の要素数と同数の行
    - 在籍期間_年・在籍期間_ヶ月は空白にしない
```

### 3.4 フラグマスタ参照方法

**ファイル**: `src/constants/flags.ts` (757行)

フラグマスタは **Excel ファイルではなく TypeScript 定数として埋め込み済み**。

#### FLAG_DEFINITIONS (enum オブジェクト)

```typescript
export const FLAG_DEFINITIONS = {
  エージェント利用フラグ: ["現在も利用中", "過去に利用有", "初めて利用"],
  転職時期フラグ: ["すぐにでも", "3カ月以内", "半年以内", "情報収集"],
  転職活動期間フラグ: ["1週間以内", "2週間以内", "1ヵ月以内", "2カ月以内", "3ヶ月以内", "半年以内", "半年以上"],
  応募種別フラグ: ["応募済み", "応募なし", "検討中"],
  学歴フラグ: ["中卒", "高校卒", "高専卒", "短大・専門卒", "大学卒", "大学院卒"],
  // ... 以下、カテゴリ_大/中/小、時制、エリア、都道府県、PCスキル等のenum定義
  // 合計約30カテゴリ
} as const;
```

#### FILEMAKER_MAPPING_KEYS (67列名の配列)

```typescript
export const FILEMAKER_MAPPING_KEYS = [
  "エージェント利用フラグ", "エージェント利用メモ",
  "転職時期フラグ", "転職時期メモ",
  // ... 基本情報シートの列名67個
  "初回面談まとめ", "インポート用照合キー"
];
```

#### FLAG_LIST_TSV (全フラグのTSV形式テキスト)

プロンプトに埋め込む用の文字列。約756行のTSV形式で、フラグリスト.xlsx の「リスト」シートと同等内容。

#### Geminiプロンプトへの埋め込み方法

`loadSpec.ts:282-283` でユーザープロンプトに直接埋め込み:

```
【フラグリスト（シート「リスト」。フラグ列の値はここに記載されている文言をそのままコピーすること）】
${flagListText || "(なし)"}
```

加えて `flagListSchema.ts` で Gemini Response Schema を構築:
- `FLAG_DEFINITIONS` の enum 値から各フラグ項目の `type: "string", enum: [...]` を自動生成
- `analysis_thought` + `extracted_facts` + `filemaker_mapping` + `missing_items` の4層構造スキーマ

### 3.5 解析結果のマッピング

**ファイル**: `src/services/flagListSchema.ts:197-234`

`adaptGeminiResponseToCommonAnalysis()` が Gemini レスポンスを正規化:

1. `extracted_facts`: candidate_no, candidate_name, work_history[], tense, reading_targets に正規化
2. `filemaker_mapping`: `FILEMAKER_MAPPING_KEYS` の67キーでフィルタリング。存在するキーの値のみ保持
3. `missing_items`: 配列として保持

**フラグ値の検証** (`validateAndFixFlagValue`):
- enum に完全一致 → そのまま採用
- 部分一致 (含む/含まれる) → 自動補正
- 不一致 → 警告ログを出して値はそのまま保持

**退職理由の3階層**:
- `退職理由_大`: FLAG_DEFINITIONS.カテゴリ_大 の enum から選択
- `退職理由_中`: FLAG_DEFINITIONS.カテゴリ_中 の enum から選択
- `退職理由_小`: FLAG_DEFINITIONS.カテゴリ_小 の enum から選択
- work_history 各要素に退職理由_大/中/小 + 転職理由メモを保持

**職種/業種/エリアの3階層**:
- 希望職種フラグ + 希望職種メモ
- 希望業種フラグ + 希望業種メモ
- 希望エリアフラグ + 希望_都道府県 + 希望_市区 + 希望エリアメモ

### 3.6 エラーハンドリング

**API呼び出し失敗時** (`geminiClient.ts:87-108`):
- HTTP ステータスエラー → `Gemini API error: {status}` を throw
- candidates 配列が空 → `No response from Gemini ({blockReason})` を throw
- レスポンス構造不正 → `Invalid response structure from Gemini` を throw

**解析パイプライン** (`analyze/route.ts`):
- 最大3回リトライ (初回 + MAX_RETRIES=2)
- Response Schema で 400 エラーが出た場合 → スキーマなしでリトライ
- 構造検証に失敗した場合 → リトライ
- 全リトライ失敗 → `500: Failed to generate valid common_analysis_json`

**質問文生成** (`hearing-question-text/route.ts`):
- PDF テキスト抽出0文字 → `400: PDFからテキストを読み取れませんでした`
- 品質ゲート不通過 → `422: PDFテキスト抽出が不十分`
- 構造化抽出 (Step A) 失敗 → `500: 構造化抽出に失敗しました`
- 出力自己検査不合格 → 1回リトライ → 再度不合格なら `500: AI出力がルールに適合しませんでした`

---

## 4. Excel出力機能

### 4.1 出力フォーマット

- **形式**: .xlsx (ExcelJS)
- **シート構成**: 2シート
  - `基本情報シート`: 66列（フラグ + メモ + 年収 + 面談まとめ + インポート用照合キー）
  - `職歴情報シート`: 12列（求職者NO, 何社目, 企業名, 事業内容, 在籍期間_年/月, 職種フラグ/メモ, 退職理由_大/中/小, 転職理由メモ）
- **ライブラリ**: `exceljs@4.4.0`

### 4.2 出力処理

**エンドポイント**: `POST /api/intake/excel`
**ファイル**: `src/app/api/intake/excel/route.ts`

1. `common_analysis_json` を受け取る
2. `buildFilemakerExcelPrompt()` でプロンプト組立
3. Gemini に `excel_files` JSON を生成させる (maxOutputTokens=8192, リトライ2回)
4. `applyFilemakerBackfill()` で基本情報シートを `filemaker_mapping` で補完
5. `applyWorkHistoryBackfill()` で職歴シートを `work_history` で補完
6. `buildXlsxBuffer()` で .xlsx バイナリ生成
7. `Content-Disposition: attachment` でダウンロード

**ファイル名**: `FM_インポートデータ_{候補者名}.xlsx`

### 4.3 バックフィルロジック

**ファイル**: `src/services/excelBackfill.ts` (226行)

- `applyFilemakerBackfill`: Geminiの出力にfilemaker_mappingの値を上書き。インポート用照合キーは求職者NO+1で強制設定。初回面談まとめから求職者NO/照合キーをサニタイズ
- `applyWorkHistoryBackfill`: work_historyから職歴シートを再構築。企業名/事業内容/職種/在籍期間/退職理由を日本語・英語キーの両方で対応
- `ensureWorkHistorySheetExists`: 職歴シートがない場合はヘッダーのみで追加

---

## 5. Googleフォーム生成機能

### 5.1 フォーム生成方式

**Google Apps Script (GAS)** を使用。Next.js 側から GAS ウェブアプリの URL に POST で質問文テキストを送信し、GAS 側でフォームを作成する。固定テンプレートの複製ではなく、**質問文テキストの動的パース結果からフォームを構築**する。

### 5.2 実装コード

#### Next.js側 (GAS呼び出し)

**ファイル**: `src/app/api/intake/create-google-form/route.ts` (全164行)

```typescript
// 環境変数から GAS URL とトークン取得
const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL ?? "";
const GAS_INVOKE_TOKEN = process.env.GAS_INVOKE_TOKEN ?? "";

// GASへのPOSTリクエスト
const payload = {
  candidateId,
  candidateName: candidateName || existing.candidateName || "",
  questionText,       // 質問文テキスト全文
  token: GAS_INVOKE_TOKEN,
};

const gasRes = await fetch(GAS_WEB_APP_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: controller.signal,  // 90秒タイムアウト
});

// レスポンス: { formId, responseUrl, editUrl, shareWarning? }
```

#### GAS側 (フォーム生成本体)

**ファイル**: `scripts/gas/CreateGoogleFormFromQuestionText.js` (全488行)

```javascript
// 主要関数フロー
function doPost(e) {
  // 1. リクエスト解析 (candidateId, candidateName, questionText, token)
  // 2. トークン検証 (Script Properties の INVOKE_TOKEN)
  // 3. doCreateForm() 呼び出し
}

function doCreateForm(candidateId, candidateName, questionText, result) {
  // 1. parseQuestionBlocks() で「回答：」区切りでブロック分割
  // 2. splitIntroAndFirstQuestion() で挨拶と第1質問を分離
  // 3. stripFooterFromLastBlock() で末尾の「以上となります。」除去
  // 4. FormApp.create() でフォーム作成
  // 5. 各ブロックを getCategory() で分類し、適切な質問形式で追加:
  //    - photo → ラジオボタン (3択)
  //    - 仕事で意識/自己PR → チェックボックス or 段落テキスト
  //    - 資格 → 1資格1段落テキスト + 「その他」欄
  //    - 実績 → 段落テキスト + 注釈「不明な場合は空白で構いません」
  //    - その他 → 段落テキスト
  // 6. カテゴリ変化時にセクションヘッダー挿入
  // 7. 個人情報同意ページ追加 (プライバシーポリシー全文 + 同意チェックボックス)
  // 8. 回答スプレッドシート作成・紐付け
  // 9. 共有設定 (リンクを知っている全員=閲覧 + 社員5名=編集権限)
  // 10. 共有ドライブフォルダへ移動 (SHARED_DRIVE_FOLDER_ID 設定時)
}
```

**認証方式**: GAS のスクリプトプロパティに `INVOKE_TOKEN` を設定。Next.js 側から `GAS_INVOKE_TOKEN` 環境変数で送信。

**OAuth スコープ** (`appsscript.json`):
- `https://www.googleapis.com/auth/forms`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive`

**編集権限を付与する社員メールアドレス** (GAS内ハードコード):
- masayuki_oono@bizstudio.co.jp
- yoshitomi_ando@bizstudio.co.jp
- kanako_okada@bizstudio.co.jp
- yuzo_nanjo@bizstudio.co.jp
- aoi_sato@bizstudio.co.jp

### 5.3 フォーム項目

質問文テキストから動的生成されるため固定項目はないが、**必ず含まれる固定テンプレート**:

1. **高校情報** (最終学歴が高校卒以外の場合) — 短答テキスト
2. **資格取得年月** (PDFに資格記載がある場合) — 1資格1段落テキスト
3. **住所詳細** (3ケースのいずれか該当時) — 段落テキスト
4. **追加実績ヒアリング** (achievement_category 選択時) — 段落テキスト (注釈付き)
5. **仕事で意識していたこと** (固定) — チェックボックス (7択)
6. **自己PR** (固定) — チェックボックス (10択)
7. **証明写真データ** (固定) — ラジオボタン (3択)
8. **個人情報同意** (固定・最終ページ) — プライバシーポリシー表示 + 同意チェックボックス (必須)

**フォーム回答の受け取り方**: GAS が自動作成する回答スプレッドシート (`回答_{フォームタイトル}`)。Webhook なし。手動確認。

---

## 6. 求人タスク登録機能

### 6.1 bizstudio-portal との連携方法

**API呼び出しではなく、ブラウザリンクで Portal のタスク作成画面を別タブで開く方式**。

**ファイル**: `src/app/records/[candidateId]/page.tsx:930-935`

```typescript
const portalBaseUrl = (process.env.NEXT_PUBLIC_PORTAL_API_URL || 
  "https://bizstudio-portal-production.up.railway.app").replace(/\/+$/, "");
const categoryId = "cmmvzf6ct001m1doafno6y037";  // ハードコード
const url = `${portalBaseUrl}/tasks/new?candidateId=${candidateId}&categoryId=${categoryId}`;
window.open(url, "_blank");
```

### 6.2 タスク生成ロジック

- **candidateId**: 現在表示中の求職者ID (URLパラメータとして渡す)
- **categoryId**: `cmmvzf6ct001m1doafno6y037` (求人検索カテゴリ、ハードコード)
- **担当者設定**: Portal 側のタスク作成画面で設定 (candidate-intake 側では設定しない)
- **期限設定**: 同上 (Portal 側で設定)

認証はなし (Portal のフロントエンドに遷移するだけ)。

---

## 7. 求職者情報の事前取り込み

### 7.1 PDFからの求職者情報抽出

**ファイル**: `src/services/extractText.ts` (111行)

3段階フォールバック方式:

```
1. pdf-parse — テキストレイヤーから直接抽出 (最速)
       ↓ (20文字未満)
2. pdfjs-dist — CMap対応の日本語テキスト抽出 (システムDL PDF向け)
       ↓ (20文字未満)
3. Tesseract.js — OCR (スキャン/画像PDF向け、日本語対応)
```

**質問文生成での別方式** (`hearing-question-text/route.ts`):
```
1. PDF→PNG画像 (pdfjs-dist + @napi-rs/canvas, DPI200)
       ↓
2. Gemini Vision (画像→テキスト、ページごと)
       ↓ (失敗時)
3. Gemini PDF inline (PDFをbase64でそのまま送信)
```

### 7.2 求職者番号の抽出

**ファイル**: `src/services/candidateNoFromFilename.ts` (36行)

PDFファイル名から `5XXXXXX` (5で始まる7桁) を正規表現で抽出。ファイル名に番号がない場合はエラー。PDF本文やメモ内の番号は使用しない (正本プロンプト準拠)。

### 7.3 既存求職者データとの突合

**ファイル**: `src/app/register/page.tsx` (289行)

- Portal API (`/api/candidates`) から求職者一覧を取得
- URLパラメータ `?candidateId=XXXXXXX` がある場合は自動選択・自動登録
- 手動の場合は candidateNo または氏名で検索・選択

**判定ロジック**:
- ローカル `records.json` に candidateId が存在 → 既存レコードの詳細画面へ遷移
- 存在しない → 新規レコード作成

---

## 8. 移植可能性評価

### 8.1 機能別評価マトリクス

| 機能 | 移植難易度 | 理由 | 移植方針の推奨 |
|---|---|---|---|
| AI解析 (Gemini共通解析) | **中** | プロンプトYAML・Response Schema・2パス処理・フラグ定数の一式をコピー。Gemini API呼び出しはfetch直叩きのため言語非依存 | プロンプトYAMLをそのまま移植。geminiClient.ts を Portal の TypeScript/Next.js に直接コピー。flags.ts も同様 |
| 質問文生成 (hearing) | **中** | 2ステップ処理 (構造化抽出→質問文生成) + 出力自己検査 + リトライの複雑なフロー | hearing-question-text/route.ts の処理フローをPortalのAPIルートに移植 |
| フラグマスタ (flags.ts) | **低** | 既にTSの定数ファイル。コピーするだけ | src/constants/flags.ts をそのままコピー |
| Response Schema構築 | **低** | flagListSchema.ts がFLAG_DEFINITIONSから自動生成。コピーするだけ | flagListSchema.ts をコピー |
| Googleフォーム生成 | **低** | GAS は外部で独立動作。呼び出し側 (create-google-form/route.ts) は164行の単純なPOST | 呼び出しコードのみ移植。GAS本体は変更不要 |
| Excel出力 (FileMaker用) | **低** | ExcelJS依存。excelBuilder.ts (34行) + excelBackfill.ts (226行) | 廃止予定なら不要。必要なら exceljs をPortalに追加してコピー |
| PDF テキスト抽出 | **中** | pdf-parse, pdfjs-dist, tesseract.js, @napi-rs/canvas の4ライブラリ依存。jpn.traineddataも必要 | Portalに同じ依存を追加するか、Gemini Vision のみに統一して簡素化 |
| レコード管理 | **不要** | ファイルベースJSON → Portal のDB (Prisma/Supabase) に統合 | Portal既存の面談履歴テーブルに統合 |
| 求人タスク登録 | **不要** | 既にPortalへのリンク遷移のみ。Portal内で実装すればURLリンクすら不要 | Portal内でボタン直接配置 |

### 8.2 技術的懸念点

1. **ハードコードされた認証情報**:
   - GAS内の社員メールアドレス5件 (`CreateGoogleFormFromQuestionText.js:446-452`)
   - カテゴリID `cmmvzf6ct001m1doafno6y037` (タスク作成リンク)
   - `.env.local` に GEMINI_API_KEY がハードコード

2. **外部サービス依存**:
   - Gemini API (gemini-3-flash-preview) — モデル名がプレビュー版。GA版への更新が必要かもしれない
   - Google Apps Script ウェブアプリ — GAS_WEB_APP_URL が未設定だとフォーム機能は 503
   - Google Drive API (google-drive.ts) — サービスアカウント認証 (環境変数は見当たらないが googleapis 使用)

3. **Python → TypeScript の懸念なし**:
   - candidate-intake は既に TypeScript/Next.js。bizstudio-portal も Next.js のため言語変換不要

4. **ネイティブ依存**:
   - `@napi-rs/canvas` と `canvas` — PDF→画像変換に必要。Railway での動作実績あり
   - `tesseract.js` — `jpn.traineddata` (3MB) が必要
   - Portal に移植する場合、`serverExternalPackages` の設定が必要 (`next.config.ts`)

5. **データストアの移行**:
   - 現在はファイルベース (`data/records.json` + `cache/{id}_*.json|xlsx`)
   - Portal 統合時は DB テーブルに変換が必要
   - キャッシュ Excel は S3/GCS などオブジェクトストレージに移行推奨

6. **プロンプトのロード方式**:
   - 現在は `fs.readFileSync` でYAMLファイルを同期読み込み
   - Portal の Edge Runtime では使えない可能性。Node.js Runtime 指定が必要

### 8.3 推奨される移植方針

**Phase 1: コア機能の移植 (AI解析 + 質問文生成)**
1. `specs/` ディレクトリの YAML 7本をそのままコピー
2. `src/constants/flags.ts` をコピー
3. `src/services/geminiClient.ts` をコピー (fetch直叩きなのでそのまま動く)
4. `src/services/loadSpec.ts` をコピー (YAML読み込み方式はPortalに合わせて調整)
5. `src/services/flagListSchema.ts` をコピー
6. `src/app/api/intake/analyze/route.ts` のロジックを Portal API に移植
7. `src/app/api/intake/hearing-question-text/route.ts` のロジックを Portal API に移植

**Phase 2: Googleフォーム連携**
1. `src/app/api/intake/create-google-form/route.ts` のGAS呼び出しロジックを移植
2. GAS本体 (`scripts/gas/`) は変更不要 (同じURLを呼べばよい)

**Phase 3: UI統合**
1. Portal の面談履歴タブにアップロード→解析→質問文生成→フォーム作成のフローを統合
2. レコード管理は Portal の既存テーブルに統合

**Phase 4: Excel出力 (必要に応じて)**
1. 廃止方針なら実装不要
2. 必要なら `exceljs` を追加し、excelBuilder.ts + excelBackfill.ts をコピー

---

## 9. 付録

### 9.1 重要ファイル一覧

| ファイル | 行数 | 重要度 | 役割 |
|---|---|---|---|
| `specs/01_common_analysis_prompt.yaml` | 162 | ★★★ | 共通解析プロンプト |
| `specs/04_hearing_question_text_prompt.yaml` | 284 | ★★★ | 質問文生成プロンプト |
| `specs/05_structured_extract_prompt.yaml` | 30 | ★★ | 構造化抽出プロンプト |
| `specs/06_achievement_category_followup.yaml` | 157 | ★★ | 実績ヒアリング質問 |
| `specs/02_google_form_prompt.yaml` | 37 | ★ | フォーム質問生成プロンプト |
| `specs/03_filemaker_excel_prompt.yaml` | 168 | ★ | Excel出力プロンプト |
| `src/constants/flags.ts` | 757 | ★★★ | フラグマスタ定数 (Single Source of Truth) |
| `src/services/geminiClient.ts` | 181 | ★★★ | Gemini API クライアント |
| `src/services/loadSpec.ts` | 331 | ★★★ | プロンプト組立 |
| `src/services/flagListSchema.ts` | 265 | ★★ | Response Schema構築 |
| `src/app/api/intake/analyze/route.ts` | 361 | ★★★ | 共通解析API (メイン) |
| `src/app/api/intake/hearing-question-text/route.ts` | 451 | ★★★ | 質問文生成API |
| `src/app/api/intake/create-google-form/route.ts` | 164 | ★★ | GAS呼び出し |
| `src/app/api/intake/excel/route.ts` | 121 | ★ | Excel生成API |
| `src/services/excelBackfill.ts` | 226 | ★ | Excel補完ロジック |
| `src/services/excelBuilder.ts` | 34 | ★ | ExcelJS変換 |
| `src/services/extractText.ts` | 111 | ★★ | PDF/Excelテキスト抽出 |
| `src/services/pdfToImages.ts` | 101 | ★★ | PDF→PNG変換 |
| `src/lib/recordsStore.ts` | 343 | ★ | ファイルベースデータストア |
| `src/lib/portalApi.ts` | 34 | ★ | Portal API連携 |
| `scripts/gas/CreateGoogleFormFromQuestionText.js` | 488 | ★★ | GASフォーム生成本体 |
| `src/app/records/[candidateId]/page.tsx` | ~1100 | ★ | 詳細画面UI |

### 9.2 参考コードスニペット集

#### Gemini 呼び出し (generateWithGemini) — `src/services/geminiClient.ts:61-121`

```typescript
export async function generateWithGemini(params: GeminiGenerateParams): Promise<string> {
  return generateWithGeminiInternal(buildRequestBody(params));
}

async function generateWithGeminiInternal(requestBody): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "ここにあなたのAPIキー") {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Empty response from Gemini");
  return text;
}
```

#### 質問文生成の2ステップ処理 — `src/app/api/intake/hearing-question-text/route.ts:309-382`

```typescript
// Step A: 構造化抽出
const stepAPrompt = buildStructuredExtractPrompt(resumePdfText, interviewMemoText);
const stepARaw = await generateWithGemini({
  systemInstruction: stepAPrompt.systemInstruction,
  userPrompt: stepAPrompt.userPrompt,
  responseMimeType: "application/json",
  maxOutputTokens: 4096,
  temperature: 0.1,
});
const structuredExtract = parseJsonResponse<StructuredExtractResult>(stepARaw);

// Step B: 質問文生成
const { systemInstruction, userPrompt } = buildHearingQuestionTextPrompt(
  resumePdfText, interviewMemoText, structuredExtract, achievementCategory
);
const raw = await generateWithGemini({
  systemInstruction, userPrompt,
  responseMimeType: "text/plain",
  maxOutputTokens: 16384,
  temperature: 0.1,
});

// 出力自己検査
const outputCheck = checkOutputRules(text, structuredExtract);
if (!outputCheck.passed) {
  // リトライ (最大1回)
}
```

#### GAS フォーム作成のブロックパース — `scripts/gas/CreateGoogleFormFromQuestionText.js:106-116`

```javascript
function parseQuestionBlocks(questionText) {
  if (!questionText || typeof questionText !== "string") return [];
  var normalized = questionText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var parts = normalized.split(/\n回答[：:]\s*\n?/);
  var blocks = [];
  for (var i = 0; i < parts.length; i++) {
    var block = parts[i].replace(/\n?回答[：:]\s*$/, "").trim();
    if (block) blocks.push(block);
  }
  return blocks;
}
```

---

*本レポートは candidate-intake リポジトリ (master ブランチ, コミット 15c34d1) の全ソースコードを読み込んで作成した。*
