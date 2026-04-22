"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { PageTitle } from "@/components/ui/PageTitle";

const PAGE_TITLE = "タスク管理 - Bizstudio";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type TaskAssigneeStatusItem = {
  userId: string;
  isCompleted: boolean;
  completedAt: string | null;
};
type Task = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  createdAt: string;
  completionType: string;
  manualSortOrder: number | null;
  category: { id: string; name: string } | null;
  candidate: { name: string; candidateNumber: string } | null;
  assignees: { employee: { name: string } }[];
  assigneeStatuses: TaskAssigneeStatusItem[];
};
type Category = { id: string; name: string; group: { id: string; name: string; sortOrder: number } | null };
type CatGroup = { id: string; name: string; sortOrder: number };
type Employee = { id: string; name: string; employeeNo: string };
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

function SortableRow({ id, children }: { id: string; children: (props: { listeners: Record<string, unknown>; attributes: Record<string, unknown>; style: React.CSSProperties; setNodeRef: (node: HTMLElement | null) => void; isDragging: boolean }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };
  return <>{children({ listeners: listeners as unknown as Record<string, unknown>, attributes: attributes as unknown as Record<string, unknown>, style, setNodeRef, isDragging })}</>;
}

export default function TasksPage() {
  useEffect(() => { document.title = PAGE_TITLE; }, []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserMe | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catGroups, setCatGroups] = useState<CatGroup[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterCandidateName, setFilterCandidateName] = useState("");
  const [filterAssigneeId, setFilterAssigneeId] = useState("");
  const [viewMode, setViewMode] = useState<"mine" | "requested" | "all">("mine");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("manualSort");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // 3点セット一括起票
  const [bulk3ptOpen, setBulk3ptOpen] = useState(false);
  const [bulk3ptCandidateSearch, setBulk3ptCandidateSearch] = useState("");
  const [bulk3ptCandidateId, setBulk3ptCandidateId] = useState("");
  const [bulk3ptAssigneeId, setBulk3ptAssigneeId] = useState("");
  const [bulk3ptPriority, setBulk3ptPriority] = useState("MEDIUM");
  const [bulk3ptDueDate, setBulk3ptDueDate] = useState("");
  const [bulk3ptSubmitting, setBulk3ptSubmitting] = useState(false);
  const [bulk3ptCandidates, setBulk3ptCandidates] = useState<{ id: string; name: string; candidateNumber: string }[]>([]);

  // selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const headerCheckRef = useRef<HTMLInputElement>(null);

  // update indeterminate state
  useEffect(() => {
    if (headerCheckRef.current) {
      const count = selectedIds.size;
      const total = tasks.length;
      headerCheckRef.current.indeterminate = count > 0 && count < total;
    }
  }, [selectedIds, tasks]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const handleBulkComplete = async () => {
    if (selectedIds.size === 0 || bulkLoading) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/tasks/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED" }),
          })
        )
      );
      setSelectedIds(new Set());
      await fetchTasks();
    } catch { /* ignore */ }
    finally { setBulkLoading(false); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkLoading) return;
    if (!confirm(`選択した${selectedIds.size}件のタスクを削除しますか？この操作は取り消せません。`)) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          fetch(`/api/tasks/${id}`, { method: "DELETE" })
        )
      );
      setSelectedIds(new Set());
      await fetchTasks();
    } catch { /* ignore */ }
    finally { setBulkLoading(false); }
  };

  const handleSingleComplete = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "ステータス更新に失敗しました");
        return;
      }
      await fetchTasks();
    } catch { /* ignore */ }
  };

  const handleSingleDelete = async (id: string) => {
    if (!confirm("このタスクを削除しますか？この操作は取り消せません。")) return;
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await fetchTasks();
    } catch { /* ignore */ }
  };

  const handleClone = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}/clone`, { method: "POST" });
      if (!res.ok) return;
      const { id: newId } = await res.json();
      window.location.href = `/tasks/${newId}/edit`;
    } catch { /* ignore */ }
  };

  // fetch user & master data
  useEffect(() => {
    Promise.all([
      fetch("/api/users/me").then((r) => r.json()),
      fetch("/api/task-categories").then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
    ]).then(([u, catJson, empJson]) => {
      setUser(u);
      setCategories(catJson.categories ?? []);
      setCatGroups(catJson.groups ?? []);
      setEmployees(Array.isArray(empJson) ? empJson : []);
    });
  }, []);

  // fetch tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("view", viewMode);
      if (filterCategoryId) {
        params.set("categoryId", filterCategoryId);
      } else if (filterGroupId) {
        const groupCatIds = categories.filter((c) => c.group?.id === filterGroupId).map((c) => c.id);
        if (groupCatIds.length > 0) params.set("categoryId", groupCatIds.join(","));
      }
      if (filterPriority) params.set("priority", filterPriority);
      if (filterCandidateName.trim()) params.set("candidateName", filterCandidateName.trim());
      if (filterAssigneeId) params.set("assigneeId", filterAssigneeId);
      if (includeCompleted) params.set("includeCompleted", "true");
      params.set("page", String(page));
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/tasks?${params.toString()}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      setSelectedIds(new Set());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterGroupId, filterCategoryId, filterPriority, filterCandidateName, filterAssigneeId, viewMode, includeCompleted, page, sortBy, sortOrder, categories]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const resetPage = () => setPage(1);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "createdAt" || field === "dueDate" ? "desc" : "asc");
    }
    resetPage();
  };

  const sortIcon = (field: string) => {
    if (sortBy !== field) return "";
    return sortOrder === "asc" ? " ▲" : " ▼";
  };

  const SortIcons = ({ field }: { field: string }) => {
    const active = sortBy === field;
    return (
      <span className="ml-1 inline-flex flex-col text-[9px] leading-[10px]">
        <span className={active && sortOrder === "asc" ? "text-[#374151]" : "text-[#D1D5DB]"}>▲</span>
        <span className={active && sortOrder === "desc" ? "text-[#374151]" : "text-[#D1D5DB]"}>▼</span>
      </span>
    );
  };

  const isManualSort = sortBy === "manualSort";

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(tasks, oldIndex, newIndex);
    setTasks(reordered);

    // Save to API
    try {
      await fetch("/api/tasks/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: reordered.map((t) => t.id) }),
      });
    } catch { /* ignore */ }
  };

  const formatDate = (d: string | null) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ja-JP");
  };

  const isOverdue = (d: string | null, status: string) => {
    if (!d || status === "COMPLETED") return false;
    return new Date(d) < new Date(new Date().toDateString());
  };

  const debounceRef = useMemo(() => ({ timer: null as ReturnType<typeof setTimeout> | null }), []);
  const handleCandidateSearch = (v: string) => {
    setFilterCandidateName(v);
    if (debounceRef.timer) clearTimeout(debounceRef.timer);
    debounceRef.timer = setTimeout(() => resetPage(), 400);
  };

  // category group helper
  const getGroupName = (categoryId: string | undefined) => {
    if (!categoryId) return "-";
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.group?.name ?? "未分類";
  };

  // filtered categories based on selected group
  const filteredCategories = useMemo(() => {
    if (!filterGroupId) return categories;
    return categories.filter((c) => c.group?.id === filterGroupId);
  }, [categories, filterGroupId]);

  const selectCls =
    "rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  const renderRow = (t: Task, dragHandleProps?: { listeners?: Record<string, unknown>; attributes?: Record<string, unknown>; style?: React.CSSProperties; setNodeRef?: (node: HTMLElement | null) => void; isDragging?: boolean }) => {
    const rowStyle = dragHandleProps?.style;
    const isDragging = dragHandleProps?.isDragging;
    return (
      <tr
        key={t.id}
        ref={dragHandleProps?.setNodeRef}
        style={rowStyle}
        className={`border-b border-[#F3F4F6] transition-colors hover:bg-[#F9FAFB] ${t.status === "COMPLETED" ? "opacity-50" : ""} ${isDragging ? "bg-white shadow-lg z-10 relative" : ""}`}
      >
        <td className="w-8 px-1 py-3 text-center">
          {isManualSort ? (
            <span
              {...(dragHandleProps?.listeners ?? {})}
              {...(dragHandleProps?.attributes ?? {})}
              className="cursor-grab text-[#9CA3AF] hover:text-[#6B7280] select-none text-[16px] leading-none"
              title="ドラッグして並び替え"
            >
              ⠿
            </span>
          ) : (
            <span className="text-[#E5E7EB] text-[16px] leading-none select-none" title="カスタム順でのみ並び替え可能">⠿</span>
          )}
        </td>
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(t.id)}
            onChange={() => toggleSelect(t.id)}
            className="h-4 w-4 accent-[#2563EB]"
          />
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          {t.completionType === "all" && t.assignees.length > 1 && t.status !== "COMPLETED" ? (
            <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">
              {t.assigneeStatuses?.filter((s) => s.isCompleted).length ?? 0}/{t.assignees.length}完了
            </span>
          ) : (
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[t.status] ?? ""}`}>
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <Link href={`/tasks/${t.id}`} className="font-medium text-[#2563EB] hover:underline">
            {t.title}
          </Link>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
          {getGroupName(t.category?.id)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
          {t.category?.name ?? "-"}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-[#374151]">
          {t.candidate ? (
            <>
              {t.candidate.name}
              <span className="ml-1 text-[11px] text-[#9CA3AF]">（{t.candidate.candidateNumber}）</span>
            </>
          ) : "-"}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-[#374151]">
          {t.assignees.map((a) => a.employee.name).join("、") || "-"}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          {t.priority ? (
            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_COLOR[t.priority] ?? ""}`}>
              {PRIORITY_LABEL[t.priority] ?? t.priority}
            </span>
          ) : "-"}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 ${isOverdue(t.dueDate, t.status) ? "font-medium text-red-600" : "text-[#374151]"}`}>
          {formatDate(t.dueDate)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
          {formatDate(t.createdAt)}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1">
            {t.status !== "COMPLETED" && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleSingleComplete(t.id); }}
                className="rounded-[4px] p-1 text-[#9CA3AF] transition-colors hover:bg-green-50 hover:text-green-600"
                title={t.completionType === "all" && t.assignees.length > 1 ? "自分を完了にする" : "完了にする"}
              >
                ✓
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClone(t.id); }}
              className="rounded-[4px] p-1 text-[#9CA3AF] transition-colors hover:bg-blue-50 hover:text-blue-600"
              title="複製"
            >
              📋
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleSingleDelete(t.id); }}
              className="rounded-[4px] p-1 text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600"
              title="削除"
            >
              🗑
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      {/* header */}
      <div className="mb-6 flex items-center justify-between">
        <PageTitle>タスク管理</PageTitle>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              setBulk3ptOpen(true);
              if (bulk3ptCandidates.length === 0) {
                try {
                  const res = await fetch("/api/candidates");
                  if (res.ok) {
                    const data = await res.json();
                    setBulk3ptCandidates(Array.isArray(data) ? data : []);
                  }
                } catch { /* ignore */ }
              }
            }}
            className="rounded-[8px] border border-[#2563EB] bg-white px-5 py-2.5 text-[14px] font-medium text-[#2563EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#EFF6FF]"
          >
            3点セット一括起票
          </button>
          <Link
            href="/tasks/new"
            className="rounded-[8px] bg-[#2563EB] px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#1D4ED8]"
          >
            タスクを作成
          </Link>
        </div>
      </div>

      {/* view toggle + completed checkbox */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex rounded-lg border border-[#E5E7EB] overflow-hidden">
          {([
            { value: "mine" as const, label: "自分のタスク" },
            { value: "requested" as const, label: "依頼中" },
            { value: "all" as const, label: "すべて" },
          ]).map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => { setViewMode(tab.value); resetPage(); }}
              className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === tab.value
                  ? "bg-[#2563EB] text-white"
                  : "bg-white text-[#374151] hover:bg-[#F3F4F6]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => { setIncludeCompleted(e.target.checked); resetPage(); }}
            className="h-4 w-4 accent-[#2563EB]"
          />
          完了タスクを表示
        </label>
        {!isManualSort && (
          <button
            type="button"
            onClick={() => { setSortBy("manualSort"); setSortOrder("desc"); resetPage(); }}
            className="rounded-[6px] border border-[#D1D5DB] bg-white px-3 py-1.5 text-[12px] text-[#374151] transition-colors hover:bg-[#F3F4F6]"
          >
            ⠿ カスタム順に戻す
          </button>
        )}
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-[8px] border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">ステータス</label>
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); resetPage(); }} className={selectCls}>
            <option value="">全て</option>
            <option value="NOT_STARTED">未着手</option>
            <option value="IN_PROGRESS">対応中</option>
            <option value="COMPLETED">完了</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">大カテゴリ</label>
          <select value={filterGroupId} onChange={(e) => { setFilterGroupId(e.target.value); setFilterCategoryId(""); resetPage(); }} className={selectCls}>
            <option value="">全て</option>
            {catGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">カテゴリ</label>
          <select value={filterCategoryId} onChange={(e) => { setFilterCategoryId(e.target.value); resetPage(); }} className={selectCls}>
            <option value="">全て</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">優先度</label>
          <select value={filterPriority} onChange={(e) => { setFilterPriority(e.target.value); resetPage(); }} className={selectCls}>
            <option value="">全て</option>
            <option value="HIGH">高</option>
            <option value="MEDIUM">中</option>
            <option value="LOW">低</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">求職者</label>
          <input
            type="text"
            placeholder="名前で検索"
            value={filterCandidateName}
            onChange={(e) => handleCandidateSearch(e.target.value)}
            className={`${selectCls} w-[140px]`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">担当者</label>
          <select value={filterAssigneeId} onChange={(e) => { setFilterAssigneeId(e.target.value); resetPage(); }} className={selectCls}>
            <option value="">全て</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* bulk actions */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-[8px] border border-[#BFDBFE] bg-[#EEF2FF] px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#2563EB]">
            {selectedIds.size}件選択中
          </span>
          <button
            type="button"
            disabled={bulkLoading}
            onClick={handleBulkComplete}
            className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {bulkLoading ? "処理中..." : "一括完了"}
          </button>
          <button
            type="button"
            disabled={bulkLoading}
            onClick={handleBulkDelete}
            className="rounded-[6px] bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {bulkLoading ? "処理中..." : "一括削除"}
          </button>
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[12px] font-medium text-[#6B7280]">
              <th className="w-8 px-1 py-3"></th>
              <th className="w-10 px-3 py-3">
                <input
                  ref={headerCheckRef}
                  type="checkbox"
                  checked={tasks.length > 0 && selectedIds.size === tasks.length}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 accent-[#2563EB]"
                />
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("status")}>
                ステータス{sortIcon("status")}
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("title")}>
                タスクタイトル{sortIcon("title")}
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("categoryGroup")}>
                大カテゴリ<SortIcons field="categoryGroup" />
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("categoryName")}>
                カテゴリ<SortIcons field="categoryName" />
              </th>
              <th className="whitespace-nowrap px-4 py-3">求職者</th>
              <th className="whitespace-nowrap px-4 py-3">担当者</th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("priority")}>
                優先度<SortIcons field="priority" />
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("dueDate")}>
                期限<SortIcons field="dueDate" />
              </th>
              <th className="cursor-pointer whitespace-nowrap px-4 py-3 hover:text-[#374151]" onClick={() => handleSort("createdAt")}>
                作成日<SortIcons field="createdAt" />
              </th>
              <th className="w-10 px-3 py-3"></th>
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-[#6B7280]">
                  読み込み中...
                </td>
              </tr>
            </tbody>
          ) : tasks.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-[#6B7280]">
                  タスクがありません
                </td>
              </tr>
            </tbody>
          ) : isManualSort ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {tasks.map((t) => (
                    <SortableRow key={t.id} id={t.id}>
                      {(props) => renderRow(t, props)}
                    </SortableRow>
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          ) : (
            <tbody>
              {tasks.map((t) => renderRow(t))}
            </tbody>
          )}
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-[13px]">
          <p className="text-[#6B7280]">
            全{total}件中 {(page - 1) * 20 + 1}〜{Math.min(page * 20, total)}件
          </p>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className={`rounded-[6px] px-3 py-1.5 ${page <= 1 ? "cursor-not-allowed text-[#D1D5DB]" : "text-[#374151] hover:bg-[#F3F4F6]"}`}
            >
              前へ
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | "...")[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "..." ? (
                  <span key={`e${i}`} className="px-2 py-1.5 text-[#9CA3AF]">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`rounded-[6px] px-3 py-1.5 ${page === p ? "bg-[#2563EB] text-white" : "text-[#374151] hover:bg-[#F3F4F6]"}`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={`rounded-[6px] px-3 py-1.5 ${page >= totalPages ? "cursor-not-allowed text-[#D1D5DB]" : "text-[#374151] hover:bg-[#F3F4F6]"}`}
            >
              次へ
            </button>
          </div>
        </div>
      )}
      {/* 3点セット一括起票モーダル */}
      {bulk3ptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-[16px] font-bold text-[#111827]">応募書類3点セット一括起票</h3>
            <p className="mb-5 text-[13px] text-[#6B7280]">
              履歴書作成・職務経歴書作成・推薦状作成の3タスクを一括で起票します
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">求職者 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="名前で検索..."
                  value={bulk3ptCandidateSearch}
                  onChange={(e) => {
                    setBulk3ptCandidateSearch(e.target.value);
                    if (!e.target.value) setBulk3ptCandidateId("");
                  }}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[13px]"
                />
                {bulk3ptCandidateSearch && !bulk3ptCandidateId && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white shadow-md">
                    {bulk3ptCandidates
                      .filter((c) => c.name.includes(bulk3ptCandidateSearch))
                      .slice(0, 20)
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setBulk3ptCandidateId(c.id);
                            setBulk3ptCandidateSearch(c.name);
                          }}
                          className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#F3F4F6]"
                        >
                          {c.name}（{c.candidateNumber}）
                        </button>
                      ))}
                  </div>
                )}
                {bulk3ptCandidateId && (
                  <button
                    type="button"
                    onClick={() => { setBulk3ptCandidateId(""); setBulk3ptCandidateSearch(""); }}
                    className="mt-1 text-[12px] text-[#6B7280] hover:text-[#374151]"
                  >
                    選択解除
                  </button>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">担当者 <span className="text-red-500">*</span></label>
                <select
                  value={bulk3ptAssigneeId}
                  onChange={(e) => setBulk3ptAssigneeId(e.target.value)}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[13px]"
                >
                  <option value="">選択してください</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">優先度</label>
                <select
                  value={bulk3ptPriority}
                  onChange={(e) => setBulk3ptPriority(e.target.value)}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[13px]"
                >
                  <option value="HIGH">高</option>
                  <option value="MEDIUM">中</option>
                  <option value="LOW">低</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">期日</label>
                <input
                  type="date"
                  value={bulk3ptDueDate}
                  onChange={(e) => setBulk3ptDueDate(e.target.value)}
                  className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[13px]"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBulk3ptOpen(false)}
                className="rounded-lg border border-[#D1D5DB] px-4 py-2 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={bulk3ptSubmitting || !bulk3ptCandidateId || !bulk3ptAssigneeId}
                onClick={async () => {
                  setBulk3ptSubmitting(true);
                  try {
                    const res = await fetch("/api/tasks/bulk-create-3point", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        candidateId: bulk3ptCandidateId,
                        assigneeId: bulk3ptAssigneeId,
                        priority: bulk3ptPriority,
                        dueDate: bulk3ptDueDate || null,
                      }),
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      alert(err.error || "一括起票に失敗しました");
                      return;
                    }
                    const data = await res.json();
                    alert(data.message || "3タスクを一括起票しました");
                    setBulk3ptOpen(false);
                    setBulk3ptCandidateId("");
                    setBulk3ptCandidateSearch("");
                    setBulk3ptAssigneeId("");
                    setBulk3ptPriority("MEDIUM");
                    setBulk3ptDueDate("");
                    fetchTasks();
                  } catch {
                    alert("一括起票に失敗しました");
                  } finally {
                    setBulk3ptSubmitting(false);
                  }
                }}
                className="rounded-lg bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {bulk3ptSubmitting ? "起票中..." : "起票する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
