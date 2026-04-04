"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { AREA_GROUPS, OTHER_PREFECTURES } from "@/lib/constants/target-areas";

/* ---------- Types ---------- */
type Job = {
  id: number;
  company_name: string;
  job_title: string;
  job_db: string | null;
  job_type: string | null;
  job_category: string | null;
  work_location: string | null;
  salary: string | null;
  overtime: string | null;
  area_match: string | null;
  transfer: string | null;
  original_url: string | null;
  created_at: string;
  updated_at: string;
};

type JobsResponse = {
  jobs: Job[];
  total_jobs: number;
  project_id?: number;
  project_name?: string;
  job_seeker_id?: string;
  job_seeker_name?: string;
};

type Entry = {
  id: string;
  candidateId: string;
  externalJobId: number;
  companyName: string;
  jobTitle: string;
  jobDb: string | null;
  jobType: string | null;
  jobCategory: string | null;
  workLocation: string | null;
  salary: string | null;
  overtime: string | null;
  areaMatch: string | null;
  transfer: string | null;
  originalUrl: string | null;
  entryDate: string;
  introducedAt: string;
  createdAt: string;
  updatedAt: string;
};

/* ---------- Helpers ---------- */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase();
}

function formatDateJST(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function toInputDate(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function todayString(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/* ---------- Sub-components ---------- */

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3 animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-4 w-4 bg-gray-200 rounded" />
            <div className="h-4 w-28 bg-gray-200 rounded" />
            <div className="ml-auto h-4 w-20 bg-gray-200 rounded" />
          </div>
          <div className="h-4 w-full bg-gray-200 rounded mb-2" />
          <div className="h-3 w-24 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Entry Date Modal ---------- */
function EntryDateModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayString());

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-bold text-[#374151]">
            エントリー日を選択
          </h2>
          <button
            onClick={onCancel}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          {count}件の求人をエントリーします
        </p>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB]"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(date)}
            disabled={!date}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            登録
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
/* ---------- Bookmark Section ---------- */
type BookmarkFile = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  driveFileId: string;
  driveViewUrl: string;
  memo: string | null;
  extractedAt: string | null;
  aiMatchRating: string | null;
  aiAnalysisComment: string | null;
  aiAnalyzedAt: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
};

const RATING_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-red-100 text-red-800 border-red-300",
};
const RATING_LABELS: Record<string, string> = {
  A: "A 非常に良い", B: "B 良い", C: "C 要検討", D: "D 合わない",
};

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
  "text/plain",
]);

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
  if (mimeType === "text/plain") return "📝";
  return "📎";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatFileDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function BookmarkSection({ candidateId, onCountChange }: { candidateId: string; onCountChange?: (count: number) => void }) {
  const [files, setFiles] = useState<BookmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendDbType, setSendDbType] = useState("hito_mynavi");
  const [sendAreas, setSendAreas] = useState<Set<string>>(new Set());
  const [otherSearch, setOtherSearch] = useState("");
  const [showOtherDropdown, setShowOtherDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; projectUrl?: string; message?: string } | null>(null);
  const [sendStep, setSendStep] = useState(0);
  const [memoFile, setMemoFile] = useState<File | null>(null);
  const [isMemoDropping, setIsMemoDropping] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<{ fileName: string; rating: string; comment: string } | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractTriggered = useRef(false);

  const triggerExtraction = (fileIds: string[], label = "") => {
    if (fileIds.length === 0) return;
    console.log(`[ExtractText${label}] Triggering extraction for`, fileIds.length, "files:", fileIds);
    fetch(`/api/candidates/${candidateId}/bookmarks/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          console.error(`[ExtractText${label}] API error:`, res.status, data);
        } else {
          console.log(`[ExtractText${label}] Result:`, data);
          if (data?.extracted > 0) {
            fetchFiles(); // refresh to show ✅ icons
          }
        }
      })
      .catch((err) => {
        console.error(`[ExtractText${label}] Fetch failed:`, err);
      });
  };

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
      if (res.ok) {
        const data = await res.json();
        const f = data.files || [];
        setFiles(f);
        onCountChange?.(f.length);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [candidateId, onCountChange]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // Refresh when AI analysis completes (ratings updated)
  useEffect(() => {
    const handler = () => fetchFiles();
    window.addEventListener("bookmark-ratings-updated", handler);
    return () => window.removeEventListener("bookmark-ratings-updated", handler);
  }, [fetchFiles]);

  // Auto-extract text for existing files without extraction (run once)
  useEffect(() => {
    if (extractTriggered.current || loading || files.length === 0) return;
    const filesWithoutText = files.filter((f) => !f.extractedAt);
    if (filesWithoutText.length > 0) {
      extractTriggered.current = true;
      triggerExtraction(filesWithoutText.map((f) => f.id), ":auto");
    }
  }, [files, loading]);

  const uploadFiles = async (fileList: File[]) => {
    const valid = fileList.filter((f) => ALLOWED_TYPES.has(f.type) && f.size <= 20 * 1024 * 1024);
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: valid.length });

    const uploadedFileIds: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      setUploadProgress({ current: i + 1, total: valid.length });
      try {
        const formData = new FormData();
        formData.append("file", valid[i]);
        formData.append("category", "BOOKMARK");
        const res = await fetch(`/api/candidates/${candidateId}/files/upload`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.file?.id) uploadedFileIds.push(data.file.id);
        }
      } catch { /* */ }
    }

    setUploading(false);
    fetchFiles();

    // Background text extraction for uploaded files
    triggerExtraction(uploadedFileIds, ":upload");
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm("このファイルを削除します。よろしいですか？")) return;
    setDeletingId(fileId);
    try {
      await fetch(`/api/candidates/${candidateId}/files/${fileId}`, { method: "DELETE" });
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(fileId); return n; });
      fetchFiles();
    } catch { /* */ }
    finally { setDeletingId(null); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`選択した ${selectedIds.size} 件のファイルを削除しますか？`)) return;
    setBulkDeleting(true);
    try {
      for (const fileId of selectedIds) {
        await fetch(`/api/candidates/${candidateId}/files/${fileId}`, { method: "DELETE" });
      }
      setSelectedIds(new Set());
      fetchFiles();
    } catch { /* */ }
    finally { setBulkDeleting(false); }
  };

  const handleBulkDownload = async () => {
    if (selectedIds.size === 0) return;
    setBulkDownloading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/bulk-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bookmarks_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("一括ダウンロードに失敗しました");
    } finally {
      setBulkDownloading(false);
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };

  // Filtered files
  const filteredFiles = files.filter((f) => {
    if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterDate) {
      const fileDate = new Date(f.createdAt).toISOString().slice(0, 10);
      if (fileDate !== filterDate) return false;
    }
    return true;
  });

  const toggleAll = () => {
    const ids = filteredFiles.map((f) => f.id);
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));

  const shortDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  const handleSendToJobTool = async () => {
    const areas = [...sendAreas];
    if (areas.length === 0) return;
    if (sendDbType === "circus" && !memoFile) return;

    setSending(true);
    setSendResult(null);
    setSendStep(1);

    try {
      let memoContent: string | null = null;
      if (sendDbType === "circus" && memoFile) {
        memoContent = await memoFile.text();
      }

      // Simulate step progress during API call
      const stepTimer = setInterval(() => {
        setSendStep((prev) => Math.min(prev + 1, 3));
      }, 2000);

      const res = await fetch(`/api/candidates/${candidateId}/bookmarks/send-to-job-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileIds: Array.from(selectedIds),
          dbType: sendDbType,
          targetAreas: areas,
          memoContent,
        }),
      });

      clearInterval(stepTimer);
      setSendStep(4);

      const data = await res.json();
      if (res.ok && data.success) {
        setSendResult({ success: true, projectUrl: data.projectUrl, message: data.message });
        toast.success(data.message);
      } else {
        setSendResult({ success: false, message: data.error || "送信に失敗しました" });
        toast.error(data.error || "送信に失敗しました");
      }
    } catch {
      setSendResult({ success: false, message: "通信エラーが発生しました" });
      toast.error("通信エラーが発生しました");
    } finally {
      setSending(false);
    }
  };

  const handleCloseSendModal = () => {
    setShowSendModal(false);
    setSendResult(null);
    setSendStep(0);
    setOtherSearch("");
    setShowOtherDropdown(false);
    if (sendResult?.success) {
      setSelectedIds(new Set());
    }
  };

  const toggleArea = (area: string) => {
    setSendAreas((prev) => {
      const n = new Set(prev);
      if (n.has(area)) n.delete(area); else if (n.size < 5) n.add(area);
      return n;
    });
  };

  const toggleGroup = (prefectures: readonly string[]) => {
    setSendAreas((prev) => {
      const n = new Set(prev);
      const allSelected = prefectures.every((p) => n.has(p));
      if (allSelected) {
        for (const p of prefectures) n.delete(p);
      } else {
        for (const p of prefectures) {
          if (!n.has(p) && n.size < 5) n.add(p);
        }
      }
      return n;
    });
  };

  const otherSelected = [...sendAreas].filter((a) =>
    OTHER_PREFECTURES.includes(a)
  );

  const filteredOtherPrefectures = OTHER_PREFECTURES.filter(
    (p) => !sendAreas.has(p) && p.includes(otherSearch)
  );

  return (
    <div
      className="bg-white rounded-lg border border-gray-200"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
        if (e.dataTransfer.files?.length) uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Fixed header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[#374151]">📁 ブックマーク</h3>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {uploading ? `アップロード中 (${uploadProgress.current}/${uploadProgress.total})` : "+ アップロード"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt"
            onChange={(e) => { if (e.target.files?.length) uploadFiles(Array.from(e.target.files)); e.target.value = ""; }}
          />
        </div>
        <p className="text-[12px] text-gray-500">求人票PDFを保管します</p>

        {/* Select all + bulk delete */}
        {files.length > 0 && (
          <div className="flex items-center gap-3 mt-2">
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
              />
              全選択
            </label>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="text-[12px] text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                >
                  🗑️ 選択を削除（{selectedIds.size}件）
                </button>
                <button
                  onClick={handleBulkDownload}
                  disabled={bulkDownloading}
                  className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
                >
                  {bulkDownloading ? "⬇ ダウンロード中..." : `⬇ 一括DL（${selectedIds.size}件）`}
                </button>
                <button
                  onClick={() => { setSendResult(null); setSendStep(0); setSendDbType("hito_mynavi"); setSendAreas(new Set()); setOtherSearch(""); setShowOtherDropdown(false); setMemoFile(null); setShowSendModal(true); }}
                  className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                >
                  📤 求人出力へ送信（{selectedIds.size}件）
                </button>
              </>
            )}
          </div>
        )}

        {/* Search + date filter */}
        {files.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 ファイル名で検索..."
                className="w-full border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
            <div className="relative">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {filterDate && (
                <button onClick={() => setFilterDate("")} className="absolute -right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Drop zone hint */}
      {isDragging && (
        <div className="mx-4 my-3 border-2 border-dashed border-[#2563EB] bg-blue-50 rounded-lg p-6 text-center">
          <p className="text-[#2563EB] font-medium text-sm">ここにファイルをドロップしてアップロード</p>
        </div>
      )}

      {/* Scrollable file list */}
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 && !isDragging ? (
          <div className="mx-4 my-4 border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-400">ファイルをドラッグ＆ドロップ、または「アップロード」ボタンをクリック</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFiles.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-gray-400">該当するファイルが見つかりません</div>
            ) : filteredFiles.map((file) => (
              <div key={file.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedIds.has(file.id)}
                  onChange={() => toggleSelect(file.id)}
                  className="w-3.5 h-3.5 shrink-0 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                <span className="shrink-0 text-base">{getFileIcon(file.mimeType)}</span>
                <a
                  href={getPreviewUrl(file.driveViewUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 text-[13px] font-medium text-blue-600 hover:text-blue-800 hover:underline truncate"
                  title="クリックでPDFをプレビュー"
                >{file.fileName}</a>
                <span className="shrink-0 text-[11px] text-gray-400">{formatFileSize(file.fileSize)}</span>
                {file.extractedAt && <span className="shrink-0 text-[10px] text-green-500" title="テキスト化済">✅</span>}
                {file.aiMatchRating && RATING_STYLES[file.aiMatchRating] && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAnalysis({
                        fileName: file.fileName,
                        rating: file.aiMatchRating!,
                        comment: file.aiAnalysisComment || "分析コメントがありません",
                      });
                    }}
                    className={`shrink-0 inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-semibold border cursor-pointer hover:opacity-80 transition-opacity ${RATING_STYLES[file.aiMatchRating]}`}
                  >
                    {RATING_LABELS[file.aiMatchRating]}
                  </button>
                )}
                <span className="shrink-0 text-[11px] text-gray-400 hidden sm:inline">{file.uploadedBy.name}</span>
                <span className="shrink-0 text-[11px] text-gray-400">{shortDate(file.createdAt)}</span>
                <a
                  href={`https://drive.google.com/uc?export=download&id=${file.driveFileId}`}
                  download
                  className="shrink-0 text-gray-400 hover:text-gray-700 text-[12px] font-medium"
                >
                  ⬇DL
                </a>
                <button
                  onClick={() => handleDelete(file.id)}
                  disabled={deletingId === file.id}
                  className="shrink-0 text-gray-400 hover:text-red-500 text-[12px] font-medium disabled:opacity-50"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send to job tool modal */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={handleCloseSendModal}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-bold text-[#374151]">📤 求人出力へ送信</h2>
              <button onClick={handleCloseSendModal} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>

            {sendResult ? (
              <div>
                {sendResult.success ? (
                  <div className="text-center py-4">
                    <p className="text-green-600 font-medium mb-3">✅ {sendResult.message}</p>
                    {sendResult.projectUrl && (
                      <a href={sendResult.projectUrl} target="_blank" rel="noopener noreferrer" className="text-[#2563EB] hover:underline text-sm font-medium">
                        メモ編集・抽出へ進む →
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-red-600 text-sm py-4 text-center">{sendResult.message}</p>
                )}
                <button onClick={handleCloseSendModal} className="w-full mt-4 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50">閉じる</button>
              </div>
            ) : sending ? (
              <div className="py-4 space-y-2 text-[13px]">
                <p className="animate-pulse text-blue-600 font-semibold mb-3">📤 処理中...</p>
                {[
                  { step: 1, label: "プロジェクト確認" },
                  { step: 2, label: "PDFアップロード" },
                  { step: 3, label: "メモ作成" },
                  { step: 4, label: "抽出開始" },
                ].map(({ step, label }) => {
                  const done = sendStep >= step;
                  const active = !done && sendStep === step - 1;
                  return (
                    <div key={step} className="flex items-center gap-2">
                      {done ? (
                        <span className="text-green-500">✅</span>
                      ) : active ? (
                        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <span className="text-gray-300">⬜</span>
                      )}
                      <span className={active ? "text-blue-600 font-medium" : done ? "text-gray-700" : "text-gray-400"}>{label}{active ? "..." : ""}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">選択したPDF: {selectedIds.size}件</p>
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-2">データベースタイプ</label>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="dbType" value="hito_mynavi" checked={sendDbType === "hito_mynavi"} onChange={() => { setSendDbType("hito_mynavi"); setMemoFile(null); }} className="accent-[#2563EB]" />
                      HITO-Link / マイナビ（自動処理）
                    </label>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="dbType" value="circus" checked={sendDbType === "circus"} onChange={() => { setSendDbType("circus"); setMemoFile(null); }} className="accent-[#2563EB]" />
                      Circus（手動処理）
                    </label>
                  </div>
                </div>
                {sendDbType === "circus" && (
                  <div>
                    <label className="block text-[13px] font-medium text-[#374151] mb-2">メモ帳ファイル（必須）</label>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsMemoDropping(true); }}
                      onDragLeave={() => setIsMemoDropping(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsMemoDropping(false);
                        const file = e.dataTransfer.files[0];
                        if (file && file.name.endsWith(".txt")) {
                          setMemoFile(file);
                        } else {
                          toast.error(".txtファイルのみ添付可能です");
                        }
                      }}
                      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                        isMemoDropping ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {memoFile ? (
                        <div className="flex items-center justify-between">
                          <span className="text-[13px]">✅ {memoFile.name} ({(memoFile.size / 1024).toFixed(1)}KB)</span>
                          <button onClick={() => setMemoFile(null)} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
                        </div>
                      ) : (
                        <>
                          <p className="text-[13px] text-gray-500">Circusのメモ帳（.txt）をドラッグ＆ドロップ</p>
                          <p className="text-[11px] text-gray-400 mt-1">フォーマット: 会社名 → CircusURL（2行ずつ）</p>
                          <label className="inline-block mt-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded cursor-pointer text-[12px]">
                            ファイルを選択
                            <input
                              type="file"
                              accept=".txt"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) setMemoFile(file);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[13px] font-medium text-[#374151] mb-2">
                    対象エリア（1〜5件選択）
                    <span className="ml-2 text-[12px] font-normal text-gray-500">{sendAreas.size}/5</span>
                  </label>
                  {sendAreas.size >= 5 && (
                    <p className="text-[11px] text-red-500 mb-2">最大5件まで選択可能です</p>
                  )}
                  <div className="space-y-2">
                    {AREA_GROUPS.map((group) => {
                      const allSelected = group.prefectures.every((p) => sendAreas.has(p));
                      const someSelected = !allSelected && group.prefectures.some((p) => sendAreas.has(p));
                      const wouldExceed = !allSelected && sendAreas.size + group.prefectures.filter((p) => !sendAreas.has(p)).length > 5;
                      return (
                        <div key={group.label}>
                          <label className="flex items-start gap-1.5 text-[13px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => { if (el) el.indeterminate = someSelected; }}
                              onChange={() => toggleGroup(group.prefectures)}
                              disabled={wouldExceed && !allSelected && !someSelected}
                              className="w-3.5 h-3.5 mt-0.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer disabled:opacity-50"
                            />
                            <span>
                              <span className="font-medium">{group.label}</span>
                              <span className="text-[11px] text-gray-500 ml-1">（{group.prefectures.join("・")}）</span>
                            </span>
                          </label>
                          <div className="ml-5 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            {group.prefectures.map((pref) => (
                              <label key={pref} className="flex items-center gap-1 text-[12px] cursor-pointer text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={sendAreas.has(pref)}
                                  onChange={() => toggleArea(pref)}
                                  disabled={!sendAreas.has(pref) && sendAreas.size >= 5}
                                  className="w-3 h-3 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer disabled:opacity-50"
                                />
                                {pref}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    <span className="text-[12px] font-medium text-gray-600">その他の都道府県</span>
                    {otherSelected.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5 mb-1.5">
                        {otherSelected.map((pref) => (
                          <span key={pref} className="inline-flex items-center gap-1 bg-blue-50 text-[#2563EB] text-[12px] px-2 py-0.5 rounded-full border border-blue-200">
                            {pref}
                            <button onClick={() => toggleArea(pref)} className="hover:text-red-500 text-[10px] leading-none">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative mt-1">
                      <input
                        value={otherSearch}
                        onChange={(e) => { setOtherSearch(e.target.value); setShowOtherDropdown(true); }}
                        onFocus={() => setShowOtherDropdown(true)}
                        onBlur={() => setTimeout(() => setShowOtherDropdown(false), 200)}
                        placeholder="都道府県を検索..."
                        disabled={sendAreas.size >= 5}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50 disabled:bg-gray-50"
                      />
                      {showOtherDropdown && filteredOtherPrefectures.length > 0 && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-[150px] overflow-y-auto">
                          {filteredOtherPrefectures.map((pref) => (
                            <button
                              key={pref}
                              onClick={() => {
                                toggleArea(pref);
                                setOtherSearch("");
                                setShowOtherDropdown(false);
                              }}
                              disabled={sendAreas.size >= 5}
                              className="block w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-blue-50 hover:text-[#2563EB] disabled:opacity-50"
                            >
                              {pref}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={handleCloseSendModal} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50">キャンセル</button>
                  <button onClick={handleSendToJobTool} disabled={sendAreas.size === 0 || (sendDbType === "circus" && !memoFile)} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">送信開始</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis comment modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setSelectedAnalysis(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[70vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b bg-gray-50">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${RATING_STYLES[selectedAnalysis.rating]}`}>
                  {RATING_LABELS[selectedAnalysis.rating]}
                </span>
                <h3 className="font-semibold text-sm truncate">{selectedAnalysis.fileName}</h3>
              </div>
              <button onClick={() => setSelectedAnalysis(null)} className="text-gray-400 hover:text-gray-600 text-xl shrink-0 ml-2">✕</button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[55vh]">
              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {selectedAnalysis.comment}
              </div>
            </div>
            <div className="p-3 border-t flex justify-end">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(selectedAnalysis.comment);
                  toast.success("コピーしました");
                }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                📋 コピー
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
export default function HistoryTab({ candidateId }: { candidateId: string }) {
  const [activeSubTab, setActiveSubTab] = useState<"bookmark" | "jobs" | "entries">("bookmark");
  const [bookmarkCount, setBookmarkCount] = useState(0);

  // Jobs state
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobSearch, setJobSearch] = useState("");

  // Entries state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entrySearch, setEntrySearch] = useState("");

  // Derive entered external job ids for cross-referencing
  const enteredJobIds = new Set(entries.map((e) => e.externalJobId));

  /* ---------- Fetch ---------- */
  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/jobs`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `エラー (${res.status})`);
      }
      const data: JobsResponse = await res.json();
      setJobsData(data);
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setJobsLoading(false);
    }
  }, [candidateId]);

  const fetchEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/entries`);
      if (!res.ok) throw new Error("エントリーの取得に失敗しました");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : "データの取得に失敗しました");
    } finally {
      setEntriesLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchJobs();
    fetchEntries();
  }, [fetchJobs, fetchEntries]);

  /* ---------- Handlers ---------- */
  const toggleJobSelection = (jobId: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const selectableJobIds = (jobsData?.jobs || [])
    .filter((j) => !enteredJobIds.has(j.id))
    .map((j) => j.id);

  const allSelectableChecked =
    selectableJobIds.length > 0 &&
    selectableJobIds.every((id) => selectedJobIds.has(id));

  const handleToggleAll = () => {
    if (allSelectableChecked) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(selectableJobIds));
    }
  };

  const handleEntrySubmit = async (entryDate: string) => {
    if (!jobsData) return;
    setSubmitting(true);

    const selectedJobs = jobsData.jobs.filter((j) => selectedJobIds.has(j.id));
    const payload = {
      entries: selectedJobs.map((j) => ({
        externalJobId: j.id,
        companyName: j.company_name,
        jobTitle: j.job_title,
        jobDb: j.job_db,
        jobType: j.job_type,
        jobCategory: j.job_category,
        workLocation: j.work_location,
        salary: j.salary,
        overtime: j.overtime,
        areaMatch: j.area_match,
        transfer: j.transfer,
        originalUrl: j.original_url,
        introducedAt: j.created_at,
      })),
      entryDate,
    };

    try {
      const res = await fetch(`/api/candidates/${candidateId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("エントリーの登録に失敗しました");
      const data = await res.json();

      if (data.skipped > 0) {
        toast.success(`${data.created}件登録、${data.skipped}件は登録済みのためスキップ`);
      } else {
        toast.success(`${data.created}件のエントリーを登録しました`);
      }

      setSelectedJobIds(new Set());
      setShowEntryModal(false);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm("このエントリーを削除します。よろしいですか？")) return;
    setDeletingId(entryId);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("削除に失敗しました");
      toast.success("エントリーを削除しました");
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateEntryDate = async (entryId: string, newDate: string) => {
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/${entryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryDate: newDate }),
        }
      );
      if (!res.ok) throw new Error("更新に失敗しました");
      toast.success("エントリー日を更新しました");
      setEditingEntryId(null);
      fetchEntries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新に失敗しました");
    }
  };

  /* ---------- Render ---------- */
  const allJobs = jobsData?.jobs || [];
  const totalJobs = jobsData?.total_jobs ?? 0;
  const jobs = jobSearch
    ? allJobs.filter((j) => normalize(j.company_name).includes(normalize(jobSearch)))
    : allJobs;
  const filteredEntries = entrySearch
    ? entries.filter((e) => normalize(e.companyName).includes(normalize(entrySearch)))
    : entries;

  return (
    <div>
      {/* サブタブバー */}
      <div className="bg-gray-50 rounded-lg p-1 inline-flex gap-1 mb-6">
        <button
          onClick={() => setActiveSubTab("bookmark")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "bookmark"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          ブックマーク
          {bookmarkCount > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({bookmarkCount})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("jobs")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "jobs"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          求人紹介
          {totalJobs > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({totalJobs})</span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab("entries")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "entries"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          エントリー
          {entries.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({entries.length})</span>
          )}
        </button>
      </div>

      {/* ===== ブックマークサブタブ ===== */}
      {activeSubTab === "bookmark" && (
        <BookmarkSection candidateId={candidateId} onCountChange={setBookmarkCount} />
      )}

      {/* ===== 求人紹介サブタブ ===== */}
      {activeSubTab === "jobs" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              抽出結果（{jobSearch ? `${jobs.length}件 / ${totalJobs}件` : `${totalJobs}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {jobSearch && (
                <button
                  onClick={() => setJobSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
            {selectableJobIds.length > 0 && (
              <button
                onClick={handleToggleAll}
                className="text-[13px] text-gray-500 hover:text-[#2563EB] transition-colors"
              >
                {allSelectableChecked ? "☑ 全解除" : "☐ 全選択"}
              </button>
            )}
            <button
              onClick={() => setShowEntryModal(true)}
              disabled={selectedJobIds.size === 0 || submitting}
              className="ml-auto bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ☑ 選択してエントリー
              {selectedJobIds.size > 0 && ` (${selectedJobIds.size})`}
            </button>
          </div>

          {/* コンテンツ */}
          {jobsLoading ? (
            <SkeletonCards />
          ) : jobsError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{jobsError}</div>
          ) : allJobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              この求職者の求人紹介データはまだありません
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当する求人が見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              <div className="grid grid-cols-1 gap-3">
                {jobs.map((job) => {
                  const isEntered = enteredJobIds.has(job.id);
                  const isSelected = selectedJobIds.has(job.id);

                  return (
                    <div
                      key={job.id}
                      className={`rounded-lg border p-3 transition-shadow ${
                        isSelected
                          ? "border-[#2563EB] bg-blue-50/30"
                          : "border-gray-200 hover:shadow-sm"
                      }`}
                    >
                      {/* 1行目: チェック + 会社名 + バッジ + DB/タイプ */}
                      <div className="flex items-center gap-2 min-w-0">
                        {isEntered ? (
                          <span className="shrink-0 text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">
                            済
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleJobSelection(job.id)}
                            className="shrink-0 w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                          />
                        )}
                        <span className="font-semibold text-sm text-[#374151] truncate">
                          {job.company_name}
                        </span>
                        {job.job_category && (
                          <span className="shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                            {job.job_category}
                          </span>
                        )}
                        <span className="shrink-0 ml-auto text-xs text-gray-400">
                          {[job.job_db, job.job_type].filter(Boolean).join(" / ")}
                        </span>
                      </div>
                      {/* 2行目: 求人タイトル + 紹介日 */}
                      <div className="flex items-start justify-between gap-3 mt-1 ml-6">
                        <p className="text-sm text-gray-700 line-clamp-2 min-w-0">
                          {job.job_title}
                        </p>
                        <span className="shrink-0 text-xs text-gray-400 pt-0.5">
                          紹介日: {formatDateJST(job.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== エントリーサブタブ ===== */}
      {activeSubTab === "entries" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          {/* ヘッダー */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-[14px] font-semibold text-[#374151] shrink-0">
              エントリー一覧（{entrySearch ? `${filteredEntries.length}件 / ${entries.length}件` : `${entries.length}件`}）
            </h3>
            <div className="relative">
              <input
                type="text"
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
                placeholder="🔍 会社名で検索..."
                className="border border-gray-300 rounded-md pl-3 pr-7 py-1 text-[13px] w-48 focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
              />
              {entrySearch && (
                <button
                  onClick={() => setEntrySearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* コンテンツ */}
          {entriesLoading ? (
            <SkeletonCards />
          ) : entriesError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{entriesError}</div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              エントリーはまだありません。求人紹介タブから求人を選択してエントリーできます。
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-400">
              該当するエントリーが見つかりません
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              <div className="grid grid-cols-1 gap-3">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow"
                  >
                    {/* 1行目: 会社名 + バッジ + DB/タイプ */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm text-[#374151] truncate">
                        {entry.companyName}
                      </span>
                      {entry.jobCategory && (
                        <span className="shrink-0 text-xs bg-blue-100 text-blue-700 rounded px-2 py-0.5">
                          {entry.jobCategory}
                        </span>
                      )}
                      <span className="shrink-0 ml-auto text-xs text-gray-400">
                        {[entry.jobDb, entry.jobType].filter(Boolean).join(" / ")}
                      </span>
                    </div>
                    {/* 2行目: 求人タイトル + エントリー日/紹介日 + 削除 */}
                    <div className="flex items-start justify-between gap-3 mt-1">
                      <p className="text-sm text-gray-700 line-clamp-2 min-w-0">
                        {entry.jobTitle}
                      </p>
                      <div className="shrink-0 flex items-center gap-2 pt-0.5">
                        <span className="text-xs font-medium text-[#374151]">
                          エントリー日:{" "}
                          {editingEntryId === entry.id ? (
                            <input
                              type="date"
                              value={editingDate}
                              onChange={(e) => setEditingDate(e.target.value)}
                              onBlur={() => {
                                if (editingDate && editingDate !== toInputDate(entry.entryDate)) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else {
                                  setEditingEntryId(null);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editingDate) {
                                  handleUpdateEntryDate(entry.id, editingDate);
                                } else if (e.key === "Escape") {
                                  setEditingEntryId(null);
                                }
                              }}
                              autoFocus
                              className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingEntryId(entry.id);
                                setEditingDate(toInputDate(entry.entryDate));
                              }}
                              className="hover:text-[#2563EB] hover:underline transition-colors"
                            >
                              {formatDateJST(entry.entryDate)}
                            </button>
                          )}
                        </span>
                        <span className="text-xs text-gray-400">
                          (紹介日: {formatDateJST(entry.introducedAt)})
                        </span>
                        <button
                          onClick={() => handleDeleteEntry(entry.id)}
                          disabled={deletingId === entry.id}
                          className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                          title="削除"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* エントリー日選択モーダル */}
      {showEntryModal && (
        <EntryDateModal
          count={selectedJobIds.size}
          onConfirm={handleEntrySubmit}
          onCancel={() => setShowEntryModal(false)}
        />
      )}
    </div>
  );
}
