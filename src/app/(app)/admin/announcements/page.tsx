"use client";

import { useState, useEffect, useCallback } from "react";
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES, AnnouncementCategoryKey, AnnouncementStatusKey } from "@/lib/constants/announcement";

type Announcement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategoryKey;
  status: AnnouncementStatusKey;
  publishedAt: string | null;
  author: { name: string };
  createdAt: string;
  updatedAt: string;
};

type FormData = {
  title: string;
  content: string;
  category: AnnouncementCategoryKey;
};

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    title: "",
    content: "",
    category: "IMPORTANT",
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [aiFormatting, setAiFormatting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({ title: "", content: "", category: "IMPORTANT" });
    setModalOpen(true);
  };

  const openEditModal = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setFormData({
      title: announcement.title,
      content: announcement.content,
      category: announcement.category,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async (status: "PUBLISHED" | "DRAFT") => {
    if (!formData.title.trim() || !formData.content.trim()) return;

    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/announcements/${editingId}/update`
        : "/api/admin/announcements/create";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, status }),
      });

      if (res.ok) {
        closeModal();
        fetchAnnouncements();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/announcements/${id}/delete`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDeleteConfirm(null);
      fetchAnnouncements();
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const handleAiFormat = async () => {
    if (formData.content.trim().length < 10) return;

    setAiFormatting(true);
    setAiError(null);

    try {
      const res = await fetch("/api/admin/announcements/ai-format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: formData.content }),
      });

      if (!res.ok) {
        const data = await res.json();
        setAiError(data.error || "AI整理に失敗しました");
        setTimeout(() => setAiError(null), 3000);
        return;
      }

      const data = await res.json();
      setFormData({ ...formData, content: data.formattedContent });
    } catch {
      setAiError("AI整理に失敗しました");
      setTimeout(() => setAiError(null), 3000);
    } finally {
      setAiFormatting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[#374151]">お知らせ管理</h1>
        <button
          onClick={openCreateModal}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 hover:bg-[#1D4ED8] text-[14px]"
        >
          + 新規作成
        </button>
      </div>

      <div className="mt-6 bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#6B7280]">読み込み中...</div>
        ) : announcements.length === 0 ? (
          <div className="p-8 text-center text-[#6B7280]">お知らせはまだありません</div>
        ) : (
          <table className="min-w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="px-4 py-3 text-left font-medium text-[#374151]">タイトル</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">カテゴリ</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">ステータス</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">公開日</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">操作</th>
              </tr>
            </thead>
            <tbody>
              {announcements.map((announcement) => {
                const cat = ANNOUNCEMENT_CATEGORIES[announcement.category];
                const stat = ANNOUNCEMENT_STATUSES[announcement.status];
                return (
                  <tr key={announcement.id} className="border-b border-[#E5E7EB] last:border-b-0">
                    <td className="px-4 py-3 text-[#374151]">{announcement.title}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px]"
                        style={{ backgroundColor: cat.bgColor, color: cat.color }}
                      >
                        {cat.icon} {cat.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-[12px]"
                        style={{ backgroundColor: stat.bgColor, color: stat.color }}
                      >
                        {stat.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#6B7280]">{formatDate(announcement.publishedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditModal(announcement)}
                          className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#F9FAFB]"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(announcement.id)}
                          className="border border-[#E5E7EB] bg-white text-[#DC2626] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#FEE2E2]"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[8px] w-full max-w-[600px] max-h-[90vh] overflow-y-auto">
            <div className="border-b border-[#E5E7EB] px-6 py-4">
              <h2 className="text-[18px] font-semibold text-[#374151]">
                {editingId ? "お知らせを編集" : "お知らせを作成"}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1">タイトル</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  placeholder="タイトルを入力"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1">カテゴリ</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value as AnnouncementCategoryKey })}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                >
                  {Object.entries(ANNOUNCEMENT_CATEGORIES).map(([key, val]) => (
                    <option key={key} value={key}>{val.icon} {val.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[14px] font-medium text-[#374151]">本文（Markdown）</label>
                  <button
                    type="button"
                    onClick={handleAiFormat}
                    disabled={aiFormatting || formData.content.trim().length < 10}
                    className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[13px] hover:bg-[#F9FAFB] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiFormatting ? "⏳ 整理中..." : "✨ AIで整理する"}
                  </button>
                </div>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={10}
                  disabled={aiFormatting}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] font-mono disabled:bg-[#F9FAFB] disabled:cursor-not-allowed"
                  placeholder="本文を入力（Markdown形式）"
                />
                {aiError && (
                  <p className="mt-1 text-[12px] text-[#DC2626]">{aiError}</p>
                )}
              </div>
            </div>
            <div className="border-t border-[#E5E7EB] px-6 py-4 flex justify-between">
              <button
                onClick={closeModal}
                className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB]"
              >
                キャンセル
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave("DRAFT")}
                  disabled={saving || !formData.title.trim() || !formData.content.trim()}
                  className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB] disabled:opacity-50"
                >
                  下書き保存
                </button>
                <button
                  onClick={() => handleSave("PUBLISHED")}
                  disabled={saving || !formData.title.trim() || !formData.content.trim()}
                  className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[14px] hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  公開する
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[8px] w-full max-w-[400px]">
            <div className="p-6">
              <h3 className="text-[16px] font-semibold text-[#374151] mb-2">削除の確認</h3>
              <p className="text-[14px] text-[#6B7280]">
                このお知らせを削除してもよろしいですか？この操作は取り消せません。
              </p>
            </div>
            <div className="border-t border-[#E5E7EB] px-6 py-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB]"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="bg-[#DC2626] text-white rounded-md px-4 py-2 text-[14px] hover:bg-[#B91C1C]"
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
