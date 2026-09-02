"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { formatRecruiterName } from "@/lib/recruiterDisplay";
import IssueSiteTokenButton from "@/components/candidates/IssueSiteTokenButton";
import SitePreviewButton from "@/components/candidates/SitePreviewButton";
import AutoRecommendConditionDialog from "@/components/candidates/AutoRecommendConditionDialog";
import { openJobPlatformSearch } from "@/lib/openJobPlatformDetail";

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

// T-189 追加: 求人サイト側の配信条件パターン（/api/candidates/[id]/recommend-conditions の応答）。
type ConditionPattern = {
  id: string;
  label: string;
  summary: string;
  queryString: string;
  enabled: boolean;
  updatedAt: string | null;
};

type ConditionsState = {
  /** ok = 取得できた（0件を含む） / unreachable = 求人サイトに聞けなかった＝不明 */
  status: "ok" | "unreachable";
  patterns: ConditionPattern[];
  enabledCount: number;
};

/** 自動配信トグルの保存結果（親が /update の応答をそのまま返す）。 */
export type AutoRecommendToggleResult = { ok: boolean; error?: string };

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
  /** T-189 Phase1: 自動配信トグルの表示可否（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ true） */
  showAutoRecommendToggle?: boolean;
  /**
   * T-189 Phase1: トグル切替時に呼ぶ（保存は親が行う）。
   * T-189 追加: 保存APIの結果を返すこと（400 condition_not_found を受け取って共通ダイアログを出す）。
   */
  onAutoRecommendToggle?: (
    enabled: boolean,
  ) => Promise<AutoRecommendToggleResult | void> | AutoRecommendToggleResult | void;
  /** T-189 追加: 「今すぐ探す」で求人が増えた／AI評価が終わった時に呼ぶ（ブックマークタブの再読込） */
  onRecommendUpdated?: () => void;
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
  onRecommendUpdated,
}: CandidateHeaderProps) {
  const [urlCopied, setUrlCopied] = useState(false);
  const [age, setAge] = useState<number | null>(null);
  const [oneDriveSyncing, setOneDriveSyncing] = useState(false);
  const [autoRecommendSaving, setAutoRecommendSaving] = useState(false);
  // T-189 追加: 「今すぐ探す」。running=引き当てAPI待ち / polling=AI評価の完了待ち
  const [recommendRunning, setRecommendRunning] = useState(false);
  const [recommendPolling, setRecommendPolling] = useState(false);
  // アンマウント後にポーリングを続けない（画面遷移でタイマーを止める）
  const recommendAliveRef = useRef(true);
  useEffect(() => {
    recommendAliveRef.current = true;
    return () => {
      recommendAliveRef.current = false;
    };
  }, []);

  // T-189 追加: 求人サイト（job-platform）に登録された配信条件パターン。
  //   null = 未取得 / unreachable = 求人サイトに聞けなかった（ONガードでは「不明＝ONにしない」）
  const [conditions, setConditions] = useState<ConditionsState | null>(null);
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [conditionDialogOpen, setConditionDialogOpen] = useState(false);

  // 最新の条件を取り直す（トグル操作時は必ずこれを通す＝画面の古い情報でONにしない）。
  const loadConditions = useCallback(async (): Promise<ConditionsState> => {
    setConditionsLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/recommend-conditions`);
      if (!res.ok) {
        const state: ConditionsState = { status: "unreachable", patterns: [], enabledCount: 0 };
        setConditions(state);
        return state;
      }
      const data = (await res.json()) as { patterns?: ConditionPattern[]; enabledCount?: number };
      const state: ConditionsState = {
        status: "ok",
        patterns: data.patterns ?? [],
        enabledCount: data.enabledCount ?? 0,
      };
      setConditions(state);
      return state;
    } catch {
      const state: ConditionsState = { status: "unreachable", patterns: [], enabledCount: 0 };
      setConditions(state);
      return state;
    } finally {
      setConditionsLoading(false);
    }
  }, [candidate.id]);

  useEffect(() => {
    if (!showAutoRecommendToggle) return;
    void loadConditions();
  }, [showAutoRecommendToggle, loadConditions]);

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

  // T-189 追加:「今すぐ探す」。
  //   ① recommend-now（job-platform の即時引き当て → 新着があればAI評価バッチへ投入）
  //   ② created>0 なら recommend-collect を30秒間隔・最長10分ポーリングして評価完了を待つ
  //   評価はバッチAPI（数分〜）なので、完了したらブックマークタブを取り直す。
  const RECOMMEND_POLL_INTERVAL_MS = 30_000;
  const RECOMMEND_POLL_MAX_MS = 10 * 60_000;

  const pollRecommendCollect = async () => {
    const startedAt = Date.now();
    let autoRejectedD = 0;
    setRecommendPolling(true);
    try {
      while (recommendAliveRef.current && Date.now() - startedAt < RECOMMEND_POLL_MAX_MS) {
        await new Promise((r) => setTimeout(r, RECOMMEND_POLL_INTERVAL_MS));
        if (!recommendAliveRef.current) return;
        try {
          const res = await fetch(`/api/candidates/${candidate.id}/recommend-collect`, {
            method: "POST",
          });
          if (!res.ok) continue; // 一時的な失敗は次の周回で拾う
          const data = (await res.json().catch(() => ({}))) as {
            pending?: number;
            autoRejectedD?: number;
          };
          autoRejectedD += data.autoRejectedD ?? 0;
          if ((data.pending ?? 1) === 0) {
            toast.success(`評価が完了しました（D自動却下 ${autoRejectedD}件）`, { duration: 8000 });
            onRecommendUpdated?.();
            return;
          }
        } catch {
          // ネットワーク断は次の周回で再試行
        }
      }
      if (recommendAliveRef.current) {
        toast.message("AI評価がまだ完了していません。時間をおいて画面を更新してください。", {
          duration: 8000,
        });
        onRecommendUpdated?.();
      }
    } finally {
      setRecommendPolling(false);
    }
  };

  const handleRecommendNow = async () => {
    if (recommendRunning || recommendPolling) return;
    setRecommendRunning(true);
    const loadingId = toast.loading("求人を探しています…");
    try {
      const res = await fetch(`/api/candidates/${candidate.id}/recommend-now`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        created?: number;
        skipped?: number;
        submitted?: number;
        error?: string;
        submitError?: string;
      };
      toast.dismiss(loadingId);

      if (!res.ok) {
        if (res.status === 404 && data.error === "no_condition") {
          // T-189 追加: トースト＋リンクをやめ、トグルのガードと同じ共通ダイアログに統一する。
          setConditionDialogOpen(true);
          void loadConditions();
        } else if (res.status === 429) {
          toast.error("1分以内に実行済みです", { duration: 8000 });
        } else if (res.status === 400 && data.error === "auto_recommend_off") {
          toast.error("自動配信をONにしてください", { duration: 8000 });
        } else {
          toast.error("求人の取得に失敗しました。時間をおいてお試しください。", { duration: 8000 });
        }
        return;
      }

      const created = data.created ?? 0;
      if (created === 0) {
        toast.message("条件に合う新着はありませんでした", { duration: 8000 });
        return;
      }
      toast.success(`${created}件を追加しました。AI評価中（数分）`, { duration: 8000 });
      onRecommendUpdated?.(); // 評価前でもブックマークタブには並ぶので先に取り直す
      if (data.submitError) {
        toast.error("AI評価の投入に失敗しました（夜間の自動処理で再試行されます）", {
          duration: 10000,
        });
        return;
      }
      void pollRecommendCollect();
    } catch {
      toast.dismiss(loadingId);
      toast.error("求人の取得に失敗しました。時間をおいてお試しください。", { duration: 8000 });
    } finally {
      setRecommendRunning(false);
    }
  };

  // T-189 追加: 自動配信トグル。
  //   OFF→ON のときだけ「求人サイトに配信条件パターンが1件以上あるか」を先に確認する。
  //     - 0件 → 共通ダイアログを出し、トグルは OFF のまま（保存APIも叩かない）
  //     - 求人サイトに聞けない → ONにしない（fail-closed。サーバー側も502で拒否する）
  //     - 1件以上 → 従来どおり保存。保存APIが 400 condition_not_found（画面が古い）でも同じダイアログ
  //   ON→OFF は無条件で従来どおり。
  const handleAutoRecommendToggleClick = async () => {
    if (autoRecommendSaving) return;
    const next = !candidate.autoRecommendEnabled;
    setAutoRecommendSaving(true);
    try {
      if (next) {
        const state = await loadConditions();
        if (state.status === "unreachable") {
          toast.error("求人サイトに接続できず、配信条件を確認できませんでした", { duration: 8000 });
          return;
        }
        if (state.enabledCount < 1) {
          setConditionDialogOpen(true);
          return;
        }
      }
      const result = await onAutoRecommendToggle?.(next);
      if (result && result.ok === false) {
        if (result.error === "condition_not_found") {
          setConditionDialogOpen(true);
          void loadConditions(); // 表示も最新に合わせる
        } else if (result.error === "job_platform_unreachable") {
          toast.error("求人サイトに接続できず、配信条件を確認できませんでした", { duration: 8000 });
        } else {
          toast.error("自動配信の切り替えに失敗しました", { duration: 8000 });
        }
      }
    } finally {
      setAutoRecommendSaving(false);
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
            {/* T-189 Phase1: 自動配信トグル（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ表示） */}
            {showAutoRecommendToggle && (
              <button
                disabled={autoRecommendSaving}
                onClick={handleAutoRecommendToggleClick}
                className={`w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border cursor-pointer truncate disabled:opacity-50 ${
                  candidate.autoRecommendEnabled
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
                    : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200"
                }`}
              >
                自動配信 {candidate.autoRecommendEnabled ? "ON" : "OFF"}
              </button>
            )}
            {/* T-189 追加: 今すぐ探す（自動配信 ON のときだけ押せる） */}
            {showAutoRecommendToggle && (
              <button
                disabled={
                  !candidate.autoRecommendEnabled || recommendRunning || recommendPolling
                }
                title={
                  !candidate.autoRecommendEnabled
                    ? "自動配信をONにしてください"
                    : recommendPolling
                      ? "AI評価の完了を待っています"
                      : "求人サイトの配信条件で今すぐ引き当てます"
                }
                onClick={handleRecommendNow}
                className="w-[130px] h-8 rounded-md px-2 text-[13px] font-medium border cursor-pointer truncate bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {recommendRunning
                  ? "検索中…"
                  : recommendPolling
                    ? "AI評価中…"
                    : "今すぐ探す"}
              </button>
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

      {/* Row 2.4: T-189 配信条件パターン一覧（AUTO_RECOMMEND_ADMIN_IDS のユーザーのみ・読み取り専用）。
          登録・編集・削除・ON/OFF は求人サイト側だけで行う（portal では行わない）。 */}
      {showAutoRecommendToggle && (
        <div className="px-6 pb-2">
          <div className="flex items-start gap-2 text-[13px]">
            <span className="shrink-0 pt-0.5 text-gray-400">配信条件:</span>
            <div className="min-w-0 flex-1">
              {conditions === null ? (
                <span className="text-gray-400">{conditionsLoading ? "読み込み中…" : "-"}</span>
              ) : conditions.status === "unreachable" ? (
                <span className="text-amber-700">
                  求人サイトに接続できず、配信条件を取得できませんでした
                </span>
              ) : conditions.patterns.length === 0 ? (
                <span className="text-gray-600">
                  配信条件が未登録です
                  <button
                    onClick={() => void openJobPlatformSearch()}
                    className="ml-2 text-blue-600 underline hover:text-blue-800"
                  >
                    求人サイトで登録する
                  </button>
                </span>
              ) : (
                <div className="flex flex-col gap-1">
                  {conditions.patterns.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 min-w-0">
                      <span
                        className={`shrink-0 rounded px-1.5 py-0 text-[10px] font-medium ${
                          p.enabled
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                        title={
                          p.enabled
                            ? "自動配信に使うパターン"
                            : "保存のみ（自動配信には使わない）"
                        }
                      >
                        {p.enabled ? "配信" : "保存のみ"}
                      </span>
                      <span className="shrink-0 font-medium text-gray-700">{p.label}</span>
                      <span className="truncate text-gray-500" title={p.summary}>
                        {p.summary}
                      </span>
                      <button
                        onClick={() => void openJobPlatformSearch(p.queryString)}
                        className="shrink-0 text-blue-600 underline hover:text-blue-800"
                        title="この条件で求人サイトの検索画面を開きます"
                      >
                        求人サイトで開く
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* T-189 追加: 配信条件が未登録のときの共通ダイアログ（トグルON・今すぐ探すの両方から出す） */}
      <AutoRecommendConditionDialog
        open={conditionDialogOpen}
        candidateName={candidate.name}
        candidateNumber={candidate.candidateNumber}
        onClose={() => setConditionDialogOpen(false)}
      />

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
