"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { PageTitle } from "@/components/ui/PageTitle";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  createdAt: string;
  category: { id: string; name: string } | null;
  candidate: { name: string } | null;
  assignees: { employee: { name: string } }[];
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

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserMe | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catGroups, setCatGroups] = useState<CatGroup[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [catFilterLabel, setCatFilterLabel] = useState("全て");

  // filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterCandidateName, setFilterCandidateName] = useState("");
  const [filterAssigneeId, setFilterAssigneeId] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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
      await fetch(`/api/tasks/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
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
      if (filterCategoryId) params.set("categoryId", filterCategoryId);
      if (filterPriority) params.set("priority", filterPriority);
      if (filterCandidateName.trim()) params.set("candidateName", filterCandidateName.trim());
      if (filterAssigneeId) params.set("assigneeId", filterAssigneeId);
      if (showAll) params.set("showAll", "true");
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
  }, [filterStatus, filterCategoryId, filterPriority, filterCandidateName, filterAssigneeId, showAll, includeCompleted, page, sortBy, sortOrder]);

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

  const selectCls =
    "rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  return (
    <div>
      {/* header */}
      <div className="mb-6 flex items-center justify-between">
        <PageTitle>タスク管理</PageTitle>
        <Link
          href="/tasks/new"
          className="rounded-[8px] bg-[#2563EB] px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#1D4ED8]"
        >
          タスクを作成
        </Link>
      </div>

      {/* toggles */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {user?.role === "admin" && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setShowAll(e.target.checked);
                resetPage();
              }}
              className="h-4 w-4 accent-[#2563EB]"
            />
            全タスクを表示
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => {
              setIncludeCompleted(e.target.checked);
              resetPage();
            }}
            className="h-4 w-4 accent-[#2563EB]"
          />
          完了タスクを表示
        </label>
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
        <div className="relative">
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">カテゴリ</label>
          <button
            type="button"
            onClick={() => setCatDropdownOpen((v) => !v)}
            className={`${selectCls} flex items-center gap-1 min-w-[160px] text-left`}
          >
            <span className="flex-1 truncate">{catFilterLabel}</span>
            <span className="text-[10px] text-[#9CA3AF]">▼</span>
          </button>
          {catDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCatDropdownOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 max-h-[360px] w-[280px] overflow-y-auto rounded-[8px] border border-[#E5E7EB] bg-white shadow-lg">
                <button
                  type="button"
                  onClick={() => { setFilterCategoryId(""); setCatFilterLabel("全て"); setCatDropdownOpen(false); resetPage(); }}
                  className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#F3F4F6] ${!filterCategoryId ? "font-bold text-[#2563EB]" : "text-[#374151]"}`}
                >
                  全て
                </button>
                {(() => {
                  const sections: { label: string; cats: Category[] }[] = [];
                  for (const g of catGroups) {
                    const cats = categories.filter((c) => c.group?.id === g.id);
                    if (cats.length > 0) sections.push({ label: g.name, cats });
                  }
                  const ungrouped = categories.filter((c) => !c.group);
                  if (ungrouped.length > 0) sections.push({ label: "未分類", cats: ungrouped });

                  return sections.map((sec) => (
                    <div key={sec.label}>
                      <button
                        type="button"
                        onClick={() => {
                          const ids = sec.cats.map((c) => c.id).join(",");
                          setFilterCategoryId(ids);
                          setCatFilterLabel(sec.label);
                          setCatDropdownOpen(false);
                          resetPage();
                        }}
                        className="w-full border-t border-[#F3F4F6] bg-[#F9FAFB] px-3 py-1.5 text-left text-[12px] font-bold text-[#6B7280] hover:bg-[#EEF2FF] hover:text-[#2563EB]"
                      >
                        {sec.label}
                      </button>
                      {sec.cats.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setFilterCategoryId(c.id);
                            setCatFilterLabel(c.name);
                            setCatDropdownOpen(false);
                            resetPage();
                          }}
                          className={`w-full px-3 py-1.5 pl-6 text-left text-[13px] hover:bg-[#F3F4F6] ${filterCategoryId === c.id ? "font-bold text-[#2563EB]" : "text-[#374151]"}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </>
          )}
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
              <th className="whitespace-nowrap px-4 py-3">カテゴリ</th>
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
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[#6B7280]">
                  読み込み中...
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[#6B7280]">
                  タスクがありません
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.id} className={`border-b border-[#F3F4F6] transition-colors hover:bg-[#F9FAFB] ${t.status === "COMPLETED" ? "opacity-50" : ""}`}>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      className="h-4 w-4 accent-[#2563EB]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[t.status] ?? ""}`}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/tasks/${t.id}`} className="font-medium text-[#2563EB] hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
                    {t.category?.name ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[#374151]">
                    {t.candidate?.name ?? "-"}
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
                          title="完了にする"
                        >
                          ✓
                        </button>
                      )}
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
              ))
            )}
          </tbody>
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
    </div>
  );
}
