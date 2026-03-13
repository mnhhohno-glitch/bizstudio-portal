"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ---------- types ---------- */

type Candidate = { id: string; candidateNo: string; name: string };
type Employee = { id: string; employeeNo: string; name: string };
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
  description: string | null;
  fields: Field[];
};

const STEPS = [
  "求職者選択",
  "カテゴリ選択",
  "テンプレート入力",
  "担当者選択",
  "追加情報",
  "確認・作成",
];

/* ========================================================== */

export default function TaskNewPage() {
  const router = useRouter();

  /* ----- master data ----- */
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  /* ----- wizard state ----- */
  const [step, setStep] = useState(0);

  // step 0
  const [withCandidate, setWithCandidate] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");

  // step 1
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // step 2
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // step 3
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");

  // step 4
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");

  // step 5
  const [submitting, setSubmitting] = useState(false);

  /* ----- derived ----- */
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );
  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === candidateId) ?? null,
    [candidates, candidateId]
  );

  /* ----- fetch master data ----- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, empRes, canRes] = await Promise.all([
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
        fetch("/api/candidates"),
      ]);
      const catJson = await catRes.json();
      const empJson = await empRes.json();
      const canJson = await canRes.json();
      setCategories(catJson.categories ?? []);
      setEmployees(Array.isArray(empJson) ? empJson : []);
      setCandidates(Array.isArray(canJson) ? canJson : []);
    } catch {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ----- auto title ----- */
  useEffect(() => {
    if (step === 4) {
      const catName = selectedCategory?.name ?? "";
      const canName = selectedCandidate?.name ?? "";
      setTitle(canName ? `${catName} - ${canName}` : catName);
    }
  }, [step, selectedCategory, selectedCandidate]);

  /* ----- step validation ----- */
  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return !withCandidate || !!candidateId;
      case 1:
        return !!categoryId;
      case 2: {
        if (!selectedCategory) return false;
        return selectedCategory.fields
          .filter((f) => f.isRequired)
          .every((f) => {
            const v = fieldValues[f.id];
            return v !== undefined && v !== "";
          });
      }
      case 3:
        return assigneeIds.length > 0;
      case 4:
        return !!title.trim();
      default:
        return true;
    }
  };

  /* ----- submit ----- */
  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          categoryId,
          candidateId: withCandidate ? candidateId : null,
          status: "NOT_STARTED",
          priority,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          assigneeIds,
          fieldValues: Object.entries(fieldValues)
            .filter(([, v]) => v !== "")
            .map(([fieldId, value]) => ({ fieldId, value })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "タスク作成に失敗しました");
        return;
      }

      const { id } = await res.json();
      alert("タスクを作成しました");
      router.push(`/tasks/${id}`);
    } catch {
      alert("タスク作成に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- helpers ----- */
  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.candidateNo.toLowerCase().includes(q)
    );
  }, [candidates, candidateSearch]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, employeeSearch]);

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const setFieldValue = (fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const toggleMultiSelect = (fieldId: string, optValue: string) => {
    const current: string[] = (() => {
      try {
        return JSON.parse(fieldValues[fieldId] || "[]");
      } catch {
        return [];
      }
    })();
    const next = current.includes(optValue)
      ? current.filter((v) => v !== optValue)
      : [...current, optValue];
    setFieldValue(fieldId, JSON.stringify(next));
  };

  const priorityLabel = (p: string) =>
    p === "HIGH" ? "高" : p === "MEDIUM" ? "中" : "低";

  /* ----- loading ----- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[14px] text-[#6B7280]">
        読み込み中...
      </div>
    );
  }

  /* ========================================================== */
  return (
    <div className="mx-auto max-w-3xl">
      {/* header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/tasks"
          className="text-[14px] text-[#6B7280] hover:text-[#374151]"
        >
          &larr; タスク管理
        </Link>
        <span className="text-[14px] text-[#D1D5DB]">/</span>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">タスクを作成</h1>
      </div>

      {/* step indicator */}
      <div className="mb-8 flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={[
                "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold",
                i < step
                  ? "bg-[#2563EB] text-white"
                  : i === step
                    ? "bg-[#2563EB] text-white ring-4 ring-[#BFDBFE]"
                    : "bg-[#E5E7EB] text-[#9CA3AF]",
              ].join(" ")}
            >
              {i < step ? "\u2713" : i + 1}
            </div>
            <span
              className={[
                "text-[11px] text-center leading-tight",
                i <= step ? "text-[#374151] font-medium" : "text-[#9CA3AF]",
              ].join(" ")}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* card */}
      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        {/* ----- Step 0: 求職者選択 ----- */}
        {step === 0 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              求職者選択（任意）
            </h2>
            <label className="mb-4 flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={withCandidate}
                onChange={(e) => {
                  setWithCandidate(e.target.checked);
                  if (!e.target.checked) setCandidateId(null);
                }}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span className="text-[14px] text-[#374151]">
                求職者を選択する
              </span>
            </label>
            {withCandidate && (
              <div>
                <input
                  type="text"
                  placeholder="名前・求職者番号で検索"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="mb-3 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
                <div className="max-h-[300px] overflow-y-auto rounded-[6px] border border-[#E5E7EB]">
                  {filteredCandidates.length === 0 && (
                    <p className="p-4 text-center text-[13px] text-[#9CA3AF]">
                      該当する求職者がありません
                    </p>
                  )}
                  {filteredCandidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCandidateId(c.id)}
                      className={[
                        "flex w-full items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 text-left text-[14px] transition-colors last:border-b-0",
                        candidateId === c.id
                          ? "bg-[#EEF2FF] text-[#2563EB]"
                          : "hover:bg-[#F9FAFB] text-[#374151]",
                      ].join(" ")}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-[12px] text-[#9CA3AF]">
                        {c.candidateNo}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ----- Step 1: カテゴリ選択 ----- */}
        {step === 1 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              タスクカテゴリ選択
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(cat.id);
                    setFieldValues({});
                  }}
                  className={[
                    "rounded-[8px] border-2 p-4 text-left transition-colors",
                    categoryId === cat.id
                      ? "border-[#2563EB] bg-[#EEF2FF]"
                      : "border-[#E5E7EB] hover:border-[#93C5FD] hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[14px] font-bold text-[#374151]">
                    {cat.name}
                  </p>
                  {cat.description && (
                    <p className="mt-1 text-[12px] text-[#6B7280]">
                      {cat.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ----- Step 2: テンプレート入力 ----- */}
        {step === 2 && selectedCategory && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              {selectedCategory.name} - テンプレート入力
            </h2>
            {selectedCategory.fields.length === 0 ? (
              <p className="text-[14px] text-[#6B7280]">
                テンプレート項目はありません。次へ進んでください。
              </p>
            ) : (
              <div className="space-y-5">
                {selectedCategory.fields.map((field) => (
                  <div key={field.id}>
                    <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                      {field.label}
                      {field.isRequired && (
                        <span className="ml-1 text-red-500">*</span>
                      )}
                    </label>
                    {renderField(field, fieldValues, setFieldValue, toggleMultiSelect)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ----- Step 3: 担当者選択 ----- */}
        {step === 3 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              担当者選択（必須）
            </h2>
            <input
              type="text"
              placeholder="名前で検索"
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
              className="mb-3 w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            {assigneeIds.length > 0 && (
              <p className="mb-2 text-[12px] text-[#2563EB] font-medium">
                {assigneeIds.length}名 選択中
              </p>
            )}
            <div className="max-h-[300px] overflow-y-auto rounded-[6px] border border-[#E5E7EB]">
              {filteredEmployees.length === 0 && (
                <p className="p-4 text-center text-[13px] text-[#9CA3AF]">
                  該当する社員がいません
                </p>
              )}
              {filteredEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className={[
                    "flex cursor-pointer items-center gap-3 border-b border-[#F3F4F6] px-4 py-3 text-[14px] transition-colors last:border-b-0",
                    assigneeIds.includes(emp.id)
                      ? "bg-[#EEF2FF]"
                      : "hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(emp.id)}
                    onChange={() => toggleAssignee(emp.id)}
                    className="h-4 w-4 accent-[#2563EB]"
                  />
                  <span className="font-medium text-[#374151]">{emp.name}</span>
                  <span className="text-[12px] text-[#9CA3AF]">
                    {emp.employeeNo}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ----- Step 4: 追加情報 ----- */}
        {step === 4 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              追加情報
            </h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  タスクタイトル<span className="ml-1 text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  詳細メモ（任意）
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  期限（任意）
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  優先度
                </label>
                <div className="flex gap-4">
                  {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="priority"
                        checked={priority === p}
                        onChange={() => setPriority(p)}
                        className="accent-[#2563EB]"
                      />
                      <span className="text-[14px] text-[#374151]">
                        {priorityLabel(p)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----- Step 5: 確認 ----- */}
        {step === 5 && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              入力内容の確認
            </h2>
            <dl className="space-y-3 text-[14px]">
              <ConfirmRow label="タスクタイトル" value={title} />
              {selectedCandidate && (
                <ConfirmRow label="求職者" value={selectedCandidate.name} />
              )}
              <ConfirmRow
                label="カテゴリ"
                value={selectedCategory?.name ?? "-"}
              />
              <ConfirmRow
                label="担当者"
                value={
                  employees
                    .filter((e) => assigneeIds.includes(e.id))
                    .map((e) => e.name)
                    .join("、") || "-"
                }
              />
              <ConfirmRow label="優先度" value={priorityLabel(priority)} />
              <ConfirmRow label="期限" value={dueDate || "なし"} />
              {description && (
                <ConfirmRow label="詳細メモ" value={description} />
              )}
              {selectedCategory &&
                selectedCategory.fields.length > 0 && (
                  <div>
                    <dt className="text-[12px] font-medium text-[#6B7280]">
                      テンプレート項目
                    </dt>
                    <dd className="mt-1 space-y-1">
                      {selectedCategory.fields.map((f) => {
                        const raw = fieldValues[f.id] ?? "";
                        if (!raw) return null;

                        if (
                          f.fieldType === "MULTI_SELECT" &&
                          raw.startsWith("[")
                        ) {
                          let labels: string[] = [];
                          try {
                            labels = (JSON.parse(raw) as string[]).map(
                              (v) =>
                                f.options.find((o) => o.value === v)?.label ?? v
                            );
                          } catch {
                            /* skip */
                          }
                          if (labels.length === 0) return null;
                          return (
                            <div key={f.id}>
                              <span className="text-[12px] text-[#6B7280]">{f.label}:</span>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {labels.map((l) => (
                                  <span
                                    key={l}
                                    className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                                  >
                                    {l}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        }

                        let display = raw;
                        if (f.fieldType === "SELECT") {
                          display =
                            f.options.find((o) => o.value === raw)?.label ?? raw;
                        } else if (f.fieldType === "CHECKBOX") {
                          display = raw === "true" ? "はい" : "いいえ";
                        }
                        return (
                          <p key={f.id} className="text-[13px] text-[#374151]">
                            <span className="text-[#6B7280]">{f.label}:</span>{" "}
                            {display}
                          </p>
                        );
                      })}
                    </dd>
                  </div>
                )}
            </dl>
          </div>
        )}

        {/* ----- navigation ----- */}
        <div className="mt-6 flex items-center justify-between border-t border-[#F3F4F6] pt-4">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
            className={[
              "rounded-[6px] px-4 py-2 text-[14px] font-medium transition-colors",
              step === 0
                ? "cursor-not-allowed text-[#D1D5DB]"
                : "text-[#6B7280] hover:bg-[#F3F4F6]",
            ].join(" ")}
          >
            戻る
          </button>

          {step < 5 ? (
            <button
              type="button"
              disabled={!canProceed()}
              onClick={() => setStep((s) => s + 1)}
              className={[
                "rounded-[8px] px-5 py-2.5 text-[14px] font-medium text-white transition-colors",
                canProceed()
                  ? "bg-[#2563EB] hover:bg-[#1D4ED8]"
                  : "cursor-not-allowed bg-[#93C5FD]",
              ].join(" ")}
            >
              次へ
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className={[
                "rounded-[8px] px-5 py-2.5 text-[14px] font-medium text-white transition-colors",
                submitting
                  ? "cursor-not-allowed bg-[#93C5FD]"
                  : "bg-[#2563EB] hover:bg-[#1D4ED8]",
              ].join(" ")}
            >
              {submitting ? "作成中..." : "タスクを作成"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- field renderer ---------- */

function renderField(
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
      if (field.label === "エントリー件数") {
        return (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={value}
              placeholder="5"
              onChange={(e) => setFieldValue(field.id, e.target.value)}
              className="max-w-[120px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
            />
            <span className="text-[14px] text-[#374151]">件</span>
          </div>
        );
      }
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
        <select
          value={value}
          onChange={(e) => setFieldValue(field.id, e.target.value)}
          className={base}
        >
          <option value="">選択してください</option>
          {field.options.map((opt) => (
            <option key={opt.id} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "MULTI_SELECT": {
      const selected: string[] = (() => {
        try {
          return JSON.parse(value || "[]");
        } catch {
          return [];
        }
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
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2"
              >
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
            onChange={(e) =>
              setFieldValue(field.id, e.target.checked ? "true" : "false")
            }
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

/* ---------- confirm row ---------- */

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-[#6B7280]">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-[#374151] whitespace-pre-wrap">
        {value}
      </dd>
    </div>
  );
}
