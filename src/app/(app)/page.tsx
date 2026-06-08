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
import { isDailyReportEnabled } from "@/lib/dailyReport/featureFlag";
import DashboardTabs from "@/components/dashboard/DashboardTabs";
import PerformancePanel from "@/components/performance/PerformancePanel";
import DailyReportView from "@/components/dailyReport/DailyReportView";

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

  // T-085: 日報の「表示する人」プルダウン用に active ユーザー一覧を取得（人数が少ないので全員）。
  const reportUsers = await prisma.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

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

  // === 共通フラグメント（既存表示も 3 タブ表示も同じ JSX を流用） ===

  const tasksPanel = (
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
  );

  const announcementsPanel = (
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
  );

  const attendanceArea = (
    <>
      {!employee?.isExemptFromAttendance && (
        <AttendanceMiniCard
          status={todayAttendance?.status ?? null}
          clockIn={todayAttendance?.clockIn?.toISOString() ?? null}
          clockOut={todayAttendance?.clockOut?.toISOString() ?? null}
          totalWork={todayAttendance?.totalWork ?? 0}
          totalBreak={todayAttendance?.totalBreak ?? 0}
        />
      )}
      {!employee?.isExemptFromAttendance && <AttendanceAlertBanner />}
    </>
  );

  // === feature flag OFF：従来表示を完全保持（リグレッション防止） ===
  if (!isDailyReportEnabled()) {
    return (
      <div>
        <PageTitle>ダッシュボード</PageTitle>

        <div className="mt-4 flex gap-6">
          <div className="w-[440px] flex-shrink-0 hidden lg:block">
            <SchedulePanel />
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {attendanceArea}
              {tasksPanel}
            </div>
            <div>{announcementsPanel}</div>
          </div>
        </div>
      </div>
    );
  }

  // === feature flag ON：4 タブ（スケジュール（日報）｜実績表｜タスク｜お知らせ） ===
  // 実績表は独立タブで全幅表示（T-071 後修正）。スケジュールタブには日報・スケジュール・勤怠のみ。
  // 日報タブ：日報ビュー（上段スケジュール3要素[予定枠に作成導線・実績枠に完了チェック]＋下段当日実績/グラフ/所感）。
  // スケジュール作成（手動・AI・カレンダー同期）と完了チェックは DailyReportView 上段に移植済み（T-069 折りたたみ撤去）。
  const scheduleTab = (
    <div className="space-y-4">
      <DailyReportView currentUserId={user?.id ?? ""} users={reportUsers} isAdmin={user?.role === "admin"} />
      {attendanceArea}
    </div>
  );

  // 実績表タブ：全幅で配置（左右分割なし、コンテナ幅をフルに使う）
  const performanceTab = (
    <div className="w-full">
      <PerformancePanel />
    </div>
  );

  return (
    <div>
      <PageTitle>ダッシュボード</PageTitle>
      <DashboardTabs
        scheduleTab={scheduleTab}
        performanceTab={performanceTab}
        tasksTab={tasksPanel}
        announcementsTab={announcementsPanel}
      />
    </div>
  );
}
