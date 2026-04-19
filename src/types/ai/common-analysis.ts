/**
 * 共通解析JSON（common_analysis_json）の型定義
 */

export interface WorkHistoryItem {
  company_name?: string | null;
  period?: string | null;
  job_type?: string | null;
  resignation_reason?: string | null;
  [key: string]: unknown;
}

/** 重要項目の根拠（抜粋・位置） */
export interface EvidenceEntry {
  excerpt?: string;
  position?: string;
  [key: string]: unknown;
}

export interface ExtractedFacts {
  candidate_no?: string | null;
  candidate_name?: string | null;
  work_history?: WorkHistoryItem[];
  /** 面談の時制。未来/過去/混在/不明 のいずれかで必ず出力 */
  tense?: string | null;
  /** 読むべき内容・確認すべき資料・論点の箇条書き */
  reading_targets?: string[];
  /** 重要項目（退職理由・時制など）への根拠箇所 */
  evidence_map?: Record<string, EvidenceEntry>;
  [key: string]: unknown;
}

export interface FilemakerMapping {
  [columnName: string]: string | number | boolean | null | undefined;
}

export interface CommonAnalysisJson {
  extracted_facts: ExtractedFacts;
  filemaker_mapping: FilemakerMapping;
  missing_items: string[];
}
