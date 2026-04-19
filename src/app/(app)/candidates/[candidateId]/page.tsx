"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CandidateQuickSearch from "@/components/candidates/CandidateQuickSearch";
import InterviewUrlModal from "@/components/candidates/InterviewUrlModal";
import DocumentsTab from "@/components/candidates/DocumentsTab";
import AdvisorFloatingPanel from "@/components/candidates/AdvisorFloatingPanel";
import HistoryTab from "@/components/candidates/HistoryTab";
import SupportEndModal from "@/components/candidates/SupportEndModal";
import CandidateHeader from "@/components/candidates/CandidateHeader";
import InterviewHistoryTab from "@/components/candidates/InterviewHistoryTab";
import { Toaster } from "sonner";
import { REASON_LABEL_MAP } from "@/lib/constants/support-end-reasons";
import {
  SUPPORT_SUB_STATUS_MAP,
  isSubStatusFixed as isSubStatusFixedFn,
} from "@/lib/support-status-constants";

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
  createdAt: string;
  updatedAt: string;
};

type JimuSession = {
  id: string;
  token: string;
  candidateName: string | null;
  state: AppState;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type AppState = {
  currentScreen: number;
  candidateName: string;
  answers: { q1: string; q2: string };
  freeTexts: { q1?: string; q2?: string };
  storyResponses: { q1: string; q2: string; q3: string };
  quizResults: { questionNumber: number; selectedAnswer: string; correct: boolean; scene: string }[];
  reflection: {
    mostImpressiveScenario: number | null;
    whyImpressive: string;
    pastExperience: string;
    happiestMoment: string;
  };
  reportText: string;
};

type Candidate = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  supportStatus: string;
  supportSubStatus: string | null;
  supportSubStatusManual: boolean;
  supportEndReason: string | null;
  supportEndComment: string | null;
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
  { key: "interview", label: "面談履歴" },
  { key: "history", label: "紹介履歴" },
  { key: "documents", label: "書類" },
  { key: "tasks", label: "タスク" },
  { key: "support", label: "対策・サポート" },
  { key: "notes", label: "メモ" },
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
  const [isFuriganaComposing, setIsFuriganaComposing] = useState(false);
  const [candidateNo, setCandidateNo] = useState(candidate.candidateNumber);
  const [email, setEmail] = useState(candidate.email || "");
  const [phone, setPhone] = useState(candidate.phone || "");
  const [address, setAddress] = useState(candidate.address || "");
  const [gender, setGender] = useState(candidate.gender || "");
  const [birthday, setBirthday] = useState(candidate.birthday ? new Date(candidate.birthday).toISOString().slice(0, 10) : "");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState(
    candidate.employeeId || ""
  );
  const [saving, setSaving] = useState(false);

  const calcAge = (bd: string) => {
    if (!bd) return "";
    const today = new Date();
    const birth = new Date(bd);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return `${age}歳`;
  };

  const handleSave = async () => {
    if (!name.trim() || !furigana.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateNumber: candidateNo.trim(),
          name: name.trim(),
          furigana: furigana.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          gender: gender || null,
          birthday: birthday || null,
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
        className="bg-white rounded-[8px] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
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
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">求職者番号</label>
              <input type="text" value={candidateNo} onChange={(e) => setCandidateNo(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
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
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                氏名 <span className="text-red-500">*</span>
              </label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">
                フリガナ <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={furigana}
                onCompositionStart={() => setIsFuriganaComposing(true)}
                onCompositionEnd={(e) => { setIsFuriganaComposing(false); setFurigana(e.currentTarget.value.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))); }}
                onChange={(e) => setFurigana(isFuriganaComposing ? e.target.value : e.target.value.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)))}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">生年月日</label>
              <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">年齢</label>
              <input type="text" value={calcAge(birthday)} readOnly disabled className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-100 text-gray-500" />
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
              <label className="block text-[13px] font-medium text-[#374151] mb-1">電話番号</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
            </div>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">メールアドレス</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#374151] mb-1">住所</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={onClose}
              className="border border-gray-300 bg-white text-gray-700 rounded-md px-6 py-2.5 text-[13px] hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !furigana.trim()}
              className="bg-[#2563EB] text-white rounded-md px-6 py-2.5 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
/*  Tab: Interview                                                      */
/* ================================================================== */
function InterviewTab({
  candidate,
  guideData,
}: {
  candidate: Candidate;
  guideData: Record<string, unknown> | null;
}) {
  const interviewGuide = candidate.guideEntries.find(
    (e) => e.guideType === "INTERVIEW"
  );
  const data = (guideData || {}) as Record<string, unknown>;
  const [appUrl, setAppUrl] = useState("");

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

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
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-[#374151]">
          面接対策ガイド
        </h3>
        <Link
          href={`/candidates/${candidate.id}/guides/interview`}
          className="inline-flex items-center gap-2 bg-[#003366] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#002244] transition-colors"
        >
          📖 面接対策ガイドを開く
        </Link>
      </div>

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

    </div>
  );
}

/* ================================================================== */
/*  Q1/Q2 option labels                                                 */
/* ================================================================== */
const Q1_LABELS: Record<string, string> = {
  condition: "土日休み・残業の少なさなど、働き方の条件が合うと思った",
  personality: "几帳面・コツコツ作業が得意で、自分に向いていると思った",
  support: "誰かをサポートする・縁の下で支える仕事がしたい",
  other: "その他",
};
const Q2_LABELS: Record<string, string> = {
  u1: "正確さ。ミスなく仕事をやり遂げたい",
  u2: "スピード。頼まれたことに素早く対応したい",
  u3: "気配り。周りが動きやすいよう先回りしたい",
  u4: "安定。無理なく長く続けられる働き方をしたい",
  u5: "その他",
};
const SCENARIO_LABELS: Record<number, string> = {
  1: "取締役会議の資料更新（正確さ）",
  2: "急ぎの見積書作成（スピード × 正確さ）",
  3: "他部署への経費精算フォロー（社内調整）",
  4: "契約書の金額ミス発見（気づきと先回り）",
  5: "3つの同時依頼の優先判断（マルチタスク）",
};
const REFLECTION_LABELS: Record<number, string> = {
  1: "問1：取締役会議の資料更新（正確さ）",
  2: "問2：急ぎの見積書作成（スピード × 正確さ）",
  3: "問3：他部署への経費精算フォロー（社内調整）",
  4: "問4：契約書の金額ミス発見（気づきと先回り）",
  5: "問5：3つの同時依頼の優先判断（マルチタスク）",
};

/* ================================================================== */
/*  Tab: Counseling (面談サポート)                                       */
/* ================================================================== */
function CounselingTab({
  candidate,
  jimuSessions,
  onJimuCreated,
}: {
  candidate: Candidate;
  jimuSessions: JimuSession[];
  onJimuCreated: () => void;
}) {
  const [jimuGenerating, setJimuGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(
    jimuSessions.length > 0 ? jimuSessions[0].id : null
  );
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleGenerateJimu = async () => {
    setJimuGenerating(true);
    try {
      const res = await fetch("/api/jimu/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName: candidate.name,
          candidateId: candidate.id,
        }),
      });
      if (!res.ok) throw new Error();
      onJimuCreated();
    } catch {
      alert("事務職診断URLの生成に失敗しました");
    } finally {
      setJimuGenerating(false);
    }
  };

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${appUrl}/j/${token}`);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch { /* silent */ }
  };

  const getProgress = (state: AppState) => {
    const total = 10;
    return Math.min(state.currentScreen, total);
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold text-[#374151]">
          事務職診断
        </h3>
        <button
          onClick={handleGenerateJimu}
          disabled={jimuGenerating}
          className="inline-flex items-center gap-2 bg-[#003366] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#002244] transition-colors disabled:opacity-50"
        >
          {jimuGenerating ? "生成中..." : "診断URLを生成"}
        </button>
      </div>

      {jimuSessions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-[13px] text-gray-400">
          まだ事務職診断が作成されていません。「診断URLを生成」ボタンからURLを発行してください。
        </div>
      ) : (
        <div className="space-y-4">
          {jimuSessions.map((session) => {
            const state = session.state;
            const progress = getProgress(state);
            const isCompleted = session.completedAt !== null || progress >= 10;
            const isExpanded = expandedSession === session.id;

            return (
              <div key={session.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* セッションヘッダー */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                      isCompleted
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {isCompleted ? "完了" : `進行中 (${progress}/10)`}
                    </span>
                    <span className="text-[13px] text-gray-600">
                      {formatDateTime(session.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(session.token); }}
                      className={`border rounded-md px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors ${
                        copiedToken === session.token
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {copiedToken === session.token ? "コピー済" : "URLをコピー"}
                    </button>
                    <span className="text-gray-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* 診断結果（展開時） */}
                {isExpanded && (
                  <JimuSessionDetail state={state} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  JimuSessionDetail - 診断結果表示                                    */
/* ================================================================== */
function JimuSessionDetail({ state }: { state: AppState }) {
  const q1Label = Q1_LABELS[state.answers.q1] || state.answers.q1;
  const q2Label = Q2_LABELS[state.answers.q2] || state.answers.q2;

  return (
    <div className="border-t border-gray-200 p-4 space-y-5">
      {/* Q1 */}
      <div>
        <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
          Q1. 事務を目指した理由
        </h4>
        <div className="bg-gray-50 rounded-lg p-3">
          {state.answers.q1 ? (
            <>
              <p className="text-[13px] text-gray-700">{q1Label}</p>
              {state.answers.q1 === "other" && state.freeTexts.q1 && (
                <p className="text-[13px] text-gray-600 mt-1 pl-3 border-l-2 border-gray-300">
                  {state.freeTexts.q1}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-gray-400">未回答</p>
          )}
        </div>
      </div>

      {/* Q2 */}
      <div>
        <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
          Q2. 事務の仕事で大切にしたいこと
        </h4>
        <div className="bg-gray-50 rounded-lg p-3">
          {state.answers.q2 ? (
            <>
              <p className="text-[13px] text-gray-700">{q2Label}</p>
              {state.answers.q2 === "u5" && state.freeTexts.q2 && (
                <p className="text-[13px] text-gray-600 mt-1 pl-3 border-l-2 border-gray-300">
                  {state.freeTexts.q2}
                </p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-gray-400">未回答</p>
          )}
        </div>
      </div>

      {/* ストーリー回答 */}
      {(state.storyResponses.q1 || state.storyResponses.q2 || state.storyResponses.q3) && (
        <div>
          <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
            ストーリー回答
          </h4>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            {["q1", "q2", "q3"].map((key, idx) => {
              const val = state.storyResponses[key as keyof typeof state.storyResponses];
              return val ? (
                <div key={key} className="text-[13px]">
                  <span className="text-gray-500">質問{idx + 1}:</span>{" "}
                  <span className="text-gray-700">{val}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* シナリオクイズ結果 */}
      {state.quizResults.length > 0 && (
        <div>
          <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
            シナリオクイズ結果（{state.quizResults.filter(r => r.correct).length}/{state.quizResults.length} 正解）
          </h4>
          <div className="space-y-2">
            {state.quizResults.map((result) => (
              <div key={result.questionNumber} className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                <span className={`text-[13px] font-bold ${result.correct ? "text-green-600" : "text-red-500"}`}>
                  {result.correct ? "○" : "×"}
                </span>
                <div className="text-[13px]">
                  <span className="text-gray-500">
                    問{result.questionNumber}:
                  </span>{" "}
                  <span className="text-gray-700">
                    {SCENARIO_LABELS[result.questionNumber] || result.scene}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 振り返り */}
      {(state.reflection.mostImpressiveScenario !== null || state.reflection.whyImpressive || state.reflection.pastExperience) && (
        <div>
          <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
            振り返り
          </h4>
          <div className="bg-gray-50 rounded-lg p-3 space-y-3">
            {state.reflection.mostImpressiveScenario !== null && (
              <div>
                <p className="text-[12px] text-gray-500 mb-0.5">最も印象に残ったシナリオ</p>
                <p className="text-[13px] text-gray-700">
                  {REFLECTION_LABELS[state.reflection.mostImpressiveScenario] || `問${state.reflection.mostImpressiveScenario}`}
                </p>
              </div>
            )}
            {state.reflection.whyImpressive && (
              <div>
                <p className="text-[12px] text-gray-500 mb-0.5">印象に残った理由</p>
                <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{state.reflection.whyImpressive}</p>
              </div>
            )}
            {state.reflection.pastExperience && (
              <div>
                <p className="text-[12px] text-gray-500 mb-0.5">過去の近い経験</p>
                <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{state.reflection.pastExperience}</p>
              </div>
            )}
            {state.reflection.happiestMoment && (
              <div>
                <p className="text-[12px] text-gray-500 mb-0.5">一番うれしかった瞬間</p>
                <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{state.reflection.happiestMoment}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AIレポート */}
      {state.reportText && (
        <div>
          <h4 className="text-[13px] font-semibold text-[#374151] mb-2">
            AIレポート
          </h4>
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{state.reportText}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab: Schedule (日程調整)                                             */
/* ================================================================== */
function ScheduleTab({
  candidate,
  currentUser,
  onRefresh,
}: {
  candidate: Candidate;
  currentUser: SessionUser | null;
  onRefresh: () => void;
}) {
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
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
    <div>
      {/* 日程調整URLセクション */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            日程調整URL
          </h3>
          <button
            onClick={() => setScheduleModalOpen(true)}
            className="text-[12px] bg-[#003366] text-white rounded-md px-3 py-1.5 font-medium hover:bg-[#002244] transition-colors"
          >
            URLを生成
          </button>
        </div>
        <p className="text-[12px] text-gray-400">
          面談・面接の日程調整URLを生成します。
        </p>
      </div>

      <InterviewUrlModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        candidateName={candidate.name}
        advisorName={candidate.employee?.name ?? null}
      />

      {/* メモセクション */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[#374151]">
            メモ
          </h3>
          <span className="text-[12px] text-gray-500">
            ({candidate.notes.length}件)
          </span>
        </div>

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
              {posting ? "投稿中..." : "投稿する"}
            </button>
          </div>
        </div>

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
                      削除
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
    </div>
  );
}

/* ================================================================== */
/*  Candidate Tasks Tab                                                 */
/* ================================================================== */
const TASK_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "未着手",
  IN_PROGRESS: "対応中",
  COMPLETED: "完了",
};
const TASK_STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
};
const TASK_PRIORITY_LABEL: Record<string, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};
const TASK_PRIORITY_COLOR: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-yellow-100 text-yellow-700",
  LOW: "bg-gray-100 text-gray-600",
};

type CandidateTask = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  createdAt: string;
  category: { id: string; name: string } | null;
  assignees: { employee: { name: string } }[];
};

function CandidateTasksTab({ candidateId }: { candidateId: string }) {
  const [tasks, setTasks] = useState<CandidateTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeCompleted) params.set("includeCompleted", "true");
      const res = await fetch(`/api/candidates/${candidateId}/tasks?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [candidateId, includeCompleted]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const fmtDate = (d: string | null) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ja-JP");
  };

  const isOverdue = (d: string | null, status: string) => {
    if (!d || status === "COMPLETED") return false;
    return new Date(d) < new Date(new Date().toDateString());
  };

  return (
    <div>
      {/* header: create button + toggle */}
      <div className="mb-4 flex items-center justify-between">
        <a
          href={`/tasks/new?candidateId=${candidateId}`}
          className="rounded-[8px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#1D4ED8]"
        >
          タスクを作成
        </a>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#374151]">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
            className="h-4 w-4 accent-[#2563EB]"
          />
          完了タスクを表示
        </label>
      </div>

      {/* table */}
      <div className="overflow-x-auto rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[12px] font-medium text-[#6B7280]">
              <th className="whitespace-nowrap px-4 py-3">ステータス</th>
              <th className="whitespace-nowrap px-4 py-3">タスクタイトル</th>
              <th className="whitespace-nowrap px-4 py-3">カテゴリ</th>
              <th className="whitespace-nowrap px-4 py-3">担当者</th>
              <th className="whitespace-nowrap px-4 py-3">優先度</th>
              <th className="whitespace-nowrap px-4 py-3">期限</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[#6B7280]">
                  読み込み中...
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-[#6B7280]">この求職者に紐づくタスクはありません</p>
                  <a
                    href={`/tasks/new?candidateId=${candidateId}`}
                    className="mt-3 inline-block rounded-[8px] bg-[#2563EB] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#1D4ED8]"
                  >
                    タスクを作成
                  </a>
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr
                  key={t.id}
                  className={`border-b border-[#F3F4F6] transition-colors hover:bg-[#F9FAFB] ${t.status === "COMPLETED" ? "opacity-50" : ""}`}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_STATUS_COLOR[t.status] ?? ""}`}>
                      {TASK_STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a href={`/tasks/${t.id}`} className="font-medium text-[#2563EB] hover:underline">
                      {t.title}
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[#6B7280]">
                    {t.category?.name ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[#374151]">
                    {t.assignees.map((a) => a.employee.name).join("、") || "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {t.priority ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TASK_PRIORITY_COLOR[t.priority] ?? ""}`}>
                        {TASK_PRIORITY_LABEL[t.priority] ?? t.priority}
                      </span>
                    ) : "-"}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 ${isOverdue(t.dueDate, t.status) ? "font-medium text-red-600" : "text-[#374151]"}`}>
                    {fmtDate(t.dueDate)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Tab: Support (対策・サポート)                                          */
/* ================================================================== */
function SupportTab({
  candidate,
  guideData,
  jimuSessions,
  onJimuCreated,
}: {
  candidate: Candidate;
  guideData: Record<string, unknown> | null;
  jimuSessions: JimuSession[];
  onJimuCreated: () => void;
}) {
  const [subTab, setSubTab] = useState<"interview" | "counseling">("interview");

  return (
    <div>
      {/* サブタブバー */}
      <div className="bg-gray-50 rounded-lg p-1 inline-flex gap-1 mb-6">
        <button
          onClick={() => setSubTab("interview")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer ${
            subTab === "interview"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500"
          }`}
        >
          面接対策
        </button>
        <button
          onClick={() => setSubTab("counseling")}
          className={`px-4 py-2 text-sm font-medium rounded-md cursor-pointer ${
            subTab === "counseling"
              ? "bg-white text-[#2563EB] shadow-sm"
              : "text-gray-500"
          }`}
        >
          面談
        </button>
      </div>

      {subTab === "interview" && (
        <InterviewTab candidate={candidate} guideData={guideData} />
      )}
      {subTab === "counseling" && (
        <CounselingTab
          candidate={candidate}
          jimuSessions={jimuSessions}
          onJimuCreated={onJimuCreated}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Placeholder tabs                                                    */
/* ================================================================== */
/* ================================================================== */
/*  Tab: Notes (メモ)                                                    */
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
      const res = await fetch(`/api/candidates/${candidate.id}/notes/${noteId}`, { method: "DELETE" });
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
    return currentUser.id === note.authorUserId || currentUser.role === "admin";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold text-[#374151]">📝 メモ</h3>
        <span className="text-[12px] text-gray-500">({candidate.notes.length}件)</span>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
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

      {candidate.notes.length > 0 ? (
        <div className="space-y-3">
          {candidate.notes.map((note) => (
            <div key={note.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[#374151]">{note.author.name}</span>
                <span className="text-[12px] text-gray-500">{formatDateTime(note.createdAt)}</span>
              </div>
              <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{note.content}</p>
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
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-[13px] text-gray-400">
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
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto" />
            <p className="mt-3 text-[14px] text-gray-500">読み込み中...</p>
          </div>
        </div>
      }
    >
      <CandidateDetailPageInner />
    </Suspense>
  );
}

function CandidateDetailPageInner() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-[#2563EB] border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-[14px] text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  return <CandidateDetailPageBody />;
}

function CandidateDetailPageBody() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "interview";

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>(
    []
  );
  const [guideData, setGuideData] = useState<Record<string, unknown> | null>(
    null
  );
  const [jimuSessions, setJimuSessions] = useState<JimuSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleMethod, setScheduleMethod] = useState("");
  const [scheduleGenerating, setScheduleGenerating] = useState(false);
  const [scheduleCopiedType, setScheduleCopiedType] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState("");
  const [jobOutputLoading, setJobOutputLoading] = useState(false);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState(false);
  const [mypageUrl, setMypageUrl] = useState<string | null>(null);
  const [mypageAdminUrl, setMypageAdminUrl] = useState<string | null>(null);
  const [mypageAccessCount, setMypageAccessCount] = useState<number | null>(null);
  const [mypageExpiresAt, setMypageExpiresAt] = useState<string | null>(null);
  const [mypageLoading, setMypageLoading] = useState(true);
  const [mypageModalOpen, setMypageModalOpen] = useState(false);
  const [mypageCopied, setMypageCopied] = useState(false);

  const handleOpenJobOutput = async () => {
    if (jobOutputLoading) return;
    setJobOutputLoading(true);
    const fallbackUrl = "https://web-production-95808.up.railway.app/projects";
    try {
      const res = await fetch(`/api/candidates/${candidateId}/jobs`);
      const data = await res.json();
      if (data.project_id) {
        window.open(`https://web-production-95808.up.railway.app/projects/${data.project_id}`, "_blank");
      } else {
        window.open(fallbackUrl, "_blank");
      }
    } catch {
      window.open(fallbackUrl, "_blank");
    } finally {
      setJobOutputLoading(false);
    }
  };

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

  const fetchGuideData = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/candidates/${candidateId}/guides/interview`
      );
      if (res.ok) {
        const json = await res.json();
        if (json.guideEntry?.data) {
          setGuideData(json.guideEntry.data as Record<string, unknown>);
        }
      }
    } catch {
      // silent
    }
  }, [candidateId]);

  const fetchJimuSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${candidateId}/jimu-sessions`);
      if (res.ok) {
        const json = await res.json();
        setJimuSessions(json.sessions || []);
      }
    } catch {
      // silent
    }
  }, [candidateId]);

  useEffect(() => {
    fetchCandidate();
    fetchGuideData();
    fetchJimuSessions();
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
    fetch(`/api/candidates/${candidateId}/mypage`)
      .then((r) => r.json())
      .then((data) => {
        console.log("[mypage-client] fetched:", data);
        setMypageUrl(data.url ?? null);
        setMypageAdminUrl(data.adminUrl ?? null);
        setMypageAccessCount(data.accessCount ?? null);
        setMypageExpiresAt(data.expiresAt ?? null);
      })
      .catch((e) => {
        console.error("[mypage-client] fetch error:", e);
      })
      .finally(() => setMypageLoading(false));
  }, [fetchCandidate, fetchGuideData, fetchJimuSessions, candidateId]);

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
      <Toaster position="bottom-center" richColors />

      {/* パンくず + 検索 */}
      <div className="flex items-center gap-4 mb-3">
        <Link
          href="/admin/master"
          className="text-[13px] text-[#2563EB] hover:underline"
        >
          ← 求職者一覧に戻る
        </Link>
        <CandidateQuickSearch />
      </div>

      {/* スティッキーヘッダ */}
      <CandidateHeader
        candidate={candidate}
        onStatusChange={async (val) => {
          await fetch(`/api/candidates/${candidate.id}/update`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ supportStatus: val }),
          });
          fetchCandidate();
        }}
        onSubStatusChange={async (val) => {
          await fetch(`/api/candidates/${candidate.id}/update`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ supportSubStatus: val }),
          });
          fetchCandidate();
        }}
        onEditBasicInfo={() => setEditModalOpen(true)}
        onGuideUrlCopy={() => {
          const guide = candidate.guideEntries.find((e) => e.guideType === "INTERVIEW");
          if (guide) {
            const url = `${window.location.origin}/g/${guide.token}`;
            navigator.clipboard.writeText(url);
          }
        }}
        onScheduleOpen={() => { setScheduleModalOpen(true); setScheduleMethod(""); setScheduleError(""); setScheduleCopiedType(null); }}
        onJobOutput={handleOpenJobOutput}
        onMypageOpen={() => {
          setMypageModalOpen(true);
          fetch(`/api/candidates/${candidateId}/sync-ca-comments`, { method: "POST" })
            .then((r) => r.json())
            .then((r) => console.log("[SyncCaComments]", r))
            .catch(() => {});
        }}
        hasGuideUrl={!!candidate.guideEntries.find((e) => e.guideType === "INTERVIEW")}
        mypageLoading={mypageLoading}
        jobOutputLoading={jobOutputLoading}
        supportEndReasonLabel={candidate.supportEndReason ? (REASON_LABEL_MAP[candidate.supportEndReason] || candidate.supportEndReason) : undefined}
        onSupportEndClick={() => setShowEndModal(true)}
        subStatusOptions={SUPPORT_SUB_STATUS_MAP[candidate.supportStatus] || []}
        isSubStatusFixed={isSubStatusFixedFn(candidate.supportStatus)}
      />

      {/* タブバー */}
      <div className="flex border-b border-gray-200 mt-4">
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
        {activeTab === "interview" && (
          <InterviewHistoryTab
            candidateId={candidateId}
            currentUser={currentUser}
          />
        )}
        {activeTab === "documents" && (
          <DocumentsTab candidateId={candidateId} />
        )}
        {activeTab === "support" && (
          <SupportTab
            candidate={candidate}
            guideData={guideData}
            jimuSessions={jimuSessions}
            onJimuCreated={fetchJimuSessions}
          />
        )}
        {activeTab === "tasks" && (
          <CandidateTasksTab candidateId={candidateId} />
        )}
        {activeTab === "history" && (
          <HistoryTab candidateId={candidateId} />
        )}
        {activeTab === "notes" && (
          <NotesTab
            candidate={candidate}
            currentUser={currentUser}
            onRefresh={fetchCandidate}
          />
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

      {/* 求人マイページモーダル */}
      {mypageModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => { setMypageModalOpen(false); setMypageCopied(false); }}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[15px] font-bold text-[#374151]">📱 求人マイページ</h2>
              <button onClick={() => { setMypageModalOpen(false); setMypageCopied(false); }} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>

            {mypageUrl ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">URL</label>
                  <input
                    type="text"
                    readOnly
                    value={mypageUrl}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 bg-gray-50 select-all focus:outline-none focus:border-[#2563EB]"
                    onFocus={(e) => e.target.select()}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(mypageUrl);
                      setMypageCopied(true);
                      setTimeout(() => setMypageCopied(false), 2000);
                    }}
                    className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    {mypageCopied ? "✅ コピーしました" : "📋 URLをコピー"}
                  </button>
                  <button
                    onClick={() => window.open(mypageAdminUrl || mypageUrl, "_blank")}
                    className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    🔗 管理者プレビュー
                  </button>
                </div>

                <div className="flex gap-4 text-sm text-gray-500">
                  {mypageAccessCount != null && (
                    <span>閲覧回数: {mypageAccessCount}回</span>
                  )}
                  {mypageExpiresAt && (
                    <span>有効期限: {new Date(mypageExpiresAt).toLocaleDateString("ja-JP")}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-gray-500">マイページが未生成です。求人出力ページで生成してください。</p>
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => { setMypageModalOpen(false); setMypageCopied(false); }}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-5 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 日程調整URLモーダル */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setScheduleModalOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[15px] font-bold text-[#374151]">📅 日程調整URLを生成</h2>
              <button onClick={() => setScheduleModalOpen(false)} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
            </div>

            {scheduleError && (
              <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">{scheduleError}</div>
            )}

            {/* 面接希望日の回収 */}
            <div>
              <h3 className="font-bold text-[#003366] text-base mb-2">面接希望日の回収</h3>
              <p className="text-sm text-gray-500 mb-3">求職者に面接の希望日時を提出してもらいます。</p>

              <label className="block text-sm font-medium text-[#374151] mb-2">面接方式 <span className="text-red-500">*</span></label>
              <div className="flex gap-4 mb-4">
                {[
                  { value: "in-person", label: "対面" },
                  { value: "online", label: "オンライン" },
                  { value: "flexible", label: "どちらでも可" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="interviewMethod"
                      value={opt.value}
                      checked={scheduleMethod === opt.value}
                      onChange={(e) => setScheduleMethod(e.target.value)}
                      className="accent-[#2563EB]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>

              <button
                onClick={async () => {
                  if (!scheduleMethod || scheduleGenerating || !currentUser) return;
                  setScheduleGenerating(true);
                  setScheduleError("");
                  try {
                    const res = await fetch("/api/schedule-links", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        type: "interview",
                        candidateName: candidate.name,
                        advisorName: currentUser.name,
                        interviewMethod: scheduleMethod,
                      }),
                    });
                    if (!res.ok) throw new Error();
                    const data = await res.json();
                    await navigator.clipboard.writeText(data.url);
                    setScheduleCopiedType("interview");
                    setTimeout(() => setScheduleCopiedType(null), 2000);
                  } catch {
                    setScheduleError("URL生成に失敗しました");
                  } finally {
                    setScheduleGenerating(false);
                  }
                }}
                disabled={!scheduleMethod || scheduleGenerating}
                className="bg-[#2563EB] text-white rounded-lg px-4 py-2.5 text-sm font-medium w-full hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {scheduleCopiedType === "interview" ? "✅ URLをコピーしました" : scheduleGenerating ? "生成中..." : "面接希望日の回収URLを生成"}
              </button>
            </div>

            <div className="border-t border-gray-200 my-6" />

            {/* 面談調整 */}
            <div>
              <h3 className="font-bold text-[#003366] text-base mb-2">面談調整</h3>
              <p className="text-sm text-gray-500 mb-3">求職者に面談の希望日時を提出してもらいます。</p>
              <p className="text-xs text-gray-400 mb-4">※ 面談形式（電話/オンライン）は求職者が選択します。</p>

              <button
                onClick={async () => {
                  if (scheduleGenerating || !currentUser) return;
                  setScheduleGenerating(true);
                  setScheduleError("");
                  try {
                    const res = await fetch("/api/schedule-links", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        type: "consultation",
                        candidateName: candidate.name,
                        advisorName: currentUser.name,
                        interviewMethod: "",
                      }),
                    });
                    if (!res.ok) throw new Error();
                    const data = await res.json();
                    await navigator.clipboard.writeText(data.url);
                    setScheduleCopiedType("consultation");
                    setTimeout(() => setScheduleCopiedType(null), 2000);
                  } catch {
                    setScheduleError("URL生成に失敗しました");
                  } finally {
                    setScheduleGenerating(false);
                  }
                }}
                disabled={scheduleGenerating}
                className="bg-[#2563EB] text-white rounded-lg px-4 py-2.5 text-sm font-medium w-full hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
              >
                {scheduleCopiedType === "consultation" ? "✅ URLをコピーしました" : scheduleGenerating ? "生成中..." : "面談調整URLを生成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Advisor floating button */}
      {!isAdvisorOpen && (
        <button
          onClick={() => setIsAdvisorOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg w-14 h-14 flex items-center justify-center transition-all hover:scale-105"
        >
          <span className="text-2xl">🤖</span>
        </button>
      )}

      {/* AI Advisor floating panel */}
      <AdvisorFloatingPanel
        candidateId={candidateId}
        candidateName={candidate.name}
        isOpen={isAdvisorOpen}
        onClose={() => setIsAdvisorOpen(false)}
      />

      {showEndModal && (
        <SupportEndModal
          candidateId={candidateId}
          initialComment={candidate?.supportEndComment}
          onClose={() => setShowEndModal(false)}
          onSaved={fetchCandidate}
        />
      )}
    </div>
  );
}
