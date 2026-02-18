import { prisma } from "@/lib/prisma";
import { PageTitle, PageSubtleText } from "@/components/ui/PageTitle";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import CandidateForm from "./CandidateForm";
import Link from "next/link";

const PAGE_SIZE = 20;

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

type Props = {
  searchParams: Promise<{ page?: string }>;
};

export default async function CandidateMasterPage({ searchParams }: Props) {
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt(params.page || "1", 10));
  const skip = (currentPage - 1) * PAGE_SIZE;

  const [candidates, totalCount, employees] = await Promise.all([
    prisma.candidate.findMany({
      orderBy: { candidateNumber: "desc" },
      include: { employee: true },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.candidate.count(),
    prisma.employee.findMany({
      where: { status: "active" },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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

            {/* ページネーション */}
            <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-4">
              <div className="text-[13px] text-[#374151]/70">
                全 {totalCount.toLocaleString()} 件中 {skip + 1}〜{Math.min(skip + PAGE_SIZE, totalCount)} 件を表示
              </div>
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={`/admin/master?page=${currentPage - 1}`}
                    className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                  >
                    前へ
                  </Link>
                ) : (
                  <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                    前へ
                  </span>
                )}
                <span className="text-[13px] text-[#374151]">
                  {currentPage} / {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={`/admin/master?page=${currentPage + 1}`}
                    className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                  >
                    次へ
                  </Link>
                ) : (
                  <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                    次へ
                  </span>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
