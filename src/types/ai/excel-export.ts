/**
 * FileMaker用Excel出力（excel_files形式）の型定義
 */

export interface ExcelSheet {
  sheet_name: string;
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

export interface ExcelFilesOutput {
  excel_files: {
    recommended_filename_base?: string;
    sheets: ExcelSheet[];
  };
}
