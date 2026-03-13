"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type Attachment = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  publicUrl: string;
  uploadedByUserId: string;
  uploadedByUser: { name: string };
  createdAt: string;
};

type Props = {
  taskId: string;
  currentUserId: string;
  currentUserRole: string;
};

const FILE_ICONS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/csv": "CSV",
  "text/plain": "TXT",
};

const FILE_ICON_COLORS: Record<string, string> = {
  PDF: "bg-red-100 text-red-700",
  JPG: "bg-orange-100 text-orange-700",
  PNG: "bg-purple-100 text-purple-700",
  GIF: "bg-pink-100 text-pink-700",
  DOCX: "bg-blue-100 text-blue-700",
  XLSX: "bg-green-100 text-green-700",
  CSV: "bg-emerald-100 text-emerald-700",
  TXT: "bg-gray-100 text-gray-600",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskAttachments({ taskId, currentUserId, currentUserRole }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAttachments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments`);
      if (!res.ok) return;
      const data = await res.json();
      setAttachments(data.attachments ?? []);
    } catch { /* ignore */ }
  }, [taskId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  const uploadFile = async (file: File) => {
    setError(null);
    if (file.size > 10 * 1024 * 1024) {
      setError("ファイルサイズが10MBを超えています");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "アップロードに失敗しました");
        return;
      }

      await fetchAttachments();
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (attachmentId: string, fileName: string) => {
    if (!confirm(`「${fileName}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "削除に失敗しました");
        return;
      }
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch {
      alert("削除に失敗しました");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const canDelete = (attachment: Attachment) =>
    attachment.uploadedByUserId === currentUserId || currentUserRole === "admin";

  const getFileIcon = (mimeType: string) => FILE_ICONS[mimeType] ?? "FILE";
  const getIconColor = (icon: string) => FILE_ICON_COLORS[icon] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="mt-6 border-t border-[#F3F4F6] pt-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-bold text-[#374151]">添付ファイル</h2>
        {attachments.length > 0 && (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#2563EB] px-1.5 text-[11px] font-medium text-white">
            {attachments.length}
          </span>
        )}
      </div>

      {/* upload area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={[
          "mb-4 flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-6 transition-colors",
          dragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]",
        ].join(" ")}
      >
        {uploading ? (
          <p className="text-[13px] text-[#6B7280]">アップロード中...</p>
        ) : (
          <>
            <p className="text-[13px] text-[#6B7280]">
              ファイルをドラッグ＆ドロップ、または
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline"
            >
              ファイルを選択
            </button>
            <p className="mt-1 text-[11px] text-[#9CA3AF]">
              PDF, 画像, Word, Excel, CSV, テキスト（最大10MB）
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.gif,.docx,.xlsx,.csv,.txt"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
      </div>

      {/* error */}
      {error && (
        <p className="mb-3 text-[13px] text-red-600">{error}</p>
      )}

      {/* file list */}
      {attachments.length === 0 ? (
        <p className="text-[13px] text-[#9CA3AF]">添付ファイルはありません</p>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => {
            const icon = getFileIcon(a.mimeType);
            const iconColor = getIconColor(icon);
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-[6px] border border-[#E5E7EB] px-3 py-2.5 transition-colors hover:bg-[#F9FAFB]"
              >
                {/* file icon */}
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-bold ${iconColor}`}>
                  {icon}
                </span>
                {/* info */}
                <div className="min-w-0 flex-1">
                  <a
                    href={a.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-[13px] font-medium text-[#2563EB] hover:underline"
                  >
                    {a.fileName}
                  </a>
                  <p className="text-[11px] text-[#9CA3AF]">
                    {formatFileSize(a.fileSize)} ・ {a.uploadedByUser.name} ・ {new Date(a.createdAt).toLocaleDateString("ja-JP")}
                  </p>
                </div>
                {/* delete */}
                {canDelete(a) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(a.id, a.fileName)}
                    className="shrink-0 rounded-[4px] px-2 py-1 text-[12px] text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600"
                    title="削除"
                  >
                    削除
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
