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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [memo, setMemo] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = (files: FileList | File[]) => {
    const newFiles: File[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.has(file.type)) {
        errors.push(`${file.name}: この形式はアップロードできません`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        errors.push(`${file.name}: 20MBを超えています`);
        continue;
      }
      // 重複チェック
      if (selectedFiles.some((f) => f.name === file.name && f.size === file.size)) {
        continue;
      }
      newFiles.push(file);
    }

    if (errors.length > 0) {
      setError(errors.join("\n"));
    } else {
      setError("");
    }

    if (newFiles.length > 0) {
      setSelectedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    setIsUploading(true);
    setError("");
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < selectedFiles.length; i++) {
      setUploadProgress({ current: i + 1, total: selectedFiles.length });
      try {
        const formData = new FormData();
        formData.append("file", selectedFiles[i]);
        formData.append("category", category);
        if (memo.trim()) formData.append("memo", memo.trim());

        const res = await fetch(`/api/candidates/${candidateId}/files/upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error();
        successCount++;
      } catch {
        errorCount++;
      }
    }

    setIsUploading(false);

    if (errorCount > 0) {
      setError(`${successCount}件アップロード成功、${errorCount}件失敗`);
    }

    if (successCount > 0) {
      onSuccess();
      if (errorCount === 0) onClose();
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
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm whitespace-pre-wrap">{error}</div>
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

          {/* ドロップエリア（常時表示） */}
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
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
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                if (e.target.files?.length) {
                  validateAndAddFiles(e.target.files);
                }
                e.target.value = "";
              }}
            />
            <p className="text-xs text-gray-400 mt-3">PDF, Word, Excel, PowerPoint, 画像 ・ 最大20MB ・ 複数選択可</p>
          </div>

          {/* 選択済みファイル一覧 */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              {selectedFiles.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <span className="text-lg">{getIcon(file.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatSize(file.size)}</p>
                  </div>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-gray-400 hover:text-gray-600 text-sm shrink-0"
                  >
                    ✕ 取り消し
                  </button>
                </div>
              ))}
              <p className="text-xs text-gray-500">{selectedFiles.length}件のファイルを選択中</p>
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
            disabled={selectedFiles.length === 0 || isUploading}
            className={`flex-1 bg-[#2563EB] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed ${isUploading ? "animate-pulse" : ""}`}
          >
            {isUploading
              ? `アップロード中... (${uploadProgress.current}/${uploadProgress.total})`
              : selectedFiles.length > 1
                ? `${selectedFiles.length}件をアップロード`
                : "アップロード"}
          </button>
        </div>
      </div>
    </div>
  );
}
