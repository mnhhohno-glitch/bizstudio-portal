// T-096: 社員詳細ページの共有型・クライアント側ヘルパ。
// 日付はすべて "YYYY-MM-DD" 文字列で受け渡しする（罠 #17: Date オブジェクトの
// タイムゾーン変換を挟まない）。年齢・在籍年数・支給総額は表示時計算のみで DB に保存しない。

export type EmployeeBasic = {
  id: string;
  employeeNumber: string;
  name: string;
  status: "active" | "disabled";
  paidLeave: number;
  jobCategory: string | null;
  furigana: string | null;
  birthday: string | null;
  gender: string | null;
  hireDate: string | null;
  resignDate: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
};

export type BankAccountData = {
  bankCode: string | null;
  bankName: string | null;
  branchCode: string | null;
  branchName: string | null;
  accountType: string | null;
  accountNumber: string | null;
  accountHolderKana: string | null;
};

export type InsuranceData = {
  employmentInsuranceStatus: string | null;
  employmentInsuranceAcquiredDate: string | null;
  employmentInsuranceLostDate: string | null;
  employmentInsuranceArea: string | null;
  employmentInsuranceNumber: string | null;
  separationNoticeRequestDate: string | null;
  socialInsuranceStatus: string | null;
  socialInsuranceAcquiredDate: string | null;
  socialInsuranceLostDate: string | null;
  pensionNumber: string | null;
  socialInsuranceNote: string | null;
  dependentAcquiredDate: string | null;
  dependentLostDate: string | null;
};

export type SalaryData = {
  baseSalary: number | null;
  rankAllowance: number | null;
  communicationAllowance: number | null;
  specialAllowance: number | null;
  commuteAllowance: number | null;
  commuteRoute: string | null;
  commuteFrom: string | null;
  commuteTo: string | null;
  commuteFareOneWay: number | null;
  commuteFareRoundTrip: number | null;
  memo: string | null;
};

export type EquipmentData = {
  pcLentDate: string | null;
  pcNumber: string | null;
  pcType: string | null;
  deviceNumber: string | null;
  mobileNumber: string | null;
  mobileSerialNumber: string | null;
  appleId: string | null;
  googleAccount: string | null;
  mobileManagementNo: string | null;
  hasPcInitialPassword: boolean;
  hasLineworksPassword: boolean;
  hasAppleIdPassword: boolean;
  hasGooglePassword: boolean;
  hasOffice365Password: boolean;
};

export type DependentData = {
  id: string;
  name: string | null;
  kana: string | null;
  gender: string | null;
  relation: string | null;
  birthday: string | null;
  annualIncome: number | null;
  sortOrder: number;
};

export type LeaveRequestItem = {
  id: string;
  targetDate: string;
  leaveType: "PAID_FULL" | "PAID_HALF" | "OTHER";
  halfDay: "AM" | "PM" | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string | null;
};

export type EmployeeDetailData = {
  employee: EmployeeBasic;
  bankAccount: BankAccountData | null;
  insurance: InsuranceData | null;
  salary: SalaryData | null;
  equipment: EquipmentData | null;
  dependents: DependentData[];
  leaveRequests: LeaveRequestItem[];
};

/** "YYYY-MM-DD" 同士の文字列演算で満年齢を計算（タイムゾーン非依存）。 */
export function calcAge(birthday: string | null, todayJst: string): number | null {
  if (!birthday) return null;
  const [by, bm, bd] = birthday.split("-").map(Number);
  const [ty, tm, td] = todayJst.split("-").map(Number);
  if (!by || !ty) return null;
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age >= 0 ? age : null;
}

/**
 * 在籍年数「N年Mヵ月」。在籍中=入社日→今日(JST)、退社済=入社日→退社日。
 * "YYYY-MM-DD" 文字列演算のみで計算する。
 */
export function calcTenure(
  hireDate: string | null,
  resignDate: string | null,
  todayJst: string,
): string | null {
  if (!hireDate) return null;
  const end = resignDate || todayJst;
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (!hy || !ey) return null;
  let months = (ey - hy) * 12 + (em - hm);
  if (ed < hd) months--;
  if (months < 0) return null;
  return `${Math.floor(months / 12)}年${months % 12}ヵ月`;
}

/** タブ単位の部分更新。失敗時は Error を投げる。 */
export async function patchEmployeeSection(
  employeeId: string,
  section: "basic" | "bank" | "insurance" | "salary" | "equipment",
  data: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/admin/employees/${employeeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, data }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `エラー ${res.status}`);
  }
}
