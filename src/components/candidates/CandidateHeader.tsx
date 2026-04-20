"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";

type Candidate = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  gender: string | null;
  supportStatus: string;
  supportSubStatus: string | null;
  supportSubStatusManual: boolean;
  supportEndReason: string | null;
  supportEndComment: string | null;
  employeeId: string | null;
  employee: { id: string; name: string } | null;
  createdAt: string;
};

interface CandidateHeaderProps {
  candidate: Candidate;
  onStatusChange: (status: string) => void;
  onSubStatusChange: (subStatus: string) => void;
  onEditBasicInfo: () => void;
  onGuideUrlCopy: () => void;
  onScheduleOpen: () => void;
  onJobOutput: () => void;
  onMypageOpen: () => void;
  hasGuideUrl: boolean;
  mypageLoading: boolean;
  jobOutputLoading: boolean;
  supportEndReasonLabel?: string;
  onSupportEndClick: () => void;
  subStatusOptions: string[];
  isSubStatusFixed: boolean;
}

function genderLabel(g: string | null) {
  if (!g) return "未設定";
  switch (g) {
    case "male": return "男性";
    case "female": return "女性";
    case "other": return "その他";
    default: return "未設定";
  }
}

function calcAge(bd: string | null): number | null {
  if (!bd) return null;
  const today = new Date();
  const birth = new Date(bd);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatBirthday(bd: string): string {
  const d = new Date(bd);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatRegistrationDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function CopyableText({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children: React.ReactNode;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`コピーしました: ${label}`);
    } catch {
      // silent
    }
  };

  return (
    <span
      className="group inline-flex items-center gap-1 cursor-pointer hover:bg-blue-50 rounded px-1.5 py-0.5 transition"
      onClick={handleCopy}
    >
      {children}
      <svg
        className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="2" />
      </svg>
    </span>
  );
}

