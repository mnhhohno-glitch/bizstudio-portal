"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type Manual = {
  id: string;
  title: string;
  category: "INTERNAL" | "CANDIDATE" | "CLIENT";
  contentType: "VIDEO" | "PDF" | "URL" | "MARKDOWN";
  author: { name: string };
  createdAt: string;
};

type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const CATEGORY_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "INTERNAL", label: "社内" },
  { value: "CANDIDATE", label: "求職者" },
  { value: "CLIENT", label: "求人企業" },
] as const;

const CONTENT_TYPE_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "VIDEO", label: "動画" },
  { value: "PDF", label: "PDF" },
  { value: "URL", label: "URL" },
  { value: "MARKDOWN", label: "テキスト" },
] as const;

const CATEGORY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  INTERNAL: { bg: "bg-[#DBEAFE]", text: "text-[#2563EB]", label: "社内" },
  CANDIDATE: { bg: "bg-[#DCFCE7]", text: "text-[#16A34A]", label: "求職者" },
  CLIENT: { bg: "bg-[#FEF3C7]", text: "text-[#D97706]", label: "求人企業" },
};

const CONTENT_TYPE_MAP: Record<string, { icon: string; label: string }> = {
  VIDEO: { icon: "🎥", label: "動画" },
  PDF: { icon: "📄", label: "PDF" },
  URL: { icon: "🔗", label: "URL" },
  MARKDOWN: { icon: "📝", label: "テキスト" },
};

function ManualsList() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [manuals, setManuals] = useState<Manual[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [contentType, setContentType] = useState(searchParams.get("contentType") || "");
  const page = parseInt(searchParams.get("page") || "1", 10);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateURL = useCallback(
    (params: { search?: string; category?: string; contentType?: string; page?: number }) => {
      const newParams = new URLSearchParams();
      const newSearch = params.search ?? search;
      const newCategory = params.category ?? category;
      const newContentType = params.contentType ?? contentType;
      const newPage = params.page ?? 1;

      if (newSearch) newParams.set("search", newSearch);
      if (newCategory) newParams.set("category", newCategory);
      if (newContentType) newParams.set("contentType", newContentType);
      if (newPage > 1) newParams.set("page", String(newPage));

      router.push(`/manuals?${newParams.toString()}`);
    },
    [router, search, category, contentType]
  );

  const fetchManuals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (contentType) params.set("contentType", contentType);
      params.set("page", String(page));
      params.set("limit", "10");

      const res = await fetch(`/api/manuals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setManuals(data.manuals);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  }, [search, category, contentType, page]);

  useEffect(() => {
    fetchManuals();
  }, [fetchManuals]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => { if (user) setIsAdmin(user.role === "admin"); });
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("このマニュアルを削除します。よろしいですか？")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/manuals/${id}/delete`, { method: "DELETE" });
      if (res.ok) {
        fetchManuals();
      } else {
        const data = await res.json();
        alert(data.error || "削除に失敗しました");
      }
    } catch {
      alert("削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setCategory(searchParams.get("category") || "");
    setContentType(searchParams.get("contentType") || "");
  }, [searchParams]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateURL({ search: value, page: 1 });
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const renderPagination = () => {
    if (pagination.totalPages <= 1) return null;

    const pages: (number | string)[] = [];
    const { page: currentPage, totalPages } = pagination;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }

    return (
      <div className="flex justify-center items-center gap-1 mt-6">
        <button
          onClick={() => updateURL({ page: currentPage - 1 })}
          disabled={currentPage === 1}
          className="px-3 py-1.5 text-[14px] border border-[#E5E7EB] rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F9FAFB]"
        >
          &lt; 前へ
        </button>
        {pages.map((p, idx) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${idx}`} className="px-2 text-[#6B7280]">
                ...
              </span>
            );
          }
          return (
            <button
              key={p}
              onClick={() => updateURL({ page: p as number })}
              className={`px-3 py-1.5 text-[14px] border rounded-md ${
                p === currentPage
                  ? "bg-[#2563EB] text-white border-[#2563EB]"
                  : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
              }`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => updateURL({ page: currentPage + 1 })}
          disabled={currentPage === totalPages}
          className="px-3 py-1.5 text-[14px] border border-[#E5E7EB] rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F9FAFB]"
        >
          次へ &gt;
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[#374151]">マニュアル</h1>
        <Link
          href="/manuals/new"
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 hover:bg-[#1D4ED8] text-[14px]"
        >
          + 新規作成
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]">🔍</span>
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="キーワード検索..."
            className="w-full pl-9 pr-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
          />
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            updateURL({ category: e.target.value, page: 1 });
          }}
          className="px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              カテゴリ: {opt.label}
            </option>
          ))}
        </select>
        <select
          value={contentType}
          onChange={(e) => {
            setContentType(e.target.value);
            updateURL({ contentType: e.target.value, page: 1 });
          }}
          className="px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
        >
          {CONTENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              種別: {opt.label}
            </option>
          ))}
        </select>
      </div>

      <hr className="my-4 border-[#E5E7EB]" />

      {loading ? (
        <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>
      ) : manuals.length === 0 ? (
        <div className="py-12 text-center text-[#6B7280]">マニュアルはまだ登録されていません</div>
      ) : (
        <div className="space-y-4">
          {manuals.map((manual) => {
            const badge = CATEGORY_BADGE[manual.category];
            const ct = CONTENT_TYPE_MAP[manual.contentType];
            return (
              <div
                key={manual.id}
                className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4 relative"
              >
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(manual.id)}
                    disabled={deletingId === manual.id}
                    className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    title="削除"
                  >
                    {deletingId === manual.id ? "..." : "🗑"}
                  </button>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[16px]">{ct.icon}</span>
                  <h3 className="text-[16px] font-semibold text-[#374151]">{manual.title}</h3>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
                    {ct.label}
                  </span>
                  <span>・</span>
                  <span>{manual.author.name}</span>
                  <span>・</span>
                  <span>{formatDate(manual.createdAt)}</span>
                </div>
                <Link
                  href={`/manuals/${manual.id}`}
                  className="inline-block text-[14px] text-[#2563EB] hover:underline mt-3"
                >
                  詳細を見る →
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {renderPagination()}
    </div>
  );
}

export default function ManualsListPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-[#6B7280]">読み込み中...</div>}>
      <ManualsList />
    </Suspense>
  );
}
