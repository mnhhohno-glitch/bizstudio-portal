/**
 * Response Schema 定義 (Gemini API用)
 * 
 * src/constants/flags.ts の定数を唯一の参照元として使用
 * 文字列の直書きは禁止 - すべて定数ファイルから参照
 */

import { FLAG_DEFINITIONS, FILEMAKER_MAPPING_KEYS } from "@/constants/candidate-flags";

type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
};

function buildEnumProperty(
  description: string,
  enumValues: readonly string[]
): JsonSchemaProperty {
  return {
    type: "string",
    description,
    enum: enumValues,
  };
}

function buildStringProperty(description: string): JsonSchemaProperty {
  return { type: "string", description };
}

function buildIntegerProperty(description: string): JsonSchemaProperty {
  return { type: "integer", description };
}

function buildArrayProperty(description: string, itemType: JsonSchemaProperty): JsonSchemaProperty {
  return {
    type: "array",
    description,
    items: itemType,
  };
}

/**
 * Gemini 3.0 Flash の Deep Think 能力を強制活用する 3 層構造 Schema
 * 
 * 1. analysis_thought: AIの分析思考プロセス（事前解釈・根拠・推論）
 * 2. extracted_facts: 抽出された事実情報
 * 3. filemaker_mapping: 定数から自動生成されたenumによる完全一致出力
 */
