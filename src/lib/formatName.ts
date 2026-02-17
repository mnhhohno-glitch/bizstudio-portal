/**
 * 氏名の空白を半角スペース1つに統一する
 * - 全角スペース（\u3000）を半角スペースに変換
 * - 連続する空白を1つの半角スペースに集約
 * - 前後の空白をトリム
 *
 * 例：
 * - 「山田　太郎」→「山田 太郎」
 * - 「山田    太郎」→「山田 太郎」
 * - 「  山田 太郎  」→「山田 太郎」
 */
export function formatName(name: string): string {
  return name
    .replace(/\u3000/g, " ") // 全角スペースを半角に変換
    .replace(/\s+/g, " ") // 連続する空白を1つに集約
    .trim(); // 前後の空白をトリム
}

/**
 * 氏名のバリデーション
 * - 空文字でないこと
 * - 整形後に1文字以上あること
 */
export function validateName(name: string): { valid: boolean; error?: string } {
  const formatted = formatName(name);
  if (formatted.length === 0) {
    return { valid: false, error: "氏名を入力してください" };
  }
  return { valid: true };
}
