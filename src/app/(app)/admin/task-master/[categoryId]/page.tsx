"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: "テキスト",
  TEXTAREA: "テキストエリア",
  SELECT: "セレクト",
  MULTI_SELECT: "マルチセレクト",
  DATE: "日付",
  CHECKBOX: "チェックボックス",
};

const FIELD_TYPES = ["TEXT", "TEXTAREA", "SELECT", "MULTI_SELECT", "DATE", "CHECKBOX"] as const;

type Option = {
  id: string;
  label: string;
  value: string;
  sortOrder: number;
};

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
};

type FieldForm = {
  label: string;
  fieldType: string;
  isRequired: boolean;
  placeholder: string;
  sortOrder: number;
};

type OptionForm = {
  label: string;
  value: string;
  sortOrder: number;
};

export default function TaskFieldsPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);

  // Field modal
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldForm>({
    label: "", fieldType: "TEXT", isRequired: false, placeholder: "", sortOrder: 0,
  });
  const [fieldSaving, setFieldSaving] = useState(false);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<string | null>(null);

  // Option modal
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [optionFieldId, setOptionFieldId] = useState<string | null>(null);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [optionForm, setOptionForm] = useState<OptionForm>({ label: "", value: "", sortOrder: 0 });
  const [optionSaving, setOptionSaving] = useState(false);

  // Expanded field (to show options)
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/task-categories/${categoryId}/fields`);
      if (res.ok) {
        const data = await res.json();
        setCategory(data.category);
        setFields(data.fields);
      }
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  /* ---------- Field CRUD ---------- */
  const openCreateField = () => {
    setEditingFieldId(null);
    const maxSort = fields.length > 0 ? Math.max(...fields.map((f) => f.sortOrder)) : 0;
    setFieldForm({ label: "", fieldType: "TEXT", isRequired: false, placeholder: "", sortOrder: maxSort + 1 });
    setFieldModalOpen(true);
  };

  const openEditField = (f: Field) => {
    setEditingFieldId(f.id);
    setFieldForm({
      label: f.label,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      placeholder: f.placeholder || "",
      sortOrder: f.sortOrder,
    });
    setFieldModalOpen(true);
  };

  const handleSaveField = async () => {
    if (!fieldForm.label.trim()) return;
    setFieldSaving(true);
    try {
      const url = editingFieldId
        ? `/api/task-categories/${categoryId}/fields/${editingFieldId}`
        : `/api/task-categories/${categoryId}/fields`;
      const method = editingFieldId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fieldForm),
      });
      if (!res.ok) throw new Error();
      setFieldModalOpen(false);
      setEditingFieldId(null);
      fetchFields();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setFieldSaving(false);
    }
  };

  const handleDeleteField = async (id: string) => {
    try {
      const res = await fetch(`/api/task-categories/${categoryId}/fields/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDeleteFieldConfirm(null);
      fetchFields();
    } catch {
      alert("削除に失敗しました");
    }
  };

  /* ---------- Option CRUD ---------- */
  const openCreateOption = (fieldId: string) => {
    setOptionFieldId(fieldId);
    setEditingOptionId(null);
    const field = fields.find((f) => f.id === fieldId);
    const maxSort = field && field.options.length > 0
      ? Math.max(...field.options.map((o) => o.sortOrder))
      : 0;
    setOptionForm({ label: "", value: "", sortOrder: maxSort + 1 });
    setOptionModalOpen(true);
  };

  const openEditOption = (fieldId: string, opt: Option) => {
    setOptionFieldId(fieldId);
    setEditingOptionId(opt.id);
    setOptionForm({ label: opt.label, value: opt.value, sortOrder: opt.sortOrder });
    setOptionModalOpen(true);
  };

  const handleSaveOption = async () => {
    if (!optionForm.label.trim() || !optionFieldId) return;
    setOptionSaving(true);
    try {
      const url = editingOptionId
        ? `/api/task-fields/${optionFieldId}/options/${editingOptionId}`
        : `/api/task-fields/${optionFieldId}/options`;
      const method = editingOptionId ? "PUT" : "POST";
      const payload = { ...optionForm };
      if (!payload.value.trim()) payload.value = payload.label;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setOptionModalOpen(false);
      setEditingOptionId(null);
      setOptionFieldId(null);
      fetchFields();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setOptionSaving(false);
    }
  };

  const handleDeleteOption = async (fieldId: string, optionId: string) => {
    try {
      const res = await fetch(`/api/task-fields/${fieldId}/options/${optionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      fetchFields();
    } catch {
      alert("削除に失敗しました");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-[14px] text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  const hasOptions = (type: string) => type === "SELECT" || type === "MULTI_SELECT";

  return (
    <div>
      {/* ヘッダー */}
      <div className="mb-6">
        <Link href="/admin/task-master" className="text-[13px] text-[#2563EB] hover:underline">
          ← タスクマスター管理
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-xl font-bold text-[#374151]">{category?.name}</h1>
            {category?.description && (
              <p className="text-[13px] text-gray-500 mt-1">{category.description}</p>
            )}
          </div>
          <button
            onClick={openCreateField}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            + 項目を追加
          </button>
        </div>
      </div>

      {/* 項目一覧 */}
      {fields.length === 0 ? (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-12 text-center text-gray-400 text-[13px]">
          テンプレート項目がまだありません
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field.id} className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
              {/* 項目ヘッダー */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-gray-400 w-6 text-center">{field.sortOrder}</span>
                  <span className="text-[14px] font-medium text-[#374151]">{field.label}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                    {FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}
                  </span>
                  {field.isRequired && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-600">
                      必須
                    </span>
                  )}
                  {field.placeholder && (
                    <span className="text-[12px] text-gray-400 truncate max-w-[200px]">
                      placeholder: {field.placeholder}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasOptions(field.fieldType) && (
                    <button
                      onClick={() => setExpandedFieldId(expandedFieldId === field.id ? null : field.id)}
                      className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#F9FAFB] transition-colors"
                    >
                      選択肢 ({field.options.length}) {expandedFieldId === field.id ? "▲" : "▼"}
                    </button>
                  )}
                  <button
                    onClick={() => openEditField(field)}
                    className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#F9FAFB] transition-colors"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => setDeleteFieldConfirm(field.id)}
                    className="border border-red-200 bg-white text-red-500 rounded-md px-3 py-1.5 text-[12px] hover:bg-red-50 transition-colors"
                  >
                    削除
                  </button>
                </div>
              </div>

              {/* 選択肢一覧（展開時） */}
              {hasOptions(field.fieldType) && expandedFieldId === field.id && (
                <div className="border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-medium text-gray-500">選択肢</span>
                    <button
                      onClick={() => openCreateOption(field.id)}
                      className="text-[12px] text-[#2563EB] hover:underline font-medium"
                    >
                      + 追加
                    </button>
                  </div>
                  {field.options.length === 0 ? (
                    <p className="text-[12px] text-gray-400">選択肢がまだありません</p>
                  ) : (
                    <div className="space-y-1">
                      {field.options.map((opt) => (
                        <div key={opt.id} className="flex items-center justify-between bg-white rounded px-3 py-2 border border-gray-200">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-gray-400 w-5 text-center shrink-0">{opt.sortOrder}</span>
                            <span className="text-[13px] text-[#374151] truncate">{opt.label}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button
                              onClick={() => openEditOption(field.id, opt)}
                              className="text-[11px] text-gray-500 hover:text-[#2563EB] px-1.5 py-0.5"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => handleDeleteOption(field.id, opt.id)}
                              className="text-[11px] text-gray-500 hover:text-red-500 px-1.5 py-0.5"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 項目 作成・編集モーダル */}
      {fieldModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setFieldModalOpen(false)}>
          <div className="bg-white rounded-[8px] w-full max-w-[520px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">
                {editingFieldId ? "項目を編集" : "項目を追加"}
              </h2>
              <button onClick={() => setFieldModalOpen(false)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  ラベル <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fieldForm.label}
                  onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })}
                  placeholder="例: 志望動機カテゴリ"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  項目タイプ <span className="text-red-500">*</span>
                </label>
                <select
                  value={fieldForm.fieldType}
                  onChange={(e) => setFieldForm({ ...fieldForm, fieldType: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isRequired"
                  checked={fieldForm.isRequired}
                  onChange={(e) => setFieldForm({ ...fieldForm, isRequired: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <label htmlFor="isRequired" className="text-[13px] text-[#374151]">必須項目</label>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">プレースホルダー</label>
                <input
                  type="text"
                  value={fieldForm.placeholder}
                  onChange={(e) => setFieldForm({ ...fieldForm, placeholder: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">並び順</label>
                <input
                  type="number"
                  value={fieldForm.sortOrder}
                  onChange={(e) => setFieldForm({ ...fieldForm, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setFieldModalOpen(false)}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveField}
                  disabled={fieldSaving || !fieldForm.label.trim()}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {fieldSaving ? "保存中..." : "保存する"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 選択肢 作成・編集モーダル */}
      {optionModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOptionModalOpen(false)}>
          <div className="bg-white rounded-[8px] w-full max-w-[480px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">
                {editingOptionId ? "選択肢を編集" : "選択肢を追加"}
              </h2>
              <button onClick={() => setOptionModalOpen(false)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  ラベル <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={optionForm.label}
                  onChange={(e) => {
                    setOptionForm({ ...optionForm, label: e.target.value });
                    if (!editingOptionId) {
                      setOptionForm((prev) => ({ ...prev, label: e.target.value, value: e.target.value }));
                    }
                  }}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">並び順</label>
                <input
                  type="number"
                  value={optionForm.sortOrder}
                  onChange={(e) => setOptionForm({ ...optionForm, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setOptionModalOpen(false)}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveOption}
                  disabled={optionSaving || !optionForm.label.trim()}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {optionSaving ? "保存中..." : "保存する"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 項目削除確認モーダル */}
      {deleteFieldConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteFieldConfirm(null)}>
          <div className="bg-white rounded-[8px] w-full max-w-[400px] shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-[#374151] mb-2">削除の確認</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              この項目と関連する選択肢がすべて削除されます。この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteFieldConfirm(null)}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDeleteField(deleteFieldConfirm)}
                className="flex-1 bg-red-500 text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-red-600 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
