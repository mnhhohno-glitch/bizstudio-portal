"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import InterviewUrlModal from "@/components/candidates/InterviewUrlModal";

/* ---------- Types ---------- */
type Employee = { id: string; name: string };

type Note = {
  id: string;
  content: string;
  authorUserId: string;
  author: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
};

type GuideEntry = {
  id: string;
  guideType: string;
  token: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Candidate = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  email: string | null;
  employeeId: string | null;
  employee: Employee | null;
  guideEntries: GuideEntry[];
  notes: Note[];
  createdAt: string;
  updatedAt: string;
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/* ---------- Constants ---------- */
const TABS = [
  { key: "overview", label: "概要" },
  { key: "interview", label: "面接対策" },
  { key: "notes", label: "メモ" },
  { key: "tasks", label: "タスク" },
  { key: "documents", label: "書類" },
  { key: "history", label: "履歴" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ---------- Helpers ---------- */
function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function genderLabel(g: string | null) {
  if (!g) return "未設定";
  switch (g) {
    case "male":
      return "男性";
    case "female":
      return "女性";
    case "other":
      return "その他";
    default:
      return "未設定";
  }
}

/* ================================================================== */
/*  EditModal                                                          */
/* ================================================================== */
function EditModal({
  candidate,
  employees,
  onClose,
  onSaved,
}: {
  candidate: Candidate;
  employees: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(candidate.name);
  const [furigana, setFurigana] = useState(candidate.nameKana || "");
  const [email, setEmail] = useState(candidate.email || "");
  const [gender, setGender] = useState(candidate.gender || "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(
    candidate.employeeId || ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !furigana.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          furigana: furigana.trim(),
          email: email.trim(),
          gender: gender || null,
          assignedEmployeeId: assignedEmployeeId || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved();
      onClose();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[8px] w-full max-w-[520px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <h2 className="text-[15px] font-bold text-[#374151]">
            基本情報を編集
          </h2>
          <button
            onClick={onClose}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              氏名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              ふりがな <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={furigana}
              onChange={(e) => setFurigana(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              性別 <span className="text-red-500">*</span>
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            >
              <option value="">選択してください</option>
              <option value="male">男性</option>
              <option value="female">女性</option>
              <option value="other">その他</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[#374151] mb-1">
              担当キャリアアドバイザー <span className="text-red-500">*</span>
            </label>
            <select
              value={assignedEmployeeId}
              onChange={(e) => setAssignedEmployeeId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            >
              <option value="">選択してください</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !furigana.trim()}
              className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Tab: Overview                                                       */
/* ================================================================== */
function OverviewTab({
  candidate,
  onTabChange,
}: {
  candidate: Candidate;
  onTabChange: (tab: TabKey) => void;
}) {
  const interviewGuide = candidate.guideEntries.find(
    (e) => e.guideType === "INTERVIEW"
  );
  const notesCount = candidate.notes.length;
  const recentNotes = candidate.notes.slice(0, 3);
  const aiAxis = interviewGuide?.data
    ? (interviewGuide.data as Record<string, unknown>).ai_generated_axis
    : null;

  return (
    <div className="space-y-6">
      {/* ステータスカード */}
      <div>
        <h3 className="text-[14px] font-semibold text-[#374151] mb-3">
          📊 ステータス
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-[#003366]">
              {interviewGuide ? "✅" : "⚠️"}
            </div>
            <div className="text-xs text-gray-500 mt-1">面接対策</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {interviewGuide ? "作成済み" : "未作成"}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-[#003366]">
              {notesCount}件
            </div>
            <div className="text-xs text-gray-500 mt-1">メモ</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-[#003366]">0件</div>
            <div className="text-xs text-gray-500 mt-1">タスク</div>
          </div>
        </div>
      </div>

      {/* 最近のメモ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            📝 最近のメモ
          </h3>
          {notesCount > 0 && (
            <button
              onClick={() => onTabChange("notes")}
              className="text-[12px] text-[#2563EB] hover:underline"
            >
              すべて見る →
            </button>
          )}
        </div>
        {recentNotes.length > 0 ? (
          <div className="space-y-2">
            {recentNotes.map((note) => (
              <div
                key={note.id}
                className="bg-white rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium text-[#374151]">
                    {note.author.name}
                  </span>
                  <span className="text-[12px] text-gray-500">
                    {formatDate(note.createdAt)}
                  </span>
                </div>
                <p className="text-[13px] text-gray-700 whitespace-pre-wrap line-clamp-2">
                  {note.content}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-[13px] text-gray-400">
            メモはまだありません
          </div>
        )}
      </div>

      {/* 転職軸プレビュー */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            🎯 転職軸プレビュー
          </h3>
          {aiAxis ? (
            <button
              onClick={() => onTabChange("interview")}
              className="text-[12px] text-[#2563EB] hover:underline"
            >
              詳しく見る →
            </button>
          ) : null}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          {aiAxis ? (
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">
              {String(aiAxis).slice(0, 200)}
              {String(aiAxis).length > 200 ? "..." : ""}
            </p>
          ) : (
            <p className="text-[13px] text-gray-400 text-center">
              まだ生成されていません
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Tab: Interview                                                      */
/* ================================================================== */
function InterviewTab({ candidate }: { candidate: Candidate }) {
  const interviewGuide = candidate.guideEntries.find(
    (e) => e.guideType === "INTERVIEW"
  );
  const data = (interviewGuide?.data || {}) as Record<string, unknown>;
  const appUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const worksheetFields = [
    { key: "worksheet_q1", label: "① なぜ転職するのか" },
    { key: "worksheet_q2", label: "② 何を大切にして働きたいか" },
    { key: "worksheet_q3", label: "③ どんな自分になりたいか" },
  ];

  const prepFields = [
    { key: "prep_point", label: "P（結論）" },
    { key: "prep_reason", label: "R（理由）" },
    { key: "prep_example", label: "E（具体例）" },
    { key: "prep_point2", label: "P（再結論）" },
  ];

  const aiAxis = data.ai_generated_axis;
  const hasValue = (key: string) => {
    const val = data[key];
    return val !== undefined && val !== null && String(val).trim() !== "";
  };

  return (
    <div className="space-y-6">
      <h3 className="text-[16px] font-semibold text-[#374151]">
        面接対策ガイド
      </h3>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-[14px] text-[#374151]">
          ステータス:{" "}
          {interviewGuide ? (
            <span className="text-green-600 font-medium">
              ✅ ガイド作成済み
            </span>
          ) : (
            <span className="text-yellow-600 font-medium">⚠️ 未作成</span>
          )}
        </p>
        {interviewGuide && (
          <div className="mt-3">
            <p className="text-[12px] text-gray-500 mb-1">求職者用URL:</p>
            <div className="flex items-center gap-2">
              <code className="text-[12px] bg-gray-50 border border-gray-200 rounded px-2 py-1 flex-1 break-all">
                {appUrl}/g/{interviewGuide.token}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${appUrl}/g/${interviewGuide.token}`
                  );
                }}
                className="text-[12px] bg-white border border-gray-300 text-gray-700 rounded-md px-3 py-1.5 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                📋 コピー
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ワークシート入力状況 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-[13px] font-semibold text-[#374151] mb-3">
          転職軸ワークシート入力状況
        </h4>
        <div className="space-y-2">
          {worksheetFields.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-[13px]">
              <span>{hasValue(f.key) ? "✅" : "⚠️"}</span>
              <span className="text-[#374151]">{f.label}:</span>
              <span
                className={
                  hasValue(f.key) ? "text-green-600" : "text-yellow-600"
                }
              >
                {hasValue(f.key) ? "入力済み" : "未入力"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* PREP法入力状況 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-[13px] font-semibold text-[#374151] mb-3">
          PREP法入力状況
        </h4>
        <div className="space-y-2">
          {prepFields.map((f) => (
            <div key={f.key} className="flex items-center gap-2 text-[13px]">
              <span>{hasValue(f.key) ? "✅" : "⚠️"}</span>
              <span className="text-[#374151]">{f.label}:</span>
              <span
                className={
                  hasValue(f.key) ? "text-green-600" : "text-yellow-600"
                }
              >
                {hasValue(f.key) ? "入力済み" : "未入力"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AI自己分析レポート */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h4 className="text-[13px] font-semibold text-[#374151] mb-3">
          AI自己分析レポート
        </h4>
        {aiAxis ? (
          <>
            <p className="text-green-600 text-[13px] font-medium mb-2">
              ✅ 生成済み
            </p>
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">
              {String(aiAxis).slice(0, 200)}
              {String(aiAxis).length > 200 ? "..." : ""}
            </p>
          </>
        ) : (
          <p className="text-yellow-600 text-[13px]">⚠️ 未生成</p>
        )}
      </div>

      <Link
        href={`/candidates/${candidate.id}/guides/interview`}
        className="inline-flex items-center gap-2 bg-[#003366] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#002244] transition-colors"
      >
        📖 ガイドを開く
      </Link>
    </div>
  );
}

/* ================================================================== */
/*  Tab: Notes                                                          */
/* ================================================================== */
function NotesTab({
  candidate,
  currentUser,
  onRefresh,
}: {
  candidate: Candidate;
  currentUser: SessionUser | null;
  onRefresh: () => void;
}) {
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handlePost = async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (!res.ok) throw new Error();
      setContent("");
      onRefresh();
    } catch {
      alert("メモの投稿に失敗しました");
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!confirm("このメモを削除しますか？")) return;
    setDeletingId(noteId);
    try {
      const res = await fetch(
        `/api/candidates/${candidate.id}/notes/${noteId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
      onRefresh();
    } catch {
      alert("メモの削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = (note: Note) => {
    if (!currentUser) return false;
    return (
      currentUser.id === note.authorUserId || currentUser.role === "admin"
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[#374151]">メモ</h3>
        <span className="text-[12px] text-gray-500">
          （{candidate.notes.length}件）
        </span>
      </div>

      {/* 新規メモ入力 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <textarea
          rows={3}
          placeholder="メモを入力..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none resize-none"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handlePost}
            disabled={!content.trim() || posting}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {posting ? "投稿中..." : "📝 投稿する"}
          </button>
        </div>
      </div>

      {/* メモ一覧 */}
      {candidate.notes.length > 0 ? (
        <div className="space-y-3">
          {candidate.notes.map((note) => (
            <div
              key={note.id}
              className="bg-white rounded-lg border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[#374151]">
                  {note.author.name}
                </span>
                <span className="text-[12px] text-gray-500">
                  {formatDateTime(note.createdAt)}
                </span>
              </div>
              <p className="text-[13px] text-gray-700 whitespace-pre-wrap">
                {note.content}
              </p>
              {canDelete(note) && (
                <div className="flex justify-end mt-3">
                  <button
                    onClick={() => handleDelete(note.id)}
                    disabled={deletingId === note.id}
                    className="text-red-400 hover:text-red-600 text-sm transition-colors disabled:opacity-50"
                  >
                    🗑 削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-[13px] text-gray-400">
          メモはまだありません
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Placeholder tabs                                                    */
/* ================================================================== */
function PlaceholderTab({
  icon,
  label,
}: {
  icon: string;
  label: string;
}) {
  return (
    <div className="text-center py-16 text-gray-400">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="text-[14px] font-medium">{label}は準備中です</p>
      <p className="text-[12px] mt-1">
        今後のアップデートで利用可能になります
      </p>
    </div>
  );
}

/* ================================================================== */
/*  Main Page Component                                                 */
/* ================================================================== */
export default function CandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "overview";

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [urlModalOpen, setUrlModalOpen] = useState(false);

  const fetchCandidate = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("求職者が見つかりません");
        } else {
          setError("データの取得に失敗しました");
        }
        return;
      }
      const data = await res.json();
      setCandidate(data.candidate);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    fetchCandidate();
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.id) setCurrentUser(d);
      })
      .catch(() => {});
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEmployees(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
        }
      })
      .catch(() => {});
  }, [fetchCandidate]);

  const handleTabChange = (tab: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/candidates/${candidateId}?${params.toString()}`, {
      scroll: false,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-[14px] text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="text-center py-20">
        <p className="text-[16px] text-red-500">{error || "エラー"}</p>
        <Link
          href="/admin/master"
          className="mt-4 inline-block text-[14px] text-[#2563EB] hover:underline"
        >
          ← 求職者一覧に戻る
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* パンくず */}
      <Link
        href="/admin/master"
        className="text-[13px] text-[#2563EB] hover:underline"
      >
        ← 求職者一覧に戻る
      </Link>

      {/* ヘッダーカード */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#374151]">
              {candidate.name}
            </h1>
            {candidate.nameKana && (
              <p className="text-sm text-gray-500 mt-1">
                {candidate.nameKana}
              </p>
            )}
          </div>
          <span className="text-sm text-gray-500">
            ID: {candidate.candidateNumber}
          </span>
        </div>

        <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
          <span>
            ✉{" "}
            {candidate.email || (
              <span className="text-gray-400">未登録</span>
            )}
          </span>
          <span>
            👤 担当CA:{" "}
            {candidate.employee?.name || (
              <span className="text-gray-400">未設定</span>
            )}
          </span>
          <span>性別: {genderLabel(candidate.gender)}</span>
          <span>登録日: {formatDate(candidate.createdAt)}</span>
        </div>

        <div className="flex gap-3 mt-4">
          <Link
            href={`/candidates/${candidate.id}/guides/interview`}
            className="bg-[#003366] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#002244] transition-colors"
          >
            面接対策
          </Link>
          <button
            onClick={() => setUrlModalOpen(true)}
            className="bg-white border border-gray-300 text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            URL生成
          </button>
          <button
            onClick={() => setEditModalOpen(true)}
            className="bg-white border border-gray-300 text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ✏️ 基本情報を編集
          </button>
        </div>
      </div>

      {/* タブバー */}
      <div className="flex border-b border-gray-200 mt-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "text-[#2563EB] border-[#2563EB]"
                : "text-gray-500 hover:text-gray-700 border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div className="mt-6">
        {activeTab === "overview" && (
          <OverviewTab
            candidate={candidate}
            onTabChange={handleTabChange}
          />
        )}
        {activeTab === "interview" && (
          <InterviewTab candidate={candidate} />
        )}
        {activeTab === "notes" && (
          <NotesTab
            candidate={candidate}
            currentUser={currentUser}
            onRefresh={fetchCandidate}
          />
        )}
        {activeTab === "tasks" && (
          <PlaceholderTab icon="📋" label="タスク機能" />
        )}
        {activeTab === "documents" && (
          <PlaceholderTab icon="📁" label="書類管理機能" />
        )}
        {activeTab === "history" && (
          <PlaceholderTab icon="📜" label="対応履歴機能" />
        )}
      </div>

      {/* 基本情報編集モーダル */}
      {editModalOpen && (
        <EditModal
          candidate={candidate}
          employees={employees}
          onClose={() => setEditModalOpen(false)}
          onSaved={fetchCandidate}
        />
      )}

      {/* URL生成モーダル */}
      <InterviewUrlModal
        isOpen={urlModalOpen}
        onClose={() => setUrlModalOpen(false)}
        candidateName={candidate.name}
        advisorName={candidate.employee?.name ?? null}
      />
    </div>
  );
}
