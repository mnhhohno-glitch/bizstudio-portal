import { prisma } from "@/lib/prisma";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import CandidateForm from "./CandidateForm";

function formatDate(date: Date) {
  return date.toLocaleString("ja-JP");
}

function formatGender(gender: string | null) {
  if (!gender) return "-";
  switch (gender) {
    case "male": return "男性";
    case "female": return "女性";
    case "other": return "その他";
    default: return "-";
  }
}

export default async function CandidateMasterPage() {
  const [candidates, employees] = await Promise.all([
    prisma.candidate.findMany({
      orderBy: { candidateNumber: "desc" },
      include: { employee: true },
    }),
    prisma.employee.findMany({
      where: { status: "active" },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);

  return (
    <div>
      <PageTitle>求職者管理</PageTitle>
      <PageSubtleText>求職者の基本情報を管理します</PageSubtleText>

      <div className="mt-6">
        <Card>
          <CardHeader title="求職者マスター" />
          <CardBody>
            <CandidateForm employees={employees} />

            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>求職者番号</Th>
                    <Th>氏名</Th>
                    <Th>ふりがな</Th>
                    <Th>性別</Th>
                    <Th>担当CA</Th>
                    <Th>登録日時</Th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((cand) => (
                    <tr key={cand.id}>
                      <Td>
                        <span className="font-mono text-[13px]">{cand.candidateNumber}</span>
                      </Td>
                      <Td>{cand.name}</Td>
                      <Td>
                        <span className="text-[13px] text-[#374151]/70">
                          {cand.nameKana || "-"}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[13px]">{formatGender(cand.gender)}</span>
                      </Td>
                      <Td>
                        <span className="text-[13px]">{cand.employee?.name || "-"}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px] text-[#374151]/70">
                          {formatDate(cand.createdAt)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[14px] text-[#374151]/60">
                        求職者が登録されていません
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
