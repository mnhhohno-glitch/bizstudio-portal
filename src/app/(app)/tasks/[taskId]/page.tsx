"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  category: { name: string } | null;
  candidate: { name: string; candidateNumber: string } | null;
  createdByUser: { name: string } | null;
  assignees: { employee: { name: string } }[];
  fieldValues: { field: { label: string; fieldType: string }; value: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "進行中",
  COMPLETED: "完了",
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

const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
};

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTask(data.task);
    } catch {
      alert("タスクの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">
        読み込み中...
      </div>
    );
  }

  if (!task) {
    return (
      <div className="py-20 text-center">
        <p className="text-[14px] text-[#6B7280]">タスクが見つかりません</p>
        <Link href="/tasks" className="mt-2 inline-block text-[14px] text-[#2563EB] hover:underline">
          タスク管理に戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/tasks"
          className="text-[14px] text-[#6B7280] hover:text-[#374151]"
        >
          &larr; タスク管理
        </Link>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* header */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${STATUS_COLOR[task.status] ?? ""}`}
          >
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${PRIORITY_COLOR[task.priority] ?? ""}`}
          >
            優先度: {PRIORITY_LABEL[task.priority] ?? task.priority}
          </span>
        </div>

        <h1 className="mb-4 text-[20px] font-bold text-[#1E3A8A]">
          {task.title}
        </h1>

        <dl className="space-y-3 text-[14px]">
          {task.category && (
            <Row label="カテゴリ" value={task.category.name} />
          )}
          {task.candidate && (
            <Row
              label="求職者"
              value={`${task.candidate.name}（${task.candidate.candidateNumber}）`}
            />
          )}
          <Row
            label="担当者"
            value={
              task.assignees.map((a) => a.employee.name).join("、") || "-"
            }
          />
          {task.dueDate && (
            <Row label="期限" value={new Date(task.dueDate).toLocaleDateString("ja-JP")} />
          )}
          <Row
            label="作成日"
            value={new Date(task.createdAt).toLocaleDateString("ja-JP")}
          />
          {task.createdByUser && <Row label="作成者" value={task.createdByUser.name} />}
          {task.description && (
            <div>
              <dt className="text-[12px] font-medium text-[#6B7280]">
                詳細メモ
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-[14px] text-[#374151]">
                {task.description}
              </dd>
            </div>
          )}
        </dl>

        {/* field values */}
        {task.fieldValues.length > 0 && (
          <div className="mt-6 border-t border-[#F3F4F6] pt-4">
            <h2 className="mb-3 text-[14px] font-bold text-[#374151]">
              テンプレート項目
            </h2>
            <dl className="space-y-2">
              {task.fieldValues.map((fv, i) => {
                let display = fv.value;
                if (
                  fv.field.fieldType === "MULTI_SELECT" &&
                  fv.value.startsWith("[")
                ) {
                  try {
                    display = (JSON.parse(fv.value) as string[]).join("、");
                  } catch {
                    /* keep raw */
                  }
                } else if (fv.field.fieldType === "CHECKBOX") {
                  display = fv.value === "true" ? "はい" : "いいえ";
                }
                return (
                  <Row key={i} label={fv.field.label} value={display} />
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-[#374151]">{value}</dd>
    </div>
  );
}
