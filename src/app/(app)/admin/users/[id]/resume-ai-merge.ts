// T-098 追補: AI解析結果を form state にマージする共通ロジック。
// allowedKeys に含まれ、かつ「現在の form 値が空のフィールドのみ」を埋める。
// ボタン経路（単一ファイル・自タブ）と全画面D&D経路（複数ファイル・全タブ配布）の両方から使う。

export function mergeEmptyOnly<T extends Record<string, string>>(
  prev: T,
  data: Record<string, unknown>,
  allowedKeys: readonly (keyof T & string)[],
): { next: T; filled: number } {
  const next = { ...prev };
  let filled = 0;
  for (const key of allowedKeys) {
    // 空欄のみマージ: 現在の値が空文字 or 空白のみのときに限る（人の編集を上書きしない）
    const cur = (prev[key] ?? "").toString();
    if (cur.trim() !== "") continue;
    const v = data[key];
    if (typeof v === "string" && v.trim() !== "") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (next as any)[key] = v;
      filled++;
    }
  }
  return { next, filled };
}

export function filledMessage(filled: number): string {
  return filled > 0
    ? `${filled} 件を仮入力しました（空欄のみ）`
    : "新たに埋まる空欄はありませんでした";
}
