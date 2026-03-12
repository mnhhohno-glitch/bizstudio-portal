"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCategoryLabel, getSubCategoryLabel } from "@/lib/constants/manual-categories";

type Manual = {
  id: string;
  title: string;
  category: "INTERNAL" | "CANDIDATE" | "CLIENT";
  subCategory: string | null;
  contentType: "VIDEO" | "PDF" | "URL" | "MARKDOWN";
  videoUrl: string | null;
  pdfPath: string | null;
  pdfData: string | null;
  externalUrl: string | null;
  markdownContent: string | null;
  description: string | null;
  authorUserId: string;
  author: { name: string };
  createdAt: string;
};

type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

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

export default function ManualDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [manual, setManual] = useState<Manual | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [manualRes, userRes] = await Promise.all([
          fetch(`/api/manuals/${id}`),
          fetch("/api/auth/session"),
        ]);
        if (manualRes.ok) {
          setManual(await manualRes.json());
        }
        if (userRes.ok) {
          setCurrentUser(await userRes.json());
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const toLoomEmbed = (url: string) => {
    return url.replace("/share/", "/embed/");
  };

  const handleDelete = async () => {
    if (!confirm("このマニュアルを削除します。よろしいですか？")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/manuals/${id}/delete`, { method: "DELETE" });
      if (res.ok) {
        router.push("/manuals");
      }
    } finally {
      setDeleting(false);
    }
  };

  const canEdit =
    currentUser &&
    manual &&
    (currentUser.role === "admin" || currentUser.id === manual.authorUserId);

  const canDelete = currentUser?.role === "admin";

  if (loading) {
    return <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>;
  }

  if (!manual) {
    return <div className="py-12 text-center text-[#6B7280]">マニュアルが見つかりませんでした</div>;
  }

  const badge = CATEGORY_BADGE[manual.category];
  const ct = CONTENT_TYPE_MAP[manual.contentType];
  const categoryLabel = getCategoryLabel(manual.category);
  const subCategoryLabel = manual.subCategory
    ? getSubCategoryLabel(manual.category, manual.subCategory)
    : null;

  return (
    <div>
      <Link
        href="/manuals"
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6"
      >
        ← マニュアル一覧に戻る
      </Link>

      <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] ${badge.bg} ${badge.text}`}>
            {categoryLabel}
            {subCategoryLabel && <span> &gt; {subCategoryLabel}</span>}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] text-[12px]">
            {ct.icon} {ct.label}
          </span>
        </div>

        <h1 className="text-[20px] font-semibold text-[#374151]">{manual.title}</h1>

        <p className="text-[12px] text-[#6B7280] mt-2">
          投稿者: {manual.author.name} ・ {formatDate(manual.createdAt)}
        </p>

        <hr className="my-6 border-[#E5E7EB]" />

        {manual.contentType === "VIDEO" && manual.videoUrl && (
          <div className="aspect-video">
            <iframe
              src={toLoomEmbed(manual.videoUrl)}
              className="w-full h-full rounded-[8px] border border-[#E5E7EB]"
              allowFullScreen
              title={manual.title}
            />
          </div>
        )}

        {manual.contentType === "PDF" && manual.pdfData && (
          <embed
            src={manual.pdfData}
            type="application/pdf"
            className="w-full border border-[#E5E7EB] rounded-[8px]"
            style={{ height: "calc(100vh - 300px)" }}
          />
        )}

        {manual.contentType === "URL" && manual.externalUrl && (
          <div className="flex justify-center py-12">
            <a
              href={manual.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#2563EB] text-white rounded-md px-6 py-3 hover:bg-[#1D4ED8] text-[14px]"
            >
              🔗 マニュアルを開く
            </a>
          </div>
        )}

        {manual.contentType === "MARKDOWN" && manual.markdownContent && (
          <div className="prose-custom">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-[20px] font-semibold mt-6 mb-3 text-[#374151]">{children}</h1>,
                h2: ({ children }) => <h2 className="text-[18px] font-semibold mt-6 mb-3 text-[#374151]">{children}</h2>,
                h3: ({ children }) => <h3 className="text-[16px] font-semibold mt-4 mb-2 text-[#374151]">{children}</h3>,
                p: ({ children }) => <p className="text-[14px] leading-relaxed mb-4 text-[#374151]">{children}</p>,
                ul: ({ children }) => <ul className="pl-6 mb-4 list-disc">{children}</ul>,
                ol: ({ children }) => <ol className="pl-6 mb-4 list-decimal">{children}</ol>,
                li: ({ children }) => <li className="text-[14px] mb-1 text-[#374151]">{children}</li>,
                code: ({ children, className }) => {
                  const isInline = !className;
                  if (isInline) {
                    return <code className="bg-[#F3F4F6] px-1.5 py-0.5 rounded text-[13px]">{children}</code>;
                  }
                  return <code className={className}>{children}</code>;
                },
                pre: ({ children }) => (
                  <pre className="bg-[#1E293B] text-white p-4 rounded-[8px] overflow-x-auto mb-4 text-[13px]">
                    {children}
                  </pre>
                ),
                a: ({ href, children }) => (
                  <a href={href} className="text-[#2563EB] hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-[#E5E7EB] pl-4 my-4 text-[#6B7280] italic">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <table className="min-w-full border-collapse text-[14px] mb-4">{children}</table>
                ),
                th: ({ children }) => (
                  <th className="border border-[#E5E7EB] px-3 py-2 bg-[#F9FAFB] text-left font-medium">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-[#E5E7EB] px-3 py-2">{children}</td>
                ),
              }}
            >
              {manual.markdownContent}
            </ReactMarkdown>
          </div>
        )}

        {manual.description && (
          <>
            <hr className="my-6 border-[#E5E7EB]" />
            <div>
              <h2 className="text-[16px] font-semibold text-[#374151] mb-2">説明</h2>
              <p className="text-[14px] text-[#374151] whitespace-pre-line">{manual.description}</p>
            </div>
          </>
        )}

        {(canEdit || canDelete) && (
          <>
            <hr className="my-6 border-[#E5E7EB]" />
            <div className="flex items-center gap-3">
              {canEdit && (
                <Link
                  href={`/manuals/${manual.id}/edit`}
                  className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] font-medium hover:bg-[#F9FAFB]"
                >
                  ✏️ 編集
                </Link>
              )}
              {canDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-[#DC2626] text-white rounded-md px-4 py-2 text-[14px] font-medium hover:bg-[#B91C1C] disabled:opacity-50"
                >
                  {deleting ? "削除中..." : "🗑 削除"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
