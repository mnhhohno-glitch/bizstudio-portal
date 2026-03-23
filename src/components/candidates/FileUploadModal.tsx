"use client";

import { useState, useRef } from "react";
import { CANDIDATE_FILE_CATEGORIES } from "@/lib/constants/candidate-file-categories";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_SIZE = 20 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
  return "📎";
}

export default function FileUploadModal({
  candidateId,
  defaultCategory,
  onClose,
  onSuccess,
}: {
  candidateId: string;
  defaultCategory: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [category, setCategory] = useState(defaultCategory);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [memo, setMemo] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = (file: File) => {
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("この形式のファイルはアップロードできません");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("ファイルサイズは20MB以下にしてください");
      return;
    }
    setSelectedFile(file);
    setError("");
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("category", category);
      if (memo.trim()) formData.append("memo", memo.trim());

      const res = await fetch(`/api/candidates/${candidateId}/files/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "アップロードに失敗しました");
      }

      onClose();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">ファイルをアップロード</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">{error}</div>
        )}

        <div className="space-y-4">
          {/* カテゴリ */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1">カテゴリ</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            >
              {CANDIDATE_FILE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* ドロップエリア */}
          {!selectedFile ? (
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                isDragging ? "border-[#2563EB] bg-[#F4F7F9]" : "border-gray-300"
              }`}
            >
              <p className="text-sm text-gray-500 mb-2">ファイルをドラッグ＆ドロップ</p>
              <p className="text-xs text-gray-400 mb-3">または</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-white border border-gray-300 text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                📎 ファイルを選択
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) validateAndSetFile(file);
                }}
              />
              <p className="text-xs text-gray-400 mt-3">PDF, Word, Excel, PowerPoint, 画像 ・ 最大20MB</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
              <span className="text-lg">{getIcon(selectedFile.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-500">{formatSize(selectedFile.size)}</p>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-gray-400 hover:text-gray-600 text-sm"
              >
                ✕ 取り消し
              </button>
            </div>
          )}

          {/* メモ */}
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1">メモ（任意）</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="ファイルに関するメモを入力..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50">
            キャンセル
          </button>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className={`flex-1 bg-[#2563EB] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed ${isUploading ? "animate-pulse" : ""}`}
          >
            {isUploading ? "アップロード中..." : "アップロード"}
          </button>
        </div>
      </div>
    </div>
  );
}
