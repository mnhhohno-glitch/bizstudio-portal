"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Option = { id: string; label: string; value: string };
type Field = {
  id: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  placeholder: string | null;
  sortOrder: number;
  options: Option[];
};
type Category = {
  id: string;
  name: string;
  fields: Field[];
};
type Employee = { id: string; name: string; employeeNo: string };
type Candidate = { id: string; name: string; candidateNumber: string };
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
  createdByUserId: string;
  category: { id: string; name: string } | null;
  candidate: { id: string; name: string; candidateNumber: string } | null;
  assignees: { employee: { id: string; name: string; employeeNumber: string } }[];
  fieldValues: {
    field: { id: string; label: string; fieldType: string; sortOrder: number; options: Option[] };
    value: string;
  }[];
};
type UserMe = { id: string; name: string; role: string };

const STATUS_OPTIONS = [
  { value: "NOT_STARTED", label: "未着手" },
  { value: "IN_PROGRESS", label: "対応中" },
  { value: "COMPLETED", label: "完了" },
];
const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "高" },
  { value: "MEDIUM", label: "中" },
  { value: "LOW", label: "低" },
];

export default function TaskEditPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [user, setUser] = useState<UserMe | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("NOT_STARTED");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [categoryFields, setCategoryFields] = useState<Field[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [taskRes, userRes, catRes, empRes] = await Promise.all([
        fetch(`/api/tasks/${taskId}`),
        fetch("/api/users/me"),
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
      ]);

      const taskData = await taskRes.json();
      const userData = await userRes.json();
      const catData = await catRes.json();
      const empData = await empRes.json();

      const t: Task = taskData.task;
      if (!t) {
        alert("タスクが見つかりません");
        router.push("/tasks");
        return;
      }

      setTask(t);
      setUser(userData);
      setCategories(catData.categories ?? []);
      setEmployees(Array.isArray(empData) ? empData : []);

      // 権限チェック
      if (t.createdByUserId !== userData.id && userData.role !== "admin") {
        alert("編集権限がありません");
        router.push(`/tasks/${taskId}`);
        return;
      }

      // populate form
      setTitle(t.title);
      setDescription(t.description ?? "");
      setStatus(t.status);
      setPriority(t.priority ?? "MEDIUM");
      setDueDate(t.dueDate ? t.dueDate.split("T")[0] : "");
      setAssigneeIds(t.assignees.map((a) => a.employee.id));

      // find category fields
      const cats: Category[] = catData.categories ?? [];
      const cat = cats.find((c) => c.id === t.category?.id);
      if (cat) {
        setCategoryFields(cat.fields.sort((a, b) => a.sortOrder - b.sortOrder));
      }

      // populate field values
      const fvMap: Record<string, string> = {};
      for (const fv of t.fieldValues) {
        fvMap[fv.field.id] = fv.value;
      }
      setFieldValues(fvMap);
    } catch {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [taskId, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setFieldValue = (fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const toggleMultiSelect = (fieldId: string, optValue: string) => {
    const current: string[] = (() => {
      try { return JSON.parse(fieldValues[fieldId] || "[]"); } catch { return []; }
    })();
    const next = current.includes(optValue)
      ? current.filter((v) => v !== optValue)
      : [...current, optValue];
    setFieldValue(fieldId, JSON.stringify(next));
  };

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) { alert("タイトルは必須です"); return; }
    if (assigneeIds.length === 0) { alert("担当者は最低1名必要です"); return; }

    setSubmitting(true);
    try {
      const fvArr = Object.entries(fieldValues)
        .filter(([, v]) => v !== "")
        .map(([fieldId, value]) => ({ fieldId, value }));

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          assigneeIds,
          fieldValues: fvArr,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "更新に失敗しました");
        return;
      }

      router.push(`/tasks/${taskId}`);
    } catch {
      alert("更新に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">
        読み込み中...
      </div>
    );
  }

  if (!task) return null;

  return (
    <div className="mx-auto max-w-3xl">
      {/* back */}
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/tasks/${taskId}`} className="text-[14px] text-[#6B7280] hover:text-[#374151]">
          &larr; タスク詳細に戻る
        </Link>
        <span className="text-[14px] text-[#D1D5DB]">/</span>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">タスクを編集</h1>
      </div>

      <div className="space-y-6 rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* title */}
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[#374151]">
            タスクタイトル<span className="ml-1 text-red-500">*</span>
          </label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>

        {/* status + priority */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[#374151]">ステータス</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[#374151]">優先度</label>
            <div className="flex gap-4 pt-2">
              {PRIORITY_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="priority"
                    checked={priority === o.value}
                    onChange={() => setPriority(o.value)}
                    className="accent-[#2563EB]"
                  />
                  <span className="text-[14px] text-[#374151]">{o.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* due date */}
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[#374151]">期限</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`${inputCls} max-w-[200px]`}
          />
        </div>

        {/* description */}
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[#374151]">詳細メモ</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* assignees */}
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[#374151]">
            担当者<span className="ml-1 text-red-500">*</span>
          </label>
          {assigneeIds.length > 0 && (
            <p className="mb-2 text-[12px] font-medium text-[#2563EB]">{assigneeIds.length}名 選択中</p>
          )}
          <div className="max-h-[200px] overflow-y-auto rounded-[6px] border border-[#E5E7EB]">
            {employees.map((emp) => (
              <label
                key={emp.id}
                className={[
                  "flex cursor-pointer items-center gap-3 border-b border-[#F3F4F6] px-4 py-2.5 text-[14px] transition-colors last:border-b-0",
                  assigneeIds.includes(emp.id) ? "bg-[#EEF2FF]" : "hover:bg-[#F9FAFB]",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(emp.id)}
                  onChange={() => toggleAssignee(emp.id)}
                  className="h-4 w-4 accent-[#2563EB]"
                />
                <span className="font-medium text-[#374151]">{emp.name}</span>
                <span className="text-[12px] text-[#9CA3AF]">{emp.employeeNo}</span>
              </label>
            ))}
          </div>
        </div>

        {/* template fields */}
        {categoryFields.length > 0 && (
          <div>
            <h2 className="mb-3 text-[14px] font-bold text-[#374151]">
              テンプレート項目（{task.category?.name}）
            </h2>
            <div className="space-y-4">
              {categoryFields.map((field) => (
                <div key={field.id}>
                  <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                    {field.label}
                    {field.isRequired && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  {renderEditField(field, fieldValues, setFieldValue, toggleMultiSelect)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* actions */}
        <div className="flex items-center justify-end gap-3 border-t border-[#F3F4F6] pt-4">
          <Link
            href={`/tasks/${taskId}`}
            className="rounded-[6px] px-4 py-2 text-[14px] font-medium text-[#6B7280] hover:bg-[#F3F4F6]"
          >
            キャンセル
          </Link>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className={[
              "rounded-[8px] px-5 py-2.5 text-[14px] font-medium text-white transition-colors",
              submitting ? "cursor-not-allowed bg-[#93C5FD]" : "bg-[#2563EB] hover:bg-[#1D4ED8]",
            ].join(" ")}
          >
            {submitting ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderEditField(
  field: Field,
  fieldValues: Record<string, string>,
  setFieldValue: (id: string, v: string) => void,
  toggleMultiSelect: (id: string, v: string) => void
) {
  const value = fieldValues[field.id] ?? "";
  const base =
    "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

  switch (field.fieldType) {
    case "TEXT":
      return (
        <input
          type="text"
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
    case "TEXTAREA":
      return (
        <textarea
          rows={4}
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
    case "SELECT":
      return (
        <select value={value} onChange={(e) => setFieldValue(field.id, e.target.value)} className={base}>
          <option value="">選択してください</option>
          {field.options.map((opt) => (
            <option key={opt.id} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected: string[] = (() => {
        try { return JSON.parse(value || "[]"); } catch { return []; }
      })();
      return (
        <div>
          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((v) => {
                const opt = field.options.find((o) => o.value === v);
                return (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                  >
                    {opt?.label ?? v}
                    <button
                      type="button"
                      onClick={() => toggleMultiSelect(field.id, v)}
                      className="ml-0.5 text-[#93C5FD] hover:text-[#2563EB]"
                    >
                      &times;
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-3">
            {field.options.map((opt) => (
              <label key={opt.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggleMultiSelect(field.id, opt.value)}
                  className="h-4 w-4 shrink-0 accent-[#2563EB]"
                />
                <span className="text-[14px] text-[#374151]">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case "DATE":
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
    case "CHECKBOX":
      return (
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => setFieldValue(field.id, e.target.checked ? "true" : "false")}
            className="h-4 w-4 accent-[#2563EB]"
          />
          <span className="text-[14px] text-[#374151]">はい</span>
        </label>
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        />
      );
  }
}
