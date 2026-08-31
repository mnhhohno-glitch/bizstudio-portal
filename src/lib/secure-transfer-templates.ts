// T-185: セキュアファイル送信テンプレートの差し込みタグ処理。
// クライアント（送信画面・確認画面）とサーバーの両方から使う純粋関数のみを置く。
// Node 専用モジュールは import しないこと（secure-transfer-shared.ts と同方針）。
//
// 差し込みの方式（確定仕様）:
// - 件名・本文・署名の入力値にはタグ（{{企業名}} 等）をそのまま保持し、
//   プレビュー・確認画面・実送信の直前に applyTransferTemplateTags で置換する（保存時は生のまま）。
// - 値が入力済みのタグだけ置換する。未入力のタグは {{...}} のまま残し、
//   確認画面で hasUnresolvedTemplateBraces が真なら送信ボタンを無効化する
//   （未展開のまま取引先に届く事故を防ぐ・確定仕様）。
//   手入力のタグ崩れ（{{ だけ残る等）も同じ判定で送信を止める。

/** 差し込みタグとして認識する項目名（この3つのみ・確定仕様） */
export const TRANSFER_TEMPLATE_TAG_NAMES = ["企業名", "担当者名", "候補者名"] as const;

export type TransferTemplateTagName = (typeof TRANSFER_TEMPLATE_TAG_NAMES)[number];

/** タグ名 → 実際にテキスト中に現れる表記（{{企業名}}）。 */
export function tagToken(tag: TransferTemplateTagName): string {
  return `{{${tag}}}`;
}

/** 与えられたテキスト群に含まれる既知タグを、定義順で重複なく返す。 */
export function extractTransferTemplateTags(
  ...texts: (string | null | undefined)[]
): TransferTemplateTagName[] {
  const joined = texts.filter(Boolean).join("\n");
  return TRANSFER_TEMPLATE_TAG_NAMES.filter((tag) => joined.includes(tagToken(tag)));
}

/**
 * 既知タグを入力値で置換する。値が空（未入力・空白のみ）のタグは置換せず {{...}} のまま残す
 * → 確認画面の未展開チェックで送信が止まる。
 */
export function applyTransferTemplateTags(
  text: string,
  values: Partial<Record<TransferTemplateTagName, string>>
): string {
  let result = text;
  for (const tag of TRANSFER_TEMPLATE_TAG_NAMES) {
    const value = values[tag]?.trim();
    if (!value) continue;
    result = result.split(tagToken(tag)).join(value);
  }
  return result;
}

/** 置換後のテキストに {{ または }} が残っているか（未知タグ・タグ崩れも含めて検知する）。 */
export function hasUnresolvedTemplateBraces(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && (t.includes("{{") || t.includes("}}")));
}

/** 宛先テンプレートの担当者が既定でどの欄に入るか。 */
export const CONTACT_FIELDS = ["TO", "CC", "NONE"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export function isContactField(v: unknown): v is ContactField {
  return typeof v === "string" && (CONTACT_FIELDS as readonly string[]).includes(v);
}

/** 一覧のグレー表示判定: 最終使用が90日以上前、または一度も使われていない。 */
export function isTemplateStale(lastUsedAt: string | Date | null | undefined): boolean {
  if (!lastUsedAt) return true;
  const last = typeof lastUsedAt === "string" ? new Date(lastUsedAt) : lastUsedAt;
  return Date.now() - last.getTime() >= 90 * 24 * 60 * 60 * 1000;
}
