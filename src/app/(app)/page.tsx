import { prisma } from "@/lib/prisma";
import { PageTitle } from "@/components/ui/PageTitle";
import Link from "next/link";
import { ANNOUNCEMENT_CATEGORIES, AnnouncementCategoryKey } from "@/lib/constants/announcement";

export default async function DashboardPage() {
  const recentAnnouncements = await prisma.announcement.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: 3,
    include: { author: { select: { name: true } } },
  });

  const formatDate = (date: Date | null) => {
    if (!date) return "";
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const truncateContent = (content: string, maxLength: number = 80) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + "…";
  };

  return (
    <div>
      <PageTitle>ダッシュボード</PageTitle>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-[#374151] flex items-center gap-2">
            📢 お知らせ
          </h2>
          <Link
            href="/announcements"
            className="text-[14px] text-[#2563EB] hover:underline"
          >
            すべて見る →
          </Link>
        </div>

        {recentAnnouncements.length === 0 ? (
          <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
            <p className="text-[14px] text-[#6B7280]">お知らせはまだありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentAnnouncements.map((announcement) => {
              const cat = ANNOUNCEMENT_CATEGORIES[announcement.category as AnnouncementCategoryKey];
              return (
                <Link
                  key={announcement.id}
                  href={`/announcements/${announcement.id}`}
                  className="block bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4 hover:border-[#2563EB]/30 transition-colors"
                >
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] mb-2"
                    style={{ backgroundColor: cat.bgColor, color: cat.color }}
                  >
                    {cat.icon} {cat.label}
                  </span>
                  <h3 className="text-[16px] font-semibold text-[#374151]">{announcement.title}</h3>
                  <p className="text-[12px] text-[#6B7280] mt-1">
                    {formatDate(announcement.publishedAt)}
                  </p>
                  <p className="text-[14px] text-[#6B7280] mt-2">
                    {truncateContent(announcement.content)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
