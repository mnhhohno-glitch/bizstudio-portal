import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ANNOUNCEMENT_CATEGORIES, AnnouncementCategoryKey } from "@/lib/constants/announcement";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AnnouncementDetailPage({ params }: Props) {
  const { id } = await params;

  const announcement = await prisma.announcement.findUnique({
    where: { id, status: "PUBLISHED" },
    include: { author: { select: { name: true } } },
  });

  if (!announcement) {
    notFound();
  }

  const cat = ANNOUNCEMENT_CATEGORIES[announcement.category as AnnouncementCategoryKey];

  const formatDateTime = (date: Date | null) => {
    if (!date) return "";
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return `${y}年${m}月${d}日 ${h}:${min}`;
  };

  return (
    <div>
      <Link
        href="/announcements"
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6"
      >
        ← お知らせ一覧に戻る
      </Link>

      <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] mb-4"
          style={{ backgroundColor: cat.bgColor, color: cat.color }}
        >
          {cat.icon} {cat.label}
        </span>

        <h1 className="text-[20px] font-semibold text-[#374151]">
          {announcement.title}
        </h1>

        <p className="text-[12px] text-[#6B7280] mt-2">
          {formatDateTime(announcement.publishedAt)} ・ 投稿者: {announcement.author.name}
        </p>

        <hr className="my-6 border-[#E5E7EB]" />

        <div className="prose-custom">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-[20px] font-semibold mt-6 mb-3 text-[#374151]">{children}</h1>,
              h2: ({ children }) => <h2 className="text-[18px] font-semibold mt-6 mb-3 text-[#374151]">{children}</h2>,
              h3: ({ children }) => <h3 className="text-[16px] font-semibold mt-4 mb-2 text-[#374151]">{children}</h3>,
              p: ({ children }) => <p className="text-[14px] leading-relaxed mb-4 text-[#374151]">{children}</p>,
              ul: ({ children }) => <ul className="pl-6 mb-4 list-disc">{children}</ul>,
              ol: ({ children }) => <ol className="pl-6 mb-4 list-decimal">{children}</ol>,
              li: ({ children }) => <li className="text-[14px] mb-1 text-[#374151]">{children}</li>,
              code: ({ children, className }) => {
                const isInline = !className;
                if (isInline) {
                  return <code className="bg-[#F3F4F6] px-1.5 py-0.5 rounded text-[13px]">{children}</code>;
                }
                return <code className={className}>{children}</code>;
              },
              pre: ({ children }) => (
                <pre className="bg-[#1E293B] text-white p-4 rounded-[8px] overflow-x-auto mb-4 text-[13px]">
                  {children}
                </pre>
              ),
              a: ({ href, children }) => (
                <a href={href} className="text-[#2563EB] hover:underline" target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-[#E5E7EB] pl-4 my-4 text-[#6B7280] italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <table className="min-w-full border-collapse text-[14px] mb-4">{children}</table>
              ),
              th: ({ children }) => (
                <th className="border border-[#E5E7EB] px-3 py-2 bg-[#F9FAFB] text-left font-medium">{children}</th>
              ),
              td: ({ children }) => (
                <td className="border border-[#E5E7EB] px-3 py-2">{children}</td>
              ),
            }}
          >
            {announcement.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
