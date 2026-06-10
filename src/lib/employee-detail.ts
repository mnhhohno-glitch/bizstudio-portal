// T-096: 社員詳細管理の入力整形・フィールド定義の単一ソース。
// API ルート（/api/admin/employees/**）からのみ使う想定。
//
// 日付は罠 #17 厳守: クライアントからは "YYYY-MM-DD" 文字列で受け、
// @db.Date カラムへれっきとした UTC midnight Date として格納する
// （既存 DailySchedule.date / jstDateStringToDbDate と同じパターン）。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → @db.Date 用 Date。空文字/null → null。不正値・未指定 → undefined（更新しない）。 */
export function parseDateInput(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "string" && DATE_RE.test(v)) return new Date(`${v}T00:00:00.000Z`);
  return undefined;
}

/** 文字列入力。空文字 → null（クリア）。未指定 → undefined（更新しない）。 */
export function parseStringInput(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  return undefined;
}

/** 整数入力（金額等）。空文字/null → null。未指定・非数 → undefined（更新しない）。 */
export function parseIntInput(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.round(n);
  return undefined;
}

type FieldKind = "string" | "date" | "int";

function buildData(
  body: Record<string, unknown>,
  fields: Record<string, FieldKind>,
): Record<string, string | number | Date | null> {
  const data: Record<string, string | number | Date | null> = {};
  for (const [key, kind] of Object.entries(fields)) {
    const parsed =
      kind === "date" ? parseDateInput(body[key])
      : kind === "int" ? parseIntInput(body[key])
      : parseStringInput(body[key]);
    if (parsed !== undefined) data[key] = parsed;
  }
  return data;
}

// ---- セクション別フィールド定義（ホワイトリスト） ----

/** 基本情報（employees 本体）。employeeNumber / name / status は別途バリデーションして扱う。 */
export const BASIC_FIELDS: Record<string, FieldKind> = {
  furigana: "string",
  birthday: "date",
  gender: "string",
  hireDate: "date",
  resignDate: "date",
  address: "string",
  phone: "string",
  emergencyContactName: "string",
  emergencyContactRelation: "string",
  emergencyContactPhone: "string",
};

export const BANK_FIELDS: Record<string, FieldKind> = {
  bankCode: "string",
  bankName: "string",
  branchCode: "string",
  branchName: "string",
  accountType: "string",
  accountNumber: "string",
  accountHolderKana: "string",
};

export const INSURANCE_FIELDS: Record<string, FieldKind> = {
  employmentInsuranceStatus: "string",
  employmentInsuranceAcquiredDate: "date",
  employmentInsuranceLostDate: "date",
  employmentInsuranceArea: "string",
  employmentInsuranceNumber: "string",
  separationNoticeRequestDate: "date",
  socialInsuranceStatus: "string",
  socialInsuranceAcquiredDate: "date",
  socialInsuranceLostDate: "date",
  pensionNumber: "string",
  socialInsuranceNote: "string",
  dependentAcquiredDate: "date",
  dependentLostDate: "date",
};

export const SALARY_FIELDS: Record<string, FieldKind> = {
  baseSalary: "int",
  rankAllowance: "int",
  communicationAllowance: "int",
  specialAllowance: "int",
  commuteAllowance: "int",
  commuteRoute: "string",
  commuteFrom: "string",
  commuteTo: "string",
  commuteFareOneWay: "int",
  commuteFareRoundTrip: "int",
  memo: "string",
};

/** 貸与物の平文フィールド（パスワード類は SECRET_FIELD_COLUMNS で別扱い）。 */
export const EQUIPMENT_PLAIN_FIELDS: Record<string, FieldKind> = {
  pcLentDate: "date",
  pcNumber: "string",
  pcType: "string",
  deviceNumber: "string",
  mobileNumber: "string",
  mobileSerialNumber: "string",
  appleId: "string",
  googleAccount: "string",
  mobileManagementNo: "string",
};

/**
 * パスワード類: API の field 名 → DB カラム（Prisma フィールド）名。
 * このマップがホワイトリスト。ここに無い field 指定は 400。
 */
export const SECRET_FIELD_COLUMNS = {
  pcInitialPassword: "pcInitialPasswordEncrypted",
  lineworksPassword: "lineworksPasswordEncrypted",
  appleIdPassword: "appleIdPasswordEncrypted",
  googlePassword: "googlePasswordEncrypted",
  office365Password: "office365PasswordEncrypted",
} as const;

export type SecretFieldName = keyof typeof SECRET_FIELD_COLUMNS;

export const DEPENDENT_FIELDS: Record<string, FieldKind> = {
  name: "string",
  kana: "string",
  gender: "string",
  relation: "string",
  birthday: "date",
  annualIncome: "int",
  sortOrder: "int",
};

export function buildBasicData(body: Record<string, unknown>) {
  return buildData(body, BASIC_FIELDS);
}
export function buildBankData(body: Record<string, unknown>) {
  return buildData(body, BANK_FIELDS);
}
export function buildInsuranceData(body: Record<string, unknown>) {
  return buildData(body, INSURANCE_FIELDS);
}
export function buildSalaryData(body: Record<string, unknown>) {
  return buildData(body, SALARY_FIELDS);
}
export function buildEquipmentPlainData(body: Record<string, unknown>) {
  return buildData(body, EQUIPMENT_PLAIN_FIELDS);
}
export function buildDependentData(body: Record<string, unknown>) {
  return buildData(body, DEPENDENT_FIELDS);
}
