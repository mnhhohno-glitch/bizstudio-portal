"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Group = {
  id: string;
  name: string;
  sortOrder: number;
  _count?: { categories: number };
};

type Category = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  groupId: string | null;
  group: { id: string; name: string; sortOrder: number } | null;
  _count: { fields: number };
  createdAt: string;
};

type FormData = {
  name: string;
  description: string;
  sortOrder: number;
  groupId: string;
};

type GroupForm = {
  name: string;
  sortOrder: number;
};

export default function TaskMasterPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Category modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    name: "", description: "", sortOrder: 0, groupId: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupEditId, setGroupEditId] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>({ name: "", sortOrder: 0 });
  const [groupSaving, setGroupSaving] = useState(false);

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/task-categories");
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories);
        setGroups(data.groups ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* ---------- Category CRUD ---------- */
  const openCreateModal = () => {
    setEditingId(null);
    const maxSort = categories.length > 0
      ? Math.max(...categories.map((c) => c.sortOrder))
      : 0;
    setFormData({ name: "", description: "", sortOrder: maxSort + 1, groupId: "" });
    setModalOpen(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingId(cat.id);
    setFormData({
      name: cat.name,
      description: cat.description || "",
      sortOrder: cat.sortOrder,
      groupId: cat.groupId || "",
    });
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingId(null); };

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
        body: JSON.stringify({
          ...formData,
          groupId: formData.groupId || null,
        }),
      });
      if (!res.ok) throw new Error();
      closeModal();
      fetchData();
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
      fetchData();
    } catch {
      alert("更新に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/task-categories/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDeleteConfirm(null);
      fetchData();
    } catch {
      alert("削除に失敗しました");
    }
  };

  /* ---------- Group CRUD ---------- */
  const openGroupCreate = () => {
    setGroupEditId(null);
    const maxSort = groups.length > 0 ? Math.max(...groups.map((g) => g.sortOrder)) : 0;
    setGroupForm({ name: "", sortOrder: maxSort + 1 });
    setGroupModalOpen(true);
  };

  const openGroupEdit = (g: Group) => {
    setGroupEditId(g.id);
    setGroupForm({ name: g.name, sortOrder: g.sortOrder });
    setGroupModalOpen(true);
  };

  const handleGroupSave = async () => {
    if (!groupForm.name.trim()) return;
    setGroupSaving(true);
    try {
      const url = groupEditId
        ? `/api/task-category-groups/${groupEditId}`
        : "/api/task-category-groups";
      const method = groupEditId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(groupForm),
      });
      if (!res.ok) throw new Error();
      setGroupModalOpen(false);
      setGroupEditId(null);
      fetchData();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setGroupSaving(false);
    }
  };

  const handleGroupDelete = async (id: string) => {
    if (!confirm("このグループを削除しますか？所属カテゴリは「未分類」に移動します。")) return;
    try {
      const res = await fetch(`/api/task-category-groups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      alert("削除に失敗しました");
    }
  };

  /* ---------- Group-based rendering ---------- */
  const groupedCategories = (() => {
    const result: { key: string; label: string; cats: Category[] }[] = [];

    // Sorted groups
    for (const g of groups) {
      result.push({
        key: g.id,
        label: g.name,
        cats: categories.filter((c) => c.groupId === g.id),
      });
    }

    // Uncategorized
    const ungrouped = categories.filter((c) => !c.groupId);
    if (ungrouped.length > 0) {
      result.push({ key: "__ungrouped__", label: "未分類", cats: ungrouped });
    }

    return result;
  })();

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
        <div className="flex gap-2">
          <button
            onClick={() => {
              setGroupEditId(null);
              setGroupModalOpen(false);
              // Open inline group management
              setGroupModalOpen(true);
              setGroupEditId("__list__");
            }}
            className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#F9FAFB] transition-colors"
          >
            グループ管理
          </button>
          <button
            onClick={openCreateModal}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            + カテゴリを追加
          </button>
        </div>
      </div>

      {/* グループ別表示 */}
      {groupedCategories.length === 0 ? (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-12 text-center text-gray-400 text-[13px]">
          カテゴリがまだありません
        </div>
      ) : (
        <div className="space-y-4">
          {groupedCategories.map(({ key, label, cats }) => (
            <div key={key} className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="w-full flex items-center justify-between px-4 py-3 bg-[#F9FAFB] border-b border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[#9CA3AF]">
                    {collapsedGroups.has(key) ? "▶" : "▼"}
                  </span>
                  <span className="text-[14px] font-bold text-[#374151]">{label}</span>
                  <span className="text-[12px] text-[#9CA3AF]">({cats.length}件)</span>
                </div>
              </button>

              {/* Category table */}
              {!collapsedGroups.has(key) && (
                <table className="min-w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] bg-[#FAFAFA]">
                      <th className="text-left font-medium text-[#6B7280] px-4 py-2 text-[12px]">順</th>
                      <th className="text-left font-medium text-[#6B7280] px-4 py-2 text-[12px]">カテゴリ名</th>
                      <th className="text-left font-medium text-[#6B7280] px-4 py-2 text-[12px]">説明</th>
                      <th className="text-center font-medium text-[#6B7280] px-4 py-2 text-[12px]">項目数</th>
                      <th className="text-center font-medium text-[#6B7280] px-4 py-2 text-[12px]">状態</th>
                      <th className="text-right font-medium text-[#6B7280] px-4 py-2 text-[12px]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cats.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-gray-400 text-[13px]">
                          カテゴリがありません
                        </td>
                      </tr>
                    ) : (
                      cats.map((cat) => (
                        <tr key={cat.id} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors">
                          <td className="px-4 py-3 text-[#374151] text-center w-12">{cat.sortOrder}</td>
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
              )}
            </div>
          ))}
        </div>
      )}

      {/* カテゴリ作成・編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-[8px] w-full max-w-[480px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">
                {editingId ? "カテゴリを編集" : "カテゴリを追加"}
              </h2>
              <button onClick={closeModal} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
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
                <label className="block text-[13px] font-medium text-[#374151] mb-1">グループ</label>
                <select
                  value={formData.groupId}
                  onChange={(e) => setFormData({ ...formData, groupId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                >
                  <option value="">なし（未分類）</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
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

      {/* グループ管理モーダル */}
      {groupModalOpen && groupEditId === "__list__" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setGroupModalOpen(false); setGroupEditId(null); }}>
          <div className="bg-white rounded-[8px] w-full max-w-[520px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">グループ管理</h2>
              <button onClick={() => { setGroupModalOpen(false); setGroupEditId(null); }} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <div className="p-6">
              <div className="space-y-2 mb-4">
                {groups.length === 0 ? (
                  <p className="text-[13px] text-gray-400 text-center py-4">グループがありません</p>
                ) : (
                  groups.map((g) => (
                    <div key={g.id} className="flex items-center justify-between rounded-[6px] border border-[#E5E7EB] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-gray-400 w-5 text-center">{g.sortOrder}</span>
                        <span className="text-[13px] font-medium text-[#374151]">{g.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openGroupEdit(g)}
                          className="text-[12px] text-[#6B7280] hover:text-[#2563EB] px-2 py-1"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleGroupDelete(g.id)}
                          className="text-[12px] text-[#6B7280] hover:text-red-500 px-2 py-1"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={openGroupCreate}
                className="w-full border border-dashed border-[#D1D5DB] rounded-[6px] px-3 py-2 text-[13px] text-[#2563EB] font-medium hover:bg-[#F9FAFB] transition-colors"
              >
                + グループを追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* グループ作成・編集モーダル */}
      {groupModalOpen && groupEditId !== "__list__" && groupEditId !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setGroupModalOpen(false); setGroupEditId(null); }}>
          <div className="bg-white rounded-[8px] w-full max-w-[400px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">グループを編集</h2>
              <button onClick={() => { setGroupModalOpen(false); setGroupEditId(null); }} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">グループ名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">並び順</label>
                <input
                  type="number"
                  value={groupForm.sortOrder}
                  onChange={(e) => setGroupForm({ ...groupForm, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setGroupModalOpen(false); setGroupEditId(null); }}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleGroupSave}
                  disabled={groupSaving || !groupForm.name.trim()}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {groupSaving ? "保存中..." : "保存する"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* グループ新規作成モーダル */}
      {groupModalOpen && groupEditId === null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setGroupModalOpen(false)}>
          <div className="bg-white rounded-[8px] w-full max-w-[400px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[15px] font-bold text-[#374151]">グループを追加</h2>
              <button onClick={() => setGroupModalOpen(false)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">グループ名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-1">並び順</label>
                <input
                  type="number"
                  value={groupForm.sortOrder}
                  onChange={(e) => setGroupForm({ ...groupForm, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setGroupModalOpen(false)}
                  className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleGroupSave}
                  disabled={groupSaving || !groupForm.name.trim()}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
                >
                  {groupSaving ? "保存中..." : "保存する"}
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
