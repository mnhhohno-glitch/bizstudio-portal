"use client";

import { useState, useEffect, useCallback } from "react";

type Document = {
  id: string;
  title: string;
  description: string;
  category: string;
  url: string;
  status: "PUBLISHED" | "DRAFT";
  author: { name: string };
  createdAt: string;
  updatedAt: string;
};

type FormData = {
  title: string;
  description: string;
  category: string;
  url: string;
};

export default function AdminDocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    title: "",
    description: "",
    category: "",
    url: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/documents");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({ title: "", description: "", category: "", url: "" });
    setModalOpen(true);
  };

  const openEditModal = (doc: Document) => {
    setEditingId(doc.id);
    setFormData({
      title: doc.title,
      description: doc.description,
      category: doc.category,
      url: doc.url,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async (status: "PUBLISHED" | "DRAFT") => {
    if (!formData.title.trim() || !formData.description.trim() || !formData.category.trim() || !formData.url.trim()) return;

    setSaving(true);
    try {
      const apiUrl = editingId
        ? `/api/admin/documents/${editingId}/update`
        : "/api/admin/documents/create";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(apiUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, status }),
      });

      if (res.ok) {
        closeModal();
        fetchDocuments();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/documents/${id}/delete`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDeleteConfirm(null);
      fetchDocuments();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[#374151]">資料管理</h1>
        <button
          onClick={openCreateModal}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 hover:bg-[#1D4ED8] text-[14px]"
        >
          + 新規登録
        </button>
      </div>

      <div className="mt-6 bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#6B7280]">読み込み中...</div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center text-[#6B7280]">資料はまだ登録されていません</div>
        ) : (
          <table className="min-w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="px-4 py-3 text-left font-medium text-[#374151]">タイトル</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">カテゴリ</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">ステータス</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">更新日</th>
                <th className="px-4 py-3 text-left font-medium text-[#374151]">操作</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-[#E5E7EB] last:border-b-0">
                  <td className="px-4 py-3 text-[#374151]">{doc.title}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] bg-[#DBEAFE] text-[#2563EB]">
                      {doc.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {doc.status === "PUBLISHED" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] bg-[#DCFCE7] text-[#16A34A]">
                        🟢 公開
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] bg-[#F3F4F6] text-[#6B7280]">
                        下書き
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6B7280]">{formatDate(doc.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(doc)}
                        className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#F9FAFB]"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(doc.id)}
                        className="border border-[#E5E7EB] bg-white text-[#DC2626] rounded-md px-3 py-1.5 text-[12px] hover:bg-[#FEE2E2]"
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
                {editingId ? "資料を編集" : "資料を登録"}
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
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  placeholder="例: 面接対策、履歴書、業界研究"
                />
                <p className="mt-1 text-[12px] text-[#6B7280]">※ 自由入力（例: 面接対策、履歴書、業界研究）</p>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1">説明文</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  placeholder="資料の説明を入力"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1">資料URL</label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  className="w-full border border-[#E5E7EB] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  placeholder="例: /documents/interview-basics.html"
                />
                <p className="mt-1 text-[12px] text-[#6B7280]">※ 例: /documents/interview-basics.html</p>
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
                  disabled={saving || !formData.title.trim() || !formData.description.trim() || !formData.category.trim() || !formData.url.trim()}
                  className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB] disabled:opacity-50"
                >
                  非公開で保存
                </button>
                <button
                  onClick={() => handleSave("PUBLISHED")}
                  disabled={saving || !formData.title.trim() || !formData.description.trim() || !formData.category.trim() || !formData.url.trim()}
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
                この資料を削除してもよろしいですか？この操作は取り消せません。
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
