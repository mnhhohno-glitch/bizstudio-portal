import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const SPECS_DIR = path.join(process.cwd(), "src", "lib", "ai", "specs");

function loadYamlSafe<T>(filename: string): T {
  const filePath = path.join(SPECS_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return yaml.load(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`specs/${filename} の読み込みに失敗しました: ${msg}`);
  }
}

export type Spec01 = {
  role?: string;
  tone?: string;
  absolute_rules?: string[] | string;
  output_structure?: unknown;
  input_sections?: { name: string; description: string }[];
  basic_info_sheet_columns?: string[];
  work_history_sheet_columns?: string[];
  input_rules?: string[];
  procedure?: string;
  final_instruction?: string;
  three_layer_analysis?: {
    layer_1_evidence_extraction?: { name?: string; description?: string; output_to?: string };
    layer_2_contradiction_analysis?: { name?: string; description?: string; output_to?: string };
    layer_3_flag_fitting?: { name?: string; description?: string; output_to?: string };
  };
  three_step_reasoning?: {
    step_1_fact_collection?: { name?: string; description?: string; output_to?: string };
    step_2_contradiction_resolution?: { name?: string; description?: string; output_to?: string };
    step_3_inference?: { name?: string; description?: string; output_to?: string };
  };
  resignation_category_guide?: Record<string, unknown>;
  tense_determination?: Record<string, unknown>;
};

export type Spec02 = {
  role?: string;
  tone?: string;
  absolute_rules?: string[];
  output_structure?: unknown;
  input_rules?: string[];
  final_instruction?: string;
};

export type Spec03 = {
  prompt?: string;
};

export type Spec04 = {
  base_prompt?: string;
  input_instruction?: string;
};

export type Spec05 = {
  system_prompt?: string;
  output_instruction?: string;
};

export type Spec06 = {
  description?: string;
  categories?: Record<string, { instruction?: string; questions?: string }>;
};

/** 実績ヒアリングの職種カテゴリ選択肢（UI・APIで共通） */
export const ACHIEVEMENT_CATEGORY_OPTIONS = [
  "営業・販売（数字を追う職種）",
  "事務・サポート職",
  "専門・技術職",
  "マネジメント職",
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORY_OPTIONS)[number];

/** achievement_category に応じた追加実績ヒアリングの質問文のみを返す。未指定・不明時は空文字。説明・指示（求職者非開示）は含めない。 */
export function getAchievementCategoryBlock(category: string): string {
  if (!category || typeof category !== "string") return "";
  const spec = loadYamlSafe<Spec06>("06_achievement_category_followup.yaml");
  const categories = spec.categories ?? {};
  const key = category.trim();
  const entry = categories[key];
  if (!entry) return "";
  const q = (entry.questions ?? "").trim();
  return q;
}

/** Step A 構造化抽出の結果型（04 base_prompt は一切変更しない） */
export type StructuredExtractResult = {
  highest_education_category?: string;
  qualifications_list?: string[];
  address_full?: string;
  address_has_banchi?: boolean;
  address_has_building?: boolean;
  address_has_room?: boolean;
  education_has_faculty_keywords?: boolean;
};

/** Step A: 構造化抽出用プロンプトを組み立てる */
export function buildStructuredExtractPrompt(
  resumePdfText: string,
  interviewMemoText: string
): { systemInstruction: string; userPrompt: string } {
  const spec = loadYamlSafe<Spec05>("05_structured_extract_prompt.yaml");
  const systemInstruction = [spec.system_prompt ?? "", spec.output_instruction ?? ""].join("\n\n").trim();
  const userPrompt = `【候補者WEB履歴書PDF抽出テキスト】
${resumePdfText || "(なし)"}

【面談メモ】
${interviewMemoText || "(なし)"}

上記のみから指定項目を抽出し、JSONのみを出力してください。`;
  return { systemInstruction, userPrompt };
}

