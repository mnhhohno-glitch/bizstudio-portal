"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { normalizeDate } from "@/lib/date-utils";

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

type WorkHistoryRecord = {
  id?: string;
  order: number;
  companyName: string | null;
  businessContent: string | null;
  tenureYear: number | null;
  tenureMonth: number | null;
  jobTypeFlag: string | null;
  jobTypeMemo: string | null;
  resignReasonLarge: string | null;
  resignReasonMedium: string | null;
  resignReasonSmall: string | null;
  jobChangeReasonMemo: string | null;
};

type CandidateInfo = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  birthday: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  address: string | null;
  employee: { name: string; employeeNumber: string } | null;
};

interface InterviewFormProps {
  interviewId: string;
  candidateId: string;
  currentUser: SessionUser | null;
  onSaved?: () => void;
  onDeleted?: () => void;
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

const AUTOSAVE_DEBOUNCE = 3_000;

const MEMO_FLAGS = ["初回面談", "既存面談", "面接対策", "内定面談", "その他"];

const WORK_STYLE_OPTIONS = [
  "フルリモート", "上場企業", "退職金制度", "海外勤務・出張あり",
  "ハイブリッド", "スタートアップ", "固定残業NG", "海外常駐希望",
  "フレックス勤務", "住宅手当", "賞与必須", "英語を使う仕事",
];

const DESIRED_SUBTABS = [
  { id: "st-job", label: "職種" },
  { id: "st-industry", label: "業種" },
  { id: "st-area", label: "エリア" },
];

/* ================================================================== */
/*  CSS custom properties (Notion-like palette)                        */
/* ================================================================== */

const CSS_VARS: React.CSSProperties & Record<string, string> = {
  "--im-bg": "#ffffff",
  "--im-bg2": "#f7f7f5",
  "--im-bg3": "#f1efe8",
  "--im-bg-info": "#e6f1fb",
  "--im-bg-ok": "#e1f5ee",
  "--im-bg-warn": "#faeeda",
  "--im-fg": "#1a1a19",
  "--im-fg2": "#5f5e5a",
  "--im-fg3": "#888780",
  "--im-fg-info": "#0c447c",
  "--im-fg-ok": "#0f6e56",
  "--im-fg-warn": "#854f0b",
  "--im-fg-err": "#791f1f",
  "--im-bdr": "rgba(0,0,0,0.08)",
  "--im-bdr2": "rgba(0,0,0,0.15)",
  "--im-bdr-info": "#85b7eb",
};

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

function calcAge(bd: string | null): number | null {
  if (!bd) return null;
  const today = new Date();
  const birth = new Date(bd);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function genderLabel(g: string | null) {
  if (!g) return "-";
  switch (g) { case "male": return "男"; case "female": return "女"; case "other": return "他"; default: return "-"; }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function rankColor(rank: string | null): { bg: string; fg: string } {
  if (!rank) return { bg: "var(--im-bg2)", fg: "var(--im-fg2)" };
  if (rank === "S") return { bg: "#fef3c7", fg: "#92400e" };
  if (rank.startsWith("A")) return { bg: "var(--im-bg-ok)", fg: "var(--im-fg-ok)" };
  if (rank.startsWith("B")) return { bg: "var(--im-bg-info)", fg: "var(--im-fg-info)" };
  if (rank.startsWith("C")) return { bg: "var(--im-bg-warn)", fg: "var(--im-fg-warn)" };
  return { bg: "#fde8e8", fg: "var(--im-fg-err)" };
}

/* ================================================================== */
/*  Sub-components                                                     */
/* ================================================================== */

function SectionHd({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between mb-2.5 px-2.5 py-1 rounded-sm"
      style={{ fontSize: 12, fontWeight: 500, color: "var(--im-fg)", background: "var(--im-bg2)", borderLeft: "3px solid var(--im-fg-info)" }}
    >
      <span>{title}</span>
      {right}
    </div>
  );
}

function RoField({ v }: { v: string }) {
  return (
    <span
      className="flex-1 min-w-0 truncate"
      style={{ fontSize: 12, padding: "5px 8px", borderRadius: 5, background: "var(--im-bg2)", color: "var(--im-fg)" }}
    >{v || "-"}</span>
  );
}

function Fld({
  value, onChange, type = "text", options, rows, placeholder, style: extraStyle, className, readOnly,
}: {
  value: unknown;
  onChange: (v: string) => void;
  type?: "text" | "textarea" | "select" | "number" | "date" | "time";
  options?: string[];
  rows?: number;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  readOnly?: boolean;
}) {
  const base: React.CSSProperties = {
    flex: "1 1 auto", minWidth: 0, fontSize: 12, padding: "5px 8px", borderRadius: 5,
    color: "var(--im-fg)", border: "0.5px solid var(--im-bdr)", background: readOnly ? "var(--im-bg2)" : "var(--im-bg)",
    fontFamily: "inherit", width: "100%", ...extraStyle,
  };

  if (type === "select" && options) {
    return (
      <select value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} style={base} className={className} disabled={readOnly}>
        <option value="">-</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (type === "textarea") {
    return (
      <textarea
        value={(value as string) || ""} onChange={(e) => onChange(e.target.value)}
        rows={rows || 3} placeholder={placeholder} style={{ ...base, resize: "vertical", minHeight: 42, lineHeight: 1.5 }} className={className}
        readOnly={readOnly}
      />
    );
  }
  return (
    <input
      type={type === "number" ? "number" : type === "date" ? "date" : type === "time" ? "time" : "text"}
      value={value != null ? String(value) : ""} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} style={base} className={className} readOnly={readOnly}
    />
  );
}

function Row({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 mb-1 min-w-0" style={wide ? { gridColumn: "span 4" } : undefined}>
      <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", whiteSpace: "nowrap", minWidth: 64 }}>{label}</span>
      {children}
    </div>
  );
}

function Chip({ text, variant }: { text: string; variant: "info" | "ok" | "warn" | "rank" }) {
  const bgMap = { info: "var(--im-bg-info)", ok: "var(--im-bg-ok)", warn: "var(--im-bg-warn)", rank: "var(--im-bg-info)" };
  const fgMap = { info: "var(--im-fg-info)", ok: "var(--im-fg-ok)", warn: "var(--im-fg-warn)", rank: "var(--im-fg-info)" };
  return (
    <span
      className="inline-flex items-center rounded-[10px]"
      style={{ padding: variant === "rank" ? "2px 12px" : "3px 10px", fontSize: variant === "rank" ? 13 : 11, fontWeight: 500, background: bgMap[variant], color: fgMap[variant] }}
    >{text}</span>
  );
}

function BtnMini({ children, onClick, variant, disabled }: { children: React.ReactNode; onClick?: () => void; variant?: "danger" | "ai"; disabled?: boolean }) {
  const styles: React.CSSProperties = {
    padding: "2px 8px", fontSize: 11, borderRadius: 4, border: "0.5px solid var(--im-bdr)",
    background: variant === "ai" ? "var(--im-bg-info)" : "transparent",
    color: variant === "danger" ? "var(--im-fg-err)" : variant === "ai" ? "var(--im-fg-info)" : "var(--im-fg2)",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4,
    fontWeight: variant === "ai" ? 500 : undefined,
    borderColor: variant === "ai" ? "var(--im-bdr-info)" : undefined,
    opacity: disabled ? 0.5 : undefined,
  };
  return <button type="button" style={styles} onClick={disabled ? undefined : onClick} disabled={disabled}>{children}</button>;
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export default function InterviewForm({
  interviewId, candidateId, currentUser, onSaved, onDeleted,
}: InterviewFormProps) {
  /* ---- State ---- */
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
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevIdRef = useRef<string | null>(null);
  const [candidate, setCandidate] = useState<CandidateInfo | null>(null);
  const [desiredSub, setDesiredSub] = useState("st-job");
  const [aiOrganizeLoading, setAiOrganizeLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [workHistories, setWorkHistories] = useState<WorkHistoryRecord[]>([]);
  const [intakeAnalyzing, setIntakeAnalyzing] = useState(false);

  /* ---- Fetch interview data (existing logic) ---- */
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
      const wh = rec.workHistories || [];
      if (wh.length > 0) {
        setWorkHistories(wh);
      } else if (rec.detail?.companyName) {
        const tenureStr = rec.detail.tenure || "";
        const yMatch = tenureStr.match(/(\d+)\s*年/);
        const mMatch = tenureStr.match(/(\d+)\s*[ヶカか]月/);
        const migrated: WorkHistoryRecord = {
          order: 1,
          companyName: rec.detail.companyName || null,
          businessContent: rec.detail.businessContent || null,
          tenureYear: yMatch ? Number(yMatch[1]) : null,
          tenureMonth: mMatch ? Number(mMatch[1]) : null,
          jobTypeFlag: rec.detail.jobTypeFlag || null,
          jobTypeMemo: rec.detail.jobTypeMemo || null,
          resignReasonLarge: rec.detail.resignReasonLarge || null,
          resignReasonMedium: rec.detail.resignReasonMedium || null,
          resignReasonSmall: rec.detail.resignReasonSmall || null,
          jobChangeReasonMemo: rec.detail.jobChangeReasonMemo || null,
        };
        setWorkHistories([migrated]);
        fetch(`/api/interviews/${interviewId}/work-histories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(migrated),
        }).then((r) => r.ok ? r.json() : null).then((saved) => {
          if (saved) setWorkHistories([saved]);
        }).catch(() => {});
      } else {
        setWorkHistories([]);
      }
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

  /* ---- Fetch candidate info ---- */
  useEffect(() => {
    if (!candidateId) return;
    fetch(`/api/candidates/${candidateId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.candidate) setCandidate(data.candidate); })
      .catch(() => {});
  }, [candidateId]);

  /* ---- Field setters ---- */
  const setField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };
  const DETAIL_DATETIME_KEYS = ["resignationDate", "nextInterviewDate", "jobSendDeadline"];
  const setDetail = (key: string, value: unknown) => {
    const v = DETAIL_DATETIME_KEYS.includes(key) && typeof value === "string"
      ? normalizeDate(value)
      : value;
    setDetailState((prev) => ({ ...prev, [key]: v }));
    setIsDirty(true);
  };
  const setRating = (key: string, value: unknown) => {
    setRatingState((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  /* ---- Unified debounce autosave (3s) ---- */
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const whDirtyRef = useRef(false);
  const forceCompleteRef = useRef(false);

  const doAutoSave = useCallback(async () => {
    if (!interviewId || savingRef.current) return;
    savingRef.current = true;
    setSaveStatus("saving");
    try {
      const r = rating;
      const pT = (r.personalityMotivation || 0) + (r.personalityCommunication || 0) + (r.personalityManner || 0) + (r.personalityIntelligence || 0) + (r.personalityHumanity || 0);
      const cT = (r.careerJobType || 0) + (r.careerExperience || 0) + (r.careerJobChangeCount || 0) + (r.careerAchievement || 0) + (r.careerQualification || 0);
      const cdT = (r.conditionJobType || 0) + (r.conditionSalary || 0) + (r.conditionHoliday || 0) + (r.conditionArea || 0) + (r.conditionFlexibility || 0);
      const ratingData = {
        ...cleanRelationFields(r),
        personalityTotal: pT || null,
        careerTotal: cT || null,
        conditionTotal: cdT || null,
        grandTotal: (pT + cT + cdT) || null,
      };

      const detailData = cleanRelationFields(detail);
      if (workHistories.length > 0) {
        const first = [...workHistories].sort((a, b) => a.order - b.order)[0];
        detailData.companyName = first.companyName;
        detailData.businessContent = first.businessContent;
        const tenure = [
          first.tenureYear != null ? `${first.tenureYear}年` : null,
          first.tenureMonth != null ? `${first.tenureMonth}ヶ月` : null,
        ].filter(Boolean).join("");
        detailData.tenure = tenure || null;
        detailData.jobTypeFlag = first.jobTypeFlag;
        detailData.jobTypeMemo = first.jobTypeMemo;
        detailData.resignReasonLarge = first.resignReasonLarge;
        detailData.resignReasonMedium = first.resignReasonMedium;
        detailData.resignReasonSmall = first.resignReasonSmall;
        detailData.jobChangeReasonMemo = first.jobChangeReasonMemo;
        detailData.careerSummary = workHistories
          .map((w) => {
            const t = [w.tenureYear != null ? `${w.tenureYear}年` : null, w.tenureMonth != null ? `${w.tenureMonth}ヶ月` : null].filter(Boolean).join("");
            return `【${w.order}社目】${w.companyName ?? ""}（${w.businessContent ?? ""}）${t} / ${w.jobTypeFlag ?? ""}`;
          })
          .join("\n");
      }

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
          status: forceCompleteRef.current ? "complete" : (form.status || undefined),
          lastEditedBy: currentUser?.id,
          autosaveToken: autosaveToken || undefined,
          detail: Object.keys(detailData).length > 0 ? detailData : undefined,
          rating: Object.keys(ratingData).length > 0 ? ratingData : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLastSavedAt(new Date(data.lastSavedAt));
        setAutosaveToken(data.autosaveToken);
      } else if (res.status === 409) {
        toast.error("他のセッションで変更されました。リロードしてください。");
        setSaveStatus("error");
        return;
      } else {
        setSaveStatus("error");
        return;
      }

      if (workHistories.length > 0 && whDirtyRef.current) {
        await fetch(`/api/interviews/${interviewId}/work-histories`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workHistories }),
        }).catch(() => {});
        whDirtyRef.current = false;
      }

      setIsDirty(false);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      localStorage.setItem(`interview-draft-${interviewId}`, JSON.stringify({ form, detail, rating }));
    } finally {
      savingRef.current = false;
    }
  }, [interviewId, form, detail, rating, workHistories, autosaveToken, currentUser?.id]);

  useEffect(() => {
    if (!isDirty || !interviewId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { doAutoSave(); }, AUTOSAVE_DEBOUNCE);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [isDirty, interviewId, form, detail, rating, workHistories, doAutoSave]);

  /* ---- beforeunload (existing logic) ---- */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /* ---- Tick for time-ago display ---- */
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  /* ---- Manual save (immediate, cancels debounce, marks complete) ---- */
  const handleSave = async () => {
    if (saving || savingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    whDirtyRef.current = true;
    forceCompleteRef.current = true;
    try {
      await doAutoSave();
      setForm((prev) => ({ ...prev, status: "complete" }));
      toast.success("保存しました");
      onSaved?.();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      forceCompleteRef.current = false;
      setSaving(false);
    }
  };

  /* ---- Attachment upload (existing logic) ---- */
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/interviews/${interviewId}/attachments`, { method: "POST", body: fd });
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

  /* ---- Attachment delete (existing logic) ---- */
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

  /* ---- Memo CRUD ---- */
  const handleAddMemo = async () => {
    try {
      const now = new Date();
      const res = await fetch(`/api/interviews/${interviewId}/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "新規メモ",
          flag: "初回面談",
          date: now.toISOString(),
          time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
          content: "",
        }),
      });
      if (res.ok) {
        const memo = await res.json();
        setMemos((prev) => [memo, ...prev]);
      }
    } catch {
      toast.error("メモ作成に失敗しました");
    }
  };

  const handleUpdateMemo = async (memoId: string, field: string, value: string) => {
    setMemos((prev) => prev.map((m) => m.id === memoId ? { ...m, [field]: value } : m));
    try {
      await fetch(`/api/interviews/${interviewId}/memos/${memoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch { /* silent */ }
  };

  const handleDeleteMemo = async (memoId: string) => {
    if (!confirm("このメモを削除しますか？")) return;
    try {
      const res = await fetch(`/api/interviews/${interviewId}/memos/${memoId}`, { method: "DELETE" });
      if (res.ok) {
        setMemos((prev) => prev.filter((m) => m.id !== memoId));
        toast.success("メモを削除しました");
      }
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  const handleAiOrganize = async () => {
    if (aiOrganizeLoading) return;
    setAiOrganizeLoading(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/interviews/ai-organize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form,
          detail,
          rating,
          memos,
          candidate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI整理に失敗しました");
      setDetail("nextAction", data.suggestions);
      setIsDirty(true);
      toast.success("AI整理が完了しました");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI整理に失敗しました");
    } finally {
      setAiOrganizeLoading(false);
    }
  };

  const handlePdfExport = async () => {
    if (pdfLoading) return;
    const pdfFiles = attachments
      .filter((a) => a.mimeType === "application/pdf" || a.fileType === "pdf")
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
    if (pdfFiles.length === 0) {
      toast.error("PDFが添付されていません");
      return;
    }
    setPdfLoading(true);
    try {
      const latest = pdfFiles[0];
      const res = await fetch(`/api/interviews/${interviewId}/attachments/${latest.id}?url=true`);
      if (!res.ok) throw new Error("PDFのURL取得に失敗しました");
      const data = await res.json();
      window.open(data.signedUrl, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDFの表示に失敗しました");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    if (!confirm("この面談記録を削除しますか？この操作は取り消せません。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/interviews/${interviewId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
      toast.success("面談記録を削除しました");
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  };

  /* ---- Intake analyze (candidate-intake proxy) ---- */
  const handleIntakeAnalyze = async () => {
    if (!interviewId) {
      toast.error("先に面談を保存してから解析を実行してください");
      return;
    }
    setIntakeAnalyzing(true);
    try {
      const res = await fetch(`/api/interviews/${interviewId}/analyze-with-intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "解析に失敗しました");
      }
      const { detailUpdates, interviewMemo: memo, workHistories: newWH, missingItems } = await res.json();
      if (detailUpdates && typeof detailUpdates === "object") {
        setDetailState((prev) => ({ ...prev, ...detailUpdates }));
      }
      if (memo) {
        setForm((prev) => ({ ...prev, interviewMemo: memo }));
      }
      if (Array.isArray(newWH) && newWH.length > 0) {
        await fetch(`/api/interviews/${interviewId}/work-histories`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workHistories: newWH }),
        });
        const whRes = await fetch(`/api/interviews/${interviewId}/work-histories`);
        if (whRes.ok) {
          const whData = await whRes.json();
          setWorkHistories(whData.workHistories || newWH);
        } else {
          setWorkHistories(newWH);
        }
      }
      setIsDirty(true);
      if (missingItems && missingItems.length > 0) {
        toast.info(`解析完了。不足項目: ${missingItems.length}件`);
      } else {
        toast.success("解析結果を反映しました");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "解析に失敗しました");
    } finally {
      setIntakeAnalyzing(false);
    }
  };

  /* ---- WorkHistory helpers ---- */
  const setWH = (index: number, key: keyof WorkHistoryRecord, value: unknown) => {
    setWorkHistories((prev) => prev.map((w, i) => i === index ? { ...w, [key]: value } : w));
    whDirtyRef.current = true;
    setIsDirty(true);
  };

  const addWorkHistory = () => {
    const nextOrder = workHistories.length > 0 ? Math.max(...workHistories.map((w) => w.order)) + 1 : 1;
    const newWH: WorkHistoryRecord = {
      order: nextOrder, companyName: null, businessContent: null,
      tenureYear: null, tenureMonth: null, jobTypeFlag: null, jobTypeMemo: null,
      resignReasonLarge: null, resignReasonMedium: null, resignReasonSmall: null,
      jobChangeReasonMemo: null,
    };
    setWorkHistories((prev) => [...prev, newWH]);
    whDirtyRef.current = true;
    setIsDirty(true);
    if (interviewId) {
      fetch(`/api/interviews/${interviewId}/work-histories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newWH),
      }).then((r) => r.ok ? r.json() : null).then((saved) => {
        if (saved) setWorkHistories((prev) => prev.map((w, i) => i === prev.length - 1 ? { ...saved } : w));
      }).catch(() => {});
    }
  };

  const removeWorkHistory = async (index: number) => {
    if (!confirm("この職歴を削除しますか？")) return;
    const target = workHistories[index];
    if (target.id && interviewId) {
      await fetch(`/api/interviews/${interviewId}/work-histories/${target.id}`, { method: "DELETE" }).catch(() => {});
    }
    setWorkHistories((prev) => prev.filter((_, i) => i !== index));
    whDirtyRef.current = true;
    setIsDirty(true);
  };

  /* ---- Computed ---- */
  const hasPdf = attachments.some((a) => a.mimeType === "application/pdf" || a.fileType === "pdf");
  const d = detail;
  const r = rating;
  const pTotal = (r.personalityMotivation || 0) + (r.personalityCommunication || 0) + (r.personalityManner || 0) + (r.personalityIntelligence || 0) + (r.personalityHumanity || 0);
  const cTotal = (r.careerJobType || 0) + (r.careerExperience || 0) + (r.careerJobChangeCount || 0) + (r.careerAchievement || 0) + (r.careerQualification || 0);
  const condTotal = (r.conditionJobType || 0) + (r.conditionSalary || 0) + (r.conditionHoliday || 0) + (r.conditionArea || 0) + (r.conditionFlexibility || 0);
  const grandTotal = pTotal + cTotal + condTotal;

  const autoRank = grandTotal > 0
    ? grandTotal >= 70 ? "S"
      : grandTotal >= 63 ? "A+"
      : grandTotal >= 56 ? "A"
      : grandTotal >= 48 ? "B+"
      : grandTotal >= 40 ? "B"
      : grandTotal >= 30 ? "C"
      : "D"
    : null;

  useEffect(() => {
    if (autoRank && autoRank !== r.overallRank) {
      setRating("overallRank", autoRank);
    }
  }, [autoRank]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = (() => {
    if (form.startTime && form.endTime) {
      const [sh, sm] = form.startTime.split(":").map(Number);
      const [eh, em] = form.endTime.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      return dur > 0 ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}` : "0:00";
    }
    return "";
  })();

  const age = candidate ? calcAge(candidate.birthday) : null;

  const workStyleSet = new Set<string>((d.workStylePreferences ? JSON.parse(d.workStylePreferences) : []) as string[]);
  const toggleWorkStyle = (item: string) => {
    const next = new Set(workStyleSet);
    if (next.has(item)) next.delete(item); else next.add(item);
    setDetail("workStylePreferences", JSON.stringify([...next]));
  };

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 rounded-full" style={{ borderColor: "var(--im-bdr-info)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */
  return (
    <div style={{ ...CSS_VARS, fontFamily: '-apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif', fontSize: 13, lineHeight: 1.5, color: "var(--im-fg)", background: "var(--im-bg2)" }}>

      {/* ============ HEADER ============ */}
      <div className="flex items-center justify-between px-5 py-2.5" style={{ background: "var(--im-bg)", borderBottom: "0.5px solid var(--im-bdr)" }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 15, fontWeight: 500 }}>面談履歴入力</span>
          <span style={{ fontSize: 12, color: "var(--im-fg2)" }}>
            求職者詳細 / {candidate?.name || "..."} / 面談 #{form.interviewCount || "?"}
          </span>
          {/* Save status indicator */}
          <span className="flex items-center gap-1.5" style={{ fontSize: 11 }}>
            {saveStatus === "saving" ? (
              <span className="flex items-center gap-1.5" style={{ color: "var(--im-fg-info)" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--im-fg-info)" }} />保存中...
              </span>
            ) : saveStatus === "error" ? (
              <button
                type="button"
                onClick={() => { doAutoSave(); }}
                className="flex items-center gap-1.5 cursor-pointer"
                style={{ fontSize: 11, color: "var(--im-fg-err)", background: "none", border: "none", padding: 0, fontFamily: "inherit" }}
              >
                <span style={{ fontSize: 13 }}>⚠</span> 保存失敗（クリックで再試行）
              </button>
            ) : isDirty ? (
              <span className="flex items-center gap-1.5" style={{ color: "var(--im-fg3)" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--im-fg3)" }} />未保存
              </span>
            ) : lastSavedAt ? (
              <span className="flex items-center gap-1.5" style={{ color: "var(--im-fg-ok)" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--im-fg-ok)" }} />保存済み {formatTimeAgo(lastSavedAt)}
              </span>
            ) : (
              <span style={{ color: "var(--im-fg3)" }}>-</span>
            )}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button" onClick={handleDelete} disabled={deleting}
            className="inline-flex items-center justify-center gap-1 cursor-pointer"
            style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, border: "0.5px solid var(--im-bdr)", background: "transparent", color: "#ef4444", fontFamily: "inherit", opacity: deleting ? 0.5 : 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            {deleting ? "削除中..." : "削除"}
          </button>
          <button
            type="button" onClick={() => window.history.back()}
            className="cursor-pointer" style={{ minWidth: 104, padding: "6px 14px", borderRadius: 6, fontSize: 13, border: "0.5px solid var(--im-bdr)", background: "transparent", color: "var(--im-fg2)", fontFamily: "inherit" }}
          >← 一覧に戻る</button>
          <button
            type="button" onClick={() => { if (!isDirty || confirm("変更を破棄しますか？")) window.history.back(); }}
            className="cursor-pointer" style={{ minWidth: 104, padding: "6px 14px", borderRadius: 6, fontSize: 13, border: "0.5px solid var(--im-bdr)", background: "transparent", color: "var(--im-fg)", fontFamily: "inherit" }}
          >キャンセル</button>
          <button
            type="button" onClick={handlePdfExport} disabled={pdfLoading || !hasPdf}
            className="inline-flex items-center justify-center gap-1"
            style={{ minWidth: 104, padding: "6px 14px", borderRadius: 6, fontSize: 13, border: `0.5px solid ${hasPdf ? "var(--im-bdr)" : "var(--im-bdr)"}`, background: "transparent", color: hasPdf ? "var(--im-fg)" : "var(--im-fg3)", fontFamily: "inherit", opacity: pdfLoading || !hasPdf ? 0.5 : 1, cursor: hasPdf && !pdfLoading ? "pointer" : "not-allowed" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={hasPdf ? "var(--im-fg)" : "var(--im-fg3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
            {pdfLoading ? "PDF取得中..." : "PDF表示"}
          </button>
          <button
            type="button" onClick={handleSave} disabled={saving}
            className="cursor-pointer"
            style={{ minWidth: 104, padding: "6px 14px", borderRadius: 6, fontSize: 13, border: "0.5px solid var(--im-bdr-info)", background: "var(--im-bg-info)", color: "var(--im-fg-info)", fontFamily: "inherit", fontWeight: 500, opacity: saving ? 0.6 : 1 }}
          >{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>

      {/* ============ GRID: LEFT + RIGHT ============ */}
      <div className="grid grid-cols-2">

        {/* ======== LEFT COLUMN ======== */}
        <div className="flex flex-col p-3.5" style={{ background: "var(--im-bg)", borderRight: "0.5px solid var(--im-bdr)" }}>

          {/* --- 面談基本情報 --- */}
          <div className="mb-4">
            <SectionHd title="面談基本情報" />
            <div className="grid gap-x-2 gap-y-1.5 overflow-hidden" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
              {/* Row 1: 面談日 | 時刻 | 時間/手法 */}
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>面談日</span>
                <Fld value={form.interviewDate} onChange={(v) => setField("interviewDate", v)} type="date" />
              </div>
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>時刻</span>
                <div className="flex gap-0.5 flex-1 min-w-0">
                  <Fld value={form.startTime} onChange={(v) => setField("startTime", v)} type="time" />
                  <Fld value={form.endTime} onChange={(v) => setField("endTime", v)} type="time" />
                </div>
              </div>
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 40 }}>時間/手法</span>
                <div className="flex gap-0.5 flex-1 min-w-0">
                  <RoField v={duration} />
                  <Fld value={form.interviewTool} onChange={(v) => setField("interviewTool", v)} type="select" options={["電話", "オンライン", "対面"]} />
                </div>
              </div>

              {/* Row 2: 求職者ID | 氏名 | フリガナ */}
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>求職者ID</span><RoField v={candidate?.candidateNumber || ""} /></div>
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>氏名</span><RoField v={candidate?.name || ""} /></div>
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 54 }}>フリガナ</span><RoField v={candidate?.nameKana || ""} /></div>

              {/* Row 3: 生年月日 | 電話 | メール */}
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>生年月日</span><RoField v={fmtDate(candidate?.birthday ?? null)} /></div>
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>電話</span><RoField v={candidate?.phone || ""} /></div>
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 40 }}>メール</span><RoField v={candidate?.email || ""} /></div>

              {/* Row 4: 年齢/性別 | 住所(wide) */}
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>年齢/性別</span>
                <div className="flex gap-0.5 flex-1 min-w-0">
                  <RoField v={age !== null ? String(age) : ""} />
                  <RoField v={genderLabel(candidate?.gender ?? null)} />
                </div>
              </div>
              <div className="col-span-4 flex items-center gap-1.5 min-w-0"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>住所</span><RoField v={candidate?.address || ""} /></div>

              {/* Row 5: 担当CA | 社員名 | ランク */}
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>担当CA</span><RoField v={candidate?.employee?.employeeNumber ? `BS${candidate.employee.employeeNumber}` : ""} /></div>
              <div className="col-span-2 flex items-center gap-1.5"><span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 40 }}>社員名</span><RoField v={candidate?.employee?.name || form.interviewer?.name || ""} /></div>
              <div className="col-span-2 flex items-center gap-1.5">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 40 }}>ランク</span>
                <div className="flex-1 flex items-center justify-center rounded-[5px] py-0.5" style={{ background: "var(--im-bg2)" }}>
                  {r.overallRank ? (
                    <span className="inline-flex items-center rounded-[10px] px-3 py-0.5" style={{ fontSize: 13, fontWeight: 500, background: rankColor(r.overallRank).bg, color: rankColor(r.overallRank).fg }}>{r.overallRank}</span>
                  ) : <span style={{ fontSize: 12, color: "var(--im-fg3)" }}>-</span>}
                </div>
              </div>

              {/* Row 6: 回数/状態 | 結果 | 最新 */}
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>回数/状態</span>
                <div className="flex gap-0.5 flex-1 min-w-0">
                  <RoField v={form.interviewCount ? `${form.interviewCount}回` : ""} />
                  <div className="flex items-center justify-center rounded-[5px] py-0.5 shrink-0" style={{ background: "var(--im-bg2)" }}>
                    <Chip text={form.status === "complete" ? "入力済" : "下書き"} variant={form.status === "complete" ? "warn" : "info"} />
                  </div>
                </div>
              </div>
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>結果</span>
                <Fld value={form.resultFlag} onChange={(v) => setField("resultFlag", v)} type="select" options={["求人紹介 送付前", "求人紹介 送付済", "対象外", "継続", "保留", "辞退"]} />
              </div>
              <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>最新</span>
                <div className="flex-1 flex items-center justify-center rounded-[5px] py-0.5" style={{ background: "var(--im-bg2)" }}>
                  <Chip text="最新" variant="ok" />
                </div>
              </div>
            </div>
          </div>

          {/* --- 転職活動状況 --- */}
          <div className="mb-4">
            <SectionHd title="転職活動状況" />
            <Row label="他AG状況"><Fld value={d.agentUsageFlag} onChange={(v) => setDetail("agentUsageFlag", v)} type="select" options={["初めて利用", "他社利用中", "利用経験あり"]} style={{ width: 110, flex: "none" }} /><Fld value={d.agentUsageMemo} onChange={(v) => setDetail("agentUsageMemo", v)} /></Row>
            <Row label="転職時期"><Fld value={d.jobChangeTimeline} onChange={(v) => setDetail("jobChangeTimeline", v)} type="select" options={["3カ月以内", "半年以内", "1年以内", "未定"]} style={{ width: 110, flex: "none" }} /><Fld value={d.jobChangeTimelineMemo} onChange={(v) => setDetail("jobChangeTimelineMemo", v)} /></Row>
            <Row label="活動期間"><Fld value={d.activityPeriod} onChange={(v) => setDetail("activityPeriod", v)} type="select" options={["1週間以内", "1カ月以内", "3カ月以内"]} style={{ width: 110, flex: "none" }} /><Fld value={d.activityPeriodMemo} onChange={(v) => setDetail("activityPeriodMemo", v)} /></Row>
            <Row label="他社応募">
              <Fld value={d.applicationTypeFlag} onChange={(v) => setDetail("applicationTypeFlag", v)} type="select" options={["検討中", "応募中", "選考中", "なし"]} style={{ width: 110, flex: "none" }} />
              <Fld value={d.applicationMemo} onChange={(v) => setDetail("applicationMemo", v)} />
              <div className="flex items-center gap-1 shrink-0" style={{ width: 80 }}>
                <Fld value={d.currentApplicationCount} onChange={(v) => setDetail("currentApplicationCount", v ? Number(v) : null)} type="number" style={{ width: 48, textAlign: "center", flex: "none" }} />
                <span style={{ fontSize: 11, color: "var(--im-fg3)" }}>社</span>
              </div>
            </Row>
            <Row label="最終学歴">
              <Fld value={d.educationFlag} onChange={(v) => setDetail("educationFlag", v)} type="select" options={["大学卒", "大学院卒", "短大卒", "専門卒", "高卒"]} style={{ width: 110, flex: "none" }} />
              <Fld value={d.educationMemo} onChange={(v) => setDetail("educationMemo", v)} />
              <div className="flex items-center gap-1 shrink-0" style={{ width: 186 }}>
                <Fld value={d.graduationDate} onChange={(v) => setDetail("graduationDate", v)} style={{ width: 92 }} placeholder="2016年3月" />
                <Fld value={d.employmentStatus} onChange={(v) => setDetail("employmentStatus", v)} type="select" options={["卒業", "中退", "在職中", "離職中", "退職予定"]} style={{ flex: 1 }} />
              </div>
            </Row>
          </div>

          {/* --- 職務経歴 --- */}
          <div className="mb-2">
            <SectionHd title="職務経歴" />
            <div className="rounded-lg p-2" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg3)" }}>
              {workHistories.map((wh, idx) => (
                <div key={wh.id ?? idx} className="rounded-lg p-2.5 mb-1.5" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)" }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--im-fg)", minWidth: 50 }}>{wh.order} 社目</span>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>企業名</span>
                    <Fld value={wh.companyName} onChange={(v) => setWH(idx, "companyName", v)} />
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Fld value={wh.tenureYear} onChange={(v) => setWH(idx, "tenureYear", v ? Number(v) : null)} type="number" style={{ width: 40, textAlign: "center", flex: "none" }} />
                      <span style={{ fontSize: 11, color: "var(--im-fg3)" }}>年</span>
                      <Fld value={wh.tenureMonth} onChange={(v) => setWH(idx, "tenureMonth", v ? Number(v) : null)} type="number" style={{ width: 40, textAlign: "center", flex: "none" }} />
                      <span style={{ fontSize: 11, color: "var(--im-fg3)" }}>月</span>
                    </div>
                    <BtnMini variant="danger" onClick={() => removeWorkHistory(idx)}>🗑</BtnMini>
                  </div>
                  <Row label="会社概要"><Fld value={wh.businessContent} onChange={(v) => setWH(idx, "businessContent", v)} /></Row>
                  <Row label="職種"><Fld value={wh.jobTypeFlag} onChange={(v) => setWH(idx, "jobTypeFlag", v)} /><Fld value={wh.jobTypeMemo} onChange={(v) => { setWH(idx, "jobTypeMemo", v); }} /></Row>
                  <Row label="退社理由">
                    <Fld value={wh.resignReasonLarge} onChange={(v) => setWH(idx, "resignReasonLarge", v)} type="select" options={["過去型", "未来型", "現職"]} style={{ width: 90, flex: "none" }} />
                    <Fld value={wh.resignReasonMedium} onChange={(v) => setWH(idx, "resignReasonMedium", v)} type="select" options={["環境要因", "キャリア要因", "待遇要因"]} style={{ width: 100, flex: "none" }} />
                    <Fld value={wh.resignReasonSmall} onChange={(v) => setWH(idx, "resignReasonSmall", v)} />
                  </Row>
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0 pt-1" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 64 }}>詳細</span>
                    <Fld value={wh.jobChangeReasonMemo} onChange={(v) => setWH(idx, "jobChangeReasonMemo", v)} type="textarea" rows={2} />
                  </div>
                </div>
              ))}
              {workHistories.length === 0 && <p style={{ fontSize: 11, color: "var(--im-fg3)", fontStyle: "italic", textAlign: "center", padding: 12 }}>職歴データなし</p>}
            </div>
            <button
              type="button" onClick={addWorkHistory}
              className="w-full mt-1.5 cursor-pointer"
              style={{ padding: "8px 12px", fontSize: 12, border: "0.5px dashed var(--im-bdr2)", background: "transparent", color: "var(--im-fg2)", borderRadius: 6, fontFamily: "inherit" }}
            >＋ 職歴を追加</button>
          </div>
        </div>

        {/* ======== RIGHT COLUMN ======== */}
        <div className="flex flex-col" style={{ background: "var(--im-bg)" }}>

          {/* Tabs */}
          <div className="flex overflow-x-auto" style={{ borderBottom: "0.5px solid var(--im-bdr)" }}>
            {RIGHT_TABS.map((tab) => (
              <button
                key={tab.id} type="button" onClick={() => setRightTab(tab.id)}
                className="cursor-pointer whitespace-nowrap"
                style={{
                  padding: "9px 14px", fontSize: 13, fontFamily: "inherit",
                  color: rightTab === tab.id ? "var(--im-fg)" : "var(--im-fg2)",
                  fontWeight: rightTab === tab.id ? 500 : 400,
                  borderBottom: rightTab === tab.id ? "2px solid var(--im-fg-info)" : "2px solid transparent",
                  background: "none", border: "none", borderTop: 0, borderLeft: 0, borderRight: 0,
                  borderBottomStyle: "solid", borderBottomWidth: 2, borderBottomColor: rightTab === tab.id ? "var(--im-fg-info)" : "transparent",
                }}
              >
                {tab.label}
                {tab.id === "attachments" && attachments.length > 0 && (
                  <span className="ml-1 rounded-full px-1.5" style={{ fontSize: 10, background: "var(--im-bg2)", color: "var(--im-fg2)" }}>{attachments.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col p-3.5">

            {/* ===== 初期条件タブ ===== */}
            {rightTab === "initial" && (
              <div className="flex flex-col">
                <div className="mb-4">
                  <SectionHd title="登録時条件" />
                  <div className="grid gap-x-2 gap-y-1.5 items-center" style={{ gridTemplateColumns: "64px 64px minmax(0,1fr) 64px minmax(0,1fr)" }}>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>業種</span>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>第一</span>
                    <Fld value={d.regIndustry1} onChange={(v) => setDetail("regIndustry1", v)} placeholder="（未入力）" />
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>第二</span>
                    <Fld value={d.regIndustry2} onChange={(v) => setDetail("regIndustry2", v)} placeholder="（未入力）" />

                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>職種</span>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>第一</span>
                    <Fld value={d.regJobType1} onChange={(v) => setDetail("regJobType1", v)} />
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>第二</span>
                    <Fld value={d.regJobType2} onChange={(v) => setDetail("regJobType2", v)} />

                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>エリア</span>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>都道府県</span>
                    <div className="flex items-center gap-1.5">
                      <Fld value={d.regAreaPrefecture} onChange={(v) => setDetail("regAreaPrefecture", v)} placeholder="都道府県" />
                      <span style={{ fontSize: 11, color: "var(--im-fg2)", lineHeight: 1.2, textAlign: "center", width: 28, flexShrink: 0 }}>雇用<br/>形態</span>
                      <Fld value={d.regEmploymentType} onChange={(v) => setDetail("regEmploymentType", v)} type="select" options={["正社員", "契約社員", "派遣"]} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>年収</span>
                    <div className="flex items-center gap-1 flex-nowrap">
                      <span style={{ fontSize: 11, color: "var(--im-fg2)", flexShrink: 0 }}>下限</span>
                      <Fld value={d.regSalaryMin} onChange={(v) => setDetail("regSalaryMin", v ? Number(v) : null)} type="number" style={{ width: 60, textAlign: "center", flex: "1 1 60px" }} />
                      <span style={{ fontSize: 11, color: "var(--im-fg3)", flexShrink: 0 }}>万円</span>
                      <span style={{ fontSize: 11, color: "var(--im-fg3)", flexShrink: 0 }}>〜</span>
                      <span style={{ fontSize: 11, color: "var(--im-fg2)", flexShrink: 0 }}>上限</span>
                      <Fld value={d.regSalaryMax} onChange={(v) => setDetail("regSalaryMax", v ? Number(v) : null)} type="number" style={{ width: 60, textAlign: "center", flex: "1 1 60px" }} />
                      <span style={{ fontSize: 11, color: "var(--im-fg3)", flexShrink: 0 }}>万円</span>
                    </div>
                  </div>
                </div>

                {/* Memo Section */}
                <div>
                  <SectionHd title="メモ" />
                  <div className="rounded-lg p-2" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg3)" }}>
                    {memos.map((memo) => (
                      <div key={memo.id} className="rounded-lg p-2.5 mb-1.5" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)" }}>
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <BtnMini variant="danger" onClick={() => handleDeleteMemo(memo.id)}>🗑 削除</BtnMini>
                          <input
                            value={memo.title} onChange={(e) => handleUpdateMemo(memo.id, "title", e.target.value)}
                            style={{ flex: "1 1 180px", minWidth: 120, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)" }}
                          />
                          <select
                            value={memo.flag} onChange={(e) => handleUpdateMemo(memo.id, "flag", e.target.value)}
                            style={{ width: 110, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)" }}
                          >
                            {MEMO_FLAGS.map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                          <input
                            type="date" value={memo.date ? new Date(memo.date).toISOString().slice(0, 10) : ""}
                            onChange={(e) => handleUpdateMemo(memo.id, "date", e.target.value)}
                            style={{ width: 116, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)" }}
                          />
                          <input
                            type="time" value={memo.time || ""}
                            onChange={(e) => handleUpdateMemo(memo.id, "time", e.target.value)}
                            style={{ width: 78, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)" }}
                          />
                        </div>
                        <textarea
                          value={memo.content} onChange={(e) => handleUpdateMemo(memo.id, "content", e.target.value)}
                          rows={4}
                          style={{ width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)", resize: "vertical", lineHeight: 1.5 }}
                        />
                      </div>
                    ))}
                    {memos.length === 0 && <p style={{ fontSize: 11, color: "var(--im-fg3)", fontStyle: "italic", textAlign: "center", padding: 20 }}>メモはまだありません</p>}
                  </div>
                  <button
                    type="button" onClick={handleAddMemo}
                    className="w-full mt-1.5 cursor-pointer"
                    style={{ padding: "8px 12px", fontSize: 12, border: "0.5px dashed var(--im-bdr2)", background: "transparent", color: "var(--im-fg2)", borderRadius: 6, fontFamily: "inherit" }}
                  >＋ 新規メモ登録</button>
                </div>
              </div>
            )}

            {/* ===== 希望条件タブ ===== */}
            {rightTab === "desired" && (
              <div>
                <div className="mb-4">
                  <SectionHd title="希望条件（詳細）" />
                  <div className="inline-flex gap-0.5 rounded-md p-0.5 mb-2.5" style={{ background: "var(--im-bg2)" }}>
                    {DESIRED_SUBTABS.map((st) => (
                      <button
                        key={st.id} type="button" onClick={() => setDesiredSub(st.id)}
                        className="cursor-pointer"
                        style={{
                          padding: "4px 12px", fontSize: 12, borderRadius: 5, border: 0, fontFamily: "inherit",
                          background: desiredSub === st.id ? "var(--im-bg)" : "transparent",
                          color: desiredSub === st.id ? "var(--im-fg)" : "var(--im-fg2)",
                          fontWeight: desiredSub === st.id ? 500 : 400,
                        }}
                      >{st.label}</button>
                    ))}
                  </div>
                  {desiredSub === "st-job" && (
                    <div>
                      <Fld value={d.desiredJobType1} onChange={(v) => setDetail("desiredJobType1", v)} placeholder="（例：管理・事務 ／ 一般事務・庶務）" />
                      <div className="mt-1.5"><Fld value={d.desiredJobType1Memo} onChange={(v) => setDetail("desiredJobType1Memo", v)} type="textarea" rows={2} placeholder="職種に関する所感・詳細メモ" /></div>
                    </div>
                  )}
                  {desiredSub === "st-industry" && (
                    <div>
                      <Fld value={d.desiredIndustry1} onChange={(v) => setDetail("desiredIndustry1", v)} placeholder="（例：IT・通信 ／ サービス ／ メーカー）" />
                      <div className="mt-1.5"><Fld value={d.desiredIndustry1Memo} onChange={(v) => setDetail("desiredIndustry1Memo", v)} type="textarea" rows={2} placeholder="業種に関する所感・詳細メモ" /></div>
                    </div>
                  )}
                  {desiredSub === "st-area" && (
                    <div>
                      <Fld value={d.desiredArea} onChange={(v) => setDetail("desiredArea", v)} placeholder="（例：横浜市 ／ 川崎市 ／ 東京都内）" />
                      <div className="mt-1.5"><Fld value={d.desiredAreaMemo} onChange={(v) => setDetail("desiredAreaMemo", v)} type="textarea" rows={2} placeholder="エリアに関する所感・詳細メモ" /></div>
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <SectionHd title="年収・勤務条件" />
                  <Row label="現年収"><Fld value={d.currentSalary} onChange={(v) => setDetail("currentSalary", v ? Number(v) : null)} type="number" style={{ width: 110, flex: "none" }} /><span style={{ fontSize: 11, color: "var(--im-fg3)" }}>万円</span><Fld value={d.currentSalaryMemo} onChange={(v) => setDetail("currentSalaryMemo", v)} /></Row>
                  <Row label="希望下限"><Fld value={d.desiredSalaryMin} onChange={(v) => setDetail("desiredSalaryMin", v ? Number(v) : null)} type="number" style={{ width: 110, flex: "none" }} /><span style={{ fontSize: 11, color: "var(--im-fg3)" }}>万円</span><Fld value={d.desiredSalaryMinMemo} onChange={(v) => setDetail("desiredSalaryMinMemo", v)} /></Row>
                  <Row label="希望年収"><Fld value={d.desiredSalaryMax} onChange={(v) => setDetail("desiredSalaryMax", v ? Number(v) : null)} type="number" style={{ width: 110, flex: "none" }} /><span style={{ fontSize: 11, color: "var(--im-fg3)" }}>万円</span><Fld value={d.desiredSalaryMaxMemo} onChange={(v) => setDetail("desiredSalaryMaxMemo", v)} /></Row>
                  <Row label="希望休日"><Fld value={d.desiredDayOff} onChange={(v) => setDetail("desiredDayOff", v)} type="select" options={["土日祝休み", "完全週休2日", "シフト制"]} style={{ width: 110, flex: "none" }} /><Fld value={d.desiredDayOffMemo} onChange={(v) => setDetail("desiredDayOffMemo", v)} /></Row>
                  <Row label="希望残業"><Fld value={d.desiredOvertimeMax} onChange={(v) => setDetail("desiredOvertimeMax", v)} type="select" options={["20時間以内", "30時間以内", "45時間以内"]} style={{ width: 110, flex: "none" }} /><Fld value={d.desiredOvertimeMemo} onChange={(v) => setDetail("desiredOvertimeMemo", v)} /></Row>
                  <Row label="転勤有無"><Fld value={d.desiredTransfer} onChange={(v) => setDetail("desiredTransfer", v)} type="select" options={["なし", "可", "要相談"]} style={{ width: 110, flex: "none" }} /><Fld value={d.desiredTransferMemo} onChange={(v) => setDetail("desiredTransferMemo", v)} /></Row>
                </div>

                <div className="mb-4">
                  <SectionHd title="スキル" />
                  <Row label="自動車免許"><Fld value={d.driverLicenseFlag} onChange={(v) => setDetail("driverLicenseFlag", v)} type="select" options={["取得", "未取得", "取得予定"]} style={{ width: 110, flex: "none" }} /><Fld value={d.driverLicenseMemo} onChange={(v) => setDetail("driverLicenseMemo", v)} /></Row>
                  <Row label="語学"><Fld value={d.languageSkillFlag} onChange={(v) => setDetail("languageSkillFlag", v)} type="select" options={["不可", "日常会話", "ビジネス", "ネイティブ"]} style={{ width: 110, flex: "none" }} /><Fld value={d.languageSkillMemo} onChange={(v) => setDetail("languageSkillMemo", v)} /></Row>
                  <Row label="日本語"><Fld value={d.japaneseSkillFlag} onChange={(v) => setDetail("japaneseSkillFlag", v)} type="select" options={["ネイティブ", "ビジネス", "日常会話"]} style={{ width: 110, flex: "none" }} /><Fld value={d.japaneseSkillMemo} onChange={(v) => setDetail("japaneseSkillMemo", v)} /></Row>
                  <Row label="Typing"><Fld value={d.typingFlag} onChange={(v) => setDetail("typingFlag", v)} type="select" options={["ブラインドタッチ可", "中級", "初級"]} style={{ width: 110, flex: "none" }} /><Fld value={d.typingMemo} onChange={(v) => setDetail("typingMemo", v)} /></Row>
                  <Row label="Excel"><Fld value={d.excelFlag} onChange={(v) => setDetail("excelFlag", v)} type="select" options={["中級", "上級", "初級", "不可"]} style={{ width: 110, flex: "none" }} /><Fld value={d.excelMemo} onChange={(v) => setDetail("excelMemo", v)} /></Row>
                  <Row label="Word"><Fld value={d.wordFlag} onChange={(v) => setDetail("wordFlag", v)} type="select" options={["中級", "上級", "初級", "不可"]} style={{ width: 110, flex: "none" }} /><Fld value={d.wordMemo} onChange={(v) => setDetail("wordMemo", v)} /></Row>
                  <Row label="PPT"><Fld value={d.pptFlag} onChange={(v) => setDetail("pptFlag", v)} type="select" options={["中級", "上級", "初級", "不可"]} style={{ width: 110, flex: "none" }} /><Fld value={d.pptMemo} onChange={(v) => setDetail("pptMemo", v)} /></Row>
                </div>

                <div className="mb-4">
                  <SectionHd title="働き方" />
                  <div className="grid grid-cols-4 gap-x-2.5 gap-y-1.5">
                    {WORK_STYLE_OPTIONS.map((ws) => (
                      <label key={ws} className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: 12, color: "var(--im-fg2)" }}>
                        <input type="checkbox" checked={workStyleSet.has(ws)} onChange={() => toggleWorkStyle(ws)} className="m-0" />
                        {ws}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== ランク評価タブ ===== */}
            {rightTab === "rating" && (
              <div>
                <div className="flex items-center gap-3.5 mb-3.5 p-3 rounded-lg" style={{ background: "var(--im-bg2)" }}>
                  <span style={{ fontSize: 11, color: "var(--im-fg2)" }}>ランク</span>
                  <span
                    className="inline-flex items-center rounded-[10px]"
                    style={{ padding: "2px 16px", fontSize: 24, fontWeight: 500, background: rankColor(r.overallRank ?? null).bg, color: rankColor(r.overallRank ?? null).fg }}
                  >{r.overallRank || "-"}</span>
                  <span className="ml-auto" style={{ fontSize: 12, color: "var(--im-fg2)" }}>合計：<b style={{ fontSize: 15, fontWeight: 500, color: "var(--im-fg)" }}>{grandTotal || 0}</b> ／ 75</span>
                </div>

                <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th className="text-left" style={{ fontWeight: 500, background: "var(--im-bg2)", color: "var(--im-fg2)", padding: "7px 10px", fontSize: 11, borderBottom: "0.5px solid var(--im-bdr)", width: "35%" }}>カテゴリ</th>
                      <th style={{ fontWeight: 500, background: "var(--im-bg2)", color: "var(--im-fg2)", padding: "7px 10px", fontSize: 11, borderBottom: "0.5px solid var(--im-bdr)", width: 150, textAlign: "left" }}>点数</th>
                      <th className="text-left" style={{ fontWeight: 500, background: "var(--im-bg2)", color: "var(--im-fg2)", padding: "7px 10px", fontSize: 11, borderBottom: "0.5px solid var(--im-bdr)" }}>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { items: [
                        { label: "転職意欲", key: "personalityMotivation" },
                        { label: "コミュニケーションスキル", key: "personalityCommunication" },
                        { label: "ビジネスマナー", key: "personalityManner" },
                        { label: "地頭", key: "personalityIntelligence" },
                        { label: "人間性", key: "personalityHumanity" },
                      ], subtotalLabel: "人物評価 総評", subtotalVal: pTotal },
                      { items: [
                        { label: "経験職種", key: "careerJobType" },
                        { label: "社会人経験", key: "careerExperience" },
                        { label: "転職回数", key: "careerJobChangeCount" },
                        { label: "実績・スキル", key: "careerAchievement" },
                        { label: "語学・資格", key: "careerQualification" },
                      ], subtotalLabel: "経歴評価 総評", subtotalVal: cTotal },
                      { items: [
                        { label: "希望職種", key: "conditionJobType" },
                        { label: "希望年収", key: "conditionSalary" },
                        { label: "休日・シフト", key: "conditionHoliday" },
                        { label: "エリア", key: "conditionArea" },
                        { label: "柔軟性", key: "conditionFlexibility" },
                      ], subtotalLabel: "条件評価 総評", subtotalVal: condTotal },
                    ].map((group) => (
                      <React.Fragment key={group.subtotalLabel}>
                        {group.items.map((item) => (
                          <tr key={item.key}>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)" }}>{item.label}</td>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)" }}>
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <button
                                    key={n} type="button"
                                    onClick={() => setRating(item.key, r[item.key] === n ? null : n)}
                                    className="cursor-pointer"
                                    style={{
                                      width: 24, height: 24, borderRadius: 4, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "inherit",
                                      border: "0.5px solid " + (r[item.key] === n ? "var(--im-bdr-info)" : "var(--im-bdr)"),
                                      background: r[item.key] === n ? "var(--im-bg-info)" : "var(--im-bg)",
                                      color: r[item.key] === n ? "var(--im-fg-info)" : "var(--im-fg2)",
                                      fontWeight: r[item.key] === n ? 500 : 400,
                                    }}
                                  >{n}</button>
                                ))}
                              </div>
                            </td>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)" }}>
                              <input
                                value={r[`${item.key}Memo`] || ""} onChange={(e) => setRating(`${item.key}Memo`, e.target.value)}
                                style={{ width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)", fontFamily: "inherit", color: "var(--im-fg)" }}
                              />
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg2)", fontWeight: 500 }}>{group.subtotalLabel}</td>
                          <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg2)", fontWeight: 500 }}>{group.subtotalVal}</td>
                          <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg2)" }}></td>
                        </tr>
                      </React.Fragment>
                    ))}
                    <tr>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg-warn)", fontWeight: 500 }}>合計点</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg-warn)", fontWeight: 500 }}>{grandTotal}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--im-bdr)", background: "var(--im-bg-warn)" }}>人物評価{pTotal} + 経歴評価{cTotal} + 条件評価{condTotal}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ===== アクションタブ ===== */}
            {rightTab === "action" && (
              <div className="flex flex-col flex-1">
                <div className="mb-3.5">
                  <div className="flex items-center justify-between mb-1.5 pb-1" style={{ fontSize: 12, fontWeight: 500, borderBottom: "0.5px solid var(--im-bdr)" }}>応募書類状況</div>
                  <Row label="書類状況"><Fld value={d.documentStatusFlag} onChange={(v) => setDetail("documentStatusFlag", v)} type="select" options={["未着手", "本人作成中", "書類サポート中", "完成"]} style={{ width: 110, flex: "none" }} /><Fld value={d.documentStatusMemo} onChange={(v) => setDetail("documentStatusMemo", v)} /></Row>
                  <Row label="サポート"><Fld value={d.documentSupportFlag} onChange={(v) => setDetail("documentSupportFlag", v)} type="select" options={["本人作成書類から作成", "ヤギッシュ作成依頼", "テンプレ送付のみ"]} style={{ width: 110, flex: "none" }} /><Fld value={d.documentSupportMemo} onChange={(v) => setDetail("documentSupportMemo", v)} /></Row>
                </div>
                <div className="mb-3.5">
                  <div className="flex items-center justify-between mb-1.5 pb-1" style={{ fontSize: 12, fontWeight: 500, borderBottom: "0.5px solid var(--im-bdr)" }}>連絡方法</div>
                  <Row label="連絡手段"><Fld value={d.contactMethod} onChange={(v) => setDetail("contactMethod", v)} type="select" options={["LINE", "メール", "電話", "LINE WORKS"]} style={{ width: 110, flex: "none" }} /><Fld value={d.contactMemo} onChange={(v) => setDetail("contactMemo", v)} /></Row>
                </div>
                <div className="mb-3.5">
                  <div className="flex items-center justify-between mb-1.5 pb-1" style={{ fontSize: 12, fontWeight: 500, borderBottom: "0.5px solid var(--im-bdr)" }}>求人送付／送付期限</div>
                  <Row label="送付予定"><Fld value={d.jobReferralFlag} onChange={(v) => setDetail("jobReferralFlag", v)} type="select" options={["週明け月曜日", "今週中", "未定", "送付済"]} style={{ width: 110, flex: "none" }} /><Fld value={d.jobReferralMemo} onChange={(v) => setDetail("jobReferralMemo", v)} /></Row>
                </div>
                <div className="mb-3.5">
                  <div className="flex items-center justify-between mb-1.5 pb-1" style={{ fontSize: 12, fontWeight: 500, borderBottom: "0.5px solid var(--im-bdr)" }}>次回面談予定</div>
                  <Row label="日時">
                    <Fld value={d.nextInterviewFlag} onChange={(v) => setDetail("nextInterviewFlag", v)} type="select" options={["設定済", "調整中", "未設定"]} style={{ width: 110, flex: "none" }} />
                    <Fld value={d.nextInterviewDate ? new Date(d.nextInterviewDate).toISOString().slice(0, 10) : ""} onChange={(v) => setDetail("nextInterviewDate", v)} type="date" style={{ width: 116, flex: "none" }} />
                    <Fld value={d.nextInterviewTime} onChange={(v) => setDetail("nextInterviewTime", v)} type="time" style={{ width: 78, flex: "none" }} />
                    <Fld value={d.nextInterviewMemo} onChange={(v) => setDetail("nextInterviewMemo", v)} placeholder="次回面談メモ" />
                  </Row>
                </div>
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-1.5 pb-1" style={{ fontSize: 12, fontWeight: 500, borderBottom: "0.5px solid var(--im-bdr)" }}>
                    <span>ネクストアクション</span>
                    <BtnMini variant="ai" onClick={handleAiOrganize} disabled={aiOrganizeLoading}>{aiOrganizeLoading ? "AI整理中..." : "✨ AI整理"}</BtnMini>
                  </div>
                  <Fld value={d.nextAction || d.freeMemo || d.initialSummary || form.summaryText} onChange={(v) => setDetail("nextAction", v)} type="textarea" rows={8} style={{ flex: "1 1 auto", minHeight: 560 }} />
                </div>
              </div>
            )}

            {/* ===== 添付タブ ===== */}
            {rightTab === "attachments" && (
              <div className="flex flex-col">
                <div className="mb-4">
                  <SectionHd title="面談ログ・資料アップロード" />
                  <div
                    className="cursor-pointer text-center"
                    style={{ border: "0.5px dashed var(--im-bdr2)", borderRadius: 8, padding: 20, background: "var(--im-bg2)" }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                  >
                    <input
                      ref={fileInputRef} type="file" className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.docx,.xlsx,.csv,.txt,.mp3,.m4a"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
                    />
                    {uploading ? (
                      <p style={{ fontSize: 13, color: "var(--im-fg2)" }}>アップロード中...</p>
                    ) : (
                      <>
                        <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
                        <div style={{ fontSize: 13, color: "var(--im-fg2)", marginBottom: 6 }}>Nottaログ / 録音 / 履歴書PDF等をドラッグ＆ドロップ または</div>
                        <span style={{ display: "inline-block", padding: "5px 14px", borderRadius: 6, fontSize: 12, border: "0.5px solid var(--im-bdr)", background: "transparent", color: "var(--im-fg)", fontFamily: "inherit" }}>ファイルを選択</span>
                        <div style={{ fontSize: 11, color: "var(--im-fg3)", marginTop: 6 }}>対応形式: .txt / .pdf / .docx / .xlsx / .mp3 / .m4a / .png / .jpg （最大 20MB）</div>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <SectionHd
                    title="添付ファイル一覧"
                    right={attachments.length > 0 ? <BtnMini variant="ai" onClick={handleIntakeAnalyze} disabled={intakeAnalyzing}>{intakeAnalyzing ? "解析中..." : "✨ ログを解析して各カラムへ自動入力"}</BtnMini> : undefined}
                  />
                  <div className="rounded-lg p-2" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg3)" }}>
                    {attachments.map((att) => (
                      <div key={att.id} className="rounded-lg p-2.5 mb-1.5" style={{ border: "0.5px solid var(--im-bdr)", background: "var(--im-bg)" }}>
                        <div className="flex items-center gap-1.5">
                          <BtnMini variant="danger" onClick={() => handleDeleteAttachment(att.id)}>🗑 削除</BtnMini>
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{att.mimeType?.startsWith("audio") ? "🎙️" : "📄"}</span>
                          <span className="flex-1 min-w-0 truncate" style={{ fontSize: 12, color: "var(--im-fg)" }}>{att.fileName}</span>
                          <span style={{ fontSize: 11, color: "var(--im-fg3)", whiteSpace: "nowrap" }}>{(att.fileSize / 1024).toFixed(0)} KB</span>
                        </div>
                      </div>
                    ))}
                    {attachments.length === 0 && <p style={{ fontSize: 11, color: "var(--im-fg3)", fontStyle: "italic", textAlign: "center", padding: 20 }}>添付ファイルはまだありません</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
