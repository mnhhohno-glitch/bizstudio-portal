/**
 * Googleフォーム質問定義JSONの型定義
 */

export interface FormMetadata {
  title?: string;
  description?: string;
}

export interface FormQuestion {
  id: string;
  title: string;
  required: boolean;
  type: "text" | "multiple_choice" | "checkbox" | "date" | "number" | string;
  options?: string[];
}

export interface GoogleFormDefinition {
  form_metadata: FormMetadata;
  questions: FormQuestion[];
}
