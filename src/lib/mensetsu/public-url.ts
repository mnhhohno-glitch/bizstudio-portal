// T-206: 公開 URL（環境変数 MENSETSU_PUBLIC_BASE_URL ＋ "/" ＋ slug）
export const DEFAULT_MENSETSU_PUBLIC_BASE_URL = "https://mensetsu.bizstudio.co.jp";

export function mensetsuPublicBaseUrl(): string {
  const v = (process.env.MENSETSU_PUBLIC_BASE_URL || DEFAULT_MENSETSU_PUBLIC_BASE_URL).trim();
  return v.replace(/\/+$/, "");
}

export function mensetsuPublicUrl(slug: string): string {
  return `${mensetsuPublicBaseUrl()}/${slug}`;
}
