"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ANNOUNCEMENT_CATEGORIES, AnnouncementCategoryKey } from "@/lib/constants/announcement";

type Announcement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategoryKey;
  publishedAt: string | null;
  author: { name: string };
};

type Pagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const PERIOD_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "1week", label: "過去1週間" },
  { value: "1month", label: "過去1ヶ月" },
  { value: "3months", label: "過去3ヶ月" },
];

export default function AnnouncementsListPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [period, setPeriod] = useState(searchParams.get("period") || "");
  const page = parseInt(searchParams.get("page") || "1", 10);

  const updateURL = useCallback(
    (params: { search?: string; category?: string; period?: string; page?: number }) => {
      const newParams = new URLSearchParams();
      const newSearch = params.search ?? search;
      const newCategory = params.category ?? category;
      const newPeriod = params.period ?? period;
      const newPage = params.page ?? 1;

      if (newSearch) newParams.set("search", newSearch);
      if (newCategory) newParams.set("category", newCategory);
      if (newPeriod) newParams.set("period", newPeriod);
      if (newPage > 1) newParams.set("page", String(newPage));

      router.push(`/announcements?${newParams.toString()}`);
    },
    [router, search, category, period]
  );

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (period) params.set("period", period);
      params.set("page", String(page));
      params.set("limit", "10");

      const res = await fetch(`/api/announcements?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  }, [search, category, period, page]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  useEffect(() => {
    setSearch(searchParams.get("search") || "");
    setCategory(searchParams.get("category") || "");
    setPeriod(searchParams.get("period") || "");
  }, [searchParams]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      updateURL({ search, page: 1 });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + "…";
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
      <h1 className="text-[20px] font-semibold text-[#374151]">お知らせ一覧</h1>

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
          {Object.entries(ANNOUNCEMENT_CATEGORIES).map(([key, val]) => (
            <option key={key} value={key}>
              {val.icon} {val.label}
            </option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            updateURL({ period: e.target.value, page: 1 });
          }}
          className="px-3 py-2 border border-[#E5E7EB] rounded-md text-[14px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              期間: {opt.label}
            </option>
          ))}
        </select>
      </div>

      <hr className="my-4 border-[#E5E7EB]" />

      {loading ? (
        <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>
      ) : announcements.length === 0 ? (
        <div className="py-12 text-center text-[#6B7280]">お知らせが見つかりませんでした</div>
      ) : (
        <div className="space-y-4">
          {announcements.map((announcement) => {
            const cat = ANNOUNCEMENT_CATEGORIES[announcement.category];
            return (
              <div
                key={announcement.id}
                className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-4"
              >
                <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                    style={{ backgroundColor: cat.bgColor, color: cat.color }}
                  >
                    {cat.icon} {cat.label}
                  </span>
                  <span>・</span>
                  <span>{formatDate(announcement.publishedAt)}</span>
                </div>
                <h3 className="text-[16px] font-semibold text-[#374151] mt-2">
                  {announcement.title}
                </h3>
                <p className="text-[14px] text-[#6B7280] mt-2">
                  {truncateContent(announcement.content)}
                </p>
                <Link
                  href={`/announcements/${announcement.id}`}
                  className="inline-block text-[14px] text-[#2563EB] hover:underline mt-3"
                >
                  続きを読む →
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
