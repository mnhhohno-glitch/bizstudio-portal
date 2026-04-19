"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

type SessionUser = { id: string; name: string; email: string; role: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

type AttachmentRecord = {
  id: string;
  fileName: string;
  fileType: string;
  filePath: string;
  fileSize: number;
  mimeType: string | null;
  analysisStatus: string;
  analysisResult: unknown;
  analysisError: string | null;
  analyzedAt: string | null;
  memo: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
};

type MemoRecord = {
  id: string;
  title: string;
  flag: string;
  date: string;
  time: string | null;
  content: string;
};

interface InterviewFormProps {
  interviewId: string;
  candidateId: string;
  currentUser: SessionUser | null;
  onSaved?: () => void;
}

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const RIGHT_TABS = [
  { id: "initial", label: "初期条件" },
  { id: "desired", label: "希望条件" },
  { id: "rating", label: "ランク評価" },
  { id: "action", label: "アクション" },
  { id: "attachments", label: "添付" },
] as const;

const AUTOSAVE_INTERVAL = 30_000;

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function formatTimeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return "たった今";
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  return `${Math.floor(min / 60)}時間前`;
}

function cleanRelationFields(obj: AnyRecord): AnyRecord {
  const copy = { ...obj };
  delete copy.id;
  delete copy.interviewRecordId;
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.interviewRecord;
  return copy;
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      {title && (
        <h3 className="text-[13px] font-bold text-[#374151] mb-2 border-b border-gray-200 pb-1">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", options, rows, placeholder, className,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  type?: "text" | "textarea" | "select" | "number" | "date" | "time";
  options?: string[];
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const cls =
    "w-full rounded-md border border-gray-300 px-2 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none";

  if (type === "select" && options) {
    return (
      <div className={className}>
        {label && <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
        <select value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">-</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  if (type === "textarea") {
    return (
      <div className={className}>
        {label && <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
        <textarea
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={rows || 3}
          className={cls}
          placeholder={placeholder}
        />
      </div>
    );
  }
  return (
    <div className={className}>
      {label && <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">{label}</label>}
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : type === "time" ? "time" : "text"}
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        className={cls}
        placeholder={placeholder}
      />
    </div>
  );
}

function RatingRow({
  label, scoreKey, memoKey, rating, setRating,
}: {
  label: string;
  scoreKey: string;
  memoKey: string;
  rating: AnyRecord;
  setRating: (k: string, v: unknown) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] w-32 shrink-0 text-[#374151]">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(scoreKey, rating[scoreKey] === n ? null : n)}
            className={`w-7 h-7 rounded text-[11px] font-bold border transition-colors ${
              rating[scoreKey] === n
                ? "bg-[#2563EB] text-white border-[#2563EB]"
                : "bg-white text-gray-500 border-gray-300 hover:border-[#2563EB]"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={rating[memoKey] || ""}
        onChange={(e) => setRating(memoKey, e.target.value)}
        placeholder="メモ"
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-[11px] focus:border-[#2563EB] focus:outline-none"
      />
    </div>
  );
}

function RatingSection({
  title, prefix, items, rating, setRating,
}: {
  title: string;
  prefix: string;
  items: { key: string; label: string }[];
  rating: AnyRecord;
  setRating: (k: string, v: unknown) => void;
}) {
  const total = items.reduce((sum, item) => sum + (rating[`${prefix}${item.key}`] || 0), 0);
  return (
    <Section title={`${title}（小計: ${total}/${items.length * 5}）`}>
      <div className="space-y-1.5">
        {items.map((item) => (
          <RatingRow
            key={item.key}
            label={item.label}
            scoreKey={`${prefix}${item.key}`}
            memoKey={`${prefix}${item.key}Memo`}
            rating={rating}
            setRating={setRating}
          />
        ))}
      </div>
    </Section>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function InterviewForm({
  interviewId, candidateId, currentUser, onSaved,
}: InterviewFormProps) {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<AnyRecord>({});
  const [detail, setDetailState] = useState<AnyRecord>({});
  const [rating, setRatingState] = useState<AnyRecord>({});
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [autosaveToken, setAutosaveToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rightTab, setRightTab] = useState<string>("initial");
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [memos, setMemos] = useState<MemoRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevIdRef = useRef<string | null>(null);

  // Fetch interview data
  const fetchData = useCallback(async () => {
    if (!interviewId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/interviews/${interviewId}`);
      if (!res.ok) return;
      const data = await res.json();
      const rec = data.record || data;
      setForm({
        interviewDate: rec.interviewDate ? new Date(rec.interviewDate).toISOString().slice(0, 10) : "",
        startTime: rec.startTime || "",
        endTime: rec.endTime || "",
        duration: rec.duration,
        interviewTool: rec.interviewTool || "電話",
        interviewType: rec.interviewType || "",
        interviewCount: rec.interviewCount,
        resultFlag: rec.resultFlag || "",
        interviewMemo: rec.interviewMemo || "",
        summaryText: rec.summaryText || "",
        previousMemo: rec.previousMemo || "",
        status: rec.status || "draft",
        interviewerUserId: rec.interviewerUserId || "",
        interviewer: rec.interviewer,
      });
      setDetailState(rec.detail || {});
      setRatingState(rec.rating || {});
      setAutosaveToken(rec.autosaveToken || null);
      setLastSavedAt(rec.lastSavedAt ? new Date(rec.lastSavedAt) : null);
      setAttachments(rec.attachments || []);
      setMemos(rec.memos || []);
      setIsDirty(false);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    if (interviewId !== prevIdRef.current) {
      prevIdRef.current = interviewId;
      fetchData();
    }
  }, [interviewId, fetchData]);

  // Field setters
  const setField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };
  const setDetail = (key: string, value: unknown) => {
    setDetailState((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };
  const setRating = (key: string, value: unknown) => {
    setRatingState((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  // Autosave
  useEffect(() => {
    if (!isDirty || !interviewId) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/interviews/${interviewId}/autosave`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interviewDate: form.interviewDate || undefined,
            startTime: form.startTime || undefined,
            endTime: form.endTime || undefined,
            interviewTool: form.interviewTool || undefined,
            interviewType: form.interviewType || undefined,
            resultFlag: form.resultFlag || undefined,
            interviewMemo: form.interviewMemo || undefined,
            summaryText: form.summaryText || undefined,
            status: form.status || undefined,
            lastEditedBy: currentUser?.id,
            autosaveToken: autosaveToken || undefined,
            detail: Object.keys(cleanRelationFields(detail)).length > 0
              ? cleanRelationFields(detail)
              : undefined,
            rating: Object.keys(cleanRelationFields(rating)).length > 0
              ? cleanRelationFields(rating)
              : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setLastSavedAt(new Date(data.lastSavedAt));
          setAutosaveToken(data.autosaveToken);
          setIsDirty(false);
        } else if (res.status === 409) {
          toast.error("他のセッションで変更されました。リロードしてください。");
        }
      } catch {
        localStorage.setItem(`interview-draft-${interviewId}`, JSON.stringify({ form, detail, rating }));
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(timer);
  }, [isDirty, interviewId, form, detail, rating, autosaveToken, currentUser?.id]);

  // beforeunload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Update time-ago display every 10s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // Manual save
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = rating;
      const pTotal = (r.personalityMotivation || 0) + (r.personalityCommunication || 0) + (r.personalityManner || 0) + (r.personalityIntelligence || 0) + (r.personalityHumanity || 0);
      const cTotal = (r.careerJobType || 0) + (r.careerExperience || 0) + (r.careerJobChangeCount || 0) + (r.careerAchievement || 0) + (r.careerQualification || 0);
      const condTotal = (r.conditionJobType || 0) + (r.conditionSalary || 0) + (r.conditionHoliday || 0) + (r.conditionArea || 0) + (r.conditionFlexibility || 0);

      const ratingData = {
        ...cleanRelationFields(r),
        personalityTotal: pTotal || null,
        careerTotal: cTotal || null,
        conditionTotal: condTotal || null,
        grandTotal: (pTotal + cTotal + condTotal) || null,
      };

      const res = await fetch(`/api/interviews/${interviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewDate: form.interviewDate || undefined,
          startTime: form.startTime || undefined,
          endTime: form.endTime || undefined,
          interviewTool: form.interviewTool || undefined,
          interviewType: form.interviewType || undefined,
          resultFlag: form.resultFlag || undefined,
          interviewMemo: form.interviewMemo || null,
          summaryText: form.summaryText || null,
          status: "complete",
          detail: cleanRelationFields(detail),
          rating: ratingData,
        }),
      });
      if (!res.ok) throw new Error();
      setIsDirty(false);
      setLastSavedAt(new Date());
      toast.success("保存しました");
      onSaved?.();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // Attachment upload
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/interviews/${interviewId}/attachments`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "アップロードに失敗しました");
      }
      const att = await res.json();
      setAttachments((prev) => [att, ...prev]);
      toast.success(`${file.name} をアップロードしました`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  // Attachment analyze
  const handleAnalyze = async (attachmentId: string) => {
    setAnalyzingId(attachmentId);
    try {
      const res = await fetch(`/api/interviews/${interviewId}/attachments/${attachmentId}/analyze`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachmentId
              ? { ...a, analysisStatus: "completed", analysisResult: data.analysisResult, analyzedAt: new Date().toISOString() }
              : a
          )
        );
        toast.success("AI解析が完了しました");
      } else {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachmentId ? { ...a, analysisStatus: "failed", analysisError: data.error } : a
          )
        );
        toast.error(`解析失敗: ${data.error}`);
      }
    } catch {
      toast.error("解析リクエストに失敗しました");
    } finally {
      setAnalyzingId(null);
    }
  };

  // Attachment delete
  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!confirm("この添付ファイルを削除しますか？")) return;
    try {
      const res = await fetch(`/api/interviews/${interviewId}/attachments/${attachmentId}`, { method: "DELETE" });
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
        toast.success("削除しました");
      }
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-3 border-[#2563EB] border-t-transparent rounded-full" />
      </div>
    );
  }

  const d = detail;
  const r = rating;

  const grandTotal =
    (r.personalityMotivation || 0) + (r.personalityCommunication || 0) + (r.personalityManner || 0) +
    (r.personalityIntelligence || 0) + (r.personalityHumanity || 0) +
    (r.careerJobType || 0) + (r.careerExperience || 0) + (r.careerJobChangeCount || 0) +
    (r.careerAchievement || 0) + (r.careerQualification || 0) +
    (r.conditionJobType || 0) + (r.conditionSalary || 0) + (r.conditionHoliday || 0) +
    (r.conditionArea || 0) + (r.conditionFlexibility || 0);

  return (
    <div className="flex gap-4">
      {/* ========== Left Column ========== */}
      <div className="w-[460px] shrink-0 space-y-4 overflow-y-auto max-h-[calc(100vh-260px)] pr-2">
        {/* 面談基本情報 */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <Section title="面談基本情報">
            <div className="grid grid-cols-4 gap-2">
              <Field label="面談日" value={form.interviewDate} onChange={(v) => setField("interviewDate", v)} type="date" />
              <Field label="開始" value={form.startTime} onChange={(v) => setField("startTime", v)} type="time" />
              <Field label="終了" value={form.endTime} onChange={(v) => setField("endTime", v)} type="time" />
              <Field
                label="所要(分)"
                value={(() => {
                  if (form.startTime && form.endTime) {
                    const [sh, sm] = form.startTime.split(":").map(Number);
                    const [eh, em] = form.endTime.split(":").map(Number);
                    const dur = (eh * 60 + em) - (sh * 60 + sm);
                    return dur > 0 ? dur : "";
                  }
                  return form.duration ?? "";
                })()}
                onChange={() => {}}
                type="number"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="面談手法" value={form.interviewTool} onChange={(v) => setField("interviewTool", v)}
                options={["電話", "対面", "Web面談", "Zoom", "Teams"]} type="select" />
              <Field label="担当CA" value={form.interviewer?.name || ""} onChange={() => {}} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="面談種別" value={form.interviewType} onChange={(v) => setField("interviewType", v)}
                options={["初回面談", "フォロー面談", "面接対策", "内定面談", "その他"]} type="select" />
              <Field label="面談回数" value={form.interviewCount} onChange={() => {}} type="number" />
            </div>
            <div className="mt-2">
              <Field label="結果フラグ" value={form.resultFlag} onChange={(v) => setField("resultFlag", v)}
                options={["継続", "求人送付", "書類作成", "保留", "辞退"]} type="select" />
            </div>
            <div className="mt-2">
              <Field label="面談メモ" value={form.interviewMemo} onChange={(v) => setField("interviewMemo", v)}
                type="textarea" rows={4} placeholder="面談メモを入力..." />
            </div>
          </Section>
        </div>

        {/* 転職活動状況 */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <Section title="転職活動状況">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="AG利用" value={d.agentUsageFlag} onChange={(v) => setDetail("agentUsageFlag", v)}
                  options={["初めて利用", "利用中", "過去利用あり"]} type="select" />
                <Field label="AG利用メモ" value={d.agentUsageMemo} onChange={(v) => setDetail("agentUsageMemo", v)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="在籍状況" value={d.employmentStatus} onChange={(v) => setDetail("employmentStatus", v)}
                  options={["在職中", "離職中", "退職予定"]} type="select" />
                <Field label="転職時期" value={d.jobChangeTimeline} onChange={(v) => setDetail("jobChangeTimeline", v)}
                  options={["1カ月以内", "3カ月以内", "半年以内", "未定"]} type="select" />
              </div>
              <Field label="転職時期メモ" value={d.jobChangeTimelineMemo} onChange={(v) => setDetail("jobChangeTimelineMemo", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="活動期間" value={d.activityPeriod} onChange={(v) => setDetail("activityPeriod", v)}
                  options={["1週間以内", "1カ月以内", "3カ月以内"]} type="select" />
                <Field label="活動期間メモ" value={d.activityPeriodMemo} onChange={(v) => setDetail("activityPeriodMemo", v)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="応募数" value={d.currentApplicationCount} onChange={(v) => setDetail("currentApplicationCount", v ? Number(v) : null)} type="number" />
                <Field label="応募種別" value={d.applicationTypeFlag} onChange={(v) => setDetail("applicationTypeFlag", v)}
                  options={["検討中", "応募中"]} type="select" />
              </div>
              <Field label="応募メモ" value={d.applicationMemo} onChange={(v) => setDetail("applicationMemo", v)} type="textarea" rows={2} />
            </div>
          </Section>
        </div>

        {/* 学歴・職歴 */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <Section title="学歴・職歴">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="学歴" value={d.educationFlag} onChange={(v) => setDetail("educationFlag", v)}
                  options={["大学院卒", "大卒", "短大・専門卒", "高卒"]} type="select" />
                <Field label="学歴メモ" value={d.educationMemo} onChange={(v) => setDetail("educationMemo", v)} />
              </div>
              <Field label="卒業年月" value={d.graduationDate} onChange={(v) => setDetail("graduationDate", v)} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="企業名" value={d.companyName} onChange={(v) => setDetail("companyName", v)} />
                <Field label="在籍期間" value={d.tenure} onChange={(v) => setDetail("tenure", v)} />
              </div>
              <Field label="事業内容" value={d.businessContent} onChange={(v) => setDetail("businessContent", v)} type="textarea" rows={2} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="職種フラグ" value={d.jobTypeFlag} onChange={(v) => setDetail("jobTypeFlag", v)} />
                <Field label="職種メモ" value={d.jobTypeMemo} onChange={(v) => setDetail("jobTypeMemo", v)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="退職理由（大）" value={d.resignReasonLarge} onChange={(v) => setDetail("resignReasonLarge", v)} />
                <Field label="退職理由（中）" value={d.resignReasonMedium} onChange={(v) => setDetail("resignReasonMedium", v)} />
                <Field label="退職理由（小）" value={d.resignReasonSmall} onChange={(v) => setDetail("resignReasonSmall", v)} />
              </div>
              <Field label="転職理由メモ" value={d.jobChangeReasonMemo} onChange={(v) => setDetail("jobChangeReasonMemo", v)} type="textarea" rows={2} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="転職軸" value={d.jobChangeAxisFlag} onChange={(v) => setDetail("jobChangeAxisFlag", v)} />
                <Field label="転職軸メモ" value={d.jobChangeAxisMemo} onChange={(v) => setDetail("jobChangeAxisMemo", v)} />
              </div>
            </div>
          </Section>
        </div>

        {/* Save status */}
        <div className="text-[11px] text-gray-400 px-1 flex items-center gap-2">
          {lastSavedAt ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              <span>最終保存: {formatTimeAgo(lastSavedAt)}</span>
            </>
          ) : (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
              <span>未保存</span>
            </>
          )}
          {isDirty && <span className="text-yellow-500">（変更あり）</span>}
        </div>
      </div>

      {/* ========== Right Column ========== */}
      <div className="flex-1 min-w-0 overflow-y-auto max-h-[calc(100vh-260px)]">
        {/* Right tabs */}
        <div className="flex border-b border-gray-200 mb-3 overflow-x-auto">
          {RIGHT_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setRightTab(tab.id)}
              className={`px-3 py-2 text-[12px] font-medium border-b-2 whitespace-nowrap transition-colors ${
                rightTab === tab.id
                  ? "text-[#2563EB] border-[#2563EB]"
                  : "text-gray-500 border-transparent hover:text-gray-700"
              }`}
            >
              {tab.label}
              {tab.id === "attachments" && attachments.length > 0 && (
                <span className="ml-1 bg-gray-100 text-gray-600 rounded-full px-1.5 text-[10px]">
                  {attachments.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          {/* ===== 初期条件タブ ===== */}
          {rightTab === "initial" && (
            <div className="space-y-4">
              <Section title="転職活動状況">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="AG利用" value={d.agentUsageFlag} onChange={(v) => setDetail("agentUsageFlag", v)}
                    options={["初めて利用", "利用中", "過去利用あり"]} type="select" />
                  <Field label="AG利用メモ" value={d.agentUsageMemo} onChange={(v) => setDetail("agentUsageMemo", v)} />
                  <Field label="在籍状況" value={d.employmentStatus} onChange={(v) => setDetail("employmentStatus", v)}
                    options={["在職中", "離職中", "退職予定"]} type="select" />
                  <Field label="転職時期" value={d.jobChangeTimeline} onChange={(v) => setDetail("jobChangeTimeline", v)}
                    options={["1カ月以内", "3カ月以内", "半年以内", "未定"]} type="select" />
                  <Field label="転職時期メモ" value={d.jobChangeTimelineMemo} onChange={(v) => setDetail("jobChangeTimelineMemo", v)} />
                  <Field label="活動期間" value={d.activityPeriod} onChange={(v) => setDetail("activityPeriod", v)}
                    options={["1週間以内", "1カ月以内", "3カ月以内"]} type="select" />
                  <Field label="応募数" value={d.currentApplicationCount} onChange={(v) => setDetail("currentApplicationCount", v ? Number(v) : null)} type="number" />
                  <Field label="応募種別" value={d.applicationTypeFlag} onChange={(v) => setDetail("applicationTypeFlag", v)}
                    options={["検討中", "応募中"]} type="select" />
                </div>
                <Field label="応募メモ" value={d.applicationMemo} onChange={(v) => setDetail("applicationMemo", v)} type="textarea" className="mt-2" />
              </Section>

              <Section title="学歴・職歴">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="学歴" value={d.educationFlag} onChange={(v) => setDetail("educationFlag", v)}
                    options={["大学院卒", "大卒", "短大・専門卒", "高卒"]} type="select" />
                  <Field label="学歴メモ" value={d.educationMemo} onChange={(v) => setDetail("educationMemo", v)} />
                  <Field label="卒業年月" value={d.graduationDate} onChange={(v) => setDetail("graduationDate", v)} />
                  <Field label="企業名" value={d.companyName} onChange={(v) => setDetail("companyName", v)} />
                  <Field label="事業内容" value={d.businessContent} onChange={(v) => setDetail("businessContent", v)} />
                  <Field label="在籍期間" value={d.tenure} onChange={(v) => setDetail("tenure", v)} />
                  <Field label="職種" value={d.jobTypeFlag} onChange={(v) => setDetail("jobTypeFlag", v)} />
                  <Field label="職種メモ" value={d.jobTypeMemo} onChange={(v) => setDetail("jobTypeMemo", v)} />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <Field label="退職理由（大）" value={d.resignReasonLarge} onChange={(v) => setDetail("resignReasonLarge", v)} />
                  <Field label="退職理由（中）" value={d.resignReasonMedium} onChange={(v) => setDetail("resignReasonMedium", v)} />
                  <Field label="退職理由（小）" value={d.resignReasonSmall} onChange={(v) => setDetail("resignReasonSmall", v)} />
                </div>
                <Field label="転職理由メモ" value={d.jobChangeReasonMemo} onChange={(v) => setDetail("jobChangeReasonMemo", v)} type="textarea" className="mt-2" />
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="転職軸" value={d.jobChangeAxisFlag} onChange={(v) => setDetail("jobChangeAxisFlag", v)} />
                  <Field label="転職軸メモ" value={d.jobChangeAxisMemo} onChange={(v) => setDetail("jobChangeAxisMemo", v)} />
                </div>
              </Section>

              {/* Memos */}
              <Section title={`面談メモ (${memos.length}件)`}>
                {memos.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {memos.map((memo) => (
                      <div key={memo.id} className="bg-gray-50 rounded p-2 text-[12px]">
                        <div className="flex items-center gap-2 text-gray-500 mb-1">
                          <span className="font-medium text-[#374151]">{memo.title || memo.flag}</span>
                          <span>{new Date(memo.date).toLocaleDateString("ja-JP")}</span>
                        </div>
                        <p className="text-gray-700 whitespace-pre-wrap">{memo.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-gray-400">メモはまだありません</p>
                )}
              </Section>
            </div>
          )}

          {/* ===== 希望条件タブ ===== */}
          {rightTab === "desired" && (
            <div className="space-y-4">
              <Section title="職種・業種">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="第一希望職種" value={d.desiredJobType1} onChange={(v) => setDetail("desiredJobType1", v)} />
                  <Field label="職種メモ" value={d.desiredJobType1Memo} onChange={(v) => setDetail("desiredJobType1Memo", v)} />
                  <Field label="第二希望職種" value={d.desiredJobType2} onChange={(v) => setDetail("desiredJobType2", v)} />
                  <Field label="希望業界" value={d.desiredIndustry1} onChange={(v) => setDetail("desiredIndustry1", v)} />
                  <Field label="業界メモ" value={d.desiredIndustry1Memo} onChange={(v) => setDetail("desiredIndustry1Memo", v)} />
                </div>
              </Section>

              <Section title="エリア">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="希望エリア" value={d.desiredArea} onChange={(v) => setDetail("desiredArea", v)} />
                  <Field label="都道府県" value={d.desiredPrefecture} onChange={(v) => setDetail("desiredPrefecture", v)} />
                  <Field label="市区町村" value={d.desiredCity} onChange={(v) => setDetail("desiredCity", v)} />
                  <Field label="エリアメモ" value={d.desiredAreaMemo} onChange={(v) => setDetail("desiredAreaMemo", v)} />
                </div>
              </Section>

              <Section title="年収">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="現在年収(万)" value={d.currentSalary} onChange={(v) => setDetail("currentSalary", v ? Number(v) : null)} type="number" />
                  <Field label="希望下限(万)" value={d.desiredSalaryMin} onChange={(v) => setDetail("desiredSalaryMin", v ? Number(v) : null)} type="number" />
                  <Field label="希望上限(万)" value={d.desiredSalaryMax} onChange={(v) => setDetail("desiredSalaryMax", v ? Number(v) : null)} type="number" />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <Field label="現年収メモ" value={d.currentSalaryMemo} onChange={(v) => setDetail("currentSalaryMemo", v)} />
                  <Field label="下限メモ" value={d.desiredSalaryMinMemo} onChange={(v) => setDetail("desiredSalaryMinMemo", v)} />
                  <Field label="上限メモ" value={d.desiredSalaryMaxMemo} onChange={(v) => setDetail("desiredSalaryMaxMemo", v)} />
                </div>
              </Section>

              <Section title="休日・残業・転勤">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="休日" value={d.desiredDayOff} onChange={(v) => setDetail("desiredDayOff", v)} />
                  <Field label="休日メモ" value={d.desiredDayOffMemo} onChange={(v) => setDetail("desiredDayOffMemo", v)} />
                  <Field label="年間休日数" value={d.desiredHolidayCount} onChange={(v) => setDetail("desiredHolidayCount", v)} />
                  <Field label="残業上限" value={d.desiredOvertimeMax} onChange={(v) => setDetail("desiredOvertimeMax", v)} />
                  <Field label="残業メモ" value={d.desiredOvertimeMemo} onChange={(v) => setDetail("desiredOvertimeMemo", v)} />
                  <Field label="転勤" value={d.desiredTransfer} onChange={(v) => setDetail("desiredTransfer", v)}
                    options={["可", "不可", "条件付き可"]} type="select" />
                  <Field label="転勤メモ" value={d.desiredTransferMemo} onChange={(v) => setDetail("desiredTransferMemo", v)} />
                </div>
              </Section>

              <Section title="スキル">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="普通免許" value={d.driverLicenseFlag} onChange={(v) => setDetail("driverLicenseFlag", v)}
                    options={["あり", "なし"]} type="select" />
                  <Field label="免許メモ" value={d.driverLicenseMemo} onChange={(v) => setDetail("driverLicenseMemo", v)} />
                  <Field label="語学力" value={d.languageSkillFlag} onChange={(v) => setDetail("languageSkillFlag", v)} />
                  <Field label="語学メモ" value={d.languageSkillMemo} onChange={(v) => setDetail("languageSkillMemo", v)} />
                  <Field label="日本語力" value={d.japaneseSkillFlag} onChange={(v) => setDetail("japaneseSkillFlag", v)} />
                  <Field label="日本語メモ" value={d.japaneseSkillMemo} onChange={(v) => setDetail("japaneseSkillMemo", v)} />
                  <Field label="タイピング" value={d.typingFlag} onChange={(v) => setDetail("typingFlag", v)} />
                  <Field label="タイピングメモ" value={d.typingMemo} onChange={(v) => setDetail("typingMemo", v)} />
                  <Field label="Excel" value={d.excelFlag} onChange={(v) => setDetail("excelFlag", v)} />
                  <Field label="Excelメモ" value={d.excelMemo} onChange={(v) => setDetail("excelMemo", v)} />
                  <Field label="Word" value={d.wordFlag} onChange={(v) => setDetail("wordFlag", v)} />
                  <Field label="Wordメモ" value={d.wordMemo} onChange={(v) => setDetail("wordMemo", v)} />
                  <Field label="PPT" value={d.pptFlag} onChange={(v) => setDetail("pptFlag", v)} />
                  <Field label="PPTメモ" value={d.pptMemo} onChange={(v) => setDetail("pptMemo", v)} />
                </div>
              </Section>

              <Section title="働き方・会社特徴">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="働き方" value={d.workStyleFlags} onChange={(v) => setDetail("workStyleFlags", v)} placeholder="例: リモート可,フレックス" />
                  <Field label="会社特徴" value={d.companyFeatureFlags} onChange={(v) => setDetail("companyFeatureFlags", v)} placeholder="例: 上場企業,ベンチャー" />
                </div>
              </Section>

              <Section title="優先条件">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="1位" value={d.priorityCondition1} onChange={(v) => setDetail("priorityCondition1", v)} />
                  <Field label="2位" value={d.priorityCondition2} onChange={(v) => setDetail("priorityCondition2", v)} />
                  <Field label="3位" value={d.priorityCondition3} onChange={(v) => setDetail("priorityCondition3", v)} />
                </div>
                <Field label="優先条件メモ" value={d.priorityConditionMemo} onChange={(v) => setDetail("priorityConditionMemo", v)} type="textarea" className="mt-2" />
              </Section>
            </div>
          )}

          {/* ===== ランク評価タブ ===== */}
          {rightTab === "rating" && (
            <div className="space-y-4">
              <RatingSection title="人物評価" prefix="personality" items={[
                { key: "Motivation", label: "やる気・熱意" },
                { key: "Communication", label: "コミュニケーション" },
                { key: "Manner", label: "マナー" },
                { key: "Intelligence", label: "地頭" },
                { key: "Humanity", label: "人間性" },
              ]} rating={r} setRating={setRating} />

              <RatingSection title="経歴評価" prefix="career" items={[
                { key: "JobType", label: "職種マッチ" },
                { key: "Experience", label: "経験年数" },
                { key: "JobChangeCount", label: "転職回数" },
                { key: "Achievement", label: "実績" },
                { key: "Qualification", label: "資格" },
              ]} rating={r} setRating={setRating} />

              <RatingSection title="条件評価" prefix="condition" items={[
                { key: "JobType", label: "職種" },
                { key: "Salary", label: "年収" },
                { key: "Holiday", label: "休日" },
                { key: "Area", label: "エリア" },
                { key: "Flexibility", label: "柔軟性" },
              ]} rating={r} setRating={setRating} />

              <Section title="総合">
                <div className="flex items-center gap-4 text-[13px]">
                  <span>
                    合計: <strong className="text-lg">{grandTotal || 0}</strong> / 75
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-gray-500">面談評価:</label>
                    <select
                      value={r.overallRank || ""}
                      onChange={(e) => setRating("overallRank", e.target.value || null)}
                      className="border border-gray-300 rounded px-2 py-1 text-[13px] font-bold"
                    >
                      <option value="">-</option>
                      {["A", "B", "C", "D"].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2">
                  <Field label="総合メモ" value={r.grandTotalMemo} onChange={(v) => setRating("grandTotalMemo", v)} type="textarea" rows={3} />
                </div>
              </Section>
            </div>
          )}

          {/* ===== アクションタブ ===== */}
          {rightTab === "action" && (
            <div className="space-y-4">
              <Section title="応募書類">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="書類ステータス" value={d.documentStatusFlag} onChange={(v) => setDetail("documentStatusFlag", v)}
                    options={["未着手", "作成中", "完了"]} type="select" />
                  <Field label="書類メモ" value={d.documentStatusMemo} onChange={(v) => setDetail("documentStatusMemo", v)} />
                  <Field label="書類サポート" value={d.documentSupportFlag} onChange={(v) => setDetail("documentSupportFlag", v)} />
                  <Field label="サポートメモ" value={d.documentSupportMemo} onChange={(v) => setDetail("documentSupportMemo", v)} />
                </div>
              </Section>

              <Section title="連絡">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="LINE設定" value={d.lineSetupFlag} onChange={(v) => setDetail("lineSetupFlag", v)}
                    options={["設定済", "未設定", "不要"]} type="select" />
                  <Field label="LINEメモ" value={d.lineSetupMemo} onChange={(v) => setDetail("lineSetupMemo", v)} />
                </div>
              </Section>

              <Section title="求人送付">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="送付フラグ" value={d.jobReferralFlag} onChange={(v) => setDetail("jobReferralFlag", v)}
                    options={["未送付", "送付予定", "送付済"]} type="select" />
                  <Field label="送付予定時期" value={d.jobReferralTimeline} onChange={(v) => setDetail("jobReferralTimeline", v)} />
                </div>
                <Field label="送付メモ" value={d.jobReferralMemo} onChange={(v) => setDetail("jobReferralMemo", v)} type="textarea" className="mt-2" />
              </Section>

              <Section title="次回面談">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="次回面談フラグ" value={d.nextInterviewFlag} onChange={(v) => setDetail("nextInterviewFlag", v)} />
                  <Field label="次回面談メモ" value={d.nextInterviewMemo} onChange={(v) => setDetail("nextInterviewMemo", v)} />
                </div>
              </Section>

              <Section title="フリーメモ">
                <Field label="" value={d.freeMemo} onChange={(v) => setDetail("freeMemo", v)} type="textarea" rows={5} />
              </Section>

              <Section title="初回面談まとめ">
                <Field label="" value={d.initialSummary || form.summaryText} onChange={(v) => setDetail("initialSummary", v)} type="textarea" rows={5} />
              </Section>
            </div>
          )}

          {/* ===== 添付タブ ===== */}
          {rightTab === "attachments" && (
            <div className="space-y-4">
              {/* Upload area */}
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file) handleUpload(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.docx,.xlsx,.csv,.txt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                    e.target.value = "";
                  }}
                />
                {uploading ? (
                  <p className="text-[13px] text-gray-500">アップロード中...</p>
                ) : (
                  <>
                    <p className="text-[13px] text-gray-500">ファイルをドロップ、またはクリックして選択</p>
                    <p className="text-[11px] text-gray-400 mt-1">PDF, 画像, Word, Excel, CSV, テキスト (最大20MB)</p>
                  </>
                )}
              </div>

              {/* Attachment list */}
              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map((att) => (
                    <div key={att.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-[#374151] truncate">{att.fileName}</p>
                          <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1">
                            <span>{att.fileType.toUpperCase()}</span>
                            <span>{(att.fileSize / 1024).toFixed(0)} KB</span>
                            <span>{new Date(att.uploadedAt).toLocaleDateString("ja-JP")}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              att.analysisStatus === "completed" ? "bg-green-100 text-green-700" :
                              att.analysisStatus === "processing" ? "bg-yellow-100 text-yellow-700" :
                              att.analysisStatus === "failed" ? "bg-red-100 text-red-700" :
                              "bg-gray-100 text-gray-500"
                            }`}>
                              {att.analysisStatus === "completed" ? "解析済" :
                               att.analysisStatus === "processing" ? "解析中" :
                               att.analysisStatus === "failed" ? "失敗" : "未解析"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {(att.fileType === "pdf" || att.fileType === "xlsx" || att.fileType === "txt" || att.fileType === "csv") && att.analysisStatus !== "processing" && (
                            <button
                              onClick={() => handleAnalyze(att.id)}
                              disabled={analyzingId === att.id}
                              className="text-[11px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-1 hover:bg-purple-100 transition-colors disabled:opacity-50"
                            >
                              {analyzingId === att.id ? "解析中..." : "AI解析"}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteAttachment(att.id)}
                            className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-1 transition-colors"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      {att.analysisStatus === "failed" && att.analysisError && (
                        <p className="text-[11px] text-red-500 mt-1">{att.analysisError}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-gray-400 text-center py-4">添付ファイルはまだありません</p>
              )}
            </div>
          )}
        </div>

        {/* Save button (bottom of right column) */}
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#2563EB] text-white rounded-md px-6 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
