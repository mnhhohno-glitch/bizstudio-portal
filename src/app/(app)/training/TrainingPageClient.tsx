"use client";

import { useState, useEffect, useCallback } from "react";

type Material = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  url: string;
  tag: string | null;
  sortOrder: number;
  isPublished: boolean;
};

type FormState = {
  title: string;
  category: string;
  tag: string;
  url: string;
  description: string;
  sortOrder: string;
  isPublished: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  category: "",
  tag: "",
  url: "",
  description: "",
  sortOrder: "0",
  isPublished: true,
};

function isValidMaterialUrl(url: string): boolean {
  return /^\//.test(url) || /^https?:\/\//.test(url);
}

function MaterialModal({
  material,
  onClose,
  onSaved,
}: {
  material: Material | null; // null = 新規作成
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    material
      ? {
          title: material.title,
          category: material.category,
          tag: material.tag ?? "",
          url: material.url,
          description: material.description ?? "",
          sortOrder: String(material.sortOrder),
          isPublished: material.isPublished,
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");

  const errors = {
    title: form.title.trim().length === 0 ? "タイトルは必須です" : "",
    category: form.category.trim().length === 0 ? "カテゴリは必須です" : "",
    url:
      form.url.trim().length === 0
        ? "URLは必須です"
        : !isValidMaterialUrl(form.url.trim())
          ? "「/」始まりの内部パス、または http(s):// 始まりで入力してください"
          : "",
    sortOrder:
      form.sortOrder.trim().length === 0 || !Number.isFinite(Number(form.sortOrder))
        ? "表示順は数値で入力してください"
        : "",
  };
  const hasError = Object.values(errors).some((e) => e.length > 0);

  const handleSave = async () => {
    if (hasError || saving) return;
    setSaving(true);
    setApiError("");
    try {
      const payload = {
        title: form.title.trim(),
        category: form.category.trim(),
        tag: form.tag.trim() || null,
        url: form.url.trim(),
        description: form.description.trim() || null,
        sortOrder: Number(form.sortOrder),
        isPublished: form.isPublished,
      };
      const res = await fetch(
        material ? `/api/training-materials/${material.id}` : "/api/training-materials",
        {
          method: material ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setApiError(data?.error || "保存に失敗しました");
        return;
      }
      onSaved();
    } catch {
      setApiError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-[8px] shadow-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[18px] font-semibold text-[#374151]">
          {material ? "教材を編集" : "教材を追加"}
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              タイトル <span className="text-[#DC2626]">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={inputClass}
            />
            {errors.title && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.title}</p>}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              カテゴリ <span className="text-[#DC2626]">*</span>
            </label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="例: 新人研修"
              className={inputClass}
            />
            {errors.category && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.category}</p>}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">タグ</label>
            <input
              type="text"
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              placeholder="例: クイズ"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              URL <span className="text-[#DC2626]">*</span>
            </label>
            <input
              type="text"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="/training/quiz/xxx.html または https://..."
              className={inputClass}
            />
            {errors.url && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.url}</p>}
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">説明</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              表示順 <span className="text-[#DC2626]">*</span>
            </label>
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              className={inputClass}
            />
            {errors.sortOrder && <p className="mt-1 text-[12px] text-[#DC2626]">{errors.sortOrder}</p>}
          </div>

          <label className="flex items-center gap-2 text-[14px] text-[#374151]">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              className="h-4 w-4"
            />
            公開する
          </label>
        </div>

        {apiError && <p className="mt-4 text-[13px] text-[#DC2626]">{apiError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[14px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={hasError || saving}
            className="px-4 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TrainingPageClient({ isAdmin }: { isAdmin: boolean }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);

  const fetchMaterials = useCallback(async () => {
    try {
      const res = await fetch("/api/training-materials");
      if (res.ok) {
        const data = await res.json();
        setMaterials(data.materials);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMaterials();
  }, [fetchMaterials]);

  const handleDelete = async (m: Material) => {
    if (!window.confirm(`「${m.title}」を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/training-materials/${m.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.error || "削除に失敗しました");
      return;
    }
    fetchMaterials();
  };

  // category ごとにグルーピング（API は category 昇順 → sortOrder 昇順で返す）
  const grouped = materials.reduce<{ category: string; items: Material[] }[]>((acc, m) => {
    const last = acc[acc.length - 1];
    if (last && last.category === m.category) {
      last.items.push(m);
    } else {
      acc.push({ category: m.category, items: [m] });
    }
    return acc;
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[#374151]">社内研修</h1>
        {isAdmin && (
          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="px-4 py-2 text-[14px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
          >
            ＋ 教材を追加
          </button>
        )}
      </div>
      <p className="mt-1 text-[14px] text-[#6B7280]">
        研修教材の一覧です。クリックすると別タブで開きます。
      </p>

      <hr className="my-4 border-[#E5E7EB]" />

      {loading ? (
        <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>
      ) : materials.length === 0 ? (
        <div className="py-12 text-center text-[#6B7280]">まだ教材が登録されていません</div>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.category}>
              <h2 className="text-[16px] font-semibold text-[#374151] mb-3">{group.category}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map((m) => (
                  <div
                    key={m.id}
                    className={`bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4 flex flex-col ${
                      m.isPublished ? "" : "opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.tag && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DBEAFE] text-[#2563EB] text-[12px]">
                          {m.tag}
                        </span>
                      )}
                      {!m.isPublished && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
                          非公開
                        </span>
                      )}
                    </div>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 text-[16px] font-semibold text-[#374151] hover:text-[#2563EB] hover:underline"
                    >
                      {m.title}
                    </a>
                    {m.description && (
                      <p className="mt-2 text-[13px] text-[#6B7280] whitespace-pre-wrap">{m.description}</p>
                    )}
                    <div className="mt-auto pt-4 flex items-center gap-2">
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-[13px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
                      >
                        開く
                      </a>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => {
                              setEditing(m);
                              setModalOpen(true);
                            }}
                            className="px-3 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md hover:bg-[#F9FAFB]"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(m)}
                            className="px-3 py-1.5 text-[13px] border border-[#FCA5A5] text-[#DC2626] rounded-md hover:bg-[#FEF2F2]"
                          >
                            削除
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {modalOpen && (
        <MaterialModal
          material={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            fetchMaterials();
          }}
        />
      )}
    </div>
  );
}
