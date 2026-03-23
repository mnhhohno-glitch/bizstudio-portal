export interface KnownErrorSuggestion {
  suggest_known_error: boolean;
  pattern_name: string;
  keywords: string[];
  solution: string;
  severity: string;
}

/**
 * Claudeの応答メッセージから ```json ... ``` ブロックを検出し、
 * suggest_known_error: true が含まれていればパースして返す。
 * 見つからなければ null を返す。
 */
export function parseKnownErrorSuggestion(content: string): KnownErrorSuggestion | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/;
  const match = content.match(jsonBlockRegex);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed.suggest_known_error === true && parsed.pattern_name && parsed.keywords?.length) {
      return parsed as KnownErrorSuggestion;
    }
  } catch {
    // JSON parse failure
  }
  return null;
}

/**
 * メッセージ本文から ```json ... ``` ブロックを除去して返す
 */
export function removeJsonBlock(content: string): string {
  return content.replace(/```json\s*[\s\S]*?```/, "").trim();
}
