"use client";

import Link from "next/link";
import { PageTitle } from "@/components/ui/PageTitle";

export default function TasksPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <PageTitle>タスク管理</PageTitle>
        <Link
          href="/tasks/new"
          className="rounded-[8px] bg-[#2563EB] px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#1D4ED8]"
        >
          タスクを作成
        </Link>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-8 text-center text-[14px] text-[#6B7280] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        タスク一覧は今後実装予定です。上のボタンからタスクを作成できます。
      </div>
    </div>
  );
}
