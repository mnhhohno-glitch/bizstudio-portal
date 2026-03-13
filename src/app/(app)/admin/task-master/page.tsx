"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Category = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  _count: { fields: number };
  createdAt: string;
};

type FormData = {
  name: string;
  description: string;
  sortOrder: number;
};

export default function TaskMasterPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    description: "",
    sortOrder: 0,
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/task-categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const openCreateModal = () => {
    setEditingId(null);
    const maxSort = categories.length > 0
      ? Math.max(...categories.map((c) => c.sortOrder))
      : 0;
    setFormData({ name: "", description: "", sortOrder: maxSort + 1 });
    setModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingId(cat.id);
    setFormData({
      name: cat.name,
      description: cat.description || "",
      sortOrder: cat.sortOrder,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      const url = editingId
        ? `/api/task-categories/${editingId}`
        : "/api/task-categories";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error();
      closeModal();
      fetchCategories();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (cat: Category) => {
    try {
      const res = await fetch(`/api/task-categories/${cat.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !cat.isActive }),
      });
      if (!res.ok) throw new Error();
      fetchCategories();
    } catch {
      alert("更新に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/task-categories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDeleteConfirm(null);
      fetchCategories();
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-[#374151]">タスクマスター管理</h1>
        <button
          onClick={openCreateModal}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
        >
          + カテゴリを追加
        </button>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="min-w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <th className="text-left font-medium text-[#374151] px-4 py-3">並び順</th>
              <th className="text-left font-medium text-[#374151] px-4 py-3">カテゴリ名</th>
              <th className="text-left font-medium text-[#374151] px-4 py-3">説明</th>
              <th className="text-center font-medium text-[#374151] px-4 py-3">項目数</th>
              <th className="text-center font-medium text-[#374151] px-4 py-3">状態</th>
              <th className="text-right font-medium text-[#374151] px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-400 text-[13px]">
                  カテゴリがまだありません
                </td>
              </tr>
            ) : (
              categories.map((cat) => (
                <tr key={cat.id} className="border-b border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-4 py-3 text-[#374151] text-center w-16">{cat.sortOrder}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/task-master/${cat.id}`}
                      className="text-[#2563EB] font-medium hover:underline"
                    >
                      {cat.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-[13px]">
                    {cat.description || "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium bg-blue-50 text-blue-700">
                      {cat._count.fields}件
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(cat)}
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium transition-colors ${
                        cat.isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {cat.isActive ? "有効" : "無効"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(cat)}
                        className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#F9FAFB] transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(cat.id)}
                        className="border border-red-200 bg-white text-red-500 rounded-md px-3 py-1.5 text-[12px] hover:bg-red-50 transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 作成・編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-[8px] w-full max-w-[480px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">
                {editingId ? "カテゴリを編集" : "カテゴリを追加"}
              </h2>
              <button onClick={closeModal} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">
                  カテゴリ名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例: 履歴書作成"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">説明</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">並び順</label>
                <input
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.name.trim()}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存する"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-[8px] w-full max-w-[400px] shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-bold text-[#374151] mb-2">削除の確認</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              このカテゴリと関連するテンプレート項目がすべて削除されます。この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
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