export function buildCommonAnalysisResponseSchema() {
  return {
    type: "object",
    properties: {
      analysis_thought: {
        type: "object",
        description: "AIの分析思考プロセス。フラグを選ぶ前に必ず言語化すること",
        properties: {
          career_summary: buildStringProperty(
            "求職者の経歴・現状の要約（AIによる事前解釈）。職歴の流れ、スキルセット、現在の状況を簡潔にまとめる"
          ),
          evidence_clues: buildStringProperty(
            "判断の根拠となった面談ログの具体的な発言やPDFの記載。引用形式で記載"
          ),
          inference_logic: buildStringProperty(
            "明記がない情報をプロの洞察でどう推論したかの論理過程。「〜という発言から、〜と推測される」の形式で"
          ),
          pdf_vs_interview_gap: buildStringProperty(
            "PDFの建前データと面談ログの本音データの食い違い分析。矛盾がある場合はログを優先した根拠を記載"
          ),
          resignation_analysis: buildStringProperty(
            "退職理由の分析。過去型（逃げ）か未来型（攻め）かの判定根拠と、カテゴリ_大/中/小の選定理由"
          ),
          tense_determination: buildStringProperty(
            "時制（過去/未来/混在/不明）の判定根拠。「〜だった」「〜したい」などの発話パターンから判断"
          ),
        },
      },

      extracted_facts: {
        type: "object",
        description: "抽出された事実情報",
        properties: {
          candidate_no: buildStringProperty("5で始まる7桁の求職者番号"),
          candidate_name: buildStringProperty("求職者氏名"),
          work_history: buildArrayProperty(
            "職歴の配列。在籍順に並べる",
            {
              type: "object",
              properties: {
                企業名: buildStringProperty("会社名"),
                事業内容: buildStringProperty("会社の事業内容"),
                在籍期間_年: buildIntegerProperty("在籍年数"),
                在籍期間_ヶ月: buildIntegerProperty("在籍月数（12未満）"),
                職種フラグ: buildStringProperty("職種カテゴリ"),
                職種メモ: buildStringProperty("具体的な職務内容"),
                退職理由_大: buildEnumProperty("退職理由の大分類", FLAG_DEFINITIONS.カテゴリ_大),
                退職理由_中: buildEnumProperty("退職理由の中分類", FLAG_DEFINITIONS.カテゴリ_中),
                退職理由_小: buildEnumProperty("退職理由の小分類", FLAG_DEFINITIONS.カテゴリ_小),
                転職理由メモ: buildStringProperty("退職・転職理由の詳細メモ"),
              },
            }
          ),
          tense: buildEnumProperty("面談の時制", FLAG_DEFINITIONS.時制),
          reading_targets: buildArrayProperty(
            "読むべき内容・確認すべき論点",
            buildStringProperty("確認事項")
          ),
        },
      },

      filemaker_mapping: {
        type: "object",
        description: "FileMakerインポート用のマッピング。キーは基本情報シートの列名と完全一致させること",
        properties: {
          エージェント利用フラグ: buildEnumProperty("エージェント利用状況", FLAG_DEFINITIONS.エージェント利用フラグ),
          エージェント利用メモ: buildStringProperty("エージェント利用の詳細"),
          転職時期フラグ: buildEnumProperty("希望転職時期", FLAG_DEFINITIONS.転職時期フラグ),
          転職時期メモ: buildStringProperty("転職時期の詳細"),
          転職活動期間フラグ: buildEnumProperty("転職活動期間", FLAG_DEFINITIONS.転職活動期間フラグ),
          転職活動期間メモ: buildStringProperty("転職活動期間の詳細"),
          現在応募求人数: buildIntegerProperty("現在応募中の求人数"),
          応募種別フラグ: buildEnumProperty("応募状況", FLAG_DEFINITIONS.応募種別フラグ),
          応募状況メモ: buildStringProperty("応募状況の詳細"),
          学歴フラグ: buildEnumProperty("最終学歴", FLAG_DEFINITIONS.学歴フラグ),
          学歴メモ: buildStringProperty("学歴の詳細"),
          卒業年月: buildStringProperty("YYYY年M月 卒業 形式"),
          面談メモ: buildStringProperty("面談全体のメモ"),
          希望職種フラグ: buildStringProperty("希望職種カテゴリ"),
          希望職種メモ: buildStringProperty("希望職種の詳細"),
          希望業種フラグ: buildStringProperty("希望業種カテゴリ"),
          希望業種メモ: buildStringProperty("希望業種の詳細"),
          希望エリアフラグ: buildEnumProperty("希望勤務エリア", FLAG_DEFINITIONS.エリア),
          希望_都道府県: buildEnumProperty("希望都道府県", FLAG_DEFINITIONS.都道府県),
          希望_市区: buildStringProperty("希望市区"),
          希望エリアメモ: buildStringProperty("希望エリアの詳細"),
          現在年収: buildIntegerProperty("万円単位"),
          希望下限年収: buildIntegerProperty("万円単位"),
          希望年収: buildIntegerProperty("万円単位"),
          現年収メモ: buildStringProperty("現在年収の詳細"),
          下限年収メモ: buildStringProperty("下限年収の詳細"),
          希望年収メモ: buildStringProperty("希望年収の詳細"),
          希望曜日フラグ: buildEnumProperty("希望休日", FLAG_DEFINITIONS.希望曜日フラグ),
          希望曜日メモ: buildStringProperty("休日の詳細"),
          希望最大残業フラグ: buildEnumProperty("希望残業上限", FLAG_DEFINITIONS.希望最大残業フラグ),
          希望最大残業メモ: buildStringProperty("残業の詳細"),
          希望転勤フラグ: buildEnumProperty("転勤可否", FLAG_DEFINITIONS.希望転勤フラグ),
          希望転勤メモ: buildStringProperty("転勤の詳細"),
          自動車免許フラグ: buildEnumProperty("自動車免許", FLAG_DEFINITIONS.自動車免許フラグ),
          自動車免許メモ: buildStringProperty("免許の詳細"),
          語学フラグ: buildEnumProperty("語学", FLAG_DEFINITIONS.語学フラグ),
          語学スキルフラグ: buildEnumProperty("語学レベル", FLAG_DEFINITIONS.語学スキルフラグ),
          語学スキルメモ: buildStringProperty("語学の詳細"),
          日本語スキルフラグ: buildEnumProperty("日本語レベル", FLAG_DEFINITIONS.日本語スキルフラグ),
          日本語スキルメモ: buildStringProperty("日本語の詳細"),
          PCスキル_タイピングフラグ: buildEnumProperty("タイピングスキル", FLAG_DEFINITIONS.PCスキル_タイピングフラグ),
          PCスキル_タイピングメモ: buildStringProperty("タイピングの詳細"),
          PCスキル_Excelフラグ: buildEnumProperty("Excelスキル", FLAG_DEFINITIONS.PCスキル_Excelフラグ),
          PCスキル_Excelメモ: buildStringProperty("Excelの詳細"),
          PCスキル_Wordフラグ: buildEnumProperty("Wordスキル", FLAG_DEFINITIONS.PCスキル_Wordフラグ),
          PCスキル_Wordメモ: buildStringProperty("Wordの詳細"),
          PCスキル_PPTフラグ: buildEnumProperty("PowerPointスキル", FLAG_DEFINITIONS.PCスキル_PPTフラグ),
          PCスキル_PPTメモ: buildStringProperty("PowerPointの詳細"),
          応募書類状況フラグ: buildEnumProperty("書類作成状況", FLAG_DEFINITIONS.応募書類状況フラグ),
          応募書類状況メモ: buildStringProperty("書類状況の詳細"),
          応募書類サポートフラグ: buildEnumProperty("書類サポート方法", FLAG_DEFINITIONS.応募書類サポートフラグ),
          応募書類サポートメモ: buildStringProperty("サポートの詳細"),
          LINE設定フラグ: buildEnumProperty("連絡方法", FLAG_DEFINITIONS.LINE設定フラグ),
          LINE設定メモ: buildStringProperty("連絡方法の詳細"),
          求人送付フラグ: buildEnumProperty("求人送付", FLAG_DEFINITIONS.求人送付フラグ),
          求人送付予定時期: buildStringProperty("送付予定時期"),
          求人送付メモ: buildStringProperty("求人送付の詳細"),
          次回面談設定フラグ: buildStringProperty("次回面談設定状況"),
          次回面談予定日: buildStringProperty("YYYY/MM/DD形式"),
          次回面談予定時刻: buildStringProperty("HH:MM形式"),
          次回面談予定メモ: buildStringProperty("次回面談の詳細"),
          フリーメモ: buildStringProperty("自由記述メモ"),
          初回面談まとめ: buildStringProperty("面談内容の要約。求職者NO等のキー情報は含めない"),
          インポート用照合キー: buildIntegerProperty("求職者NO+1の8桁数値"),
        },
      },

      missing_items: buildArrayProperty(
        "3つの資料のいずれにも記載がなかった項目",
        buildStringProperty("不明項目")
      ),
    },
  };
}

