"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  description: string | null;
  sortOrder: number;
  options: Option[];
};
type Category = {
  id: string;
  name: string;
  description: string | null;
  fields: Field[];
  group: { id: string; name: string; sortOrder: number } | null;
};
type CatGroup = { id: string; name: string; sortOrder: number };
type JobCatItem = { id: string; name: string; sortOrder: number };

const STEPS = [
  "求職者選択",
  "カテゴリ選択",
  "テンプレート入力",
  "担当者選択",
  "追加情報",
  "確認・作成",
];

/** 履歴書作成カテゴリ名 */
const RIREKISHO_CATEGORY = "履歴書作成";

/** 数字実績ありと判定する大分類 */
const SALES_MAJORS = ["営業", "販売・フード・アミューズメント"];

/** 職務経歴書の「応募職種」フィールドラベル */
const SHOKUMU_CATEGORY = "職務経歴書作成";

/** 職務経歴書で非表示にするフィールド（職種に応じて出し分け） */
const SALES_ONLY_LABELS = ["営業実績"];
const NON_SALES_HIDDEN_LABELS = [
  "提示できる実績や数字がない（「数字実績なしで構いません」と記載する）",
  "営業実績",
  "その他実績",
];

/* ========================================================== */

export default function TaskNewPage() {
  const router = useRouter();

  /* ----- master data ----- */
  const [categories, setCategories] = useState<Category[]>([]);
  const [catGroups, setCatGroups] = useState<CatGroup[]>([]);
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

  // step 2 - 職種選択 (職務経歴書作成用)
  const [jobMajors, setJobMajors] = useState<JobCatItem[]>([]);
  const [jobMiddles, setJobMiddles] = useState<JobCatItem[]>([]);
  const [jobMinors, setJobMinors] = useState<JobCatItem[]>([]);
  const [selectedMajorId, setSelectedMajorId] = useState("");
  const [selectedMiddleId, setSelectedMiddleId] = useState("");
  const [selectedMinorId, setSelectedMinorId] = useState("");
  const [selectedMajorName, setSelectedMajorName] = useState("");
  const [selectedMiddleName, setSelectedMiddleName] = useState("");
  const [selectedMinorName, setSelectedMinorName] = useState("");

  // step 2 - 志望動機選択 (履歴書作成用)
  const [motivMajors, setMotivMajors] = useState<JobCatItem[]>([]);
  const [motivMiddles, setMotivMiddles] = useState<JobCatItem[]>([]);
  const [motivMinors, setMotivMinors] = useState<JobCatItem[]>([]);
  const [motivMajorId, setMotivMajorId] = useState("");
  const [motivMiddleId, setMotivMiddleId] = useState("");
  const [motivMajorName, setMotivMajorName] = useState("");
  const [motivMiddleName, setMotivMiddleName] = useState("");
  const [selectedMotivMinors, setSelectedMotivMinors] = useState<string[]>([]);

  // step 2 - 職務経歴書: 非営業用の経歴概要
  const [careerSummary, setCareerSummary] = useState("");

  // step 3
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");

  // step 4
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<"HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const isRirekisho = selectedCategory?.name === RIREKISHO_CATEGORY;
  const isShokumu = selectedCategory?.name === SHOKUMU_CATEGORY;
  const isSalesJob = SALES_MAJORS.includes(selectedMajorName);

  /** 職務経歴書: 「実績なし」チェックがONか */
  const noNumbersChecked = useMemo(() => {
    if (!isShokumu || !selectedCategory) return false;
    const checkField = selectedCategory.fields.find((f) =>
      f.label.startsWith("提示できる実績や数字がない")
    );
    return checkField ? fieldValues[checkField.id] === "true" : false;
  }, [isShokumu, selectedCategory, fieldValues]);

  /* ----- fetch master data ----- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, empRes, canRes, jobRes, motivRes] = await Promise.all([
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
        fetch("/api/candidates"),
        fetch("/api/job-categories"),
        fetch("/api/motivation-categories"),
      ]);
      const catJson = await catRes.json();
      const empJson = await empRes.json();
      const canJson = await canRes.json();
      const jobJson = await jobRes.json();
      const motivJson = await motivRes.json();
      setCategories(catJson.categories ?? []);
      setCatGroups(catJson.groups ?? []);
      setEmployees(Array.isArray(empJson) ? empJson : []);
      setCandidates(Array.isArray(canJson) ? canJson : []);
      setJobMajors(Array.isArray(jobJson) ? jobJson : []);
      setMotivMajors(Array.isArray(motivJson) ? motivJson : []);
    } catch {
      alert("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ----- job category cascading ----- */
  useEffect(() => {
    if (!selectedMajorId) {
      setJobMiddles([]);
      setSelectedMiddleId("");
      setSelectedMiddleName("");
      setJobMinors([]);
      setSelectedMinorId("");
      setSelectedMinorName("");
      return;
    }
    fetch(`/api/job-categories/${selectedMajorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        setJobMiddles(Array.isArray(data) ? data : []);
        setSelectedMiddleId("");
        setSelectedMiddleName("");
        setJobMinors([]);
        setSelectedMinorId("");
        setSelectedMinorName("");
      });
  }, [selectedMajorId]);

  useEffect(() => {
    if (!selectedMiddleId) {
      setJobMinors([]);
      setSelectedMinorId("");
      setSelectedMinorName("");
      return;
    }
    fetch(`/api/job-categories/middles/${selectedMiddleId}/minors`)
      .then((r) => r.json())
      .then((data) => {
        setJobMinors(Array.isArray(data) ? data : []);
        setSelectedMinorId("");
        setSelectedMinorName("");
      });
  }, [selectedMiddleId]);

  /* ----- motivation category cascading ----- */
  useEffect(() => {
    if (!motivMajorId) {
      setMotivMiddles([]);
      setMotivMiddleId("");
      setMotivMiddleName("");
      setMotivMinors([]);
      setSelectedMotivMinors([]);
      return;
    }
    fetch(`/api/motivation-categories/${motivMajorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        setMotivMiddles(Array.isArray(data) ? data : []);
        setMotivMiddleId("");
        setMotivMiddleName("");
        setMotivMinors([]);
        setSelectedMotivMinors([]);
      });
  }, [motivMajorId]);

  useEffect(() => {
    if (!motivMiddleId) {
      setMotivMinors([]);
      setSelectedMotivMinors([]);
      return;
    }
    fetch(`/api/motivation-categories/middles/${motivMiddleId}/minors`)
      .then((r) => r.json())
      .then((data) => {
        setMotivMinors(Array.isArray(data) ? data : []);
        setSelectedMotivMinors([]);
      });
  }, [motivMiddleId]);

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
        // 履歴書作成: 志望動機の大中小必須
        if (isRirekisho) {
          if (!motivMajorName || !motivMiddleName || selectedMotivMinors.length === 0) return false;
        }
        // 職務経歴書: 職種大分類は必須
        if (isShokumu && !selectedMajorName) return false;
        // テンプレート必須フィールドのバリデーション
        const visibleFields = getVisibleFields();
        return visibleFields
          .filter((f) => f.isRequired)
          .every((f) => {
            // 応募職種は職種選択UIで代替するのでスキップ
            if (f.label === "応募職種") return true;
            // 志望動機フィールドはカスケードUIで代替するのでスキップ
            if (isRirekisho && (f.label === "志望動機（大分類）" || f.label === "志望動機（中分類）" || f.label === "志望動機（小分類）")) return true;
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

  /** 表示するフィールドを返す */
  const getVisibleFields = useCallback((): Field[] => {
    if (!selectedCategory) return [];

    // 履歴書作成: 志望動機フィールドはカスケードUIで代替するので非表示
    if (isRirekisho) {
      return selectedCategory.fields.filter((f) =>
        f.label !== "志望動機（大分類）" &&
        f.label !== "志望動機（中分類）" &&
        f.label !== "志望動機（小分類）"
      );
    }

    if (!isShokumu) return selectedCategory.fields;

    return selectedCategory.fields.filter((f) => {
      // 応募職種は職種カスケードで代替
      if (f.label === "応募職種") return false;
      // 営業系の場合
      if (isSalesJob) {
        // 「実績なし」チェック時は営業実績を非表示
        if (noNumbersChecked && SALES_ONLY_LABELS.includes(f.label)) return false;
        return true;
      }
      // 非営業系の場合
      if (NON_SALES_HIDDEN_LABELS.includes(f.label)) return false;
      return true;
    });
  }, [selectedCategory, isRirekisho, isShokumu, isSalesJob, noNumbersChecked]);

  /* ----- submit ----- */
  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 追加のfieldValues
      const extraFieldValues: { fieldId: string; value: string }[] = [];

      // 履歴書作成: 志望動機フィールドをセット
      if (isRirekisho && selectedCategory) {
        const majorField = selectedCategory.fields.find((f) => f.label === "志望動機（大分類）");
        const middleField = selectedCategory.fields.find((f) => f.label === "志望動機（中分類）");
        const minorField = selectedCategory.fields.find((f) => f.label === "志望動機（小分類）");
        if (majorField && motivMajorName) {
          extraFieldValues.push({ fieldId: majorField.id, value: motivMajorName });
        }
        if (middleField && motivMiddleName) {
          extraFieldValues.push({ fieldId: middleField.id, value: motivMiddleName });
        }
        if (minorField && selectedMotivMinors.length > 0) {
          extraFieldValues.push({ fieldId: minorField.id, value: JSON.stringify(selectedMotivMinors) });
        }
      }

      // 応募職種フィールドに職種名をセット
      if (isShokumu && selectedCategory) {
        const shokuField = selectedCategory.fields.find(
          (f) => f.label === "応募職種"
        );
        if (shokuField && selectedMinorName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMinorName });
        } else if (shokuField && selectedMiddleName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMiddleName });
        } else if (shokuField && selectedMajorName) {
          extraFieldValues.push({ fieldId: shokuField.id, value: selectedMajorName });
        }
      }

      // 通常のfieldValues
      const normalFieldValues = Object.entries(fieldValues)
        .filter(([, v]) => v !== "")
        .map(([fieldId, value]) => ({ fieldId, value }));

      // 非営業の経歴概要 → 「その他実績」フィールドに保存
      if (isShokumu && !isSalesJob && careerSummary.trim() && selectedCategory) {
        const otherField = selectedCategory.fields.find(
          (f) => f.label === "その他実績"
        );
        if (otherField) {
          extraFieldValues.push({ fieldId: otherField.id, value: careerSummary.trim() });
        }
      }

      const allFieldValues = [...normalFieldValues, ...extraFieldValues];

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
          fieldValues: allFieldValues,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "タスク作成に失敗しました");
        return;
      }

      const { id } = await res.json();

      // 添付ファイルのアップロード
      if (attachmentFiles.length > 0) {
        const failedFiles: string[] = [];
        for (const file of attachmentFiles) {
          try {
            const formData = new FormData();
            formData.append("file", file);
            const uploadRes = await fetch(`/api/tasks/${id}/attachments`, {
              method: "POST",
              body: formData,
            });
            if (!uploadRes.ok) {
              failedFiles.push(file.name);
            }
          } catch {
            failedFiles.push(file.name);
          }
        }
        if (failedFiles.length > 0) {
          alert(
            `タスクを作成しました。\n\n一部のファイルのアップロードに失敗しました。タスク詳細画面から再度アップロードしてください。\n\n失敗: ${failedFiles.join("、")}`
          );
        } else {
          alert("タスクを作成しました");
        }
      } else {
        alert("タスクを作成しました");
      }

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

  const ALLOWED_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const handleFilesSelected = (files: FileList | null) => {
    if (!files) return;
    setAttachmentError(null);
    const newFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        setAttachmentError(`「${file.name}」はファイルサイズが10MBを超えています`);
        continue;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        setAttachmentError(`「${file.name}」は許可されていないファイル形式です`);
        continue;
      }
      newFiles.push(file);
    }
    setAttachmentFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachmentFile = (index: number) => {
    setAttachmentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const selectCls =
    "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

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
            {(() => {
              const selectCategory = (id: string) => {
                setCategoryId(id);
                setFieldValues({});
                setSelectedMajorId("");
                setSelectedMajorName("");
                setSelectedMiddleId("");
                setSelectedMiddleName("");
                setSelectedMinorId("");
                setSelectedMinorName("");
                setCareerSummary("");
                setMotivMajorId("");
                setMotivMajorName("");
                setMotivMiddleId("");
                setMotivMiddleName("");
                setSelectedMotivMinors([]);
              };

              const renderCatButton = (cat: Category) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => selectCategory(cat.id)}
                  className={[
                    "rounded-[8px] border-2 p-4 text-left transition-colors",
                    categoryId === cat.id
                      ? "border-[#2563EB] bg-[#EEF2FF]"
                      : "border-[#E5E7EB] hover:border-[#93C5FD] hover:bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[14px] font-bold text-[#374151]">{cat.name}</p>
                  {cat.description && (
                    <p className="mt-1 text-[12px] text-[#6B7280]">{cat.description}</p>
                  )}
                </button>
              );

              if (catGroups.length === 0) {
                return (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {categories.map(renderCatButton)}
                  </div>
                );
              }

              const sections: { label: string; cats: Category[] }[] = [];
              for (const g of catGroups) {
                const cats = categories.filter((c) => c.group?.id === g.id);
                if (cats.length > 0) sections.push({ label: g.name, cats });
              }
              const ungrouped = categories.filter((c) => !c.group);
              if (ungrouped.length > 0) sections.push({ label: "未分類", cats: ungrouped });

              return (
                <div className="space-y-5">
                  {sections.map((sec) => (
                    <div key={sec.label}>
                      <p className="mb-2 text-[13px] font-bold text-[#6B7280]">{sec.label}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {sec.cats.map(renderCatButton)}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ----- Step 2: テンプレート入力 ----- */}
        {step === 2 && selectedCategory && (
          <div>
            <h2 className="mb-4 text-[16px] font-bold text-[#374151]">
              {selectedCategory.name} - テンプレート入力
            </h2>

            {/* 履歴書作成: 志望動機カスケード選択 */}
            {isRirekisho && (
              <div className="mb-6 space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <p className="text-[13px] font-bold text-[#374151]">
                  志望動機<span className="ml-1 text-red-500">*</span>
                </p>
                {/* 大分類 */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#6B7280]">
                    志望動機（大分類）
                  </label>
                  <select
                    value={motivMajorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setMotivMajorId(id);
                      const name = motivMajors.find((m) => m.id === id)?.name ?? "";
                      setMotivMajorName(name);
                    }}
                    className={selectCls}
                  >
                    <option value="">選択してください</option>
                    {motivMajors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 中分類 */}
                {motivMajorId && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      志望動機（中分類）
                    </label>
                    <select
                      value={motivMiddleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setMotivMiddleId(id);
                        const name = motivMiddles.find((m) => m.id === id)?.name ?? "";
                        setMotivMiddleName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {motivMiddles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 小分類 (複数選択) */}
                {motivMiddleId && motivMinors.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      志望動機（小分類）<span className="ml-1 text-[#9CA3AF]">（複数選択可）</span>
                    </label>
                    {selectedMotivMinors.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {selectedMotivMinors.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                          >
                            {name}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedMotivMinors((prev) =>
                                  prev.filter((n) => n !== name)
                                )
                              }
                              className="ml-0.5 text-[#93C5FD] hover:text-[#2563EB]"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="max-h-[240px] space-y-2 overflow-y-auto rounded-[6px] border border-[#E5E7EB] p-3">
                      {motivMinors.map((minor) => (
                        <label
                          key={minor.id}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedMotivMinors.includes(minor.name)}
                            onChange={() => {
                              setSelectedMotivMinors((prev) =>
                                prev.includes(minor.name)
                                  ? prev.filter((n) => n !== minor.name)
                                  : [...prev, minor.name]
                              );
                            }}
                            className="h-4 w-4 shrink-0 accent-[#2563EB]"
                          />
                          <span className="text-[14px] text-[#374151]">{minor.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* 選択結果 */}
                {motivMajorName && (
                  <p className="text-[12px] text-[#2563EB]">
                    選択中: {motivMajorName}
                    {motivMiddleName ? ` > ${motivMiddleName}` : ""}
                    {selectedMotivMinors.length > 0
                      ? ` > ${selectedMotivMinors.join("、")}`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {/* 職務経歴書: 職種カスケード選択 */}
            {isShokumu && (
              <div className="mb-6 space-y-3 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <p className="text-[13px] font-bold text-[#374151]">
                  応募職種<span className="ml-1 text-red-500">*</span>
                </p>
                {/* 大分類 */}
                <div>
                  <label className="mb-1 block text-[12px] text-[#6B7280]">
                    職種（大分類）
                  </label>
                  <select
                    value={selectedMajorId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedMajorId(id);
                      const name = jobMajors.find((m) => m.id === id)?.name ?? "";
                      setSelectedMajorName(name);
                    }}
                    className={selectCls}
                  >
                    <option value="">選択してください</option>
                    {jobMajors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 中分類 */}
                {selectedMajorId && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      職種（中分類）
                    </label>
                    <select
                      value={selectedMiddleId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedMiddleId(id);
                        const name = jobMiddles.find((m) => m.id === id)?.name ?? "";
                        setSelectedMiddleName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {jobMiddles.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 小分類 */}
                {selectedMiddleId && jobMinors.length > 0 && (
                  <div>
                    <label className="mb-1 block text-[12px] text-[#6B7280]">
                      職種（小分類）
                    </label>
                    <select
                      value={selectedMinorId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedMinorId(id);
                        const name = jobMinors.find((m) => m.id === id)?.name ?? "";
                        setSelectedMinorName(name);
                      }}
                      className={selectCls}
                    >
                      <option value="">選択してください</option>
                      {jobMinors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* 選択結果 */}
                {selectedMajorName && (
                  <p className="text-[12px] text-[#2563EB]">
                    選択中: {selectedMajorName}
                    {selectedMiddleName ? ` > ${selectedMiddleName}` : ""}
                    {selectedMinorName ? ` > ${selectedMinorName}` : ""}
                  </p>
                )}
              </div>
            )}

            {/* テンプレートフィールド */}
            {(() => {
              const visibleFields = getVisibleFields();
              if (visibleFields.length === 0 && !isShokumu) {
                return (
                  <p className="text-[14px] text-[#6B7280]">
                    テンプレート項目はありません。次へ進んでください。
                  </p>
                );
              }
              return (
                <div className="space-y-5">
                  {visibleFields.map((field) => (
                    <div key={field.id}>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                        {field.label}
                        {field.isRequired && (
                          <span className="ml-1 text-red-500">*</span>
                        )}
                      </label>
                      {field.description && (
                        <p className="mb-1 text-[12px] text-[#9CA3AF]">{field.description}</p>
                      )}
                      {renderField(field, fieldValues, setFieldValue, toggleMultiSelect)}
                    </div>
                  ))}

                  {/* 非営業: 経歴・実績の概要 */}
                  {isShokumu && selectedMajorName && !isSalesJob && (
                    <div>
                      <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                        経歴・実績の概要
                      </label>
                      <textarea
                        rows={4}
                        value={careerSummary}
                        placeholder="これまでの経歴や実績、アピールポイントを入力してください"
                        onChange={(e) => setCareerSummary(e.target.value)}
                        className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
                      />
                    </div>
                  )}
                </div>
              );
            })()}
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

              {/* 添付ファイル */}
              <div>
                <label className="mb-1 block text-[13px] font-medium text-[#374151]">
                  添付ファイル（任意）
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFilesSelected(e.dataTransfer.files);
                  }}
                  className={[
                    "flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-6 transition-colors",
                    dragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]",
                  ].join(" ")}
                >
                  <p className="text-[13px] text-[#6B7280]">
                    ファイルをドラッグ＆ドロップ、または
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline"
                  >
                    ファイルを選択
                  </button>
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">
                    PDF, 画像, Word, Excel, CSV, テキスト（最大10MB）
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.docx,.xlsx,.csv,.txt"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                  />
                </div>

                {attachmentError && (
                  <p className="mt-2 text-[13px] text-red-600">{attachmentError}</p>
                )}

                {attachmentFiles.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {attachmentFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="flex items-center gap-3 rounded-[6px] border border-[#E5E7EB] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[#374151]">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-[#9CA3AF]">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachmentFile(idx)}
                          className="shrink-0 rounded-[4px] px-2 py-1 text-[12px] text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
              {/* 志望動機情報 */}
              {isRirekisho && motivMajorName && (
                <>
                  <ConfirmRow label="志望動機（大分類）" value={motivMajorName} />
                  {motivMiddleName && (
                    <ConfirmRow label="志望動機（中分類）" value={motivMiddleName} />
                  )}
                  {selectedMotivMinors.length > 0 && (
                    <div>
                      <dt className="text-[12px] font-medium text-[#6B7280]">志望動機（小分類）</dt>
                      <dd className="mt-1 flex flex-wrap gap-1">
                        {selectedMotivMinors.map((name) => (
                          <span
                            key={name}
                            className="inline-block rounded-full bg-[#EEF2FF] px-2.5 py-0.5 text-[12px] font-medium text-[#2563EB]"
                          >
                            {name}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                </>
              )}
              {/* 職種情報 */}
              {isShokumu && selectedMajorName && (
                <ConfirmRow
                  label="応募職種"
                  value={[selectedMajorName, selectedMiddleName, selectedMinorName]
                    .filter(Boolean)
                    .join(" > ")}
                />
              )}
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
              {/* 経歴概要（非営業） */}
              {isShokumu && !isSalesJob && careerSummary && (
                <ConfirmRow label="経歴・実績の概要" value={careerSummary} />
              )}
              {selectedCategory &&
                selectedCategory.fields.length > 0 && (
                  <div>
                    <dt className="text-[12px] font-medium text-[#6B7280]">
                      テンプレート項目
                    </dt>
                    <dd className="mt-1 space-y-1">
                      {selectedCategory.fields.map((f) => {
                        // 志望動機フィールドは上で表示済み
                        if (isRirekisho && (f.label === "志望動機（大分類）" || f.label === "志望動機（中分類）" || f.label === "志望動機（小分類）")) return null;
                        // 応募職種は上で表示済み
                        if (f.label === "応募職種" && isShokumu) return null;
                        const raw = fieldValues[f.id] ?? "";
                        if (!raw) return null;

                        if (
                          (f.fieldType === "MULTI_SELECT" || (f.fieldType === "CHECKBOX" && f.options.length > 0)) &&
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
                        if (f.fieldType === "SELECT" || f.fieldType === "RADIO") {
                          display =
                            f.options.find((o) => o.value === raw)?.label ?? raw;
                        } else if (f.fieldType === "CHECKBOX" && f.options.length === 0) {
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
              {/* 添付ファイル */}
              <div>
                <dt className="text-[12px] font-medium text-[#6B7280]">添付ファイル</dt>
                <dd className="mt-1">
                  {attachmentFiles.length === 0 ? (
                    <p className="text-[13px] text-[#9CA3AF]">添付ファイルなし</p>
                  ) : (
                    <div className="space-y-1">
                      {attachmentFiles.map((file, idx) => (
                        <p key={`${file.name}-${idx}`} className="text-[13px] text-[#374151]">
                          {file.name}
                          <span className="ml-2 text-[#9CA3AF]">({formatFileSize(file.size)})</span>
                        </p>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
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
              {submitting ? "タスクを作成中..." : "タスクを作成"}
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
          className="max-w-[180px] rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
        />
      );
    case "CHECKBOX": {
      // オプションがある場合は複数選択チェックボックスリスト
      if (field.options.length > 0) {
        const selected: string[] = (() => {
          try { return JSON.parse(value || "[]"); } catch { return []; }
        })();
        return (
          <div className="space-y-2">
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
        );
      }
      // オプションなしの場合は従来の単一チェックボックス
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
    }
    case "RADIO":
      return (
        <div className="space-y-2">
          {field.options.map((opt) => (
            <label key={opt.id} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`radio-${field.id}`}
                checked={value === opt.value}
                onChange={() => setFieldValue(field.id, opt.value)}
                className="h-4 w-4 accent-[#2563EB]"
              />
              <span className="text-[14px] text-[#374151]">{opt.label}</span>
            </label>
          ))}
        </div>
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
