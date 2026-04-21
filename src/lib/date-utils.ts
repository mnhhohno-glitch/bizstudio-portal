/**
 * Normalize a date value for Prisma DateTime fields.
 *
 * HTML <input type="date"> returns "2026-05-01" (date-only) or "" (cleared).
 * Prisma DateTime requires full ISO-8601 ("2026-05-01T00:00:00.000Z") or null.
 */
export function normalizeDate(
  value: string | null | undefined,
): string | null {
  if (value == null || value.trim() === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(value + "T00:00:00.000Z").toISOString();
  }
  return value;
}

/**
 * Sanitize an object's DateTime fields in-place, converting date-only strings
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
