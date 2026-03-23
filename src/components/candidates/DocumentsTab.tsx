"use client";

import { useState, useEffect, useCallback } from "react";
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

const SUB_TABS = [
  { key: "ORIGINAL", label: "原本" },
  { key: "JOB_POSTING", label: "求人" },
  { key: "BS_DOCUMENT", label: "BS作成書類" },
  { key: "APPLICATION", label: "応募企業" },
  { key: "INTERVIEW_PREP", label: "面接対策" },
  { key: "MEETING", label: "面談" },
];

const DESCRIPTIONS: Record<string, string> = {
  ORIGINAL: "履歴書フォーマット、本人提出の原本書類、顔写真",
  JOB_POSTING: "紹介した求人のPDFデータ",
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

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

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

      {/* カテゴリヘッダー */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            📁 {SUB_TABS.find((t) => t.key === activeSubTab)?.label}
          </h3>
          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            + アップロード
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{DESCRIPTIONS[activeSubTab]}</p>

        {/* ファイル一覧 */}
        {isLoading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-gray-400">ファイルはまだありません</div>
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

      {/* アップロードモーダル */}
      {showUploadModal && (
        <FileUploadModal
          candidateId={candidateId}
          defaultCategory={activeSubTab}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
