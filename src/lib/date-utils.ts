/**
 * Normalize a date value for Prisma DateTime fields.
 *
 * Handles formats returned by HTML date inputs, candidate-intake API,
 * and Japanese date strings. Returns full ISO-8601 or null.
 */
export function normalizeDate(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;

  // Already full ISO-8601
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)) {
    return trimmed;
  }

  const pad = (n: string) => n.padStart(2, "0");

  // "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(trimmed + "T00:00:00.000Z").toISOString();
  }

  // "YYYY/MM/DD" or "YYYY/M/D"
  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, y, m, d] = slashMatch;
    return new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00.000Z`).toISOString();
  }

  // "YYYY年MM月DD日" or "YYYY年M月D日"
  const jpFullMatch = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (jpFullMatch) {
    const [, y, m, d] = jpFullMatch;
    return new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00.000Z`).toISOString();
  }

  // "YYYY年MM月" (no day → use 1st)
  const jpMonthMatch = trimmed.match(/^(\d{4})年(\d{1,2})月/);
  if (jpMonthMatch) {
    const [, y, m] = jpMonthMatch;
    return new Date(`${y}-${pad(m)}-01T00:00:00.000Z`).toISOString();
  }

  // Fallback: try native Date parse
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Unparseable → null (avoid Prisma rejection)
  return null;
}

/**
 * Sanitize an object's DateTime fields in-place, converting non-ISO strings
 * and empty strings to Prisma-compatible values.
 */
export function sanitizeDateTimeFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[],
): T {
  for (const key of fields) {
    if (key in obj) {
      const v = obj[key];
      if (typeof v === "string") {
        (obj as Record<string, unknown>)[key] = normalizeDate(v);
      }
    }
  }
  return obj;
}
