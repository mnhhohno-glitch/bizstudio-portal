"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type Document = {
  id: string;
  title: string;
  description: string;
  category: string;
  url: string;
  author: { name: string };
  updatedAt: string;
};

type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function DocumentsList() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const page = parseInt(searchParams.get("page") || "1", 10);

  const updateURL = useCallback(
    (params: { search?: string; category?: string; page?: number }) => {
      const newParams = new URLSearchParams();
      const newSearch = params.search ?? search;
      const newCategory = params.category ?? category;
      const newPage = params.page ?? 1;

      if (newSearch) newParams.set("search", newSearch);
      if (newCategory) newParams.set("category", newCategory);
      if (newPage > 1) newParams.set("page", String(newPage));

      router.push(`/documents?${newParams.toString()}`);
    },
    [router, search, category]
  );

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      params.set("page", String(page));
      params.set("limit", "10");

      const res = await fetch(`/api/documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents);
        setPagination(data.pagination);
        setCategories(data.categories);
      }
    } finally {
      setLoading(false);
    }
  }, [search, category, page]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setCategory(searchParams.get("category") || "");
  }, [searchParams]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      updateURL({ search, page: 1 });
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const truncateDescription = (text: string, maxLength = 100) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "…";
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
          disabled={currentPage === pagination.totalPages}
          className="px-3 py-1.5 text-[14px] border border-[#E5E7EB] rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#F9FAFB]"
        >
          次へ &gt;
        </button>
      </div>
    );
  };

  return (
    <div>
      <h1 className="text-[20px] font-semibold text-[#374151]">資料一覧</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="キーワード検索"
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
          <option value="">カテゴリ: すべて</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <hr className="my-4 border-[#E5E7EB]" />

      {loading ? (
        <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>
      ) : documents.length === 0 ? (
        <div className="py-12 text-center text-[#6B7280]">資料はまだ登録されていません</div>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[16px]">📄</span>
                <h3 className="text-[16px] font-semibold text-[#374151]">{doc.title}</h3>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
                <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#DBEAFE] text-[#2563EB] text-[12px]">
                  {doc.category}
                </span>
                <span>・</span>
                <span>更新日: {formatDate(doc.updatedAt)}</span>
              </div>
              <p className="text-[14px] text-[#6B7280] mt-2">
                {truncateDescription(doc.description)}
              </p>
              <Link
                href={`/documents/${doc.id}`}
                className="inline-block text-[14px] text-[#2563EB] hover:underline mt-3"
              >
                詳細を見る →
              </Link>
            </div>
          ))}
        </div>
      )}

      {renderPagination()}
    </div>
  );
}

export default function DocumentsListPage() {
  useEffect(() => { document.title = "ドキュメント - Bizstudio"; }, []);
  return (
    <Suspense fallback={<div className="py-12 text-center text-[#6B7280]">読み込み中...</div>}>
      <DocumentsList />
    </Suspense>
  );
}
