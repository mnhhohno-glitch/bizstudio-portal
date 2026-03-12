"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type ManualCategory = "INTERNAL" | "CANDIDATE" | "CLIENT";
type ManualContentType = "VIDEO" | "PDF" | "URL" | "MARKDOWN";

type Manual = {
  id: string;
  title: string;
  category: ManualCategory;
  contentType: ManualContentType;
  videoUrl: string | null;
  pdfPath: string | null;
  externalUrl: string | null;
  markdownContent: string | null;
  description: string | null;
  authorUserId: string;
};

type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

const CATEGORY_OPTIONS: { value: ManualCategory; label: string }[] = [
  { value: "INTERNAL", label: "社内" },
  { value: "CANDIDATE", label: "求職者" },
  { value: "CLIENT", label: "求人企業" },
];

const CONTENT_TYPE_OPTIONS: { value: ManualContentType; icon: string; label: string }[] = [
  { value: "VIDEO", icon: "🎥", label: "動画" },
  { value: "PDF", icon: "📄", label: "PDF" },
  { value: "URL", icon: "🔗", label: "URL" },
  { value: "MARKDOWN", icon: "📝", label: "テキスト" },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ManualEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ManualCategory | "">("");
  const [contentType, setContentType] = useState<ManualContentType | "">("");
  const [videoUrl, setVideoUrl] = useState("");
  const [pdfPath, setPdfPath] = useState("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfFileSize, setPdfFileSize] = useState(0);
  const [externalUrl, setExternalUrl] = useState("");
  const [markdownContent, setMarkdownContent] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [manualRes, userRes] = await Promise.all([
          fetch(`/api/manuals/${id}`),
          fetch("/api/auth/me"),
        ]);

        if (!userRes.ok) {
          router.push("/manuals");
          return;
        }

        const user: CurrentUser = await userRes.json();

        if (!manualRes.ok) {
          router.push("/manuals");
          return;
        }

        const manual: Manual = await manualRes.json();

        if (user.role !== "admin" && user.id !== manual.authorUserId) {
          router.push("/manuals");
          return;
        }

        setTitle(manual.title);
        setCategory(manual.category);
        setContentType(manual.contentType);
        setVideoUrl(manual.videoUrl || "");
        setExternalUrl(manual.externalUrl || "");
        setMarkdownContent(manual.markdownContent || "");
        setDescription(manual.description || "");

        if (manual.pdfPath) {
          setPdfPath(manual.pdfPath);
          const fileName = manual.pdfPath.split("/").pop() || "uploaded.pdf";
          setPdfFileName(fileName);
        }
      } catch {
        router.push("/manuals");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, router]);

  const handlePdfUpload = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setError("PDFファイルのみアップロード可能です");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("ファイルサイズは20MB以下にしてください");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/manuals/upload-pdf", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "アップロードに失敗しました");
        return;
      }
      const data = await res.json();
      setPdfPath(data.pdfPath);
      setPdfFileName(file.name);
      setPdfFileSize(file.size);
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handlePdfUpload(file);
    },
    [handlePdfUpload]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("タイトルを入力してください");
      return;
    }
    if (!category) {
      setError("カテゴリを選択してください");
      return;
    }
    if (!contentType) {
      setError("コンテンツタイプを選択してください");
      return;
    }

    if (contentType === "VIDEO" && !videoUrl.trim()) {
      setError("Loom URLを入力してください");
      return;
    }
    if (contentType === "PDF" && !pdfPath) {
      setError("PDFファイルをアップロードしてください");
      return;
    }
    if (contentType === "URL" && !externalUrl.trim()) {
      setError("URLを入力してください");
      return;
    }
    if (contentType === "MARKDOWN" && !markdownContent.trim()) {
      setError("テキストを入力してください");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, string | null> = {
        title: title.trim(),
        category,
        contentType,
        videoUrl: contentType === "VIDEO" ? videoUrl.trim() : null,
        pdfPath: contentType === "PDF" ? pdfPath : null,
        externalUrl: contentType === "URL" ? externalUrl.trim() : null,
        markdownContent: contentType === "MARKDOWN" ? markdownContent : null,
        description: description.trim() || null,
      };

      const res = await fetch(`/api/manuals/${id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "保存に失敗しました");
        return;
      }

      router.push(`/manuals/${id}`);
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-[#6B7280]">読み込み中...</div>;
  }

  return (
    <div>
      <Link
        href="/manuals"
        className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-6"
      >
        ← マニュアル一覧に戻る
      </Link>

      <h1 className="text-[20px] font-semibold text-[#374151] mb-6">マニュアルを編集</h1>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-[8px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.06)] p-6">
          {error && (
            <div className="mb-6 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-6">
            {/* タイトル */}
            <div>
              <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="マニュアルのタイトルを入力"
              />
            </div>

            {/* カテゴリ */}
            <div>
              <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                カテゴリ <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ManualCategory)}
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              >
                <option value="">選択してください</option>
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* コンテンツタイプ */}
            <div>
              <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                コンテンツタイプ <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {CONTENT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setContentType(opt.value)}
                    className={`flex flex-col items-center justify-center rounded-md px-4 py-4 text-[14px] transition-colors ${
                      contentType === opt.value
                        ? "border-[#2563EB] border-2 bg-[#F0F7FF] text-[#2563EB]"
                        : "border border-gray-200 bg-white text-[#374151] hover:bg-[#F9FAFB]"
                    }`}
                  >
                    <span className="text-[24px] mb-1">{opt.icon}</span>
                    <span className="font-medium">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* コンテンツ入力 */}
            {contentType === "VIDEO" && (
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                  Loom URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.loom.com/share/..."
                  className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
                <p className="mt-1.5 text-[12px] text-[#6B7280]">※ LoomのURLを貼り付けてください</p>
              </div>
            )}

            {contentType === "PDF" && (
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                  PDFファイル <span className="text-red-500">*</span>
                </label>
                {pdfPath ? (
                  <div className="flex items-center gap-3 rounded-md border border-[#E5E7EB] px-4 py-3">
                    <span className="text-[20px]">📄</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-[#374151] truncate">{pdfFileName}</p>
                      {pdfFileSize > 0 && (
                        <p className="text-[12px] text-[#6B7280]">{formatFileSize(pdfFileSize)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPdfPath("");
                        setPdfFileName("");
                        setPdfFileSize(0);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-3 py-1.5 text-[13px] hover:bg-[#F9FAFB]"
                    >
                      変更
                    </button>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center rounded-md py-10 cursor-pointer transition-colors ${
                      dragging
                        ? "border-dashed border-2 border-[#2563EB] bg-[#F0F7FF]"
                        : "border-dashed border-2 border-gray-300 hover:border-[#2563EB] hover:bg-[#F9FAFB]"
                    }`}
                  >
                    {uploading ? (
                      <p className="text-[14px] text-[#6B7280]">アップロード中...</p>
                    ) : (
                      <>
                        <span className="text-[32px] mb-2">📄</span>
                        <p className="text-[14px] text-[#6B7280]">
                          PDFをドラッグ＆ドロップ または クリックして選択
                        </p>
                        <p className="text-[12px] text-[#9CA3AF] mt-1">最大20MB</p>
                      </>
                    )}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                />
              </div>
            )}

            {contentType === "URL" && (
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                  URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
                <p className="mt-1.5 text-[12px] text-[#6B7280]">※ 外部サイトのURLを入力してください</p>
              </div>
            )}

            {contentType === "MARKDOWN" && (
              <div>
                <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                  テキスト <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={markdownContent}
                  onChange={(e) => setMarkdownContent(e.target.value)}
                  rows={15}
                  placeholder="Markdown形式で入力..."
                  className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                />
              </div>
            )}

            {/* 補足説明 */}
            <div>
              <label className="block text-[14px] font-medium text-[#374151] mb-1.5">
                補足説明（任意）
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 text-[14px] focus:border-[#2563EB] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>
          </div>

          <hr className="my-6 border-[#E5E7EB]" />

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/manuals/${id}`}
              className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB]"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[14px] hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {submitting ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