export default function CandidateHeader({
  candidate,
  onStatusChange,
  onSubStatusChange,
  onEditBasicInfo,
  onGuideUrlCopy,
  onScheduleOpen,
  onJobOutput,
  onMypageOpen,
  hasGuideUrl,
  mypageLoading,
  jobOutputLoading,
  supportEndReasonLabel,
  onSupportEndClick,
  subStatusOptions,
  isSubStatusFixed,
}: CandidateHeaderProps) {
  const [urlCopied, setUrlCopied] = useState(false);
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    setAge(calcAge(candidate.birthday));
  }, [candidate.birthday]);

  const handleGuideUrlCopy = () => {
    onGuideUrlCopy();
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  };

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
      {/* Row 1: Name + Meta + Status/Rank/Edit */}
      <div className="px-6 pt-4 pb-2">
        <div className="flex items-start justify-between">
          {/* Left: Name block */}
          <div className="flex items-center gap-6 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <CopyableText text={candidate.name} label={candidate.name}>
                  <h1 className="text-[19px] font-bold text-[#374151] truncate">
                    {candidate.name}
                  </h1>
                </CopyableText>
              </div>
              <div className="flex items-center gap-2 text-[13px] text-gray-500 mt-0.5 flex-wrap">
                {candidate.nameKana && (
                  <span>{candidate.nameKana}</span>
                )}
                <span className="text-gray-300">|</span>
                <CopyableText text={candidate.candidateNumber} label={`ID:${candidate.candidateNumber}`}>
                  <span>ID:{candidate.candidateNumber}</span>
                </CopyableText>
                <span className="text-gray-300">|</span>
                <span>登録日:{formatRegistrationDate(candidate.createdAt)}</span>
                <span className="text-gray-300">|</span>
                <span>担当:{candidate.employee?.name || "未設定"}</span>
              </div>
            </div>
          </div>

          {/* Right: Status + Edit */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {candidate.supportStatus === "ENDED" ? (
              <>
                <button
                  onClick={onSupportEndClick}
                  className="w-[130px] h-8 rounded-md px-3 text-[13px] font-medium border cursor-pointer bg-red-100 text-red-600 border-red-200 hover:bg-red-200 truncate"
                >
                  支援終了{supportEndReasonLabel ? `(${supportEndReasonLabel})` : ""}
                </button>
                <button
                  onClick={() => {
                    if (confirm("この求職者の支援状況を「支援中」に戻しますか？")) {
                      onStatusChange("ACTIVE");
                    }
                  }}
                  className="h-8 rounded-md px-3 text-[13px] font-medium border cursor-pointer bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200"
                >
                  支援中に戻す
                </button>
              </>
            ) : (
              <>
                <select
                  aria-label="支援状況"
                  value={candidate.supportStatus || "BEFORE"}
                  onChange={(e) => {
                    if (e.target.value === "ENDED") {
                      onSupportEndClick();
                    } else {
                      onStatusChange(e.target.value);
                    }
                  }}
                  className={`w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border cursor-pointer ${
                    candidate.supportStatus === "ACTIVE" ? "bg-blue-100 text-blue-700 border-blue-200" :
                    candidate.supportStatus === "WAITING" ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
                    "bg-gray-100 text-gray-600 border-gray-300"
                  }`}
                >
                  <option value="BEFORE">支援前</option>
                  <option value="ACTIVE">支援中</option>
                  <option value="WAITING">待機</option>
                  <option value="ENDED">支援終了</option>
                </select>

                {isSubStatusFixed || subStatusOptions.length <= 1 ? (
                  <span className="inline-flex items-center justify-center w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border bg-gray-50 text-gray-700 border-gray-200 truncate">
                    {candidate.supportSubStatus || subStatusOptions[0] || "-"}
                  </span>
                ) : (
                  <select
                    aria-label="ステータス"
                    value={candidate.supportSubStatus || ""}
                    onChange={(e) => onSubStatusChange(e.target.value)}
                    className="w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border cursor-pointer bg-white text-gray-700 border-gray-300"
                  >
                    {!candidate.supportSubStatus && (
                      <option value="" disabled>-</option>
                    )}
                    {subStatusOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <button
              onClick={onEditBasicInfo}
              className="w-[130px] h-8 bg-white border border-gray-300 text-gray-700 rounded-md px-2 text-[13px] font-medium hover:bg-gray-50 transition-colors truncate"
            >
              基本情報編集
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Contact info (all copyable) */}
      <div className="px-6 pb-2">
        <div className="flex items-center gap-3 text-[13px] text-gray-600 flex-wrap">
          {candidate.birthday && (
            <CopyableText
              text={(() => {
                const d = new Date(candidate.birthday!);
                return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
              })()}
              label="生年月日"
            >
              <span>🎂 {formatBirthday(candidate.birthday)}{age !== null ? ` (${age}歳)` : ""}</span>
            </CopyableText>
          )}
          <span className="text-gray-300">|</span>
          <span>性別:{genderLabel(candidate.gender)}</span>
          {candidate.phone && (
            <>
              <span className="text-gray-300">|</span>
              <CopyableText text={candidate.phone} label={candidate.phone}>
                <span>📞 {candidate.phone}</span>
              </CopyableText>
            </>
          )}
          {candidate.email && (
            <>
              <span className="text-gray-300">|</span>
              <CopyableText text={candidate.email} label={candidate.email}>
                <span>📧 {candidate.email}</span>
              </CopyableText>
            </>
          )}
          {candidate.address && (
            <>
              <span className="text-gray-300">|</span>
              <CopyableText text={candidate.address} label={candidate.address}>
                <span>📍 {candidate.address}</span>
              </CopyableText>
            </>
          )}
        </div>
      </div>

      {/* Row 3: URL / Resource buttons */}
      <div className="px-6 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-gray-400 mr-1">URL・資料:</span>
          {mypageLoading ? (
            <span className="inline-block border border-gray-200 bg-gray-50 rounded-md px-3 py-1 text-[12px] text-gray-400 animate-pulse">
              求人マイページ
            </span>
          ) : (
            <button
              onClick={onMypageOpen}
              className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors"
            >
              求人マイページ
            </button>
          )}
          {hasGuideUrl && (
            <button
              onClick={handleGuideUrlCopy}
              className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors"
            >
              {urlCopied ? "コピー済み" : "ガイドURL"}
            </button>
          )}
          <button
            onClick={onScheduleOpen}
            className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors"
          >
            日程調整URL
          </button>
          <button
            onClick={onJobOutput}
            disabled={jobOutputLoading}
            className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {jobOutputLoading ? "読み込み中..." : "求人出力"}
          </button>
        </div>
      </div>
    </div>
  );
}