/** 質問文テキスト用プロンプトを組み立てる。base_prompt 本文は変更しない。achievement_category 指定時は追加実績ヒアリングを末尾に結合。extraUserPromptSuffix は再試行時に資格ブロック必須などを追記する用。 */
export function buildHearingQuestionTextPrompt(
  resumePdfText: string,
  interviewMemoText: string,
  structuredExtract?: StructuredExtractResult | null,
  achievementCategory?: string | null,
  extraUserPromptSuffix?: string | null
): { systemInstruction: string; userPrompt: string } {
  const spec = loadYamlSafe<Spec04>("04_hearing_question_text_prompt.yaml");
  const basePrompt = spec.base_prompt ?? "";
  const inputInstruction = spec.input_instruction ?? "";
  const achievementBlock = achievementCategory ? getAchievementCategoryBlock(achievementCategory) : "";
  const middle =
    achievementBlock !== ""
      ? `\n\n---\n\n## ■ 追加実績ヒアリングロジック（achievement_category に応じて出力）\n\nachievement_category が「${achievementCategory}」の場合、実績確認セクションとして以下をそのまま追加すること。他の生成ロジックには影響を与えない。\n\n${achievementBlock}\n\n---\n\n`
      : "\n\n---\n\n";
  const systemInstruction = `${basePrompt}${middle}${inputInstruction}`.trim();

  const highestEd = structuredExtract?.highest_education_category ?? "";
  const needHighSchoolBlock = highestEd !== "" && highestEd !== "高校";
  const addrComplete =
    structuredExtract?.address_has_banchi === true &&
    structuredExtract?.address_has_building === true &&
    structuredExtract?.address_has_room === true;
  const structuredBlock =
    structuredExtract != null
      ? `【事前抽出結果（判定の参考にすること。これに基づき住所・資格の誤判定を避けること）】
${JSON.stringify(structuredExtract, null, 2)}
${addrComplete ? "\n【住所】番地・建物名・部屋番号がすべて揃っています。住所の詳細確認（丁目・番地未記入・建物名と部屋番号の記載お願い・戸建て確認など）は一切出力しないこと。\n" : ""}
${!addrComplete && structuredExtract.address_has_room === true && structuredExtract.address_has_building === false ? "\n【住所】番地・部屋番号あり・建物名なし → 必ずケースC（建物名の記載をお願い）のみ使用。ケースB（戸建てでよろしいですか）は使用禁止。\n" : ""}
${needHighSchoolBlock ? "\n【高校】最終学歴が高校卒以外（highest_education_category=" + highestEd + "）のため、必ず「高校名と卒業年度、入学年度について教えてください」のブロックをそのまま出力すること。省略禁止。\n" : ""}

`
      : "";

  const userPrompt = `${structuredBlock}${achievementCategory ? `【achievement_category】\n${achievementCategory}\n【必須】出力順4「追加実績ヒアリング」を省略しないこと。上記プロンプトの「追加実績ヒアリングロジック」の該当カテゴリ（${achievementCategory}）の質問文を、高校・資格・住所のあと、意識・自己PR・証明写真の前にそのまま全て出力すること。\n\n` : ""}【候補者WEB履歴書PDF抽出テキスト】
${resumePdfText || "(なし)"}

【面談メモ】
${interviewMemoText || "(なし)"}
${extraUserPromptSuffix ? `\n\n${extraUserPromptSuffix}` : ""}

上記を解析し、プロンプトに従い候補者に送る質問本文のみを出力してください。見出し・内部メモ・解析過程・GoogleフォームやURLは一切出力しないでください。
【重要】該当する全ての質問ブロックを省略せず最後まで出力すること。各ブロックは「回答：」で区切ること。固定の「仕事で意識」「自己PR」「証明写真」まで必ず含めること。achievement_category が指定されている場合は「追加実績ヒアリング」のブロックも必ず含めること。途中で打ち切らないこと。`;
  return { systemInstruction, userPrompt };
}

/**
 * 01 共通解析プロンプトを読み、Gemini用の systemInstruction と userPrompt を組み立てる。
 * pdfFileName を渡した場合、求職者NOはファイル名からのみ抽出する旨を明示する（正本プロンプト準拠）。
 * 3層分析（エビデンス抽出→矛盾分析→フラグフィッティング）をChain of Thoughtで強制する。
 */
