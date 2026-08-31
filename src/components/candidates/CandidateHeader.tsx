"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import IssueSiteTokenButton from "@/components/candidates/IssueSiteTokenButton";
import SitePreviewButton from "@/components/candidates/SitePreviewButton";

// T-182: 求人出力（kyuujinPDF）廃止に伴い「求人マイページ」「求人出力」ボタンを非表示。
// コードは残し描画だけ止める。復活時はここを true に戻す。
const SHOW_LEGACY_KYUUJIN_UI = false;

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
  supportEndReason: string | null;
  supportEndComment: string | null;
  employeeId: string | null;
  employee: { id: string; name: string } | null;
  recruiterName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
  scoutNumber: string | null;
  desiredJobType1: string | null;
  desiredJobType2: string | null;
  desiredIndustry1: string | null;
  desiredIndustry2: string | null;
  desiredPrefecture1: string | null;
  desiredPrefecture2: string | null;
  desiredEmploymentType: string | null;
  desiredSalaryMin: number | null;
  autoRecommendEnabled: boolean;
  createdAt: string;
};

interface CandidateHeaderProps {
  candidate: Candidate;
  onStatusChange: (status: string) => void;
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
  onGoogleFormCreate?: () => void;
  googleFormDisabled?: boolean;
  googleFormDisabledReason?: string;
  oneDriveFolderUrl?: string | null;
  /** T-159 Phase 4: 即時同期の完了後に呼ぶ。求職者データとファイル一覧を取り直す。 */
  onOneDriveSynced?: () => void;
  /** T-189 Phase1: おすすめ配信トグルの表示可否（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ true） */
  showAutoRecommendToggle?: boolean;
  /** T-189 Phase1: トグル切替時に呼ぶ（保存は親が行う） */
  onAutoRecommendToggle?: (enabled: boolean) => Promise<void> | void;
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
  onGoogleFormCreate,
  googleFormDisabled,
  googleFormDisabledReason,
  oneDriveFolderUrl,
  onOneDriveSynced,
  showAutoRecommendToggle,
  onAutoRecommendToggle,
}: CandidateHeaderProps) {
  const [urlCopied, setUrlCopied] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [oneDriveSyncing, setOneDriveSyncing] = useState(false);
  const [autoRecommendSaving, setAutoRecommendSaving] = useState(false);

  useEffect(() => {
    setAge(calcAge(candidate.birthday));
  }, [candidate.birthday]);

  // T-158: 保存時に https:// のみ許可しているが、開く側でも念のため確認する
  const oneDriveUrl =
    oneDriveFolderUrl && oneDriveFolderUrl.trim().startsWith("https://")
      ? oneDriveFolderUrl.trim()
      : null;

  // T-159 Phase 4: この求職者1人分だけを今すぐ OneDrive と同期する。
  //   結果は日本語のメッセージがサーバから返るので、そのままトーストに出す（既存の sonner を使う）。
  //   完了後に onOneDriveSynced を呼び、OneDrive ボタンの活性と書類バッジを取り直させる。
  const handleOneDriveSyncNow = async () => {
    if (oneDriveSyncing) return;
    setOneDriveSyncing(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/onedrive-sync-now`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      const message = data.message || "同期に失敗しました。時間をおいてお試しください。";
      if (res.ok && data.ok) {
        toast.success(message, { duration: 8000 });
      } else {
        toast.error(message, { duration: 8000 });
      }
      onOneDriveSynced?.();
    } catch {
      toast.error("同期に失敗しました。時間をおいてお試しください。", { duration: 8000 });
    } finally {
      setOneDriveSyncing(false);
    }
  };

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
                <span className="text-gray-300">|</span>
                <span>担当RC:{formatRecruiterName(candidate.recruiterName) || "未設定"}</span>
                <span className="text-gray-300">|</span>
                <span>経路:{candidate.applicationRoute || "-"}</span>
                <span className="text-gray-300">|</span>
                <span>媒体:{candidate.mediaSource || "-"}</span>
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

                <span className="inline-flex items-center justify-center w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border bg-gray-50 text-gray-700 border-gray-200 truncate">
                  {candidate.supportSubStatus || "-"}
                </span>
              </>
            )}
            {/* T-189 Phase1: おすすめ配信トグル（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ表示） */}
            {showAutoRecommendToggle && (
              <div className="flex flex-col items-center gap-0.5">
                <button
                  disabled={autoRecommendSaving}
                  onClick={async () => {
                    if (autoRecommendSaving) return;
                    setAutoRecommendSaving(true);
                    try {
                      await onAutoRecommendToggle?.(!candidate.autoRecommendEnabled);
                    } finally {
                      setAutoRecommendSaving(false);
                    }
                  }}
                  className={`w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border cursor-pointer truncate disabled:opacity-50 ${
                    candidate.autoRecommendEnabled
                      ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
                      : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200"
                  }`}
                >
                  おすすめ配信 {candidate.autoRecommendEnabled ? "ON" : "OFF"}
                </button>
                <span className="text-[10px] leading-tight text-gray-400 w-[130px] text-center">
                  配信条件は求人サイトで保存（未保存の場合は配信されません）
                </span>
              </div>
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

      {/* Row 2.5: 希望条件サマリ（全 null なら非表示） */}
      {(candidate.desiredJobType1 ||
        candidate.desiredJobType2 ||
        candidate.desiredIndustry1 ||
        candidate.desiredPrefecture1 ||
        candidate.desiredEmploymentType ||
        candidate.desiredSalaryMin != null) && (
        <div className="px-6 pb-2">
          <div className="flex items-center gap-2 text-[13px] text-gray-600 flex-wrap">
            <span className="text-gray-400">希望:</span>
            {(candidate.desiredJobType1 || candidate.desiredJobType2) && (
              <span>
                職種:
                {[candidate.desiredJobType1, candidate.desiredJobType2]
                  .filter(Boolean)
                  .join(" / ")}
              </span>
            )}
            {candidate.desiredIndustry1 && (
              <>
                <span className="text-gray-300">|</span>
                <span>業種:{candidate.desiredIndustry1}</span>
              </>
            )}
            {candidate.desiredPrefecture1 && (
              <>
                <span className="text-gray-300">|</span>
                <span>勤務地:{candidate.desiredPrefecture1}</span>
              </>
            )}
            {candidate.desiredEmploymentType && (
              <>
                <span className="text-gray-300">|</span>
                <span>雇用形態:{candidate.desiredEmploymentType}</span>
              </>
            )}
            {candidate.desiredSalaryMin != null && (
              <>
                <span className="text-gray-300">|</span>
                <span>年収:{candidate.desiredSalaryMin}万円〜</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Row 3: URL / Resource buttons */}
      <div className="px-6 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-gray-400 mr-1">URL・資料:</span>
          <IssueSiteTokenButton candidateId={candidate.id} candidateName={candidate.name} hasBirthday={!!candidate.birthday} />
          <SitePreviewButton candidateId={candidate.id} hasBirthday={!!candidate.birthday} />
          {SHOW_LEGACY_KYUUJIN_UI && (mypageLoading ? (
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
          ))}
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
          {SHOW_LEGACY_KYUUJIN_UI && (
            <button
              onClick={onJobOutput}
              disabled={jobOutputLoading}
              className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {jobOutputLoading ? "読み込み中..." : "求人出力"}
            </button>
          )}
          {onGoogleFormCreate && (
            <button
              onClick={onGoogleFormCreate}
              disabled={googleFormDisabled}
              title={googleFormDisabled ? googleFormDisabledReason : undefined}
              className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Google フォーム作成
            </button>
          )}
          <button
            onClick={() => {
              if (oneDriveUrl) window.open(oneDriveUrl, "_blank", "noopener,noreferrer");
            }}
            disabled={!oneDriveUrl}
            title={!oneDriveUrl ? "OneDriveフォルダURLが未登録です（基本情報編集から登録してください）" : undefined}
            className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            OneDrive
          </button>
          {/* T-159 Phase 4: つながっていない人（登録のため）にも、つながっている人
              （未反映の書類を送るため）にも要るので、常に押せる状態で置く。 */}
          <button
            onClick={handleOneDriveSyncNow}
            disabled={oneDriveSyncing}
            title="この求職者の書類を今すぐ OneDrive にコピーします"
            className="border border-gray-200 bg-white text-gray-600 rounded-md px-3 py-1 text-[12px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {oneDriveSyncing ? "同期中..." : "同期"}
          </button>
        </div>
      </div>
    </div>
  );
}
