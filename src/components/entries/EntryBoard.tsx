"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import EntryTable from "./EntryTable";
import EntryDetailModal from "./EntryDetailModal";
import EntryCreateModal from "./EntryCreateModal";
import BulkFlagChangeModal from "./BulkFlagChangeModal";
import BulkEndFlagModal from "./BulkEndFlagModal";
import EndNoticeModal from "./EndNoticeModal";
import EntryRouteSwitchModal from "./EntryRouteSwitchModal";
import EntryEditModal from "./EntryEditModal";
import InterviewGuideCopyModal from "./InterviewGuideCopyModal";
import TaskSyncConfirmDialog, { type TaskSyncSlot, type TaskSyncAction } from "./TaskSyncConfirmDialog";

export type Entry = {
  id: string;
  candidateId: string;
  candidate: { id: string; name: string; candidateNumber: string; employeeId?: string; employee?: { name: string } | null };
  companyName: string;
  jobTitle: string;
  externalJobNo: string | null;
  originalUrl: string | null;
  jobDb: string | null;
  jobDbUrl: string | null;
  jobType: string | null;
  entryRoute: string | null;
  entryJobId: string | null;
  prefecture: string | null;
  jobCategory: string | null;
  status: string | null;
  entryFlag: string | null;
  entryFlagDetail: string | null;
  companyFlag: string | null;
  personFlag: string | null;
  hasJobPosting: boolean;
  hasEntry: boolean;
  hasJoined: boolean;
  entryDate: string;
  firstMeetingDate: string | null;
  jobMeetingDate: string | null;
  jobIntroDate: string | null;
  documentSubmitDate: string | null;
  documentPassDate: string | null;
  aptitudeTestExists: boolean;
  aptitudeTestDeadline: string | null;
  interviewPrepDate: string | null;
  interviewPrepTime: string | null;
  firstInterviewDate: string | null;
  firstInterviewTime: string | null;
  firstInterviewTool: string | null;
  secondInterviewDate: string | null;
  secondInterviewTime: string | null;
  secondInterviewTool: string | null;
  finalInterviewDate: string | null;
  finalInterviewTime: string | null;
  finalInterviewTool: string | null;
  offerDate: string | null;
  offerDeadline: string | null;
  offerMeetingDate: string | null;
  offerMeetingTime: string | null;
  acceptanceDate: string | null;
  joinDate: string | null;
  revenue: number | null;
  memo: string | null;
  isActive: boolean;
  archivedAt: string | null;
  careerAdvisorId: string | null;
  introducedAt: string;
  createdAt: string;
  updatedAt: string;
  // T-066: Google ToDo（Tasks）連携用タスクID
  firstInterviewGtaskId?: string | null;
  secondInterviewGtaskId?: string | null;
  finalInterviewGtaskId?: string | null;
  // T-088: 課金方式（年収％/固定）と粗利関連。承諾 or 入社済レコードで入力可。
  // revenue は T-087 で先に追加済み（L61）。ここでは追加しない。
  feeType?: "ANNUAL_RATE" | "FIXED" | null;
  theoreticalAnnualIncome?: number | null;
  // Decimal は JSON で string 化されることがあるので両方受ける
  feeRatePercent?: number | string | null;
  // T-099: 仕入れ費（手入力・円・nullable）。
  cost?: number | null;
  // T-100: 求人DB費（手入力・円・nullable）。粗利は revenue - (jobDbCost ?? 0) - (cost ?? 0) で表示計算（非保存）。
  jobDbCost?: number | null;
};

// 選考終了系の entryFlagDetail 値（BulkEndFlagModal と一致）
const END_FLAG_DETAILS = new Set(["書類見送り", "面接見送り", "本人辞退", "求人クローズ"]);
function isEndFlagDetail(value: unknown): boolean {
  return typeof value === "string" && END_FLAG_DETAILS.has(value);
}

// T-066: 面接日時表示用フォーマッタ。Date→"YYYY/MM/DD" は JST 経由（罠 #17）。
function formatInterviewDateTime(dateIso: string | null, time: string | null): string {
  if (!dateIso || !time) return "";
  const date = new Date(dateIso);
  const ymd = date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD"
  return `${ymd.replace(/-/g, "/")} ${time}`;
}

const INTERVIEW_SLOT_DEFS: { slot: "first" | "second" | "final"; label: string; dateField: keyof Entry; timeField: keyof Entry; gtaskField: keyof Entry }[] = [
  { slot: "first", label: "一次面接", dateField: "firstInterviewDate", timeField: "firstInterviewTime", gtaskField: "firstInterviewGtaskId" },
  { slot: "second", label: "二次面接", dateField: "secondInterviewDate", timeField: "secondInterviewTime", gtaskField: "secondInterviewGtaskId" },
  { slot: "final", label: "最終面接", dateField: "finalInterviewDate", timeField: "finalInterviewTime", gtaskField: "finalInterviewGtaskId" },
];