export function buildCommonAnalysisPrompt(
  pdfText: string,
  interviewLog: string,
  flagListText: string,
  pdfFileName?: string | null
): { systemInstruction: string; userPrompt: string } {
  const spec = loadYamlSafe<Spec01>("01_common_analysis_prompt.yaml");

  const role = spec.role ?? "";
  const tone = spec.tone ?? "";
  const rulesRaw = spec.absolute_rules;
  const rules = Array.isArray(rulesRaw) ? rulesRaw.join("\n  - ") : (rulesRaw ?? "");
  const procedure = spec.procedure ?? "";
  const finalInstruction = spec.final_instruction ?? "";
  
  const threeStep = spec.three_step_reasoning;
  const threeStepBlock = threeStep ? `
## 3ステップ推論フレームワーク（Deep Think）

【ステップ1：${threeStep.step_1_fact_collection?.name ?? "事実収集"}】
${threeStep.step_1_fact_collection?.description ?? "PDFの建前データとログの本音データを分離抽出する。"}
出力先: ${threeStep.step_1_fact_collection?.output_to ?? "analysis_thought.evidence_clues"}

【ステップ2：${threeStep.step_2_contradiction_resolution?.name ?? "矛盾解消"}】
${threeStep.step_2_contradiction_resolution?.description ?? "PDFと面談ログに食い違いがある場合、ログ（本音）を優先して判定する。"}
出力先: ${threeStep.step_2_contradiction_resolution?.output_to ?? "analysis_thought.pdf_vs_interview_gap"}

【ステップ3：${threeStep.step_3_inference?.name ?? "妥当値推論"}】
${threeStep.step_3_inference?.description ?? "資料に直接記述がない項目も、周囲の文脈から最も妥当な値をプロとして推論する。"}
出力先: ${threeStep.step_3_inference?.output_to ?? "analysis_thought.inference_logic"}
` : "";

  const systemInstruction = `${role}

tone: ${tone}

absolute_rules:
  - ${rules}
${threeStepBlock}
procedure:
${procedure}

${finalInstruction}`;

  const filenameBlock =
    pdfFileName && pdfFileName.trim()
      ? `

【重要】求職者NOについて
・Web履歴書PDFのファイル名: ${pdfFileName}
・extracted_facts.candidate_no には、上記ファイル名に含まれる「5から始まる7桁の数字」のみを設定すること。
・面談メモやPDF本文内の番号は求職者NOとして使用しないでください。`
      : "";

  const basicColumns = (spec.basic_info_sheet_columns ?? []).join("、");
  const inputRulesBlock =
    Array.isArray(spec.input_rules) && spec.input_rules.length > 0
      ? `\n【出力時のルール】\n${spec.input_rules.map((r) => `・${r}`).join("\n")}\n`
      : "";

  const interviewQualityGate =
    interviewLog && interviewLog.trim().length > 0
      ? `

【面談メモ品質ゲート（書き起こしテキスト入力時）】
・面談メモは書き起こしのため、全文を走査し退職理由・転職理由の言及があれば必ず filemaker_mapping または work_history に出力すること。空欄禁止。
・時制（未来型/過去型）を判定し extracted_facts.tense に「未来」「過去」「混在」「不明」のいずれかで必ず出力すること。
・読むべき内容・確認すべき論点は extracted_facts.reading_targets に箇条書きで出力すること。

【Deep Think 必須：analysis_thought を最初に出力】
・出力JSONの最初に必ず analysis_thought オブジェクトを含め、以下を言語化すること：
  - career_summary: 求職者の経歴・現状の要約（AIによる事前解釈）
  - evidence_clues: 判断の根拠となった面談ログの具体的な発言やPDFの記載
  - inference_logic: 明記がない情報をプロの洞察でどう推論したかの論理過程
  - pdf_vs_interview_gap: PDFの建前と面談の本音の食い違い分析
  - resignation_analysis: 退職理由の分析（過去型/未来型、カテゴリ選定理由）
  - tense_determination: 時制判定の根拠`
      : "";

  const userPrompt = `【タスク】添付3つのファイル（面談の通話文字起こしメモ・Web履歴書PDF・フラグリスト）をすべて読み取り、必要な情報をフラグリストの形式に合わせて書き出してください。

【重要：Deep Think プロセス必須】
1. まず analysis_thought で3ステップ推論を実行・言語化する
   - career_summary: 求職者の経歴・現状の要約
   - evidence_clues: 判断根拠となる発言・記載の引用
   - inference_logic: 直接記述がない項目の推論過程
   - pdf_vs_interview_gap: 建前と本音の食い違い分析
   - resignation_analysis: 退職理由の分析
   - tense_determination: 時制判定の根拠
2. 次に extracted_facts で事実情報を整理する
3. 最後に filemaker_mapping でフラグをマッピングする

【フラグ値は enum 完全一致】
filemaker_mapping のキーは「基本情報シートの列名」と一字一句完全一致させること。
フラグ列の値はフラグリストに記載されている選択肢の文言をそのままコピーすること。
言い換え・要約は禁止。「〜ような」「〜系」などの表現は使わない。

【基本情報シートの列名（filemaker_mapping のキーはこのいずれかと完全一致させること）】
${basicColumns}
${inputRulesBlock}
以下は3つの資料の全文です。面談メモ・PDF・フラグリストをそれぞれ個別に解析し、すべて最初から最後まで読んだうえで、記載がある項目を漏れなく filemaker_mapping に追加し、メモ列には要約を書いてください。
${filenameBlock}
${interviewQualityGate}

【面談の通話文字起こしメモ（会話内容の文字起こし）】
${interviewLog || "(なし)"}

【Web履歴書（PDFから抽出した本文）】
${pdfText || "(なし)"}

【フラグリスト（シート「リスト」。フラグ列の値はここに記載されている文言をそのままコピーすること）】
${flagListText || "(なし)"}

上記3つをすべて読み、3ステップ推論を実行してから、言及がある列は上記の列名のどれかと完全一致するキーで filemaker_mapping に追加すること。
直接記述がない項目も、周囲の文脈から最も妥当な値を推論し、安易にnullや空欄にしないこと。
出力はJSONのみ。`;
  return { systemInstruction, userPrompt };
}

