import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { toJstDateString, todayJstDateString } from "@/lib/dailyReport/jstDate";
import EmployeeDetailClient from "./EmployeeDetailClient";
import type { EmployeeDetailData } from "./detail-types";

// T-096: 社員詳細ページ（FileMaker 相当の6タブ管理）。admin 限定。
// [id] は User.id。Employee 未リンクの場合は作成導線を出す。

function d(date: Date | null): string | null {
  return date ? toJstDateString(date) : null;
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "admin") {
    return (
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">403 Forbidden</h1>
        <p className="mt-2 text-slate-600 text-sm">
          このページにアクセスする権限がありません。
        </p>
      </div>
    );
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, employeeNumber: true, status: true },
  });
  if (!user) {
    return (
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">社員が見つかりません</h1>
        <p className="mt-2 text-slate-600 text-sm">指定されたユーザーは存在しません。</p>
      </div>
    );
  }

  const emp = await prisma.employee.findUnique({
    where: { userId: id },
    include: {
      bankAccount: true,
      insurance: true,
      salary: true,
      equipment: true,
      dependents: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      leaveRequests: { orderBy: { targetDate: "desc" }, take: 200 },
    },
  });

  let detail: EmployeeDetailData | null = null;
  if (emp) {
    detail = {
      employee: {
        id: emp.id,
        employeeNumber: emp.employeeNumber,
        name: emp.name,
        status: emp.status,
        paidLeave: emp.paidLeave,
        jobCategory: emp.jobCategory,
        furigana: emp.furigana,
        birthday: d(emp.birthday),
        gender: emp.gender,
        hireDate: d(emp.hireDate),
        resignDate: d(emp.resignDate),
        address: emp.address,
        phone: emp.phone,
        emergencyContactName: emp.emergencyContactName,
        emergencyContactRelation: emp.emergencyContactRelation,
        emergencyContactPhone: emp.emergencyContactPhone,
      },
      bankAccount: emp.bankAccount
        ? {
            bankCode: emp.bankAccount.bankCode,
            bankName: emp.bankAccount.bankName,
            branchCode: emp.bankAccount.branchCode,
            branchName: emp.bankAccount.branchName,
            accountType: emp.bankAccount.accountType,
            accountNumber: emp.bankAccount.accountNumber,
            accountHolderKana: emp.bankAccount.accountHolderKana,
          }
        : null,
      insurance: emp.insurance
        ? {
            employmentInsuranceStatus: emp.insurance.employmentInsuranceStatus,
            employmentInsuranceAcquiredDate: d(emp.insurance.employmentInsuranceAcquiredDate),
            employmentInsuranceLostDate: d(emp.insurance.employmentInsuranceLostDate),
            employmentInsuranceArea: emp.insurance.employmentInsuranceArea,
            employmentInsuranceNumber: emp.insurance.employmentInsuranceNumber,
            separationNoticeRequestDate: d(emp.insurance.separationNoticeRequestDate),
            socialInsuranceStatus: emp.insurance.socialInsuranceStatus,
            socialInsuranceAcquiredDate: d(emp.insurance.socialInsuranceAcquiredDate),
            socialInsuranceLostDate: d(emp.insurance.socialInsuranceLostDate),
            pensionNumber: emp.insurance.pensionNumber,
            socialInsuranceNote: emp.insurance.socialInsuranceNote,
            dependentAcquiredDate: d(emp.insurance.dependentAcquiredDate),
            dependentLostDate: d(emp.insurance.dependentLostDate),
          }
        : null,
      salary: emp.salary
        ? {
            baseSalary: emp.salary.baseSalary,
            rankAllowance: emp.salary.rankAllowance,
            communicationAllowance: emp.salary.communicationAllowance,
            specialAllowance: emp.salary.specialAllowance,
            commuteAllowance: emp.salary.commuteAllowance,
            commuteRoute: emp.salary.commuteRoute,
            commuteFrom: emp.salary.commuteFrom,
            commuteTo: emp.salary.commuteTo,
            commuteFareOneWay: emp.salary.commuteFareOneWay,
            commuteFareRoundTrip: emp.salary.commuteFareRoundTrip,
            memo: emp.salary.memo,
          }
        : null,
      // パスワード類は「値の有無」のみクライアントへ渡す（復号値は /secrets API のみ）
      equipment: emp.equipment
        ? {
            pcLentDate: d(emp.equipment.pcLentDate),
            pcNumber: emp.equipment.pcNumber,
            pcType: emp.equipment.pcType,
            deviceNumber: emp.equipment.deviceNumber,
            mobileNumber: emp.equipment.mobileNumber,
            mobileSerialNumber: emp.equipment.mobileSerialNumber,
            appleId: emp.equipment.appleId,
            googleAccount: emp.equipment.googleAccount,
            mobileManagementNo: emp.equipment.mobileManagementNo,
            hasPcInitialPassword: !!emp.equipment.pcInitialPasswordEncrypted,
            hasLineworksPassword: !!emp.equipment.lineworksPasswordEncrypted,
            hasAppleIdPassword: !!emp.equipment.appleIdPasswordEncrypted,
            hasGooglePassword: !!emp.equipment.googlePasswordEncrypted,
            hasOffice365Password: !!emp.equipment.office365PasswordEncrypted,
          }
        : null,
      dependents: emp.dependents.map((dep) => ({
        id: dep.id,
        name: dep.name,
        kana: dep.kana,
        gender: dep.gender,
        relation: dep.relation,
        birthday: d(dep.birthday),
        annualIncome: dep.annualIncome,
        sortOrder: dep.sortOrder,
      })),
      leaveRequests: emp.leaveRequests.map((lr) => ({
        id: lr.id,
        targetDate: d(lr.targetDate) ?? "",
        leaveType: lr.leaveType,
        halfDay: lr.halfDay,
        status: lr.status,
        reason: lr.reason,
      })),
    };
  }

  return (
    <div>
      <EmployeeDetailClient
        userId={user.id}
        userName={user.name}
        userEmail={user.email}
        userEmployeeNumber={user.employeeNumber}
        detail={detail}
        todayJst={todayJstDateString()}
      />
    </div>
  );
}
