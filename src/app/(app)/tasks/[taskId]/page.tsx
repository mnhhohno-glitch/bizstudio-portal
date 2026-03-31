"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import TaskAttachments from "@/components/tasks/TaskAttachments";
import TaskComments from "@/components/tasks/TaskComments";
import { JobCategoryDisplay } from "@/components/tasks/JobCategorySelector";
import PointsModal from "@/components/tasks/PointsModal";

type Option = { id: string; label: string; value: string };
type FieldValue = {
  field: { id: string; label: string; fieldType: string; sortOrder: number; options: Option[] };
  value: string;
};
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
  createdAt: string;
  createdByUserId: string;
  category: { id: string; name: string } | null;
  candidate: { id: string; name: string; candidateNumber: string } | null;
  createdByUser: { id: string; name: string } | null;
  assignees: { employee: { id: string; name: string } }[];
  fieldValues: FieldValue[];
  attachments: unknown[];
  comments: unknown[];
};
type UserMe = { id: string; name: string; role: string };

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "対応中",
  COMPLETED: "完了",
};
const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
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
const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [pointsModalValue, setPointsModalValue] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const [res, userRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch("/api/users/me"),
      ]);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const userData = await userRes.json();
      setTask(data.task);
      setUser(userData);
    } catch {
      alert("タスクの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const canEdit = user && task && (task.createdByUserId === user.id || user.role === "admin");

  const handleStatusChange = async (newStatus: string) => {
    if (statusUpdating || !task) return;
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "ステータス更新に失敗しました");
        return;
      }
      setTask((prev) => (prev ? { ...prev, status: newStatus } : prev));
    } catch {
      alert("ステータス更新に失敗しました");
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("このタスクを削除しますか？この操作は取り消せません。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "削除に失敗しました");
        return;
      }
      router.push("/tasks");
    } catch {
      alert("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  };

  const handleClone = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/clone`, { method: "POST" });
      if (!res.ok) { alert("複製に失敗しました"); return; }
      const { id } = await res.json();
      router.push(`/tasks/${id}/edit`);
    } catch { alert("複製に失敗しました"); }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ja-JP");
  };

  const isOverdue = task && task.dueDate && task.status !== "COMPLETED" &&
    new Date(task.dueDate) < new Date(new Date().toDateString());

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
          タスク一覧に戻る
        </Link>
      </div>
    );
  }

  // Sort field values by field sortOrder
  const sortedFieldValues = [...task.fieldValues].sort(
    (a, b) => a.field.sortOrder - b.field.sortOrder
  );

  return (
    <div className="mx-auto max-w-3xl">
      {/* back link */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/tasks" className="text-[14px] text-[#6B7280] hover:text-[#374151]">
          &larr; タスク一覧に戻る
        </Link>
      </div>

      {/* header card */}
      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* status + priority badges + actions */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {/* status dropdown */}
          <select
            value={task.status}
            disabled={statusUpdating}
            onChange={(e) => handleStatusChange(e.target.value)}
            className={`rounded-full border-0 px-3 py-1 text-[12px] font-medium outline-none ${STATUS_COLOR[task.status] ?? ""}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>

          {task.priority && (
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${PRIORITY_COLOR[task.priority] ?? ""}`}>
              優先度: {PRIORITY_LABEL[task.priority] ?? task.priority}
            </span>
          )}

          {/* spacer */}
          <div className="flex-1" />

          {/* edit / delete buttons */}
          {canEdit && (
            <div className="flex gap-2">
              <Link
                href={`/tasks/${taskId}/edit`}
                className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6]"
              >
                編集
              </Link>
              <button
                type="button"
                onClick={handleClone}
                className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F3F4F6]"
              >
                複製
              </button>
              {task.status !== "COMPLETED" ? (
                <button
                  type="button"
                  disabled={statusUpdating}
                  onClick={() => handleStatusChange("COMPLETED")}
                  className="rounded-[6px] border border-green-200 px-3 py-1.5 text-[13px] font-medium text-green-600 transition-colors hover:bg-green-50"
                >
                  完了
                </button>
              ) : (
                <button
                  type="button"
                  disabled={statusUpdating}
                  onClick={() => handleStatusChange("NOT_STARTED")}
                  className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6]"
                >
                  未完了に戻す
                </button>
              )}
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded-[6px] border border-red-200 px-3 py-1.5 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                {deleting ? "削除中..." : "削除"}
              </button>
            </div>
          )}
        </div>

        {/* title */}
        <h1 className="mb-6 text-[20px] font-bold text-[#1E3A8A]">{task.title}</h1>

        {/* basic info */}
        <div className="space-y-3">
          <h2 className="text-[14px] font-bold text-[#374151]">基本情報</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {task.category && <InfoCell label="カテゴリ" value={task.category.name} />}
            <InfoCell
              label="求職者"
              value={
                task.candidate
                  ? `${task.candidate.name}（${task.candidate.candidateNumber}）`
                  : "-"
              }
            />
            <InfoCell
              label="担当者"
              value={task.assignees.map((a) => a.employee.name).join("、") || "-"}
            />
            <InfoCell
              label="期限"
              value={formatDate(task.dueDate)}
              className={isOverdue ? "text-red-600 font-medium" : undefined}
            />
            {task.createdByUser && <InfoCell label="作成者" value={task.createdByUser.name} />}
            <InfoCell label="作成日" value={formatDate(task.createdAt)} />
          </dl>
        </div>

        {/* field values */}
        {sortedFieldValues.length > 0 && (
          <div className="mt-6 border-t border-[#F3F4F6] pt-4">
            <h2 className="mb-3 text-[14px] font-bold text-[#374151]">テンプレート項目</h2>
            <dl className="space-y-3">
              {sortedFieldValues.map((fv, i) => {
                const { field, value } = fv;

                // MULTI_SELECT or CHECKBOX with options (JSON array)
                if ((field.fieldType === "MULTI_SELECT" || (field.fieldType === "CHECKBOX" && field.options.length > 0)) && value.startsWith("[")) {
                  let items: string[] = [];
                  try { items = JSON.parse(value) as string[]; } catch { /* keep empty */ }
                  if (items.length === 0) return null;
                  const labels = items.map((v) => field.options.find((o) => o.value === v)?.label ?? v);
                  return (
                    <div key={i}>
                      <dt className="text-[12px] font-medium text-[#6B7280]">{field.label}</dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {labels.map((l) => (
                          <span
                            key={l}
                            className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                          >
                            {l}
                          </span>
                        ))}
                      </dd>
                    </div>
                  );
                }

                // 職種: パンくず表示
                if (field.label === "職種" && value.startsWith("[")) {
                  return (
                    <div key={i}>
                      <dt className="text-[12px] font-medium text-[#6B7280]">{field.label}</dt>
                      <dd className="mt-1"><JobCategoryDisplay value={value} /></dd>
                    </div>
                  );
                }

                // 求人のポイント・条件: マークダウン表示
                if (field.label === "求人のポイント・条件" && value) {
                  return (
                    <div key={i}>
                      <dt className="text-[12px] font-medium text-[#6B7280]">
                        {field.label}
                        <button
                          type="button"
                          onClick={() => setPointsModalValue(value)}
                          className="ml-2 inline-flex items-center gap-1 rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#2563EB]"
                        >
                          全体表示
                        </button>
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-[14px] text-[#374151]">
                        {value}
                      </dd>
                    </div>
                  );
                }

                let display = value;
                if (field.fieldType === "SELECT" || field.fieldType === "RADIO") {
                  display = field.options.find((o) => o.value === value)?.label ?? value;
                } else if (field.fieldType === "CHECKBOX" && field.options.length === 0) {
                  display = value === "true" ? "はい" : "いいえ";
                }

                return (
                  <div key={i}>
                    <dt className="text-[12px] font-medium text-[#6B7280]">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-[14px] text-[#374151]">{display}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        {/* description */}
        {task.description && (
          <div className="mt-6 border-t border-[#F3F4F6] pt-4">
            <h2 className="mb-3 text-[14px] font-bold text-[#374151]">詳細メモ</h2>
            <p className="whitespace-pre-wrap text-[14px] text-[#374151]">{task.description}</p>
          </div>
        )}

        {/* attachments */}
        {user && (
          <TaskAttachments
            taskId={taskId}
            currentUserId={user.id}
            currentUserRole={user.role}
            candidateId={task.candidate?.id}
            candidateName={task.candidate ? `${task.candidate.name}（${task.candidate.candidateNumber}）` : null}
          />
        )}

        {/* comments */}
        {user && (
          <TaskComments
            taskId={taskId}
            currentUserId={user.id}
            currentUserRole={user.role}
          />
        )}
      </div>

      {/* 求人ポイント全体表示モーダル（閲覧専用） */}
      {pointsModalValue !== null && (
        <PointsModal
          value={pointsModalValue}
          readOnly
          onClose={() => setPointsModalValue(null)}
        />
      )}
    </div>
  );
}

function InfoCell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
      <dd className={`mt-0.5 text-[14px] ${className ?? "text-[#374151]"}`}>{value}</dd>
    </div>
  );
}
