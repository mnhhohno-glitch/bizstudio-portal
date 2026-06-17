"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { AREA_GROUPS, OTHER_PREFECTURES } from "@/lib/constants/target-areas";
import { stripFileMetadata, stripCorpSuffixes } from "@/lib/normalize-filename";

/* ---------- Types ---------- */
type Job = {
  id: number;
  job_id: string | null;
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
  candidate_response: string | null;
  candidate_responded_at: string | null;
};

const RESPONSE_BADGE: Record<string, { label: string; cls: string }> = {
  WANT_TO_APPLY: { label: "応募したい", cls: "bg-red-100 text-red-700" },
  INTERESTED: { label: "気になる", cls: "bg-yellow-100 text-yellow-700" },
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

/* ---------- Delete Confirm Modal ---------- */
function DeleteConfirmModal({
  count,
  skippedCount,
  onConfirm,
  onCancel,
  deleting,
}: {
  count: number;
  skippedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
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
            紹介リストから削除
          </h2>
          <button
            onClick={onCancel}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-2">
          選択した{count}件の求人を紹介リストから削除しますか？
        </p>

        {skippedCount > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2 mb-4">
            ※エントリー済みの{skippedCount}件は削除されません
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="bg-red-500 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? "削除中..." : "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                      */
/* ================================================================== */
/* ---------- Sort Icon ---------- */
function SortIcon({ field, current, dir }: { field: string; current: string | null; dir: "asc" | "desc" }) {
  const active = current === field;
  return (
    <span className="inline-flex flex-col text-[8px] leading-[9px] ml-0.5">
      <span className={active && dir === "asc" ? "text-[#2563EB]" : "text-gray-300"}>▲</span>
      <span className={active && dir === "desc" ? "text-[#2563EB]" : "text-gray-300"}>▼</span>
    </span>
  );
}

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
  lastExportedAt: string | null;
  lastExportedTo: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  archivedAt?: string | null;
  archivedReason?: string | null;
  archivedNote?: string | null;
  archivedBy?: { id: string; name: string } | null;
};

const ARCHIVE_REASONS = [
  "重複",
  "希望条件不一致",
  "応募条件不足",
  "求職者意向",
  "選考終了",
  "その他",
] as const;

/* ---------- Archive Modal ---------- */
function ArchiveModal({
  count,
  fileName,
  onConfirm,
  onCancel,
  busy,
}: {
  count: number;
  fileName?: string;
  onConfirm: (reason: string | null, note: string | null) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState<string>("");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-bold text-[#374151]">紹介保留に移動</h2>
          <button onClick={onCancel} disabled={busy} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none disabled:opacity-50">×</button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {fileName ? <><span className="font-medium">{fileName}</span> を紹介保留に移動します。</> : `${count}件のブックマークを紹介保留に移動します。`}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">削除理由（任意）</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
              disabled={busy}
            >
              <option value="">（選択しない）</option>
              {ARCHIVE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">メモ（任意）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="補足があれば入力..."
              disabled={busy}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB] resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 pt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
          <button
            onClick={() => onConfirm(reason || null, note.trim() || null)}
            disabled={busy}
            className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {busy ? "処理中..." : "保留に移動"}
          </button>
        </div>
      </div>
    </div>
  );
}

const RATING_STYLES: Record<string, string> = {
  A: "bg-green-100 text-green-800 border-green-300",
  B: "bg-blue-100 text-blue-800 border-blue-300",
  C: "bg-yellow-100 text-yellow-800 border-yellow-300",
  D: "bg-red-100 text-red-800 border-red-300",
};
const RATING_LABELS: Record<string, string> = {
  A: "A 非常に良い", B: "B 良い", C: "C 要検討", D: "D 合わない",
};

function parse3AxisRatings(comment: string | null): { wish: string; pass: string; overall: string } | null {
  if (!comment) return null;
  const w = comment.match(/■\s*本人希望[：:]\s*([ABCD])/);
  const p = comment.match(/■\s*通過率[：:]\s*([ABCD])/);
  const o = comment.match(/■\s*総合[：:]\s*([ABCD])/);
  if (!w && !p && !o) return null;
  return { wish: w?.[1] || "—", pass: p?.[1] || "—", overall: o?.[1] || "—" };
}

/* ---------- Bookmark sort helpers (pure functions) ---------- */
// A=最良 … D=最低。空欄/null/「—」は方向に関わらず常に末尾に寄せるため Infinity 扱い。
const RANK_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
function rankValue(r: string | null | undefined): number {
  if (!r) return Number.POSITIVE_INFINITY;
  const v = RANK_ORDER[r];
  return v === undefined ? Number.POSITIVE_INFINITY : v;
}
// 1ランクキーの比較。null/空欄は dir に関わらず常に末尾。
function compareRank(a: string | null | undefined, b: string | null | undefined, dir: 1 | -1): number {
  const va = rankValue(a);
  const vb = rankValue(b);
  const aMissing = va === Number.POSITIVE_INFINITY;
  const bMissing = vb === Number.POSITIVE_INFINITY;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // a を末尾へ
  if (bMissing) return -1; // b を末尾へ
  return (va - vb) * dir;
}

type RankKey = "wish" | "pass" | "overall";
// クリックした主キー + 固定優先順「総合 → 希望 → 通過」の副キー。
function rankKeyOrder(primary: RankKey): RankKey[] {
  if (primary === "overall") return ["overall", "wish", "pass"];
  if (primary === "wish") return ["wish", "overall", "pass"];
  return ["pass", "overall", "wish"]; // 通過
}
// 希望/通過/総合 の AND（複数キー）比較関数を生成。
// 主キーのみ dir を適用し、副キーは常に良い順（A優先）固定。最終 tie-break は会社名昇順。
function makeRankComparator(
  primary: RankKey,
  dir: 1 | -1,
): (a: BookmarkFile, b: BookmarkFile) => number {
  const keys = rankKeyOrder(primary);
  return (a, b) => {
    const axisA = parse3AxisRatings(a.aiAnalysisComment);
    const axisB = parse3AxisRatings(b.aiAnalysisComment);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const cmp = compareRank(axisA?.[k] ?? null, axisB?.[k] ?? null, i === 0 ? dir : 1);
      if (cmp !== 0) return cmp;
    }
    return a.fileName.localeCompare(b.fileName);
  };
}

type CompanyMode = "name" | "wantFirst" | "interestFirst";
// 応募したい/気になる ステータスを mode に応じた優先順位の数値へ。その他(null)は常に末尾(2)。
function responseRank(resp: string | null, mode: CompanyMode): number {
  if (mode === "wantFirst") {
    if (resp === "WANT_TO_APPLY") return 0;
    if (resp === "INTERESTED") return 1;
    return 2;
  }
  // interestFirst
  if (resp === "INTERESTED") return 0;
  if (resp === "WANT_TO_APPLY") return 1;
  return 2;
}
// 会社名列 3状態サイクルの比較関数を生成。同順位は会社名昇順。
// getResponse は罠#6 の解決済みステータス（fileName ↔ company_name 正規化マッチ）を再利用する。
function makeCompanyComparator(
  mode: CompanyMode,
  getResponse: (f: BookmarkFile) => string | null,
): (a: BookmarkFile, b: BookmarkFile) => number {
  return (a, b) => {
    if (mode !== "name") {
      const ra = responseRank(getResponse(a), mode);
      const rb = responseRank(getResponse(b), mode);
      if (ra !== rb) return ra - rb;
    }
    return a.fileName.localeCompare(b.fileName);
  };
}

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

function BookmarkSection({ candidateId, jobResponseMap, onCountChange, onSwitchToJobs, onArchivedChange }: { candidateId: string; jobResponseMap: Map<string, string>; onCountChange?: (count: number) => void; onSwitchToJobs?: () => void; onArchivedChange?: () => void }) {
  const [files, setFiles] = useState<BookmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiving, setBulkArchiving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ kind: "single"; file: BookmarkFile } | { kind: "bulk"; ids: string[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [sortField, setSortField] = useState<"company" | "rating" | "wish" | "pass" | "overall" | "uploader" | "date" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // 要件①：会社名列の 3状態サイクル（名前順 → 応募したい順 → 気になる順）。sortField === "company" のときのみ有効。
  const [companyMode, setCompanyMode] = useState<CompanyMode>("name");
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendDbType, setSendDbType] = useState("hito_mynavi");
  const [sendAreas, setSendAreas] = useState<Set<string>>(new Set());
  const [otherSearch, setOtherSearch] = useState("");
  const [showOtherDropdown, setShowOtherDropdown] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; projectUrl?: string; message?: string } | null>(null);
  const [sendStep, setSendStep] = useState(0);
  const [selectedAnalysis, setSelectedAnalysis] = useState<{ fileId: string; fileName: string; rating: string; comment: string } | null>(null);
  const [editingComment, setEditingComment] = useState(false);
  const [editedCommentText, setEditedCommentText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [wishRating, setWishRating] = useState<string>("");
  const [passRating, setPassRating] = useState<string>("");
  const [overallRating, setOverallRating] = useState<string>("");
  const [previewFile, setPreviewFile] = useState<BookmarkFile | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractTriggered = useRef(false);

  const findJobResponse = useCallback((fileName: string): string | null => {
    const key = normalize(stripCorpSuffixes(stripFileMetadata(fileName)));
    if (!key) return null;
    for (const [cn, response] of jobResponseMap) {
      if (key.includes(cn) || cn.includes(key)) return response;
    }
    return null;
  }, [jobResponseMap]);

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

  // Initialize 3-axis rating state when analysis modal opens for a new file
  useEffect(() => {
    if (!selectedAnalysis) return;
    const axis = parse3AxisRatings(selectedAnalysis.comment);
    setWishRating(axis?.wish && axis.wish !== "—" ? axis.wish : "");
    setPassRating(axis?.pass && axis.pass !== "—" ? axis.pass : "");
    setOverallRating(axis?.overall && axis.overall !== "—" ? axis.overall : selectedAnalysis.rating || "");
  }, [selectedAnalysis?.fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRatingMarker = (axis: "wish" | "pass" | "overall", newValue: string) => {
    const label = axis === "wish" ? "本人希望" : axis === "pass" ? "通過率" : "総合";
    const setRating = axis === "wish" ? setWishRating : axis === "pass" ? setPassRating : setOverallRating;
    const baseText = editingComment ? editedCommentText : (selectedAnalysis?.comment || "");
    setRating(newValue);

    const markerLineRe = new RegExp(`^[ \\t]*■\\s*${label}[：:]\\s*[ABCD]?\\s*$`, "m");
    let newText: string;
    if (newValue === "") {
      newText = markerLineRe.test(baseText)
        ? baseText.replace(new RegExp(`^[ \\t]*■\\s*${label}[：:]\\s*[ABCD]?\\s*\\n?`, "m"), "")
        : baseText;
    } else if (markerLineRe.test(baseText)) {
      newText = baseText.replace(markerLineRe, `■ ${label}: ${newValue}`);
    } else {
      const otherMarkerRe = /^[ \t]*■\s*(?:本人希望|通過率|総合)[：:]\s*[ABCD]?\s*$/m;
      const m = baseText.match(otherMarkerRe);
      if (m && m.index !== undefined) {
        const insertPos = m.index + m[0].length;
        newText = baseText.slice(0, insertPos) + `\n■ ${label}: ${newValue}` + baseText.slice(insertPos);
      } else {
        newText = `■ ${label}: ${newValue}\n${baseText}`;
      }
    }
    setEditedCommentText(newText);
    setEditingComment(true);
  };

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

  const handleArchiveConfirm = async (reason: string | null, note: string | null) => {
    if (!archiveTarget) return;
    if (archiveTarget.kind === "single") {
      const fileId = archiveTarget.file.id;
      setArchivingId(fileId);
      try {
        const res = await fetch(`/api/candidates/${candidateId}/files/${fileId}/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, note }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "保留化に失敗しました");
        }
        toast.success("紹介保留に移動しました");
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(fileId); return n; });
        setArchiveTarget(null);
        fetchFiles();
        onArchivedChange?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "保留化に失敗しました");
      } finally {
        setArchivingId(null);
      }
    } else {
      const ids = archiveTarget.ids;
      setBulkArchiving(true);
      try {
        const results = await Promise.allSettled(
          ids.map((fileId) =>
            fetch(`/api/candidates/${candidateId}/files/${fileId}/archive`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason, note }),
            }).then(async (res) => {
              if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || `failed: ${fileId}`);
              }
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast.error(`${failed}件の保留化に失敗しました`);
        } else {
          toast.success(`${ids.length}件を紹介保留に移動しました`);
        }
        setSelectedIds(new Set());
        setArchiveTarget(null);
        fetchFiles();
        onArchivedChange?.();
      } finally {
        setBulkArchiving(false);
      }
    }
  };

  const handleArchive = (file: BookmarkFile) => {
    setArchiveTarget({ kind: "single", file });
  };

  const handleBulkArchive = () => {
    if (selectedIds.size === 0) return;
    setArchiveTarget({ kind: "bulk", ids: Array.from(selectedIds) });
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
      toast.error("一括ダウンロードに失敗しました。ファイル数が多い場合は個別にDLしてください。");
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

  // Filtered + sorted files
  // 担当・紹介日列：従来どおりの単独ソート（asc → desc → 解除）。
  const handleSort = (field: "rating" | "uploader" | "date") => {
    if (sortField === field) {
      if (sortDir === "asc") { setSortDir("desc"); }
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "desc" : "asc");
    }
  };

  // 要件②：希望/通過/総合クリックで AND ソート。主キーのみ asc/desc トグル（解除なし）、副キーは固定。
  const handleRankSort = (field: RankKey) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc"); // 良い順 A→D
    }
  };

  const ratingOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

  const filteredFiles = (() => {
    let result = files.filter((f) => {
      if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterDate) {
        const fileDate = new Date(f.createdAt).toISOString().slice(0, 10);
        if (fileDate !== filterDate) return false;
      }
      return true;
    });
    if (sortField === "company") {
      // 要件①：会社名 3状態サイクル（罠#6 の解決済みステータス findJobResponse を再利用）
      result = [...result].sort(makeCompanyComparator(companyMode, (f) => findJobResponse(f.fileName)));
    } else if (sortField === "wish" || sortField === "pass" || sortField === "overall") {
      // 要件②：希望/通過/総合 AND（複数キー）ソート
      result = [...result].sort(makeRankComparator(sortField, sortDir === "asc" ? 1 : -1));
    } else if (sortField) {
      const dir = sortDir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        if (sortField === "rating") {
          const ra = a.aiMatchRating ? (ratingOrder[a.aiMatchRating] ?? 4) : 4;
          const rb = b.aiMatchRating ? (ratingOrder[b.aiMatchRating] ?? 4) : 4;
          return (ra - rb) * dir;
        }
        if (sortField === "uploader") return a.uploadedBy.name.localeCompare(b.uploadedBy.name) * dir;
        if (sortField === "date") return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        return 0;
      });
    }
    return result;
  })();

  const toggleAll = () => {
    const ids = filteredFiles.map((f) => f.id);
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));

  // 未出力（出力済バッジ＝lastExportedAt が付いていない）行のみを対象にトグルする。
  // 出力済の表示条件（file.lastExportedAt）と必ず同一ロジックの逆を使う。
  const unexportedFiles = filteredFiles.filter((f) => !f.lastExportedAt);
  const unexportedAllChecked = unexportedFiles.length > 0 && unexportedFiles.every((f) => selectedIds.has(f.id));
  const toggleUnexported = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (unexportedAllChecked) {
        // すべて選択済み → 未出力分のみ除外（出力済の選択状態は触らない）
        unexportedFiles.forEach((f) => next.delete(f.id));
      } else {
        // 未出力分を追加（出力済の選択状態は触らない）
        unexportedFiles.forEach((f) => next.add(f.id));
      }
      return next;
    });
  };

  const shortDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  const handleSendToJobTool = async () => {
    const areas = [...sendAreas];
    if (areas.length === 0) return;
    setSending(true);
    setSendResult(null);
    setSendStep(1);

    try {
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
      fetchFiles();
    }
  };

  const [movingToJobs, setMovingToJobs] = useState(false);
  const handleMoveToJobs = async () => {
    if (selectedIds.size === 0) return;
    setMovingToJobs(true);
    try {
      const selected = files.filter((f) => selectedIds.has(f.id));
      const exportedIds = selected.filter((f) => f.lastExportedAt).map((f) => f.id);
      const notExportedIds = selected.filter((f) => !f.lastExportedAt).map((f) => f.id);

      let restoredCount = 0;
      let sentCount = 0;
      const messages: string[] = [];

      if (exportedIds.length > 0) {
        const res = await fetch(`/api/candidates/${candidateId}/bookmarks/restore-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: exportedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "復活処理に失敗しました");
        restoredCount = data.restored ?? 0;
        if (data.notMatched?.length) messages.push(`照合失敗: ${data.notMatched.length}件`);
        if (data.notExcluded?.length) messages.push(`既に有効: ${data.notExcluded.length}件`);
      }

      if (notExportedIds.length > 0) {
        const res = await fetch(`/api/candidates/${candidateId}/bookmarks/send-to-job-tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: notExportedIds, dbType: "hito_mynavi", targetAreas: ["首都圏"] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "送信に失敗しました");
        sentCount = data.uploadedCount ?? notExportedIds.length;
      }

      const parts: string[] = [];
      if (restoredCount > 0) parts.push(`${restoredCount}件を復活`);
      if (sentCount > 0) parts.push(`${sentCount}件を新規送信`);
      if (messages.length) parts.push(messages.join(" / "));
      toast.success(parts.length ? parts.join("、") + "しました" : "処理が完了しました");

      setSelectedIds(new Set());
      onSwitchToJobs?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setMovingToJobs(false);
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
            <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={unexportedAllChecked}
                onChange={toggleUnexported}
                className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
              />
              未出力を選択
            </label>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={handleBulkArchive}
                  disabled={bulkArchiving}
                  className="text-[12px] text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50"
                >
                  📦 紹介保留に移動（{selectedIds.size}件）
                </button>
                <button
                  onClick={handleBulkDownload}
                  disabled={bulkDownloading}
                  className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
                >
                  {bulkDownloading ? "⬇ ダウンロード中..." : `⬇ 一括DL（${selectedIds.size}件）`}
                </button>
                <button
                  onClick={() => { setSendResult(null); setSendStep(0); setSendDbType("hito_mynavi"); setSendAreas(new Set()); setOtherSearch(""); setShowOtherDropdown(false); setShowSendModal(true); }}
                  className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] font-medium"
                >
                  📤 求人出力へ送信（{selectedIds.size}件）
                </button>
                <button
                  onClick={handleMoveToJobs}
                  disabled={movingToJobs}
                  className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] font-medium disabled:opacity-50"
                >
                  {movingToJobs ? "📋 送信中..." : `📋 求人紹介へ移動（${selectedIds.size}件）`}
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

        {/* Sort segment buttons (会社名軸 3択) */}
        {files.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[12px] text-gray-500 shrink-0">並び替え：</span>
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              {([
                { mode: "name", label: "名前順" },
                { mode: "wantFirst", label: "応募したい順" },
                { mode: "interestFirst", label: "気になる順" },
              ] as { mode: CompanyMode; label: string }[]).map((opt, i) => {
                const active = sortField === "company" && companyMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    onClick={() => { setSortField("company"); setCompanyMode(opt.mode); }}
                    className={`px-3 py-1 text-[12px] font-medium transition-colors ${i > 0 ? "border-l border-gray-300" : ""} ${
                      active
                        ? "bg-[#2563EB] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
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

      {/* Table header */}
      {files.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[11px] font-medium text-gray-500 select-none">
          <span className="w-4 shrink-0" />
          <span className="flex-1 min-w-0">会社名</span>
          <span onClick={() => handleRankSort("wish")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "wish" ? "text-[#2563EB]" : ""}`}>
            希望<SortIcon field="wish" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleRankSort("pass")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "pass" ? "text-[#2563EB]" : ""}`}>
            通過<SortIcon field="pass" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleRankSort("overall")}
            className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "overall" ? "text-[#2563EB]" : ""}`}>
            総合<SortIcon field="overall" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("uploader")}
            className={`w-[72px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "uploader" ? "text-[#2563EB]" : ""}`}
          >
            担当
            <SortIcon field="uploader" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("date")}
            className={`w-[52px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 whitespace-nowrap ${sortField === "date" ? "text-[#2563EB]" : ""}`}
          >
            紹介日
            <SortIcon field="date" current={sortField} dir={sortDir} />
          </span>
          <span className="w-[70px] shrink-0" />
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
                  className="w-4 h-3.5 shrink-0 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                />
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span className="shrink-0 text-sm">{getFileIcon(file.mimeType)}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                    className="text-[13px] font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                    title={file.fileName}
                  >{file.fileName}</button>
                  {file.extractedAt && <span className="shrink-0 text-[10px] text-green-500" title="テキスト化済">✅</span>}
                  {(() => {
                    const resp = findJobResponse(file.fileName);
                    return resp && RESPONSE_BADGE[resp] ? (
                      <span className={`shrink-0 text-[10px] rounded px-1.5 py-0 font-medium ${RESPONSE_BADGE[resp].cls}`}>
                        {RESPONSE_BADGE[resp].label}
                      </span>
                    ) : null;
                  })()}
                  {file.lastExportedAt && (
                    <span
                      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-100 text-green-800 border border-green-200"
                      title={`${file.lastExportedTo === "circus" ? "Circus" : "HITO-Link"} に送信済（${new Date(file.lastExportedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）`}
                    >出力済</span>
                  )}
                </div>
                {(() => {
                  const axis = parse3AxisRatings(file.aiAnalysisComment);
                  const badge = (v: string | undefined) => {
                    if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                    const s = RATING_STYLES[v];
                    return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
                  };
                  const openAnalysis = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (file.aiAnalysisComment) setSelectedAnalysis({ fileId: file.id, fileName: file.fileName, rating: file.aiMatchRating || "", comment: file.aiAnalysisComment });
                  };
                  return (
                    <>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={openAnalysis}>{badge(axis?.wish)}</span>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={openAnalysis}>{badge(axis?.pass)}</span>
                      <span className="w-[56px] shrink-0 text-center cursor-pointer hover:opacity-80" onClick={openAnalysis}>{badge(axis?.overall || file.aiMatchRating || undefined)}</span>
                    </>
                  );
                })()}
                <span className="w-[72px] shrink-0 text-[11px] text-gray-500 truncate">{file.uploadedBy.name}</span>
                <span className="w-[52px] shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{shortDate(file.createdAt)}</span>
                <span className="w-[70px] shrink-0 flex items-center gap-0.5 justify-end">
                  <a
                    href={`https://drive.google.com/uc?export=download&id=${file.driveFileId}`}
                    download
                    className="text-gray-400 hover:text-gray-700 text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors"
                    title="ダウンロード"
                  >
                    ⬇
                  </a>
                  <button
                    onClick={() => handleArchive(file)}
                    disabled={archivingId === file.id}
                    className="text-gray-400 hover:text-amber-600 text-[16px] p-1.5 rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
                    title="紹介保留に移動"
                  >
                    📦
                  </button>
                </span>
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
                      <input type="radio" name="dbType" value="hito_mynavi" checked={sendDbType === "hito_mynavi"} onChange={() => setSendDbType("hito_mynavi")} className="accent-[#2563EB]" />
                      HITO-Link / マイナビ / Bee（自動処理）
                    </label>
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input type="radio" name="dbType" value="circus" checked={sendDbType === "circus"} onChange={() => setSendDbType("circus")} className="accent-[#2563EB]" />
                      Circus（手動処理）
                    </label>
                  </div>
                </div>
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
                  <button onClick={handleSendToJobTool} disabled={sendAreas.size === 0} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">送信開始</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PDF Preview popup */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreviewFile(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b bg-gray-50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(previewFile.id)}
                  onChange={() => toggleSelect(previewFile.id)}
                  className="w-4 h-4 rounded border-gray-300 text-[#2563EB] shrink-0"
                />
                <span className="text-[13px] font-medium truncate">{previewFile.fileName}</span>
                {previewFile.aiMatchRating && RATING_STYLES[previewFile.aiMatchRating] && (
                  <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-semibold border shrink-0 ${RATING_STYLES[previewFile.aiMatchRating]}`}>
                    {previewFile.aiMatchRating}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={getPreviewUrl(previewFile.driveViewUrl)} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] text-blue-600 hover:underline">新しいタブで開く</a>
                <button onClick={() => setPreviewFile(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe
                src={getPreviewUrl(previewFile.driveViewUrl)}
                className="w-full h-full border-0"
                title={previewFile.fileName}
              />
            </div>
          </div>
        </div>
      )}

      {/* Analysis comment modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => { if (!editingComment) setSelectedAnalysis(null); }}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b bg-gray-50 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selectedAnalysis.rating && RATING_STYLES[selectedAnalysis.rating] && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${RATING_STYLES[selectedAnalysis.rating]}`}>
                    {RATING_LABELS[selectedAnalysis.rating]}
                  </span>
                )}
                <h3 className="font-semibold text-sm truncate">{selectedAnalysis.fileName}</h3>
              </div>
              <button onClick={() => { setSelectedAnalysis(null); setEditingComment(false); }} className="text-gray-400 hover:text-gray-600 text-xl shrink-0 ml-2">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="font-mono text-sm mb-3 space-y-1">
                {(["wish", "pass", "overall"] as const).map((axis) => {
                  const label = axis === "wish" ? "本人希望：" : axis === "pass" ? "通過率　：" : "総合　　：";
                  const value = axis === "wish" ? wishRating : axis === "pass" ? passRating : overallRating;
                  const styleCls = value && RATING_STYLES[value]
                    ? RATING_STYLES[value]
                    : "bg-white text-gray-500 border-gray-300";
                  return (
                    <div key={axis} className="flex items-center">
                      <span className="whitespace-pre">{label}</span>
                      <select
                        value={value}
                        onChange={(e) => updateRatingMarker(axis, e.target.value)}
                        className={`ml-1 rounded border px-2 py-0.5 text-xs font-bold cursor-pointer ${styleCls}`}
                      >
                        <option value="">—</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              {editingComment ? (
                <textarea
                  value={editedCommentText}
                  onChange={(e) => setEditedCommentText(e.target.value)}
                  rows={16}
                  className="w-full text-sm text-gray-700 border border-gray-300 rounded p-3 focus:border-[#2563EB] focus:outline-none resize-none font-mono"
                />
              ) : (
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {selectedAnalysis.comment
                    .replace(/\*\*/g, "")
                    .replace(/^###?\s+/gm, "")
                    .replace(/^-{3,}\s*$/gm, "")
                    .split("\n")
                    .filter((line) => !/^\s*■\s*(本人希望|通過率|総合)[：:]/.test(line))
                    .join("\n")
                    .replace(/\n{3,}/g, "\n\n")
                    .trim()}
                </div>
              )}
            </div>
            <div className="p-3 border-t flex justify-end gap-2 shrink-0">
              {editingComment ? (
                <>
                  <button
                    onClick={() => { setEditingComment(false); setEditedCommentText(""); }}
                    disabled={savingComment}
                    className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1 disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={async () => {
                      setSavingComment(true);
                      try {
                        const res = await fetch(`/api/candidates/${candidateId}/files/${selectedAnalysis.fileId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ aiAnalysisComment: editedCommentText }),
                        });
                        if (!res.ok) throw new Error();
                        const data = await res.json().catch(() => null);
                        const updatedRating: string | null = data?.file?.aiMatchRating ?? null;
                        toast.success("コメントを保存しました");
                        // Update local state (aiAnalysisComment + aiMatchRating sync)
                        setFiles((prev) => prev.map((f) => f.id === selectedAnalysis.fileId
                          ? { ...f, aiAnalysisComment: editedCommentText, aiMatchRating: updatedRating ?? f.aiMatchRating }
                          : f));
                        setSelectedAnalysis({ ...selectedAnalysis, comment: editedCommentText, rating: updatedRating ?? selectedAnalysis.rating });
                        setEditingComment(false);
                        setEditedCommentText("");
                      } catch {
                        toast.error("保存に失敗しました");
                      } finally {
                        setSavingComment(false);
                      }
                    }}
                    disabled={savingComment}
                    className="bg-[#2563EB] text-white rounded px-3 py-1 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {savingComment ? "保存中..." : "💾 保存"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditedCommentText(selectedAnalysis.comment); setEditingComment(true); }}
                    className="text-sm text-blue-600 hover:text-blue-800 px-2"
                  >
                    ✏️ 編集
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedAnalysis.comment);
                      toast.success("コピーしました");
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800 px-2"
                  >
                    📋 コピー
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive (紹介保留に移動) modal */}
      {archiveTarget && (
        <ArchiveModal
          count={archiveTarget.kind === "bulk" ? archiveTarget.ids.length : 1}
          fileName={archiveTarget.kind === "single" ? archiveTarget.file.fileName : undefined}
          onConfirm={handleArchiveConfirm}
          onCancel={() => setArchiveTarget(null)}
          busy={archivingId !== null || bulkArchiving}
        />
      )}
    </div>
  );
}

/* ---------- Archived Bookmark Section ---------- */
function ArchivedBookmarkSection({ candidateId, onCountChange }: { candidateId: string; onCountChange?: (count: number) => void }) {
  const [files, setFiles] = useState<BookmarkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"name" | "wish" | "pass" | "overall" | "archivedBy" | "archivedAt" | null>("archivedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [permanentDeletingId, setPermanentDeletingId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<BookmarkFile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BookmarkFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<BookmarkFile | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK&archived=true`);
      if (res.ok) {
        const data = await res.json();
        const f = (data.files || []) as BookmarkFile[];
        setFiles(f);
        onCountChange?.(f.length);
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [candidateId, onCountChange]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleRestore = async (file: BookmarkFile) => {
    setRestoringId(file.id);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/${file.id}/restore`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "復元に失敗しました");
      }
      toast.success("復元しました");
      setConfirmRestore(null);
      fetchFiles();
      window.dispatchEvent(new CustomEvent("bookmark-archived-changed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "復元に失敗しました");
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (file: BookmarkFile) => {
    setPermanentDeletingId(file.id);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files/${file.id}/permanent`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "完全削除に失敗しました");
      }
      toast.success("完全削除しました");
      setConfirmDelete(null);
      fetchFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "完全削除に失敗しました");
    } finally {
      setPermanentDeletingId(null);
    }
  };

  const handleBulkRestore = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkRestoring(true);
    try {
      const results = await Promise.allSettled(
        ids.map((fileId) =>
          fetch(`/api/candidates/${candidateId}/files/${fileId}/restore`, { method: "POST" }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              throw new Error(data?.error || `failed: ${fileId}`);
            }
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      if (failed === 0) {
        toast.success(`${succeeded}件を復元しました`);
      } else if (succeeded === 0) {
        toast.error(`${failed}件すべての復元に失敗しました`);
      } else {
        toast.error(`${ids.length}件中${succeeded}件成功、${failed}件失敗`);
      }
      setSelectedIds(new Set());
      fetchFiles();
      window.dispatchEvent(new CustomEvent("bookmark-archived-changed"));
    } finally {
      setBulkRestoring(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((fileId) =>
          fetch(`/api/candidates/${candidateId}/files/${fileId}/permanent`, { method: "DELETE" }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => null);
              throw new Error(data?.error || `failed: ${fileId}`);
            }
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      if (failed === 0) {
        toast.success(`${succeeded}件を完全削除しました`);
      } else if (succeeded === 0) {
        toast.error(`${failed}件すべての削除に失敗しました`);
      } else {
        toast.error(`${ids.length}件中${succeeded}件成功、${failed}件失敗`);
      }
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      fetchFiles();
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (fileId: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(fileId)) n.delete(fileId); else n.add(fileId);
      return n;
    });
  };

  const handleSort = (field: "name" | "wish" | "pass" | "overall" | "archivedBy" | "archivedAt") => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir(field === "archivedAt" ? "desc" : "asc");
    }
  };

  const ratingOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  const filteredFiles = (() => {
    let result = files.filter((f) => {
      if (searchQuery && !f.fileName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
    if (sortField) {
      const dir = sortDir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        if (sortField === "name") return a.fileName.localeCompare(b.fileName) * dir;
        if (sortField === "wish" || sortField === "pass" || sortField === "overall") {
          const axisA = parse3AxisRatings(a.aiAnalysisComment);
          const axisB = parse3AxisRatings(b.aiAnalysisComment);
          const key = sortField;
          const va = axisA ? (ratingOrder[axisA[key]] ?? 4) : 4;
          const vb = axisB ? (ratingOrder[axisB[key]] ?? 4) : 4;
          return (va - vb) * dir;
        }
        if (sortField === "archivedBy") {
          return (a.archivedBy?.name || "").localeCompare(b.archivedBy?.name || "") * dir;
        }
        if (sortField === "archivedAt") {
          const ta = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
          const tb = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
          return (ta - tb) * dir;
        }
        return 0;
      });
    }
    return result;
  })();

  const toggleAll = () => {
    const ids = filteredFiles.map((f) => f.id);
    if (ids.length === 0) return;
    if (ids.every((id) => selectedIds.has(id))) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.delete(id);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of ids) n.add(id);
        return n;
      });
    }
  };

  const allChecked = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));
  const someChecked = filteredFiles.some((f) => selectedIds.has(f.id)) && !allChecked;

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  const shortDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  const reasonText = (file: BookmarkFile): string => {
    const r = file.archivedReason;
    const n = file.archivedNote;
    if (r && n) return `${r}: ${n}`;
    if (r) return r;
    if (n) return n;
    return "—";
  };

  const getPreviewUrl = (viewUrl: string) => viewUrl.replace(/\/view(\?|$)/, "/preview$1");

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[14px] font-semibold text-[#374151]">📦 紹介保留</h3>
          {files.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={selectedIds.size === 0 || bulkRestoring || bulkDeleting}
                className="text-[12px] text-blue-600 border border-blue-300 rounded-md px-3 py-1 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {bulkRestoring ? "復元中..." : `一括復元${selectedIds.size > 0 ? ` (${selectedIds.size}件)` : ""}`}
              </button>
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={selectedIds.size === 0 || bulkRestoring || bulkDeleting}
                className="text-[12px] text-red-600 border border-red-300 rounded-md px-3 py-1 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {`一括削除${selectedIds.size > 0 ? ` (${selectedIds.size}件)` : ""}`}
              </button>
            </div>
          )}
        </div>
        <p className="text-[12px] text-gray-500">紹介を保留にしたブックマークの一覧。復元または完全削除できます。</p>

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
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[11px] font-medium text-gray-500 select-none">
          <span className="w-[18px] shrink-0 flex items-center">
            <input
              ref={headerCheckboxRef}
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="cursor-pointer"
              aria-label="全選択"
            />
          </span>
          <span
            onClick={() => handleSort("name")}
            className={`flex-1 min-w-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "name" ? "text-[#2563EB]" : ""}`}
          >
            会社名
            <SortIcon field="name" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("wish")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "wish" ? "text-[#2563EB]" : ""}`}>
            希望<SortIcon field="wish" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("pass")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "pass" ? "text-[#2563EB]" : ""}`}>
            通過<SortIcon field="pass" current={sortField} dir={sortDir} />
          </span>
          <span onClick={() => handleSort("overall")}
            className={`w-[44px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "overall" ? "text-[#2563EB]" : ""}`}>
            総合<SortIcon field="overall" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("archivedAt")}
            className={`w-[64px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 whitespace-nowrap ${sortField === "archivedAt" ? "text-[#2563EB]" : ""}`}
          >
            保留日
            <SortIcon field="archivedAt" current={sortField} dir={sortDir} />
          </span>
          <span
            onClick={() => handleSort("archivedBy")}
            className={`w-[80px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${sortField === "archivedBy" ? "text-[#2563EB]" : ""}`}
          >
            保留者
            <SortIcon field="archivedBy" current={sortField} dir={sortDir} />
          </span>
          <span className="w-[160px] shrink-0">保留理由</span>
          <span className="w-[110px] shrink-0" />
        </div>
      )}

      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-[13px] text-gray-400">読み込み中...</div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-gray-400">紹介保留中のブックマークはありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredFiles.length === 0 ? (
              <div className="py-6 text-center text-[13px] text-gray-400">該当するファイルが見つかりません</div>
            ) : filteredFiles.map((file) => {
              const axis = parse3AxisRatings(file.aiAnalysisComment);
              const badge = (v: string | undefined) => {
                if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                const s = RATING_STYLES[v];
                return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
              };
              return (
                <div key={file.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors">
                  <span className="w-[18px] shrink-0 flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(file.id)}
                      onChange={() => toggleSelect(file.id)}
                      className="cursor-pointer"
                      aria-label="選択"
                    />
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="shrink-0 text-sm">📄</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                      className="text-[13px] font-medium text-blue-600 hover:text-blue-800 hover:underline truncate text-left"
                      title={file.fileName}
                    >{file.fileName}</button>
                  </div>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.wish)}</span>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.pass)}</span>
                  <span className="w-[44px] shrink-0 text-center">{badge(axis?.overall || file.aiMatchRating || undefined)}</span>
                  <span className="w-[64px] shrink-0 text-[11px] text-gray-500 whitespace-nowrap">{shortDate(file.archivedAt)}</span>
                  <span className="w-[80px] shrink-0 text-[11px] text-gray-500 truncate">{file.archivedBy?.name || "—"}</span>
                  <span className="w-[160px] shrink-0 text-[11px] text-gray-600 truncate" title={reasonText(file)}>{reasonText(file)}</span>
                  <span className="w-[110px] shrink-0 flex items-center gap-1 justify-end">
                    <button
                      onClick={() => setConfirmRestore(file)}
                      disabled={restoringId === file.id}
                      className="text-[11px] text-blue-600 hover:text-blue-800 border border-blue-300 rounded px-2 py-0.5 hover:bg-blue-50 transition-colors disabled:opacity-50"
                      title="復元"
                    >
                      {restoringId === file.id ? "..." : "復元"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(file)}
                      disabled={permanentDeletingId === file.id}
                      className="text-[11px] text-red-600 hover:text-red-800 border border-red-300 rounded px-2 py-0.5 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="完全削除"
                    >
                      {permanentDeletingId === file.id ? "..." : "削除"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Restore confirm modal */}
      {confirmRestore && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setConfirmRestore(null)}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-[#374151] mb-3">紹介保留から復元</h2>
            <p className="text-sm text-gray-600 mb-4"><span className="font-medium">{confirmRestore.fileName}</span> をブックマークに復元します。</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRestore(null)} disabled={restoringId === confirmRestore.id} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                disabled={restoringId === confirmRestore.id}
                className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {restoringId === confirmRestore.id ? "復元中..." : "復元する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-red-600 mb-3">⚠️ 完全削除</h2>
            <div className="text-sm text-gray-700 mb-4 space-y-2">
              <p><span className="font-medium">{confirmDelete.fileName}</span> を完全に削除します。</p>
              <p className="text-red-600 font-medium">DB と Google Drive から完全に削除されます。元に戻せません。本当に削除しますか？</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={permanentDeletingId === confirmDelete.id} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              <button
                onClick={() => handlePermanentDelete(confirmDelete)}
                disabled={permanentDeletingId === confirmDelete.id}
                className="flex-1 bg-red-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {permanentDeletingId === confirmDelete.id ? "削除中..." : "完全削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm modal */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={bulkDeleting ? undefined : () => setShowBulkDeleteConfirm(false)}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-bold text-red-600 mb-3">⚠️ 一括削除</h2>
            <div className="text-sm text-gray-700 mb-4 space-y-2">
              <p>選択した <span className="font-medium">{selectedIds.size}件</span> の紹介保留を削除します。よろしいですか？</p>
              <p className="text-red-600 font-medium">DB と Google Drive から完全に削除されます。元に戻せません。</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={bulkDeleting}
                className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleBulkDeleteConfirm}
                disabled={bulkDeleting}
                className="flex-1 bg-red-600 text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {bulkDeleting ? "削除中..." : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview popup */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPreviewFile(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b bg-gray-50 shrink-0">
              <span className="text-[13px] font-medium truncate">{previewFile.fileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <a href={getPreviewUrl(previewFile.driveViewUrl)} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] text-blue-600 hover:underline">新しいタブで開く</a>
                <button onClick={() => setPreviewFile(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <iframe src={getPreviewUrl(previewFile.driveViewUrl)} className="w-full h-full border-0" title={previewFile.fileName} />
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
export default function HistoryTab({ candidateId, candidateName }: { candidateId: string; candidateName?: string }) {
  const [activeSubTab, setActiveSubTab] = useState<"bookmark" | "jobs" | "entries" | "archived">("bookmark");
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);

  // Jobs state
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetIds, setDeleteTargetIds] = useState<number[]>([]);
  const [jobDeleting, setJobDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [responseFilter, setResponseFilter] = useState<"ALL" | "WANT_TO_APPLY" | "INTERESTED" | "NONE">("ALL");
  const [jobSortField, setJobSortField] = useState<"wish" | "pass" | "overall" | null>(null);
  const [jobSortDir, setJobSortDir] = useState<"asc" | "desc">("asc");
  const handleJobSort = (field: "wish" | "pass" | "overall") => {
    if (jobSortField === field) {
      if (jobSortDir === "asc") { setJobSortDir("desc"); }
      else { setJobSortField(null); setJobSortDir("asc"); }
    } else {
      setJobSortField(field);
      setJobSortDir("asc");
    }
  };

  // Entries state
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [bulkReverting, setBulkReverting] = useState(false);

  // Bookmark ratings for cross-referencing with jobs
  const [bookmarkRatings, setBookmarkRatings] = useState<Map<string, { wish: string; pass: string; overall: string }>>(new Map());

  // Derive entered external job ids for cross-referencing
  const enteredJobIds = new Set(entries.map((e) => e.externalJobId));

  // Job candidate responses for cross-referencing with bookmarks
  const jobResponseMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!jobsData?.jobs) return map;
    for (const job of jobsData.jobs) {
      if (!job.candidate_response) continue;
      const cn = normalize(stripCorpSuffixes(job.company_name));
      if (cn) map.set(cn, job.candidate_response);
    }
    return map;
  }, [jobsData]);

  /* ---------- Fetch ---------- */
  const fetchBookmarkRatings = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK`);
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, { wish: string; pass: string; overall: string }>();
      for (const f of data.files || []) {
        const axis = parse3AxisRatings(f.aiAnalysisComment);
        if (!axis) continue;
        const key = normalize(
          (f.fileName as string)
            .replace(/\.pdf$/i, "")
            .replace(/^求人票[_]?/, "")
            .replace(/_\d{10,}$/, "")
            .replace(/株式会社|有限会社|合同会社/g, "")
            .trim()
        );
        if (key) map.set(key, axis);
      }
      setBookmarkRatings(map);
    } catch { /* silent */ }
  }, [candidateId]);

  const findBookmarkRating = useCallback((companyName: string) => {
    const cn = normalize(companyName.replace(/株式会社|有限会社|合同会社/g, "").trim());
    for (const [key, axis] of bookmarkRatings) {
      if (key.includes(cn) || cn.includes(key)) return axis;
    }
    return null;
  }, [bookmarkRatings]);

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

  const fetchArchivedCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/files?category=BOOKMARK&archived=true`);
      if (!res.ok) return;
      const data = await res.json();
      setArchivedCount((data.files || []).length);
    } catch { /* silent */ }
  }, [candidateId]);

  useEffect(() => {
    fetchJobs();
    fetchEntries();
    fetchBookmarkRatings();
    fetchArchivedCount();
  }, [fetchJobs, fetchEntries, fetchBookmarkRatings, fetchArchivedCount]);

  useEffect(() => {
    const handler = () => fetchArchivedCount();
    window.addEventListener("bookmark-archived-changed", handler);
    return () => window.removeEventListener("bookmark-archived-changed", handler);
  }, [fetchArchivedCount]);

  useEffect(() => {
    const handler = () => fetchBookmarkRatings();
    window.addEventListener("bookmark-ratings-updated", handler);
    return () => window.removeEventListener("bookmark-ratings-updated", handler);
  }, [fetchBookmarkRatings]);

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
        externalJobNo: j.job_id,
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

  const handleRevertEntry = async (entryId: string) => {
    if (!confirm("このエントリーを求人紹介に戻しますか？")) return;
    setRevertingId(entryId);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/revert-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryIds: [entryId] }),
        }
      );
      if (!res.ok) throw new Error("戻す処理に失敗しました");
      toast.success("求人紹介に戻しました");
      fetchEntries();
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "戻す処理に失敗しました");
    } finally {
      setRevertingId(null);
    }
  };

  const handleBulkRevertEntries = async () => {
    if (selectedEntryIds.size === 0) return;
    if (!confirm(`${selectedEntryIds.size}件を求人紹介に戻しますか？`)) return;
    setBulkReverting(true);
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/entries/revert-bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryIds: Array.from(selectedEntryIds) }),
        }
      );
      if (!res.ok) throw new Error("一括戻す処理に失敗しました");
      const data = await res.json();
      toast.success(data.message || `${selectedEntryIds.size}件を求人紹介に戻しました`);
      setSelectedEntryIds(new Set());
      fetchEntries();
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "一括戻す処理に失敗しました");
    } finally {
      setBulkReverting(false);
    }
  };

  const toggleEntrySelection = (entryId: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const toggleAllEntries = () => {
    if (selectedEntryIds.size === filteredEntries.length) {
      setSelectedEntryIds(new Set());
    } else {
      setSelectedEntryIds(new Set(filteredEntries.map((e) => e.id)));
    }
  };

  /* ---------- Job Delete Handlers ---------- */
  const openDeleteModal = (jobIds: number[]) => {
    setDeleteTargetIds(jobIds);
    setShowDeleteModal(true);
  };

  const handleDeleteJobs = async () => {
    if (deleteTargetIds.length === 0) return;
    setJobDeleting(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/job-introductions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_ids: deleteTargetIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "削除に失敗しました");
      }
      const data = await res.json();
      if (data.deleted_count > 0) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
      setSelectedJobIds((prev) => {
        const next = new Set(prev);
        for (const id of deleteTargetIds) next.delete(id);
        return next;
      });
      setShowDeleteModal(false);
      setDeleteTargetIds([]);
      fetchJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setJobDeleting(false);
    }
  };

  const deleteSkippedCount = deleteTargetIds.filter((id) => enteredJobIds.has(id)).length;

  /* ---------- Render ---------- */
  const allJobs = jobsData?.jobs || [];
  const totalJobs = jobsData?.total_jobs ?? 0;
  const responseOrder: Record<string, number> = { WANT_TO_APPLY: 0, INTERESTED: 1 };

  const jobs = (() => {
    let result = allJobs;
    if (jobSearch) {
      result = result.filter((j) => normalize(j.company_name).includes(normalize(jobSearch)));
    }
    if (responseFilter !== "ALL") {
      result = responseFilter === "NONE"
        ? result.filter((j) => !j.candidate_response)
        : result.filter((j) => j.candidate_response === responseFilter);
    }
    const sorted = [...result];
    if (jobSortField) {
      const ratingOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
      const dir = jobSortDir === "asc" ? 1 : -1;
      const key = jobSortField === "wish" ? "wish" : jobSortField === "pass" ? "pass" : "overall";
      sorted.sort((a, b) => {
        const axA = findBookmarkRating(a.company_name);
        const axB = findBookmarkRating(b.company_name);
        const va = axA ? (ratingOrder[axA[key]] ?? 4) : 4;
        const vb = axB ? (ratingOrder[axB[key]] ?? 4) : 4;
        return (va - vb) * dir;
      });
    } else {
      sorted.sort((a, b) => {
        const ra = a.candidate_response ? (responseOrder[a.candidate_response] ?? 2) : 2;
        const rb = b.candidate_response ? (responseOrder[b.candidate_response] ?? 2) : 2;
        return ra - rb;
      });
    }
    return sorted;
  })();
  const filteredEntries = entrySearch
    ? entries.filter((e) => normalize(e.companyName).includes(normalize(entrySearch)))
    : entries;

  return (
    <div className="min-w-0">
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
        <button
          onClick={() => setActiveSubTab("archived")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors ${
            activeSubTab === "archived"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          紹介保留
          {archivedCount > 0 && (
            <span className="ml-1.5 text-xs text-gray-400">({archivedCount})</span>
          )}
        </button>
      </div>

      {/* ===== ブックマークサブタブ ===== */}
      {activeSubTab === "bookmark" && (
        <BookmarkSection candidateId={candidateId} jobResponseMap={jobResponseMap} onCountChange={setBookmarkCount} onSwitchToJobs={() => { setActiveSubTab("jobs"); fetchJobs(); }} onArchivedChange={fetchArchivedCount} />
      )}

      {/* ===== 紹介保留サブタブ ===== */}
      {activeSubTab === "archived" && (
        <ArchivedBookmarkSection candidateId={candidateId} onCountChange={setArchivedCount} />
      )}

      {/* ===== 求人紹介サブタブ ===== */}
      {activeSubTab === "jobs" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 min-w-0">
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
            <select
              value={responseFilter}
              onChange={(e) => setResponseFilter(e.target.value as typeof responseFilter)}
              className="border border-gray-300 rounded-md px-2 py-1 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="ALL">全て</option>
              <option value="WANT_TO_APPLY">応募したい</option>
              <option value="INTERESTED">気になる</option>
              <option value="NONE">未回答</option>
            </select>
            {selectableJobIds.length > 0 && (
              <button
                onClick={handleToggleAll}
                className="text-[13px] text-gray-500 hover:text-[#2563EB] transition-colors"
              >
                {allSelectableChecked ? "☑ 全解除" : "☐ 全選択"}
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {selectedJobIds.size > 0 && (
                <button
                  onClick={() => openDeleteModal(Array.from(selectedJobIds))}
                  disabled={jobDeleting}
                  className="border border-red-400 text-red-500 rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🗑 選択を削除（{selectedJobIds.size}件）
                </button>
              )}
              <button
                onClick={() => setShowEntryModal(true)}
                disabled={selectedJobIds.size === 0 || submitting}
                className="bg-[#2563EB] text-white rounded-md px-3 py-1.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ☑ 選択してエントリー
                {selectedJobIds.size > 0 && ` (${selectedJobIds.size})`}
              </button>
            </div>
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
              className="overflow-y-auto overflow-x-hidden min-w-0"
              style={{ maxHeight: "calc(100vh - 400px)" }}
            >
              {/* 列ヘッダー */}
              <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-y border-gray-200 text-[11px] font-medium text-gray-500 select-none min-w-0">
                <span className="w-4 shrink-0" />
                <span className="flex-1 min-w-0">会社名</span>
                <span onClick={() => handleJobSort("wish")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobSortField === "wish" ? "text-[#2563EB]" : ""}`}>
                  希望<SortIcon field="wish" current={jobSortField} dir={jobSortDir} />
                </span>
                <span onClick={() => handleJobSort("pass")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobSortField === "pass" ? "text-[#2563EB]" : ""}`}>
                  通過<SortIcon field="pass" current={jobSortField} dir={jobSortDir} />
                </span>
                <span onClick={() => handleJobSort("overall")}
                  className={`w-[56px] shrink-0 cursor-pointer hover:text-gray-700 flex items-center gap-0.5 ${jobSortField === "overall" ? "text-[#2563EB]" : ""}`}>
                  総合<SortIcon field="overall" current={jobSortField} dir={jobSortDir} />
                </span>
                <span className="w-[72px] shrink-0">DB</span>
                <span className="w-[52px] shrink-0">紹介日</span>
                <span className="w-[28px] shrink-0" />
              </div>
              <div className="divide-y divide-gray-100">
                {jobs.map((job) => {
                  const isEntered = enteredJobIds.has(job.id);
                  const isSelected = selectedJobIds.has(job.id);
                  const axis = findBookmarkRating(job.company_name);
                  const badge = (v: string | undefined) => {
                    if (!v || v === "—") return <span className="text-[10px] text-gray-300">—</span>;
                    const s = RATING_STYLES[v];
                    return s ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${s}`}>{v}</span> : <span className="text-[10px] text-gray-300">—</span>;
                  };

                  return (
                    <div
                      key={job.id}
                      className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-50 min-w-0 ${
                        isSelected ? "bg-blue-50/40" : ""
                      }`}
                    >
                      {isEntered ? (
                        <span className="w-4 shrink-0 text-xs text-gray-400 text-center">済</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleJobSelection(job.id)}
                          className="shrink-0 w-4 h-4 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                        />
                      )}
                      <div className="flex-1 min-w-0 group/job relative">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13px] font-medium text-[#374151] truncate">{job.company_name}</span>
                          {job.candidate_response && RESPONSE_BADGE[job.candidate_response] && (
                            <span className={`shrink-0 text-[10px] rounded px-1.5 py-0 font-medium ${RESPONSE_BADGE[job.candidate_response].cls}`}>
                              {RESPONSE_BADGE[job.candidate_response].label}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 truncate">{job.job_title}</p>
                        {/* ホバーでスタイル付きツールチップ表示 */}
                        <div className="hidden group-hover/job:block absolute left-0 top-full z-20 mt-1 max-w-md bg-gray-800 text-white text-[12px] rounded-lg px-3 py-2 shadow-lg whitespace-normal break-words pointer-events-none">
                          <p className="font-medium">{job.company_name}</p>
                          {job.job_title && <p className="mt-0.5 text-gray-300">{job.job_title}</p>}
                        </div>
                      </div>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.wish)}</span>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.pass)}</span>
                      <span className="w-[56px] shrink-0 text-center">{badge(axis?.overall)}</span>
                      <span className="w-[72px] shrink-0 text-[11px] text-gray-500 truncate">{job.job_db || "—"}</span>
                      <span className="w-[52px] shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{formatDateJST(job.created_at).slice(5)}</span>
                      {!isEntered ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); openDeleteModal([job.id]); }}
                          className="w-[28px] shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
                          title="紹介リストから削除"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      ) : <span className="w-[28px] shrink-0" />}
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
            {selectedEntryIds.size > 0 && (
              <button
                onClick={handleBulkRevertEntries}
                disabled={bulkReverting}
                className="shrink-0 rounded-md bg-amber-50 border border-amber-300 px-3 py-1 text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                {bulkReverting ? "処理中..." : `選択を求人紹介に戻す（${selectedEntryIds.size}件）`}
              </button>
            )}
            <a
              href={`/entries${candidateName ? `?candidateName=${encodeURIComponent(candidateName)}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 ml-auto text-[12px] text-[#2563EB] hover:underline"
            >
              エントリー管理画面へ &rarr;
            </a>
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
              {/* 全選択 */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <input
                  type="checkbox"
                  checked={filteredEntries.length > 0 && selectedEntryIds.size === filteredEntries.length}
                  onChange={toggleAllEntries}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                />
                <span className="text-[12px] text-gray-500">全選択</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-3 hover:shadow-sm transition-shadow ${selectedEntryIds.has(entry.id) ? "border-amber-300 bg-amber-50/30" : "border-gray-200"}`}
                  >
                    {/* 1行目: チェックボックス + 会社名 + バッジ + DB/タイプ */}
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.has(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-[#2563EB] focus:ring-[#2563EB]"
                      />
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
                          onClick={() => handleRevertEntry(entry.id)}
                          disabled={revertingId === entry.id}
                          className="text-xs text-amber-600 hover:text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-50 transition-colors disabled:opacity-50"
                          title="求人紹介に戻す"
                        >
                          {revertingId === entry.id ? "..." : "戻す"}
                        </button>
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

      {/* 削除確認モーダル */}
      {showDeleteModal && (
        <DeleteConfirmModal
          count={deleteTargetIds.length}
          skippedCount={deleteSkippedCount}
          onConfirm={handleDeleteJobs}
          onCancel={() => { setShowDeleteModal(false); setDeleteTargetIds([]); }}
          deleting={jobDeleting}
        />
      )}
    </div>
  );
}
