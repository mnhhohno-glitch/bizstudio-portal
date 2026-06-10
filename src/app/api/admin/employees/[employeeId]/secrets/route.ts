import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/secret-encryption";
import { SECRET_FIELD_COLUMNS, type SecretFieldName } from "@/lib/employee-detail";

// T-096: 貸与物パスワード類の復号取得（admin 限定）。
// 1リクエスト1項目。field 名はホワイトリスト検証。
// 初期表示には含めず、「表示」クリック時のみ呼ばれる設計。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const actor = await getSessionUser();
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { employeeId } = await params;
  const field = new URL(req.url).searchParams.get("field") ?? "";
  if (!(field in SECRET_FIELD_COLUMNS)) {
    return NextResponse.json({ error: "不正な field 指定です" }, { status: 400 });
  }
  const column = SECRET_FIELD_COLUMNS[field as SecretFieldName];

  const equipment = await prisma.employeeEquipment.findUnique({
    where: { employeeId },
    select: {
      pcInitialPasswordEncrypted: true,
      lineworksPasswordEncrypted: true,
      appleIdPasswordEncrypted: true,
      googlePasswordEncrypted: true,
      office365PasswordEncrypted: true,
    },
  });
  if (!equipment) {
    return NextResponse.json({ error: "貸与物情報が未登録です" }, { status: 404 });
  }

  const encrypted = equipment[column];
  if (!encrypted) {
    return NextResponse.json({ value: null });
  }

  try {
    return NextResponse.json({ value: decryptSecret(encrypted) });
  } catch (e) {
    console.error("Failed to decrypt employee secret:", e);
    return NextResponse.json({ error: "復号に失敗しました" }, { status: 500 });
  }
}
