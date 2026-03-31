"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import FileUploadModal from "./FileUploadModal";

type CandidateFile = {
  id: string;
  category: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  driveFileId: string;
  driveViewUrl: string;
  memo: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
};

type TemplateFile = {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
};

const SUB_TABS = [
  { key: "ORIGINAL", label: "原本" },
  { key: "BS_DOCUMENT", label: "BS作成書類" },
  { key: "APPLICATION", label: "応募企業" },
  { key: "INTERVIEW_PREP", label: "面接対策" },
  { key: "MEETING", label: "面談" },
];

const DESCRIPTIONS: Record<string, string> = {
  ORIGINAL: "当社作成の履歴書・職務経歴書・推薦書",
  BS_DOCUMENT: "当社作成の履歴書・職務経歴書・推薦書",
  APPLICATION: "応募先企業の関連資料",
  INTERVIEW_PREP: "面接対策で使用したファイル",
  MEETING: "面談ログ、マイナビからのDL資料",
};

function getFileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "📊";
  if (mimeType === "text/plain") return "📝";
  return "📎";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function DocumentsTab({ candidateId }: { candidateId: string }) {
  const [activeSubTab, setActiveSubTab] = useState("ORIGINAL");
  const [files, setFiles] = useState<CandidateFile[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<{ url: string; files: string[]; expiresAt: string } | null>(null);
  const [sharing, setSharing] = useState(false);

  // D&D for meeting sub-tab file area
  const [isAreaDragging, setIsAreaDragging] = useState(false);
  const [areaUploading, setAreaUploading] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<TemplateFile[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState(false);
  const [downloadingTemplateId, setDownloadingTemplateId] = useState<string | null>(null);

  const fetchFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=${activeSubTab}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch {
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [candidateId, activeSubTab]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/counts`);
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts || {});
      }
    } catch { /* */ }
  }, [candidateId]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(false);
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.files || []);
      } else {
        setTemplatesError(true);
      }
    } catch {
      setTemplatesError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleDelete = async (fileId: string) => {
    if (!confirm("このファイルを削除します。よろしいですか？")) return;
    setDeletingId(fileId);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/${fileId}`, { method: "DELETE" });
      if (res.ok) {
        fetchFiles();
        fetchCounts();
      }
    } catch { /* */ }
    finally { setDeletingId(null); }
  };

  const handleUploadSuccess = () => {
    fetchFiles();
    fetchCounts();
  };

  const ALLOWED_TYPES_SET = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ]);

  const candidateIntakeUrl = process.env.NEXT_PUBLIC_CANDIDATE_INTAKE_URL
    || "https://candidate-intake-production.up.railway.app";

  const handleOpenIntake = () => {
    const driveFileIds = files.map((f) => f.driveFileId).filter(Boolean);
    let url = `${candidateIntakeUrl}/register?candidateId=${candidateId}`;
    if (driveFileIds.length > 0) {
      url += `&files=${driveFileIds.join(",")}`;
    }
    window.open(url, "_blank");
  };

  const handleAreaDrop = async (fileList: FileList) => {
    const valid = Array.from(fileList).filter(
      (f) => (ALLOWED_TYPES_SET.has(f.type) || f.name.endsWith(".txt")) && f.size <= 20 * 1024 * 1024
    );
    if (valid.length === 0) {
      toast.error("対応していないファイル形式です");
      return;
    }
    setAreaUploading(true);
    try {
      for (const file of valid) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", "MEETING");
        await fetch(`/api/candidates/${candidateId}/files/upload`, {
          method: "POST",
          body: formData,
        });
      }
      toast.success(`${valid.length}件のファイルをアップロードしました`);
      fetchFiles();
      fetchCounts();
    } catch {
      toast.error("アップロードに失敗しました");
    } finally {
      setAreaUploading(false);
    }
  };

  const handleShareUrl = async (fileIds: string[]) => {
    setSharing(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/share-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "URL発行に失敗しました");
        return;
      }
      setShareResult({ url: data.url, files: data.files, expiresAt: data.expiresAt });
    } catch {
      toast.error("URL発行に失敗しました");
    } finally {
      setSharing(false);
    }
  };

  const handleTemplateDownload = async (template: TemplateFile) => {
    setDownloadingTemplateId(template.id);
    try {
      const res = await fetch(`/api/templates/${template.id}/download`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = template.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch { /* */ }
    finally { setDownloadingTemplateId(null); }
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  return (
    <div>
      {/* サブタブバー */}
      <div className="bg-gray-50 rounded-lg p-1 inline-flex gap-1 mb-6 flex-wrap">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
              activeSubTab === tab.key
                ? "bg-white text-[#2563EB] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {(counts[tab.key] || 0) > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">({counts[tab.key]})</span>
            )}
          </button>
        ))}
      </div>

      {/* テンプレートセクション（原本タブのみ） */}
      {activeSubTab === "ORIGINAL" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
          <h3 className="text-[14px] font-semibold text-[#374151] mb-1">
            📁 テンプレート（共通）
          </h3>
          <p className="text-sm text-gray-500 mb-4">すべての求職者で共通のテンプレートファイルです</p>

          {templatesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : templatesError ? (
            <p className="text-[13px] text-red-500 py-4 text-center">テンプレートの読み込みに失敗しました</p>
          ) : templates.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-4 text-center">テンプレートファイルはありません</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                  <span className="text-lg">{getFileIcon(t.mimeType)}</span>
                  <span className="flex-1 text-sm font-medium text-gray-800 truncate">{t.name}</span>
                  <button
                    onClick={() => handleTemplateDownload(t)}
                    disabled={downloadingTemplateId === t.id}
                    className="text-gray-500 hover:text-gray-700 text-sm font-medium disabled:opacity-50"
                  >
                    {downloadingTemplateId === t.id ? "DL中..." : "⬇ DL"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* カテゴリヘッダー */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            📁 {activeSubTab === "ORIGINAL" ? "原本（この求職者のファイル）" : SUB_TABS.find((t) => t.key === activeSubTab)?.label}
          </h3>
          <div className="flex items-center gap-2">
            {activeSubTab === "BS_DOCUMENT" && files.length > 0 && (
              <button
                onClick={() => handleShareUrl(files.map((f) => f.id))}
                disabled={sharing}
                className="border border-blue-200 bg-blue-50 text-[#2563EB] rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {sharing ? "発行中..." : "🔗 一括URL発行"}
              </button>
            )}
            {activeSubTab === "MEETING" && (
              <button
                onClick={handleOpenIntake}
                className="border border-green-200 bg-green-50 text-green-700 rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-green-100 transition-colors"
              >
                📝 面談登録
              </button>
            )}
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
            >
              + アップロード
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4">{DESCRIPTIONS[activeSubTab]}</p>

        {/* D&D hint for MEETING */}
        {activeSubTab === "MEETING" && isAreaDragging && (
          <div className="mb-3 border-2 border-dashed border-[#2563EB] bg-blue-50 rounded-lg p-6 text-center">
            <p className="text-[#2563EB] font-medium text-sm">ここにファイルをドロップしてアップロード</p>
          </div>
        )}
        {activeSubTab === "MEETING" && areaUploading && (
          <div className="mb-3 text-center text-sm text-gray-500 animate-pulse">アップロード中...</div>
        )}

        {/* ファイル一覧 */}
        <div
          onDragOver={activeSubTab === "MEETING" ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
          onDragEnter={activeSubTab === "MEETING" ? (e) => { e.preventDefault(); e.stopPropagation(); setIsAreaDragging(true); } : undefined}
          onDragLeave={activeSubTab === "MEETING" ? (e) => { e.preventDefault(); e.stopPropagation(); if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsAreaDragging(false); } : undefined}
          onDrop={activeSubTab === "MEETING" ? (e) => { e.preventDefault(); e.stopPropagation(); setIsAreaDragging(false); if (e.dataTransfer.files?.length) handleAreaDrop(e.dataTransfer.files); } : undefined}
        >
        {isLoading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-gray-400">
            {activeSubTab === "MEETING" ? "ファイルをドラッグ＆ドロップ、または「+アップロード」「📝 面談登録」ボタンをクリック" : "ファイルはまだありません"}
          </div>
        ) : (
          <div className="space-y-3">
            {files.map((file) => (
              <div key={file.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
                {/* ファイル名 */}
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getFileIcon(file.mimeType)}</span>
                  <span className="font-medium text-gray-800 text-sm truncate">{file.fileName}</span>
                </div>
                {/* 情報 */}
                <p className="text-xs text-gray-500 mt-1">
                  {formatFileSize(file.fileSize)} ・ {file.uploadedBy.name} ・ {formatDate(file.createdAt)}
                </p>
                {/* メモ */}
                {file.memo && (
                  <p className="text-xs text-gray-500 mt-1 italic">メモ: {file.memo}</p>
                )}
                {/* アクション */}
                <div className="flex items-center mt-3 pt-3 border-t border-gray-100">
                  <div className="ml-auto flex gap-2">
                    {activeSubTab === "BS_DOCUMENT" && (
                      <button
                        onClick={() => handleShareUrl([file.id])}
                        disabled={sharing}
                        className="text-[#2563EB] hover:text-[#1D4ED8] text-sm font-medium disabled:opacity-50"
                      >
                        🔗 URL発行
                      </button>
                    )}
                    <button
                      onClick={() => window.open(getPreviewUrl(file.driveViewUrl), "_blank")}
                      className="text-[#2563EB] hover:text-[#1D4ED8] text-sm font-medium"
                    >
                      👁 プレビュー
                    </button>
                    <a
                      href={`https://drive.google.com/uc?export=download&id=${file.driveFileId}`}
                      download
                      className="text-gray-500 hover:text-gray-700 text-sm font-medium"
                    >
                      ⬇ DL
                    </a>
                    <button
                      onClick={() => handleDelete(file.id)}
                      disabled={deletingId === file.id}
                      className="text-red-400 hover:text-red-600 text-sm font-medium disabled:opacity-50"
                    >
                      🗑 削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* アップロードモーダル */}
      {showUploadModal && (
        <FileUploadModal
          candidateId={candidateId}
          defaultCategory={activeSubTab}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {/* 共有URL発行結果モーダル */}
      {shareResult && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShareResult(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-bold text-[#374151]">🔗 共有URL発行完了</h2>
              <button onClick={() => setShareResult(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[13px] font-medium text-gray-600 mb-1">URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareResult.url}
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-50"
                  />
                  <button
                    onClick={() => { navigator.clipboard.writeText(shareResult.url); toast.success("URLをコピーしました"); }}
                    className="text-[#2563EB] hover:text-[#1D4ED8] text-sm font-medium whitespace-nowrap"
                  >
                    📋 コピー
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[13px] text-gray-600">パスワード: <span className="font-medium">生年月日8桁（YYYYMMDD）</span></p>
              </div>
              <div>
                <p className="text-[13px] text-gray-600">有効期限: <span className="font-medium">{new Date(shareResult.expiresAt).toLocaleDateString("ja-JP")}</span></p>
              </div>
              <div>
                <p className="text-[13px] text-gray-600 mb-1">対象ファイル:</p>
                <ul className="text-[13px] text-gray-700">
                  {shareResult.files.map((f, i) => <li key={i}>・{f}</li>)}
                </ul>
              </div>
            </div>
            <button onClick={() => setShareResult(null)} className="w-full mt-4 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50">閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}