/**
 * Geminiレスポンスを既存のインターフェースに変換するAdapter
 * analysis_thought を thought_process として保持しつつ、
 * 既存の Excel 生成ロジックが期待する型へ正確に変換する
 */
export function adaptGeminiResponseToCommonAnalysis(
  response: Record<string, unknown>
): {
  extracted_facts: Record<string, unknown>;
  filemaker_mapping: Record<string, unknown>;
  missing_items: string[];
  thought_process?: Record<string, unknown>;
} {
  const analysisThought = response.analysis_thought as Record<string, unknown> | undefined;
  const extractedFacts = response.extracted_facts as Record<string, unknown> | undefined;
  const filemakerMapping = response.filemaker_mapping as Record<string, unknown> | undefined;
  const missingItems = response.missing_items as string[] | undefined;

  const normalizedExtractedFacts: Record<string, unknown> = {
    candidate_no: extractedFacts?.candidate_no ?? "",
    candidate_name: extractedFacts?.candidate_name ?? "",
    work_history: Array.isArray(extractedFacts?.work_history) ? extractedFacts.work_history : [],
    tense: extractedFacts?.tense ?? "不明",
    reading_targets: Array.isArray(extractedFacts?.reading_targets) ? extractedFacts.reading_targets : [],
  };

  const normalizedFilemakerMapping: Record<string, unknown> = {};
  if (filemakerMapping && typeof filemakerMapping === "object") {
    for (const key of FILEMAKER_MAPPING_KEYS) {
      const value = filemakerMapping[key];
      if (value !== undefined && value !== null && value !== "") {
        normalizedFilemakerMapping[key] = value;
      }
    }
  }

  return {
    extracted_facts: normalizedExtractedFacts,
    filemaker_mapping: normalizedFilemakerMapping,
    missing_items: Array.isArray(missingItems) ? missingItems : [],
    thought_process: analysisThought,
  };
}

/**
 * フラグ値を検証し、無効な値を修正する
 * 定数ファイルのenumと完全一致しない場合は最も近い値を選択
 */
export function validateAndFixFlagValue(
  flagName: keyof typeof FLAG_DEFINITIONS,
  value: unknown
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const valueStr = String(value).trim();
  const validValues = FLAG_DEFINITIONS[flagName];

  if ((validValues as readonly string[]).includes(valueStr)) {
    return valueStr;
  }

  for (const validValue of validValues) {
    if (validValue.includes(valueStr) || valueStr.includes(validValue)) {
      console.warn(`[flagListSchema] Auto-corrected "${valueStr}" to "${validValue}" for ${flagName}`);
      return validValue;
    }
  }

  console.warn(`[flagListSchema] Invalid value "${valueStr}" for ${flagName}, keeping as-is`);
  return valueStr;
}
