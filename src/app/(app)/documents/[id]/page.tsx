import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import DocumentPdfButton from "./DocumentPdfButton";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DocumentDetailPage({ params }: Props) {
  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id, status: "PUBLISHED" },
    include: { author: { select: { name: true } } },
  });

  if (!document) {
    notFound();
  }

  const formatDate = (date: Date) => {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <div>
      <Link
        href="/documents"
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6"
      >
        ← 資料一覧に戻る
      </Link>

      <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-[#374151]">
              {document.title}
            </h1>
            <div className="flex items-center gap-2 mt-2 text-[12px] text-[#6B7280]">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DBEAFE] text-[#2563EB] text-[12px]">
                {document.category}
              </span>
              <span>・</span>
              <span>更新日: {formatDate(document.updatedAt)}</span>
            </div>
          </div>
          <DocumentPdfButton />
        </div>

        <div className="mt-6">
          <iframe
            src={document.url}
            className="w-full border border-[#E5E7EB] rounded-[8px]"
            style={{ height: "calc(100vh - 250px)" }}
            title={document.title}
            id="document-iframe"
          />
        </div>
      </div>
    </div>
  );
}
