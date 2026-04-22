import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { PageTitle } from "@/components/ui/PageTitle";

export const metadata: Metadata = { title: "ダッシュボード" };
import Link from "next/link";
import { ANNOUNCEMENT_CATEGORIES, AnnouncementCategoryKey } from "@/lib/constants/announcement";
import AttendanceAlertBanner from "@/components/attendance/AlertBanner";
import AttendanceMiniCard from "@/components/attendance/AttendanceMiniCard";
import SchedulePanel from "@/components/schedule/SchedulePanel";
import { todayForDB } from "@/lib/attendance/timezone";

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "対応中",
};
const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
};
const PRIORITY_LABEL: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  LOW: "bg-gray-100 text-gray-600",
};

export default async function DashboardPage() {
  const user = await getSessionUser();

  const [recentAnnouncements, employee] = await Promise.all([
    prisma.announcement.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      include: { author: { select: { name: true } } },
    }),
    user
      ? prisma.employee.findFirst({
          where: { name: user.name, status: "active" },
          select: { id: true, isExemptFromAttendance: true },
        })
      : null,
  ]);

  // Fetch tasks and attendance in parallel
  const [myTasks, myTaskCount, todayAttendance] = await Promise.all([
    employee
      ? prisma.task.findMany({
          where: { assignees: { some: { employeeId: employee.id } }, status: { not: "COMPLETED" } },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          take: 5,
          include: { category: { select: { name: true } }, candidate: { select: { name: true } } },
        })
      : [],
    employee
      ? prisma.task.count({
          where: { assignees: { some: { employeeId: employee.id } }, status: { not: "COMPLETED" } },
        })
      : 0,
    employee
      ? prisma.dailyAttendance.findUnique({
          where: { employeeId_date: { employeeId: employee.id, date: todayForDB() } },
        })
      : null,
  ]);

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

      <div className="mt-4 flex gap-6">
        {/* Schedule Panel (left) */}
        <div className="w-[440px] flex-shrink-0 hidden lg:block">
          <SchedulePanel />
        </div>

        {/* Main content (right) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-3">
          {/* Attendance Mini Card (打刻不要の社員は非表示) */}
          {!employee?.isExemptFromAttendance && (
            <AttendanceMiniCard
              status={todayAttendance?.status ?? null}
              clockIn={todayAttendance?.clockIn?.toISOString() ?? null}
              clockOut={todayAttendance?.clockOut?.toISOString() ?? null}
              totalWork={todayAttendance?.totalWork ?? 0}
              totalBreak={todayAttendance?.totalBreak ?? 0}
            />
          )}

          {/* Alert Banner (打刻不要の社員は非表示) */}
          {!employee?.isExemptFromAttendance && (
          <AttendanceAlertBanner />
          )}

          {/* My Tasks */}
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
              <h2 className="text-[14px] font-medium text-[#374151] flex items-center gap-2">
                マイタスク
                {myTaskCount > 0 && (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[11px] font-medium text-white">
                    {myTaskCount}
                  </span>
                )}
              </h2>
              <Link href="/tasks" className="text-[13px] text-[#2563EB] hover:underline">すべて見る →</Link>
            </div>

            {myTasks.length === 0 ? (
              <p className="text-[13px] text-[#9CA3AF] text-center py-6">タスクはありません</p>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {myTasks.map((t) => {
                  const overdue = t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());
                  return (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#F9FAFB] transition-colors"
                    >
                      <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#374151]">
                        {t.title}
                      </span>
                      {t.priority && (
                        <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIORITY_COLOR[t.priority] ?? ""}`}>
                          {PRIORITY_LABEL[t.priority] ?? t.priority}
                        </span>
                      )}
                      {t.dueDate && (
                        <span className={`shrink-0 text-[12px] ${overdue ? "font-medium text-red-600" : "text-[#6B7280]"}`}>
                          {new Date(t.dueDate).toLocaleDateString("ja-JP")}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
              <h2 className="text-[14px] font-medium text-[#374151]">お知らせ</h2>
              <Link href="/announcements" className="text-[13px] text-[#2563EB] hover:underline">すべて見る →</Link>
            </div>

            {recentAnnouncements.length === 0 ? (
              <p className="text-[13px] text-[#9CA3AF] text-center py-6">お知らせはまだありません</p>
            ) : (
              <div className="divide-y divide-[#F3F4F6]">
                {recentAnnouncements.map((announcement) => {
                  const cat = ANNOUNCEMENT_CATEGORIES[announcement.category as AnnouncementCategoryKey];
                  return (
                    <Link
                      key={announcement.id}
                      href={`/announcements/${announcement.id}`}
                      className="block px-4 py-3 hover:bg-[#F9FAFB] transition-colors"
                    >
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] mb-1"
                        style={{ backgroundColor: cat.bgColor, color: cat.color }}
                      >
                        {cat.icon} {cat.label}
                      </span>
                      <h3 className="text-[14px] font-medium text-[#374151] line-clamp-1">{announcement.title}</h3>
                      <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                        {formatDate(announcement.publishedAt)}
                      </p>
                      <p className="text-[13px] text-[#6B7280] mt-1 line-clamp-2">
                        {truncateContent(announcement.content)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