const INTERVIEW_DATE_TIME_FIELDS = new Set([
  "firstInterviewDate", "firstInterviewTime",
  "secondInterviewDate", "secondInterviewTime",
  "finalInterviewDate", "finalInterviewTime",
]);

export type FlagData = {
  entryFlags: string[];
  entryDetails: Record<string, string[]>;
  personFlags: Record<string, string[]>;
  companyFlags: Record<string, string[]>;
};

const TABS = [
  { key: "求人紹介", label: "求人紹介" },
  { key: "エントリー", label: "エントリー" },
  { key: "書類選考", label: "書類選考" },
  { key: "面接", label: "面接" },
  { key: "内定", label: "内定" },
  { key: "入社済", label: "入社済" },
  { key: "全件", label: "全件" },
];

export default function EntryBoard() {
  const searchParams = useSearchParams();
  const initialCandidateName = useMemo(() => searchParams.get("candidateName") ?? "", [searchParams]);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialCandidateName ? "全件" : "エントリー");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [flagData, setFlagData] = useState<FlagData | null>(null);

  // Filters
  const [candidateName, setCandidateName] = useState(initialCandidateName);
  const [companyName, setCompanyName] = useState("");
  const [caFilter, setCaFilter] = useState("");
  const [caOptions, setCaOptions] = useState<string[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [urlMissingOnly, setUrlMissingOnly] = useState(false);
  // セッションロード完了までは一覧の取得を遅らせる（caFilterの初期値セット前に
  // 無フィルタで取ってしまうとレース条件で全件表示になるため）
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Current user role (for admin-gated features)
  const [isAdmin, setIsAdmin] = useState(false);

  // Sort
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkFlags, setShowBulkFlags] = useState(false);
  const [showEndNotice, setShowEndNotice] = useState(false);
  const [showBulkEndFlag, setShowBulkEndFlag] = useState(false);
  const [showInterviewGuideCopy, setShowInterviewGuideCopy] = useState(false);

  // URL edit modal
  const [urlModalEntryId, setUrlModalEntryId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  // Entry route switch modal
  const [routeModalEntry, setRouteModalEntry] = useState<Entry | null>(null);

  // Entry edit modal
  const [editEntry, setEditEntry] = useState<Entry | null>(null);

  // T-066: Google 連携状態 / Tasks 同期ダイアログ
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDialogAction, setTaskDialogAction] = useState<TaskSyncAction>("create");
  const [taskDialogSlots, setTaskDialogSlots] = useState<TaskSyncSlot[]>([]);
  const [taskDialogEntryId, setTaskDialogEntryId] = useState<string | null>(null);
  // 内定+承諾になった瞬間に表示する「承諾報告タスク作成」確認ダイアログ対象
  const [offerAcceptEntry, setOfferAcceptEntry] = useState<Entry | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!sessionLoaded) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (activeTab !== "全件") params.set("entryFlag", activeTab);
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (caFilter) params.set("careerAdvisorName", caFilter);
    if (includeInactive) params.set("includeInactive", "true");
    if (includeArchived) params.set("includeArchived", "true");
    if (urlMissingOnly) params.set("urlMissingOnly", "true");

    try {
      const res = await fetch(`/api/entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotalPages(data.totalPages || 1);
        setCounts(data.counts || {});
      }
    } catch { /* */ }
    finally { setLoading(false); }
  }, [sessionLoaded, page, activeTab, candidateName, companyName, caFilter, includeInactive, includeArchived, urlMissingOnly]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Phase 3: Auto-progress — after entries load, check interview times and auto-update flags
  const autoProgressRan = useRef(false);
  useEffect(() => {
    if (loading || entries.length === 0 || autoProgressRan.current) return;
    autoProgressRan.current = true;

    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    const combineDateTime = (dateIso: string | null, time: string | null): number | null => {
      if (!dateIso || !time) return null;
      const [hh, mm] = time.split(":");
      if (!hh || !mm) return null;
      const d = new Date(dateIso);
      d.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
      return d.getTime();
    };

    type AutoUpdate = { id: string; entryFlagDetail: string; companyFlag: string };
    const updates: AutoUpdate[] = [];

    const checks: { dateField: keyof Entry; timeField: keyof Entry; pre: string; post: string }[] = [
      { dateField: "firstInterviewDate", timeField: "firstInterviewTime", pre: "一次面接実施前", post: "一次面接選考中" },
      { dateField: "secondInterviewDate", timeField: "secondInterviewTime", pre: "二次面接実施前", post: "二次面接選考中" },
      { dateField: "finalInterviewDate", timeField: "finalInterviewTime", pre: "最終面接実施前", post: "最終面接選考中" },
    ];

    for (const entry of entries) {
      for (const chk of checks) {
        if (entry.entryFlagDetail !== chk.pre) continue;
        const ts = combineDateTime(entry[chk.dateField] as string | null, entry[chk.timeField] as string | null);
        if (ts && now > ts + ONE_HOUR) {
          updates.push({ id: entry.id, entryFlagDetail: chk.post, companyFlag: "所感報告前" });
          break;
        }
      }
    }

    if (updates.length > 0) {
      fetch("/api/entries/auto-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      }).then((res) => {
        if (res.ok) fetchEntries();
      });
    }
  }, [loading, entries, fetchEntries]);

  // Refresh only tab counts (no loading state, no entry replacement)
  const refreshCounts = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "1");
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (caFilter) params.set("careerAdvisorName", caFilter);
    if (includeInactive) params.set("includeInactive", "true");
    if (includeArchived) params.set("includeArchived", "true");
    if (urlMissingOnly) params.set("urlMissingOnly", "true");
    try {
      const res = await fetch(`/api/entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts || {});
      }
    } catch { /* */ }
  }, [candidateName, companyName, caFilter, includeInactive, includeArchived, urlMissingOnly]);

  // T-066: Google カレンダー連携状態を取得（既存の /api/calendar/events を流用）
  useEffect(() => {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    fetch(`/api/calendar/events?date=${today}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.connected === "boolean") setCalendarConnected(d.connected); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/entry-flags")
      .then((r) => r.json())
      .then(setFlagData)
      .catch(() => {});

    // Load CA list + session in parallel, then match login user to an
    // employee name (ignoring whitespace) to set the default filter.
    const normalize = (s: string) => s.replace(/\s+/g, "");
    Promise.all([
      fetch("/api/employees").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/auth/session").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([empData, session]) => {
      const list: { name: string }[] = empData?.employees || empData || [];
      const names = list.map((e) => e.name);
      setCaOptions(names);
      if (session?.role === "admin") setIsAdmin(true);
      if (session?.name) {
        const target = normalize(session.name);
        const match = names.find((n) => normalize(n) === target);
        setCaFilter(match ?? session.name);
      }
    }).finally(() => {
      // caFilter の初期値セットが反映された状態で fetchEntries を走らせる
      setSessionLoaded(true);
    });
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setPage(1);
    if (tab !== "書類選考" && tab !== "面接") setUrlMissingOnly(false);
  };

  // 共通: 面接日時の保存前後差分から (action, slots) を組み立てる
  const computeTaskSync = useCallback((before: Entry, after: Entry): { action: TaskSyncAction; slots: TaskSyncSlot[] } | null => {
    const creates: TaskSyncSlot[] = [];
    const updates: TaskSyncSlot[] = [];
    const completes: TaskSyncSlot[] = [];
    for (const def of INTERVIEW_SLOT_DEFS) {
      const dateBefore = (before[def.dateField] as string | null) ?? null;
      const timeBefore = (before[def.timeField] as string | null) ?? null;
      const dateAfter = (after[def.dateField] as string | null) ?? null;
      const timeAfter = (after[def.timeField] as string | null) ?? null;
      const gtaskAfter = (after[def.gtaskField] as string | null) ?? null;
      const completeBefore = !!dateBefore && !!timeBefore;
      const completeAfter = !!dateAfter && !!timeAfter;

      if (!completeBefore && completeAfter) {
        creates.push({ slot: def.slot, label: def.label, detail: formatInterviewDateTime(dateAfter, timeAfter) });
      } else if (completeBefore && completeAfter) {
        const changed = dateBefore !== dateAfter || timeBefore !== timeAfter;
        if (changed && gtaskAfter) {
          updates.push({ slot: def.slot, label: def.label, detail: formatInterviewDateTime(dateAfter, timeAfter) });
        } else if (changed) {
          // 既存タスクが無いので新規作成扱い
          creates.push({ slot: def.slot, label: def.label, detail: formatInterviewDateTime(dateAfter, timeAfter) });
        }
      } else if (completeBefore && !completeAfter && gtaskAfter) {
        completes.push({ slot: def.slot, label: def.label, detail: def.label });
      }
    }
    if (updates.length > 0) return { action: "update", slots: updates };
    if (creates.length > 0) return { action: "create", slots: creates };
    if (completes.length > 0) return { action: "complete", slots: completes };
    return null;
  }, []);

  const openTaskDialogForEntry = useCallback((entryId: string, before: Entry | null, after: Entry) => {
    if (!calendarConnected || !before) return;
    const result = computeTaskSync(before, after);
    if (!result) return;
    setTaskDialogEntryId(entryId);
    setTaskDialogAction(result.action);
    setTaskDialogSlots(result.slots);
    setTaskDialogOpen(true);
  }, [calendarConnected, computeTaskSync]);

  // 選考終了系フラグへ変更されたとき、当該 entry に gtaskId が残っている slot を完了化ダイアログへ
  const maybeOpenCompleteForEndFlag = useCallback((entry: Entry, flags: Record<string, string | null>) => {
    if (!calendarConnected) return;
    if (!isEndFlagDetail(flags.entryFlagDetail)) return;
    const completes: TaskSyncSlot[] = [];
    for (const def of INTERVIEW_SLOT_DEFS) {
      const gtaskId = (entry[def.gtaskField] as string | null) ?? null;
      if (gtaskId) completes.push({ slot: def.slot, label: def.label, detail: def.label });
    }
    if (completes.length === 0) return;
    setTaskDialogEntryId(entry.id);
    setTaskDialogAction("complete");
    setTaskDialogSlots(completes);
    setTaskDialogOpen(true);
  }, [calendarConnected]);

  // 今回の更新で entryFlagDetail が「承諾」になり、かつ親フラグが「内定」のときだけ確認ダイアログを開く。
  // 既に承諾済みの行で他フラグ（企業対応等）のみ更新した場合は flags に entryFlagDetail を含まないため発火しない。
  const maybeOfferAcceptancePrompt = useCallback((entry: Entry, flags: Record<string, string | null>) => {
    if (flags.entryFlagDetail === "承諾" && entry.entryFlag === "内定") {
      setOfferAcceptEntry(entry);
    }
  }, []);

  // 内定承諾報告タスク作成画面へ、エントリー値をプリセットして遷移（罠#17: 日付は JST 文字列化）
  const goToOfferAcceptanceTask = (entry: Entry) => {
    const jstYmd = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "";
    const params = new URLSearchParams();
    params.set("prefill", "offer-acceptance");
    params.set("categoryName", "内定承諾報告");
    params.set("candidateId", entry.candidateId);
    if (entry.companyName) params.set("companyName", entry.companyName);
    if (entry.theoreticalAnnualIncome != null) params.set("theoreticalAnnualIncome", String(entry.theoreticalAnnualIncome));
    if (entry.feeRatePercent != null && entry.feeRatePercent !== "") params.set("feeRatePercent", String(entry.feeRatePercent));
    if (entry.revenue != null) params.set("revenue", String(entry.revenue));
    if (entry.feeType) params.set("feeType", entry.feeType);
    const acc = jstYmd(entry.acceptanceDate);
    if (acc) params.set("acceptanceDate", acc);
    const join = jstYmd(entry.joinDate);
    if (join) params.set("joinDate", join);
    params.set("step", "2");
    window.location.href = `/tasks/new?${params.toString()}`;
  };

  const handleFlagUpdate = async (entryId: string, flags: Record<string, string | null>) => {
    try {
      const res = await fetch(`/api/entries/${entryId}/flags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flags),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "更新に失敗しました");
        return;
      }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      refreshCounts();
      maybeOpenCompleteForEndFlag(data.entry as Entry, flags);
      maybeOfferAcceptancePrompt(data.entry as Entry, flags);
    } catch {
      toast.error("更新に失敗しました");
    }
  };

  const handleFieldUpdate = async (entryId: string, fields: Record<string, unknown>) => {
    try {
      const before = entries.find((e) => e.id === entryId) || null;
      const res = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        toast.error("更新に失敗しました");
        return;
      }
      const data = await res.json();
      const updatedEntry: Entry = data.entry;
      setEntries((prev) => prev.map((e) => (e.id === entryId ? updatedEntry : e)));

      if (!calendarConnected || !before) return;
      const touchedInterview = Object.keys(fields).some((k) => INTERVIEW_DATE_TIME_FIELDS.has(k));
      if (!touchedInterview) return;
      const result = computeTaskSync(before, updatedEntry);
      if (!result) return;
      setTaskDialogEntryId(entryId);
      setTaskDialogAction(result.action);
      setTaskDialogSlots(result.slots);
      setTaskDialogOpen(true);
    } catch {
      toast.error("更新に失敗しました");
    }
  };

  // T-066 Phase 4: タスク同期ダイアログ確認時に各 slot に対し sync-task API を順次呼ぶ
  const handleTaskConfirm = useCallback(async () => {
    if (!taskDialogEntryId || taskDialogSlots.length === 0) return;
    setTaskLoading(true);
    let okCount = 0;
    let errCount = 0;
    let partialCount = 0;
    let scopeError = false;
    let apiDisabled = false;
    let lastErrorMessage: string | null = null;
    try {
      for (const s of taskDialogSlots) {
        try {
          const res = await fetch(`/api/entries/${taskDialogEntryId}/sync-task`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot: s.slot, action: taskDialogAction }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.success) {
            okCount++;
            if (data?.partial) partialCount++;
          } else if (data?.skipped) {
            // incomplete 等。サイレントに無視
          } else if (res.status === 403 && data?.error === "scope_insufficient") {
            scopeError = true;
            errCount++;
          } else if (res.status === 403 && data?.error === "api_disabled") {
            apiDisabled = true;
            if (data?.message) lastErrorMessage = data.message;
            errCount++;
          } else {
            if (data?.message) lastErrorMessage = data.message;
            errCount++;
          }
        } catch {
          errCount++;
        }
      }
      if (apiDisabled) {
        toast.error("Google Tasks API が未有効です。Google Cloud Console で Tasks API を有効化してください。", { duration: 10000 });
      } else if (scopeError) {
        toast.error("Google 再認証が必要です。ダッシュボードの「再認証」から再連携してください。");
      } else if (okCount > 0 && errCount === 0) {
        const verb = taskDialogAction === "create" ? "追加" : taskDialogAction === "update" ? "変更" : "完了";
        if (partialCount > 0) {
          toast.warning(`${okCount}件を${verb}しましたが、一部（カレンダー予定 / タスクのいずれか）は同期できませんでした`);
        } else {
          toast.success(`${okCount}件のカレンダー予定とタスクを${verb}しました`);
        }
      } else if (okCount > 0 && errCount > 0) {
        toast.error(`${okCount}件成功、${errCount}件失敗しました`);
      } else if (errCount > 0) {
        toast.error(lastErrorMessage || "Google ToDo の同期に失敗しました");
      }
    } finally {
      setTaskLoading(false);
      setTaskDialogOpen(false);
      setTaskDialogSlots([]);
      setTaskDialogEntryId(null);
      fetchEntries();
    }
  }, [taskDialogEntryId, taskDialogSlots, taskDialogAction, fetchEntries]);

  const openUrlEditModal = (entryId: string, currentUrl: string | null) => {
    setUrlModalEntryId(entryId);
    setUrlInput(currentUrl || "");
  };

  const handleBulkArchive = async (selectedEntries: Entry[]) => {
    const lines = selectedEntries
      .slice(0, 10)
      .map((e) => `・${e.candidate.name} / ${e.companyName}`)
      .join("\n");
    const more = selectedEntries.length > 10 ? `\n他${selectedEntries.length - 10}件...` : "";
    const msg = `選択した${selectedEntries.length}件のエントリーをアーカイブしますか？\n\nアーカイブしたエントリーは30日後に自動削除されます。管理者は即座に削除できます。\n\n対象:\n${lines}${more}`;
    if (!confirm(msg)) return;

    try {
      const res = await fetch("/api/entries/bulk-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: selectedEntries.map((e) => e.id) }),
      });
      if (!res.ok) {
        toast.error("アーカイブに失敗しました");
        return;
      }
      const data = await res.json();
      toast.success(`${data.archived}件をアーカイブしました`);
      const archivedIds = new Set(selectedEntries.map((e) => e.id));
      setSelectedIds(new Set());
      if (!includeArchived) {
        setEntries((prev) => prev.filter((e) => !archivedIds.has(e.id)));
      }
      refreshCounts();
    } catch {
      toast.error("アーカイブに失敗しました");
    }
  };

  const handleUnarchive = async (entryId: string) => {
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivedAt: null }),
      });
      if (!res.ok) {
        toast.error("アーカイブ解除に失敗しました");
        return;
      }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data.entry : e)));
      toast.success("アーカイブを解除しました");
      refreshCounts();
    } catch {
      toast.error("アーカイブ解除に失敗しました");
    }
  };

  const handleHardDelete = async (entry: Entry) => {
    if (!isAdmin) return;
    const msg = `この操作は取り消せません。\n\n以下のエントリーをデータベースから完全に削除しますか？\n\n・${entry.candidate.name} / ${entry.companyName}`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("完全削除に失敗しました");
        return;
      }
      toast.success("完全に削除しました");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(entry.id); return n; });
      refreshCounts();
    } catch {
      toast.error("完全削除に失敗しました");
    }
  };

  const handleCreateTasks = async (selectedEntries: Entry[]) => {
    const CATEGORY_NAME = "エントリー対応（求職者対応）";
    const CATEGORY_NAME_FALLBACK = "エントリー対応";

    // 求職者ごとにグルーピング
    const byCandidate = new Map<string, { name: string; candidateNumber: string; entries: Entry[] }>();
    for (const e of selectedEntries) {
      const existing = byCandidate.get(e.candidateId);
      if (existing) {
        existing.entries.push(e);
      } else {
        byCandidate.set(e.candidateId, {
          name: e.candidate.name,
          candidateNumber: e.candidate.candidateNumber,
          entries: [e],
        });
      }
    }

    // エントリー日: entries内で最新の日付を YYYY-MM-DD 形式で返す
    const latestEntryDate = (es: Entry[]): string => {
      const times = es
        .map((e) => (e.entryDate ? new Date(e.entryDate).getTime() : NaN))
        .filter((t) => !isNaN(t));
      if (times.length === 0) return "";
      const d = new Date(Math.max(...times));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const buildDescription = (es: Entry[]): string => {
      const lines = es.map((e) => {
        const db = e.entryRoute || e.jobDb || "";
        const jobId = e.entryJobId || e.externalJobNo;
        const idPart = jobId ? `｜ID:${jobId}` : "";
        return `${db}｜${e.companyName}｜${e.jobTitle || ""}${idPart}`;
      }).join("\n");
      return `以下企業へエントリー対応お願いします\n\n${lines}`;
    };

    // 1名のみ: タスク作成画面へ遷移
    if (byCandidate.size === 1) {
      const [candidateId, info] = [...byCandidate.entries()][0];
      const params = new URLSearchParams({
        prefill: "entry",
        candidateId,
        categoryName: CATEGORY_NAME,
        assignees: "1000025",
        title: `エントリー対応依頼 - ${info.name}`,
        entryDate: latestEntryDate(info.entries),
        entryCount: String(info.entries.length),
        entryDescription: buildDescription(info.entries),
        step: "5",
      });
      window.location.href = `/tasks/new?${params.toString()}`;
      return;
    }

    // 複数名: APIを直接叩いて一括作成
    try {
      const [catRes, empRes] = await Promise.all([
        fetch("/api/task-categories?includeFields=true"),
        fetch("/api/employees"),
      ]);
      const catJson = await catRes.json();
      const empJson = await empRes.json();
      type CatField = { id: string; label: string };
      type Cat = { id: string; name: string; fields: CatField[] };
      const categories: Cat[] = catJson.categories || [];
      const employees: { id: string; employeeNo: string }[] = Array.isArray(empJson) ? empJson : [];
      const category =
        categories.find((c) => c.name === CATEGORY_NAME) ||
        categories.find((c) => c.name === CATEGORY_NAME_FALLBACK) ||
        categories.find((c) => c.name.includes("エントリー対応"));
      if (!category) {
        toast.error("カテゴリ「エントリー対応（求職者対応）」が見つかりません");
        return;
      }
      const assigneeIds = ["1000025"]
        .map((num) => employees.find((e) => e.employeeNo === num)?.id)
        .filter((id): id is string => !!id);
      if (assigneeIds.length === 0) {
        toast.error("担当者が見つかりません");
        return;
      }

      // テンプレートフィールドのID解決
      const entryDateField = category.fields.find((f) => f.label === "エントリー日");
      const entryCountField = category.fields.find((f) => f.label === "エントリー件数");

      let ok = 0;
      let fail = 0;
      for (const [cid, info] of byCandidate.entries()) {
        const fieldValues: { fieldId: string; value: string }[] = [];
        if (entryDateField) fieldValues.push({ fieldId: entryDateField.id, value: latestEntryDate(info.entries) });
        if (entryCountField) fieldValues.push({ fieldId: entryCountField.id, value: String(info.entries.length) });

        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: `エントリー対応依頼 - ${info.name}`,
              description: buildDescription(info.entries),
              categoryId: category.id,
              candidateId: cid,
              priority: "MEDIUM",
              assigneeIds,
              completionType: "any",
              fieldValues,
            }),
          });
          if (res.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
      if (fail === 0) {
        toast.success(`${ok}件のエントリータスクを作成しました`);
        setSelectedIds(new Set());
      } else {
        toast.error(`${ok}件成功、${fail}件失敗しました`);
      }
    } catch {
      toast.error("タスク作成に失敗しました");
    }
  };

  const saveJobDbUrl = async () => {
    if (!urlModalEntryId) return;
    setSavingUrl(true);
    try {
      const res = await fetch(`/api/entries/${urlModalEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDbUrl: urlInput.trim() || null }),
      });
      if (!res.ok) { toast.error("保存に失敗しました"); return; }
      const data = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === urlModalEntryId ? { ...e, jobDbUrl: data.entry.jobDbUrl } : e)));
      setUrlModalEntryId(null);
      setUrlInput("");
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSavingUrl(false);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortField(null); setSortDir("asc"); }
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (activeTab !== "全件") params.set("entryFlag", activeTab);
    if (candidateName) params.set("candidateName", candidateName);
    if (companyName) params.set("companyName", companyName);
    if (includeInactive) params.set("includeInactive", "true");
    window.open(`/api/entries/export?${params}`, "_blank");
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-[#374151]">エントリー管理</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8]"
          >
            + 新規登録
          </button>
          <button
            onClick={handleExport}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "text-[#2563EB] border-[#2563EB]"
                : "text-gray-500 hover:text-gray-700 border-transparent"
            }`}
          >
            {tab.label}
            {counts[tab.key] != null && (
              <span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-40">
          <input
            type="text"
            value={candidateName}
            onChange={(e) => { setCandidateName(e.target.value); setPage(1); }}
            placeholder="求職者名で検索"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB] w-full pr-7"
          />
          {candidateName && (
            <button
              type="button"
              onClick={() => { setCandidateName(""); setPage(1); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xs leading-none"
              aria-label="クリア"
            >
              ×
            </button>
          )}
        </div>
        <select
          value={caFilter}
          onChange={(e) => { setCaFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        >
          <option value="">担当CA（全員）</option>
          {caOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="relative w-40">
          <input
            type="text"
            value={companyName}
            onChange={(e) => { setCompanyName(e.target.value); setPage(1); }}
            placeholder="企業名で検索"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB] w-full pr-7"
          />
          {companyName && (
            <button
              type="button"
              onClick={() => { setCompanyName(""); setPage(1); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xs leading-none"
              aria-label="クリア"
            >
              ×
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-[#2563EB]"
          />
          無効も表示
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }}
            className="rounded border-gray-300 text-[#2563EB]"
          />
          アーカイブも表示
        </label>
        {(activeTab === "書類選考" || activeTab === "面接") && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={urlMissingOnly}
              onChange={(e) => { setUrlMissingOnly(e.target.checked); setPage(1); }}
              className="rounded border-gray-300 text-[#2563EB]"
            />
            URL未入力のみ
          </label>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (() => {
        const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
        const candidateIds = new Set(selectedEntries.map((e) => e.candidateId));
        const isSameCandidate = candidateIds.size === 1;
        return (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
            <span className="text-sm font-medium text-[#2563EB]">✓ {selectedIds.size}件選択中</span>
            <button
              onClick={() => setShowBulkFlags(true)}
              className="bg-[#2563EB] text-white rounded-md px-3 py-1 text-sm font-medium hover:bg-[#1D4ED8]"
            >
              一括フラグ変更
            </button>
            <button
              onClick={() => setShowEndNotice(true)}
              disabled={!isSameCandidate}
              title={!isSameCandidate ? "同一求職者のレコードのみ選択してください" : ""}
              className="border border-orange-400 text-orange-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📝 選考終了案内
            </button>
            <button
              onClick={() => setShowBulkEndFlag(true)}
              className="border border-red-300 text-red-500 rounded-md px-3 py-1 text-sm font-medium hover:bg-red-50"
              title="メッセージを作成せずフラグだけを一括更新"
            >
              🚫 選考終了（フラグのみ）
            </button>
            <button
              onClick={() => handleCreateTasks(selectedEntries)}
              className="border border-indigo-400 text-indigo-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-indigo-50"
            >
              📋 タスク作成
            </button>
            <button
              onClick={() => setShowInterviewGuideCopy(true)}
              className="border border-sky-400 text-sky-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-sky-50"
              title="✓した企業の直近の面接日程を一覧コピー"
            >
              📋 面接案内コピー
            </button>
            <button
              onClick={() => handleBulkArchive(selectedEntries)}
              className="border border-red-400 text-red-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-red-50"
            >
              🗑 アーカイブ
            </button>
            <button
              onClick={async () => {
                const names = selectedEntries.map((e) => e.companyName).join("\n");
                try {
                  await navigator.clipboard.writeText(names);
                  toast.success(`${selectedEntries.length}件の社名をコピーしました`);
                } catch {
                  alert(names);
                }
              }}
              className="border border-gray-300 text-gray-600 rounded-md px-3 py-1 text-sm font-medium hover:bg-gray-50"
            >
              社名をコピー
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              選択解除
            </button>
          </div>
        );
      })()}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">該当するエントリーがありません</div>
      ) : (
        <EntryTable
          entries={entries}
          flagData={flagData}
          activeTab={activeTab}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          onFlagUpdate={handleFlagUpdate}
          onFieldUpdate={handleFieldUpdate}
          onJobDbUrlEdit={openUrlEditModal}
          onEntryRouteEdit={(entry) => setRouteModalEntry(entry)}
          onEditEntry={(entry) => setEditEntry(entry)}
          onRowClick={(id) => setDetailEntryId(id)}
          selectedIds={selectedIds}
          onSelectToggle={(id) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
          onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          onDeselectAll={() => setSelectedIds(new Set())}
          isAdmin={isAdmin}
          onUnarchive={handleUnarchive}
          onHardDelete={handleHardDelete}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50"
          >
            &lt;
          </button>
          <span className="text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 text-sm border rounded disabled:opacity-50"
          >
            &gt;
          </button>
        </div>
      )}

      {/* URL Edit Modal */}
      {urlModalEntryId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
          onClick={() => { if (!savingUrl) setUrlModalEntryId(null); }}>
          <div className="bg-white rounded-lg p-5 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-700 mb-3">求人DBのURLを{urlInput ? "編集" : "登録"}</h3>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveJobDbUrl(); }}
              placeholder="求人DBのURLを貼り付け"
              autoFocus
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setUrlModalEntryId(null)}
                disabled={savingUrl}
                className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >キャンセル</button>
              <button
                onClick={saveJobDbUrl}
                disabled={savingUrl}
                className="bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >{savingUrl ? "保存中..." : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailEntryId && flagData && (
        <EntryDetailModal
          entryId={detailEntryId}
          flagData={flagData}
          onClose={() => setDetailEntryId(null)}
          onSaved={fetchEntries}
          calendarConnected={calendarConnected}
          onRequestTaskSync={(entryId, before, after) => openTaskDialogForEntry(entryId, before, after)}
        />
      )}

      {/* Create Modal */}
      {showCreate && flagData && (
        <EntryCreateModal
          flagData={flagData}
          onClose={() => setShowCreate(false)}
          onCreated={fetchEntries}
        />
      )}

      {/* Bulk Flag Change Modal */}
      {showBulkFlags && flagData && (
        <BulkFlagChangeModal
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          flagData={flagData}
          onClose={() => setShowBulkFlags(false)}
          onDone={() => { setShowBulkFlags(false); setSelectedIds(new Set()); fetchEntries(); }}
        />
      )}

      {/* End Notice Modal */}
      {showEndNotice && (
        <EndNoticeModal
          selectedEntries={entries.filter((e) => selectedIds.has(e.id))}
          onClose={() => setShowEndNotice(false)}
          onDone={() => { setShowEndNotice(false); setSelectedIds(new Set()); fetchEntries(); }}
        />
      )}

      {/* T-091: 面接案内コピー */}
      {showInterviewGuideCopy && (
        <InterviewGuideCopyModal
          selectedEntries={entries.filter((e) => selectedIds.has(e.id))}
          onClose={() => setShowInterviewGuideCopy(false)}
        />
      )}

      {/* Bulk End Flag Modal (message-less) */}
      {showBulkEndFlag && (
        <BulkEndFlagModal
          selectedEntries={entries.filter((e) => selectedIds.has(e.id))}
          onClose={() => setShowBulkEndFlag(false)}
          onDone={() => { setShowBulkEndFlag(false); setSelectedIds(new Set()); fetchEntries(); }}
        />
      )}

      {/* Entry Edit Modal */}
      {editEntry && (
        <EntryEditModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={(updated) => {
            setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setEditEntry(null);
            refreshCounts();
          }}
        />
      )}

      {/* Entry Route Switch Modal */}
      {routeModalEntry && (
        <EntryRouteSwitchModal
          entry={routeModalEntry}
          onClose={() => setRouteModalEntry(null)}
          onSaved={(updated) => {
            setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            setRouteModalEntry(null);
          }}
        />
      )}

      {/* T-066 Phase 4: Google ToDo 同期確認ダイアログ */}
      <TaskSyncConfirmDialog
        open={taskDialogOpen}
        action={taskDialogAction}
        slots={taskDialogSlots}
        loading={taskLoading}
        onConfirm={handleTaskConfirm}
        onCancel={() => {
          if (taskLoading) return;
          setTaskDialogOpen(false);
          setTaskDialogSlots([]);
          setTaskDialogEntryId(null);
        }}
      />

      {/* 内定+承諾: 承諾報告タスク作成 確認ダイアログ */}
      {offerAcceptEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOfferAcceptEntry(null)}>
          <div className="bg-white rounded-lg shadow-xl p-6 w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-3 text-[#374151]">承諾報告のタスクを作成しますか？</h3>
            <p className="text-sm text-gray-600 mb-5">
              {offerAcceptEntry.candidate.name}（{offerAcceptEntry.companyName}）の内定承諾報告タスクを作成します。エントリーから取得した値を自動入力した状態で作成画面を開きます。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOfferAcceptEntry(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => { const e = offerAcceptEntry; setOfferAcceptEntry(null); goToOfferAcceptanceTask(e); }}
                className="px-4 py-2 text-sm bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
              >
                作成する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
