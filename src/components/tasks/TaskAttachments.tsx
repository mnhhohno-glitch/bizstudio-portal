"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

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
  candidateId?: string | null;
  candidateName?: string | null;
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

const CATEGORIES = [
  { value: "ORIGINAL", label: "原本" },
  { value: "BS_DOCUMENT", label: "BS作成書類" },
  { value: "APPLICATION", label: "応募企業" },
  { value: "INTERVIEW_PREP", label: "面接対策" },
  { value: "MEETING", label: "面談" },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskAttachments({ taskId, currentUserId, currentUserRole, candidateId, candidateName }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);

  // Save to candidate modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveCategory, setSaveCategory] = useState("MEETING");
  const [saving, setSaving] = useState(false);

  const fetchAttachments = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments`);
      if (!res.ok) return;
      const data = await res.json();
      setAttachments(data.attachments ?? []);
    } catch { /* ignore */ }
  }, [taskId]);

  useEffect(() => { fetchAttachments(); }, [fetchAttachments]);

  const uploadFile = async (file: File) => {
    setError(null);
    if (file.size > 10 * 1024 * 1024) { setError("ファイルサイズが10MBを超えています"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: formData });
      if (!res.ok) { const err = await res.json(); setError(err.error || "アップロードに失敗しました"); return; }
      await fetchAttachments();
    } catch { setError("アップロードに失敗しました"); }
    finally { setUploading(false); }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (attachmentId: string, fileName: string) => {
    if (!confirm(`「${fileName}」を削除しますか？`)) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" });
      if (!res.ok) { alert("削除に失敗しました"); return; }
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(attachmentId); return n; });
    } catch { alert("削除に失敗しました"); }
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files); };
  const canDelete = (a: Attachment) => a.uploadedByUserId === currentUserId || currentUserRole === "admin";
  const getFileIcon = (mimeType: string) => FILE_ICONS[mimeType] ?? "FILE";
  const getIconColor = (icon: string) => FILE_ICON_COLORS[icon] ?? "bg-gray-100 text-gray-600";

  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = attachments.length > 0 && attachments.every((a) => selectedIds.has(a.id));

  const handleBulkDownload = async () => {
    setBulkDownloading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/bulk-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentIds: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition");
      a.download = cd?.match(/filename="(.+)"/)?.[1] || "download";
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("ダウンロードに失敗しました"); }
    finally { setBulkDownloading(false); }
  };

  const handleSaveToCandidate = async () => {
    if (!candidateId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/save-to-candidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentIds: Array.from(selectedIds), candidateId, category: saveCategory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      setShowSaveModal(false);
      setSelectedIds(new Set());
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存に失敗しました"); }
    finally { setSaving(false); }
  };

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
        className={["mb-4 flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-4 py-6 transition-colors", dragOver ? "border-[#2563EB] bg-[#EEF2FF]" : "border-[#D1D5DB] bg-[#F9FAFB]"].join(" ")}
      >
        {uploading ? (
          <p className="text-[13px] text-[#6B7280]">アップロード中...</p>
        ) : (
          <>
            <p className="text-[13px] text-[#6B7280]">ファイルをドラッグ＆ドロップ、または</p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-1 text-[13px] font-medium text-[#2563EB] hover:underline">ファイルを選択</button>
            <p className="mt-1 text-[11px] text-[#9CA3AF]">PDF, 画像, Word, Excel, CSV, テキスト（最大10MB）</p>
          </>
        )}
        <input ref={fileInputRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif,.docx,.xlsx,.csv,.txt" onChange={(e) => handleFileSelect(e.target.files)} />
      </div>

      {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2">
          <span className="text-[13px] font-medium text-[#2563EB]">✓ {selectedIds.size}件選択</span>
          <button onClick={handleBulkDownload} disabled={bulkDownloading} className="text-[12px] text-[#2563EB] hover:underline disabled:opacity-50">
            {bulkDownloading ? "DL中..." : "📥 一括DL"}
          </button>
          {candidateId && (
            <button onClick={() => setShowSaveModal(true)} className="text-[12px] text-[#2563EB] hover:underline">
              📁 求職者フォルダへ保存
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-[12px] text-gray-500 hover:text-gray-700">解除</button>
        </div>
      )}

      {/* file list */}
      {attachments.length === 0 ? (
        <p className="text-[13px] text-[#9CA3AF]">添付ファイルはありません</p>
      ) : (
        <div className="space-y-2">
          {/* Select all */}
          <label className="flex items-center gap-2 text-[12px] text-gray-500 cursor-pointer mb-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(attachments.map((a) => a.id)))}
              className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB]"
            />
            全選択
          </label>
          {attachments.map((a) => {
            const icon = getFileIcon(a.mimeType);
            const iconColor = getIconColor(icon);
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-[6px] border border-[#E5E7EB] px-3 py-2.5 transition-colors hover:bg-[#F9FAFB]">
                <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB] shrink-0" />
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-[10px] font-bold ${iconColor}`}>{icon}</span>
                <div className="min-w-0 flex-1">
                  <a href={a.publicUrl} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium text-[#2563EB] hover:underline">{a.fileName}</a>
                  <p className="text-[11px] text-[#9CA3AF]">{formatFileSize(a.fileSize)} ・ {a.uploadedByUser.name} ・ {new Date(a.createdAt).toLocaleDateString("ja-JP")}</p>
                </div>
                {canDelete(a) && (
                  <button type="button" onClick={() => handleDelete(a.id, a.fileName)} className="shrink-0 rounded-[4px] px-2 py-1 text-[12px] text-[#9CA3AF] transition-colors hover:bg-red-50 hover:text-red-600" title="削除">削除</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save to candidate modal */}
      {showSaveModal && candidateId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-3 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-[#374151]">📁 求職者フォルダへ保存</h3>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-[13px] text-gray-600">求職者: <span className="font-medium">{candidateName || candidateId}</span></p>
                <p className="text-[13px] text-gray-600">ファイル: {selectedIds.size}件</p>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#374151] mb-2">保存先サブタブ</label>
                <div className="space-y-1.5">
                  {CATEGORIES.map((c) => (
                    <label key={c.value} className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="saveCategory" value={c.value} checked={saveCategory === c.value} onChange={() => setSaveCategory(c.value)} className="accent-[#2563EB]" />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t px-5 py-3 flex gap-2">
              <button onClick={() => setShowSaveModal(false)} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-sm hover:bg-gray-50">キャンセル</button>
              <button onClick={handleSaveToCandidate} disabled={saving} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