/**
 * 02 Googleフォーム質問プロンプトを読み、Gemini用のプロンプトを組み立てる
 */
export function buildGoogleFormPrompt(commonAnalysisJson: unknown): {
  systemInstruction: string;
  userPrompt: string;
} {
  const spec = loadYamlSafe<Spec02>("02_google_form_prompt.yaml");

  const role = spec.role ?? "";
  const tone = spec.tone ?? "";
  const rules = (spec.absolute_rules ?? []).join("\n  - ");
  const finalInstruction = spec.final_instruction ?? "";

  const systemInstruction = `${role}\n\ntone: ${tone}\n\nabsolute_rules:\n  - ${rules}\n\n${finalInstruction}`;

  const userPrompt = `以下の共通解析JSONを入力として、Googleフォーム用の質問定義（form_metadata と questions）を生成してください。missing_items を補う質問を優先し、出力はJSONのみで説明は含めないでください。

【common_analysis_json】
${JSON.stringify(commonAnalysisJson, null, 2)}`;
  return { systemInstruction, userPrompt };
}

/**
 * 03 FileMaker用Excelプロンプトを読み、Gemini用のプロンプトを組み立てる
 */
export function buildFilemakerExcelPrompt(commonAnalysisJson: unknown): {
  systemInstruction: string;
  userPrompt: string;
} {
  const spec = loadYamlSafe<Spec03>("03_filemaker_excel_prompt.yaml");
  const fullPrompt = spec.prompt ?? "";

  const systemInstruction = fullPrompt;
  const userPrompt = `以下の common_analysis_json を入力として、仕様どおり excel_files 形式のJSON（基本情報シート・職歴情報シートの columns と rows）を出力してください。説明文は一切含めず、JSONのみを返してください。

【common_analysis_json】
${JSON.stringify(commonAnalysisJson, null, 2)}`;
  return { systemInstruction, userPrompt };
}
