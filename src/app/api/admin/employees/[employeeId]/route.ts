import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/secret-encryption";
import { toJstDateString } from "@/lib/dailyReport/jstDate";
import {
  buildBasicData,
  buildBankData,
  buildInsuranceData,
  buildSalaryData,
  buildEquipmentPlainData,
  SECRET_FIELD_COLUMNS,
} from "@/lib/employee-detail";

// T-096: 社員詳細の取得・更新（admin 限定）。
// パスワード類は GET では「値の有無 boolean」のみ返す（暗号文も平文も返さない）。
// 復号は /secrets エンドポイントのみ。

function d(date: Date | null): string | null {
  return date ? toJstDateString(date) : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { employeeId } = await params;
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      bankAccount: true,
      insurance: true,
      salary: true,
      equipment: true,
      dependents: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!emp) {
    return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
  }

  const { equipment, bankAccount, insurance, salary, dependents, ...e } = emp;

  return NextResponse.json({
    employee: {
      id: e.id,
      employeeNumber: e.employeeNumber,
      name: e.name,
      status: e.status,
      paidLeave: e.paidLeave,
      jobCategory: e.jobCategory,
      furigana: e.furigana,
      birthday: d(e.birthday),
      gender: e.gender,
      hireDate: d(e.hireDate),
      resignDate: d(e.resignDate),
      postalCode: e.postalCode,
      address: e.address,
      phone: e.phone,
      emergencyContactName: e.emergencyContactName,
      emergencyContactRelation: e.emergencyContactRelation,
      emergencyContactPhone: e.emergencyContactPhone,
    },
    bankAccount: bankAccount
      ? {
          bankCode: bankAccount.bankCode,
          bankName: bankAccount.bankName,
          branchCode: bankAccount.branchCode,
          branchName: bankAccount.branchName,
          accountType: bankAccount.accountType,
          accountNumber: bankAccount.accountNumber,
          accountHolderKana: bankAccount.accountHolderKana,
        }
      : null,
    insurance: insurance
      ? {
          employmentInsuranceStatus: insurance.employmentInsuranceStatus,
          employmentInsuranceAcquiredDate: d(insurance.employmentInsuranceAcquiredDate),
          employmentInsuranceLostDate: d(insurance.employmentInsuranceLostDate),
          employmentInsuranceArea: insurance.employmentInsuranceArea,
          employmentInsuranceNumber: insurance.employmentInsuranceNumber,
          separationNoticeRequestDate: d(insurance.separationNoticeRequestDate),
          socialInsuranceStatus: insurance.socialInsuranceStatus,
          socialInsuranceAcquiredDate: d(insurance.socialInsuranceAcquiredDate),
          socialInsuranceLostDate: d(insurance.socialInsuranceLostDate),
          pensionNumber: insurance.pensionNumber,
          socialInsuranceNote: insurance.socialInsuranceNote,
          dependentAcquiredDate: d(insurance.dependentAcquiredDate),
          dependentLostDate: d(insurance.dependentLostDate),
        }
      : null,
    salary,
    equipment: equipment
      ? {
          pcLentDate: d(equipment.pcLentDate),
          pcNumber: equipment.pcNumber,
          pcType: equipment.pcType,
          deviceNumber: equipment.deviceNumber,
          mobileNumber: equipment.mobileNumber,
          mobileSerialNumber: equipment.mobileSerialNumber,
          appleId: equipment.appleId,
          googleAccount: equipment.googleAccount,
          mobileManagementNo: equipment.mobileManagementNo,
          hasPcInitialPassword: !!equipment.pcInitialPasswordEncrypted,
          hasLineworksPassword: !!equipment.lineworksPasswordEncrypted,
          hasAppleIdPassword: !!equipment.appleIdPasswordEncrypted,
          hasGooglePassword: !!equipment.googlePasswordEncrypted,
          hasOffice365Password: !!equipment.office365PasswordEncrypted,
        }
      : null,
    dependents: dependents.map((dep) => ({
      id: dep.id,
      name: dep.name,
      kana: dep.kana,
      gender: dep.gender,
      relation: dep.relation,
      birthday: d(dep.birthday),
      annualIncome: dep.annualIncome,
      sortOrder: dep.sortOrder,
    })),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.section !== "string" || typeof body.data !== "object" || body.data === null) {
    return NextResponse.json({ error: "入力が不正です（section / data が必要）" }, { status: 400 });
  }

  const { employeeId } = await params;
  const exists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
  }

  const section = body.section as string;
  const input = body.data as Record<string, unknown>;

  try {
    if (section === "basic") {
      const data = buildBasicData(input);
      // ヘッダー項目（社員番号・氏名・在籍状態）は個別バリデーション
      if (typeof input.name === "string" && input.name.trim()) data.name = input.name.trim();
      if (typeof input.employeeNumber === "string" && input.employeeNumber.trim()) {
        const num = input.employeeNumber.trim();
        const taken = await prisma.employee.findUnique({ where: { employeeNumber: num }, select: { id: true } });
        if (taken && taken.id !== employeeId) {
          return NextResponse.json({ error: "この社員番号は既に使われています" }, { status: 400 });
        }
        data.employeeNumber = num;
      }
      if (input.status === "active" || input.status === "disabled") data.status = input.status;
      if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
      }
      await prisma.employee.update({ where: { id: employeeId }, data });
    } else if (section === "bank") {
      const data = buildBankData(input);
      await prisma.employeeBankAccount.upsert({
        where: { employeeId },
        create: { employeeId, ...data },
        update: data,
      });
    } else if (section === "insurance") {
      const data = buildInsuranceData(input);
      await prisma.employeeInsurance.upsert({
        where: { employeeId },
        create: { employeeId, ...data },
        update: data,
      });
    } else if (section === "salary") {
      const data = buildSalaryData(input);
      await prisma.employeeSalary.upsert({
        where: { employeeId },
        create: { employeeId, ...data },
        update: data,
      });
    } else if (section === "equipment") {
      const data: Record<string, unknown> = buildEquipmentPlainData(input);
      // パスワード類: 平文を受領しサーバ側で暗号化。空文字・未指定は「変更しない」、
      // 明示的な null は「クリア」。
      for (const [fieldName, column] of Object.entries(SECRET_FIELD_COLUMNS)) {
        const v = input[fieldName];
        if (v === null) {
          data[column] = null;
        } else if (typeof v === "string" && v.length > 0) {
          data[column] = encryptSecret(v);
        }
      }
      await prisma.employeeEquipment.upsert({
        where: { employeeId },
        create: { employeeId, ...(data as object) },
        update: data,
      });
    } else {
      return NextResponse.json({ error: `不明な section です: ${section}` }, { status: 400 });
    }
  } catch (e) {
    console.error("Failed to update employee detail:", e);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
