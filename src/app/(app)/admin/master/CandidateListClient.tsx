"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { toast } from "sonner";
import CandidateRegistrationModal from "./CandidateRegistrationModal";
import SupportEndModal from "@/components/candidates/SupportEndModal";
import { SUPPORT_END_REASONS, REASON_LABEL_MAP } from "@/lib/constants/support-end-reasons";
import { formatRecruiterName, splitRecruiterDisplay } from "@/lib/recruiterDisplay";
import { FilterShell, FilterTopRow, FilterGroup, FilterField, DateRangeField, FilterClearButton, FILTER_INPUT_CLS } from "@/components/filters/FilterLayout";

const SUPPORT_TABS = [
  { key: "ACTIVE", label: "支援中" },
  { key: "BEFORE", label: "支援前" },
  { key: "WAITING", label: "待機" },
  { key: "ENDED", label: "支援終了" },
  { key: "ALL", label: "ALL" },
  { key: "ARCHIVED", label: "アーカイブ" },
] as const;

const SUPPORT_BADGE: Record<string, { label: string; cls: string }> = {
  BEFORE: { label: "支援前", cls: "bg-gray-100 text-gray-600" },
  ACTIVE: { label: "支援中", cls: "bg-blue-100 text-blue-700" },
  WAITING: { label: "待機", cls: "bg-yellow-100 text-yellow-700" },
  ENDED: { label: "支援終了", cls: "bg-red-100 text-red-600" },
  ARCHIVED: { label: "アーカイブ", cls: "bg-gray-200 text-gray-500" },
};

type Employee = {
  id: string;
  employeeNumber: string;
  name: string;
};

type CandidateRow = {
  id: string;
  candidateNumber: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  employee: { id: string; name: string } | null;
  recruiterName: string | null;
  applicationRoute: string | null;
  mediaSource: string | null;
  // T-101: スカウト応募の応募日 / 配信日
  applicationDate: string | null;
  scoutDeliveryDate: string | null;
  createdAt: string;
  supportStatus: string;
  supportSubStatus: string | null;
  supportEndReason: string | null;
  jobStatus?: "entry" | "introduced" | "before" | null;
};

const SUB_STATUS_BADGE: Record<string, string> = {
  "面談前": "bg-gray-100 text-gray-600",
  "求人紹介前": "bg-gray-100 text-gray-500",
  "BM": "bg-purple-100 text-purple-700",
  "求人紹介": "bg-blue-100 text-blue-700",
  "エントリー": "bg-orange-100 text-orange-700",
  "書類選考": "bg-amber-100 text-amber-700",
  "面接": "bg-teal-100 text-teal-700",
  "内定": "bg-pink-100 text-pink-700",
  "入社済": "bg-emerald-100 text-emerald-700",
  "待機": "bg-yellow-100 text-yellow-700",
  "当社判断": "bg-red-100 text-red-600",
  "本人希望": "bg-red-100 text-red-600",
};

interface CandidateListClientProps {
  initialCandidates: CandidateRow[];
  initialTotalCount: number;
  employees: Employee[];
  currentEmployeeId?: string | null;
  isAdmin?: boolean;
}

type FileBreakdown = Record<string, number>;

type DeletionImpactItem = {
  candidateId: string;
  candidateNumber: string;
  fullName: string;
  counts: {
    interviews: number;
    files: number;
    fileBreakdown: FileBreakdown;
    entries: number;
    jobResponses: number;
    tasks: number;
  };
  hasAnyData: boolean;
};

type DeletionImpactResponse = {
  items: DeletionImpactItem[];
  summary: { total: number; withData: number; clean: number };
};

const PAGE_SIZE = 20;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("ja-JP");
}

// T-101 / 罠#17: 応募日・配信日は必ず Asia/Tokyo 基準で日付文字列化する。
// 比較用（YYYY-MM-DD）と表示用（YYYY/MM/DD）の両方をJSTで生成。
function jstDateStr(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function fmtJstSlash(iso: string | null): string {
  const s = jstDateStr(iso);
  return s ? s.replace(/-/g, "/") : "-";
}

function formatGender(gender: string | null) {
  if (!gender) return "-";
  switch (gender) {
    case "male":
      return "男性";
    case "female":
      return "女性";
    case "other":
      return "その他";
    default:
      return "-";
  }
}

export default function CandidateListClient({
  initialCandidates,
  initialTotalCount,
  employees,
  currentEmployeeId,
  isAdmin = false,
}: CandidateListClientProps) {
  const [candidates, setCandidates] = useState<CandidateRow[]>(initialCandidates);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("ACTIVE");
  const [endModalCandidateId, setEndModalCandidateId] = useState<string | null>(null);
  const [caFilter, setCaFilter] = useState(currentEmployeeId || "ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [genderFilter, setGenderFilter] = useState("ALL");
  const [endReasonFilter, setEndReasonFilter] = useState("ALL");
  // T-064: スカウト関連フィルター
  const [routeFilter, setRouteFilter] = useState("ALL");
  const [mediaFilter, setMediaFilter] = useState("ALL");
  // T-101: 応募日 / 配信日 範囲フィルター（JST）
  const [appDateFrom, setAppDateFrom] = useState("");
  const [appDateTo, setAppDateTo] = useState("");
  const [delDateFrom, setDelDateFrom] = useState("");
  const [delDateTo, setDelDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAssigneeModalOpen, setBulkAssigneeModalOpen] = useState(false);
  const [bulkStatusModalOpen, setBulkStatusModalOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState("");
  const [bulkEndReasons, setBulkEndReasons] = useState<Record<string, string>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [hardDeleteModalOpen, setHardDeleteModalOpen] = useState(false);
  const [hardDeleteImpact, setHardDeleteImpact] =
    useState<DeletionImpactResponse | null>(null);
  const [hardDeleteAck, setHardDeleteAck] = useState(false);
  const [hardDeleteLoading, setHardDeleteLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const filtered = useMemo(() => {
    let result = candidates;
    if (supportTab === "ALL") {
      result = result.filter((c) => c.supportStatus !== "ARCHIVED");
    } else {
      result = result.filter((c) => c.supportStatus === supportTab);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.candidateNumber.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.nameKana && c.nameKana.toLowerCase().includes(q)) ||
          (c.employee?.name && c.employee.name.toLowerCase().includes(q))
      );
    }
    if (caFilter !== "ALL") {
      result = result.filter((c) => c.employee?.id === caFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter((c) => new Date(c.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59");
      result = result.filter((c) => new Date(c.createdAt) <= to);
    }
    if (genderFilter !== "ALL") {
      result = result.filter((c) => c.gender === genderFilter);
    }
    if (endReasonFilter !== "ALL") {
      result = result.filter((c) => c.supportEndReason === endReasonFilter);
    }
    if (routeFilter !== "ALL") {
      result = result.filter((c) => (c.applicationRoute || "") === routeFilter);
    }
    if (mediaFilter !== "ALL") {
      result = result.filter((c) => (c.mediaSource || "") === mediaFilter);
    }
    // T-101: 応募日 / 配信日 範囲フィルター（JST日付文字列で境界比較）
    if (appDateFrom) {
      result = result.filter((c) => { const d = jstDateStr(c.applicationDate); return !!d && d >= appDateFrom; });
    }
    if (appDateTo) {
      result = result.filter((c) => { const d = jstDateStr(c.applicationDate); return !!d && d <= appDateTo; });
    }
    if (delDateFrom) {
      result = result.filter((c) => { const d = jstDateStr(c.scoutDeliveryDate); return !!d && d >= delDateFrom; });
    }
    if (delDateTo) {
      result = result.filter((c) => { const d = jstDateStr(c.scoutDeliveryDate); return !!d && d <= delDateTo; });
    }
    return result;
  }, [candidates, debouncedSearch, supportTab, caFilter, dateFrom, dateTo, genderFilter, endReasonFilter, routeFilter, mediaFilter, appDateFrom, appDateTo, delDateFrom, delDateTo]);

  const tabCounts = useMemo(() => {
    // Apply all filters except supportTab so counts reflect current filter state
    let base = candidates;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      base = base.filter(
        (c) =>
          c.candidateNumber.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.nameKana && c.nameKana.toLowerCase().includes(q)) ||
          (c.employee?.name && c.employee.name.toLowerCase().includes(q))
      );
    }
    if (caFilter !== "ALL") {
      base = base.filter((c) => c.employee?.id === caFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      base = base.filter((c) => new Date(c.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59");
      base = base.filter((c) => new Date(c.createdAt) <= to);
    }
    if (genderFilter !== "ALL") {
      base = base.filter((c) => c.gender === genderFilter);
    }
    const counts: Record<string, number> = { ALL: 0, BEFORE: 0, ACTIVE: 0, WAITING: 0, ENDED: 0, ARCHIVED: 0 };
    for (const c of base) {
      counts[c.supportStatus] = (counts[c.supportStatus] || 0) + 1;
      if (c.supportStatus !== "ARCHIVED") counts.ALL += 1;
    }
    return counts;
  }, [candidates, debouncedSearch, caFilter, dateFrom, dateTo, genderFilter]);

  const handleSupportStatusChange = async (candidateId: string, newStatus: string) => {
    if (newStatus === "ENDED") {
      setEndModalCandidateId(candidateId);
      return;
    }
    try {
      const res = await fetch(`/api/candidates/${candidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportStatus: newStatus }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        const updated = json?.candidate;
        setCandidates((prev) => prev.map((c) => c.id === candidateId ? {
          ...c,
          supportStatus: newStatus,
          supportSubStatus: updated?.supportSubStatus ?? null,
          supportEndReason: null,
        } : c));
        toast.success("更新しました");
      }
    } catch { toast.error("更新に失敗しました"); }
  };

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const skip = (safePage - 1) * PAGE_SIZE;
  const pageData = filtered.slice(skip, skip + PAGE_SIZE);

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/master/candidates?include=employee");
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates);
        setTotalCount(data.total);
      }
    } catch {
      // silent
    }
  }, []);

  // T-115: 別画面で基本情報を編集して戻ったとき、一覧を自動で最新化する。
  // window focus / visibilitychange(visible復帰) / pageshow(同一タブのブラウザバック=bfcache復元) で再取得。
  // フィルタ・ページング・検索の state は別管理のため、refreshCandidates は条件を維持したままデータのみ差し替える。
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshRef.current < 1000) return; // focus と visibilitychange の同時発火など多重取得を抑制
      lastRefreshRef.current = now;
      refreshCandidates();
    };
    const onFocus = () => maybeRefresh();
    const onVisible = () => { if (document.visibilityState === "visible") maybeRefresh(); };
    const onPageShow = () => maybeRefresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refreshCandidates]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === pageData.length && pageData.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pageData.map((c) => c.id));
    }
  };

  const executeBulkAction = async (
    action: string,
    payload?: Record<string, unknown>
  ) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/master/candidates/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, candidateIds: selectedIds, payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "操作に失敗しました");
        return;
      }
      toast.success(data.message);
      setSelectedIds([]);
      refreshCandidates();
    } catch {
      toast.error("操作に失敗しました");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkArchive = () => {
    if (selectedIds.length > 20) {
      toast.error("一括操作は最大20件までです");
      return;
    }
    if (
      !window.confirm(
        `${selectedIds.length}件の求職者をアーカイブしますか？\n（後でアーカイブタブから復元できます）`
      )
    )
      return;
    executeBulkAction("archive");
  };

  const handleBulkUnarchive = () => {
    if (
      !window.confirm(
        `${selectedIds.length}件のアーカイブを解除しますか？（支援中に戻ります）`
      )
    )
      return;
    executeBulkAction("change_status", { newStatus: "ACTIVE" });
  };

  const handleHardDeleteClick = async () => {
    if (selectedIds.length === 0) return;
    setHardDeleteLoading(true);
    try {
      const res = await fetch(
        "/api/admin/candidates/check-deletion-impact",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateIds: selectedIds }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "事前チェックに失敗しました");
        return;
      }
      setHardDeleteImpact(data as DeletionImpactResponse);
      setHardDeleteAck(false);
      setHardDeleteModalOpen(true);
    } catch {
      toast.error("事前チェックに失敗しました");
    } finally {
      setHardDeleteLoading(false);
    }
  };

  const executeHardDelete = async () => {
    if (!hardDeleteImpact) return;
    const hasWithData = hardDeleteImpact.summary.withData > 0;
    if (hasWithData && !hardDeleteAck) {
      toast.error("確認チェックボックスにチェックしてください");
      return;
    }
    setHardDeleteLoading(true);
    try {
      const res = await fetch("/api/admin/candidates/hard-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateIds: hardDeleteImpact.items.map((i) => i.candidateId),
          confirmedHasData: hasWithData,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "完全削除に失敗しました");
        return;
      }
      toast.success(`${data.deletedCount}件を完全削除しました`);
      setHardDeleteModalOpen(false);
      setHardDeleteImpact(null);
      setHardDeleteAck(false);
      setSelectedIds([]);
      refreshCandidates();
    } catch {
      toast.error("完全削除に失敗しました");
    } finally {
      setHardDeleteLoading(false);
    }
  };

  const submitBulkAssignee = (newAssigneeUserId: string) => {
    const emp = employees.find((e) => e.id === newAssigneeUserId);
    if (
      !window.confirm(
        `${selectedIds.length}件の担当CAを「${emp?.name}」に変更しますか？`
      )
    )
      return;
    setBulkAssigneeModalOpen(false);
    executeBulkAction("change_assignee", { newAssigneeUserId });
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selectedIds.includes(c.id)),
    [candidates, selectedIds]
  );

  const submitBulkStatus = (
    newStatus: string,
    endReasons?: Record<string, string>
  ) => {
    const labels: Record<string, string> = {
      BEFORE: "支援前",
      ACTIVE: "支援中",
      WAITING: "待機",
      ENDED: "支援終了",
    };
    if (newStatus === "ENDED" && endReasons) {
      const summary = selectedCandidates
        .map(
          (c) =>
            `・${c.name}（${REASON_LABEL_MAP[endReasons[c.id]] || ""}）`
        )
        .join("\n");
      if (
        !window.confirm(
          `以下の求職者を支援終了にしてよろしいですか？\n\n${summary}`
        )
      )
        return;
      setBulkStatusModalOpen(false);
      executeBulkAction("change_status", { newStatus, endReasons });
    } else {
      if (
        !window.confirm(
          `${selectedIds.length}件の支援状況を「${labels[newStatus]}」に変更しますか？`
        )
      )
        return;
      setBulkStatusModalOpen(false);
      executeBulkAction("change_status", { newStatus });
    }
  };

  const displayTotal = debouncedSearch.trim() ? totalFiltered : totalCount;
  const displayStart = totalFiltered > 0 ? skip + 1 : 0;
  const displayEnd = Math.min(skip + PAGE_SIZE, totalFiltered);

  return (
    <>
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#374151]">
            求職者管理
          </h1>
          <p className="mt-2 text-[14px] text-[#374151]/80">
            求職者の基本情報を管理します
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] transition-colors"
        >
          + 新規登録
        </button>
      </div>

      {/* 支援ステータスタブ */}
      <div className="mt-4 flex border-b border-gray-200">
        {SUPPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setSupportTab(tab.key); setCurrentPage(1); setSelectedIds([]); if (tab.key !== "ENDED") setEndReasonFilter("ALL"); setCaFilter(tab.key === "ACTIVE" && currentEmployeeId ? currentEmployeeId : "ALL"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              supportTab === tab.key
                ? "text-[#2563EB] border-[#2563EB]"
                : "text-gray-500 hover:text-gray-700 border-transparent"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
              {tabCounts[tab.key] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* フィルタ（T-105: 上段 担当者/期間/検索 ＋ 下段 区分 の2段） */}
      <FilterShell>
        <FilterTopRow>
          {/* 担当者 */}
          <FilterGroup label="担当者">
            <FilterField label="担当CA">
              <select
                value={caFilter}
                onChange={(e) => { setCaFilter(e.target.value); setCurrentPage(1); }}
                className={`w-40 ${FILTER_INPUT_CLS}`}
              >
                <option value="ALL">ALL</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </FilterField>
          </FilterGroup>

          {/* 期間 */}
          <FilterGroup label="期間">
            <DateRangeField label="登録日" from={dateFrom} to={dateTo}
              onFrom={(v) => { setDateFrom(v); setCurrentPage(1); }} onTo={(v) => { setDateTo(v); setCurrentPage(1); }} />
            <DateRangeField label="応募日" from={appDateFrom} to={appDateTo}
              onFrom={(v) => { setAppDateFrom(v); setCurrentPage(1); }} onTo={(v) => { setAppDateTo(v); setCurrentPage(1); }} />
            <DateRangeField label="配信日" from={delDateFrom} to={delDateTo}
              onFrom={(v) => { setDelDateFrom(v); setCurrentPage(1); }} onTo={(v) => { setDelDateTo(v); setCurrentPage(1); }} />
          </FilterGroup>
        </FilterTopRow>

        {/* 2段目: 検索（左端） + 区分 */}
        <FilterTopRow>
          {/* 検索 */}
          <FilterGroup label="検索">
            <FilterField label="フリー検索">
              <input
                type="text"
                placeholder="求職者ID、氏名、担当CA"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-56 ${FILTER_INPUT_CLS}`}
              />
            </FilterField>
            {(caFilter !== "ALL" || dateFrom || dateTo || genderFilter !== "ALL" || endReasonFilter !== "ALL" || routeFilter !== "ALL" || mediaFilter !== "ALL" || appDateFrom || appDateTo || delDateFrom || delDateTo) && (
              <FilterClearButton onClick={() => {
                setCaFilter("ALL");
                setDateFrom("");
                setDateTo("");
                setGenderFilter("ALL");
                setEndReasonFilter("ALL");
                setRouteFilter("ALL");
                setMediaFilter("ALL");
                setAppDateFrom("");
                setAppDateTo("");
                setDelDateFrom("");
                setDelDateTo("");
                // フリー検索もクリア（debouncedSearch も即時に空へ＝結果も全件に戻す）
                setSearch("");
                setDebouncedSearch("");
                setCurrentPage(1);
              }} />
            )}
          </FilterGroup>

          {/* 区分 */}
          <FilterGroup label="区分">
            <FilterField label="経路">
              <select
                value={routeFilter}
                onChange={(e) => { setRouteFilter(e.target.value); setCurrentPage(1); }}
                className={`w-32 ${FILTER_INPUT_CLS}`}
              >
                <option value="ALL">ALL</option>
                <option value="スカウト">スカウト</option>
                <option value="応募">応募</option>
              </select>
            </FilterField>
            <FilterField label="媒体">
              <select
                value={mediaFilter}
                onChange={(e) => { setMediaFilter(e.target.value); setCurrentPage(1); }}
                className={`w-40 ${FILTER_INPUT_CLS}`}
              >
                <option value="ALL">ALL</option>
                <option value="マイナビ転職">マイナビ転職</option>
                <option value="マイナビエージェント">マイナビエージェント</option>
                <option value="indeed">indeed</option>
                <option value="日経HR">日経HR</option>
                <option value="自社HP">自社HP</option>
                <option value="dodaMaps">dodaMaps</option>
              </select>
            </FilterField>
            <FilterField label="性別">
              <select
                value={genderFilter}
                onChange={(e) => { setGenderFilter(e.target.value); setCurrentPage(1); }}
                className={`w-32 ${FILTER_INPUT_CLS}`}
              >
                <option value="ALL">ALL</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
              </select>
            </FilterField>
            {supportTab === "ENDED" && (
              <FilterField label="終了理由">
                <select
                  value={endReasonFilter}
                  onChange={(e) => { setEndReasonFilter(e.target.value); setCurrentPage(1); }}
                  className={`w-40 ${FILTER_INPUT_CLS}`}
                >
                  <option value="ALL">ALL</option>
                  {SUPPORT_END_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </FilterField>
            )}
          </FilterGroup>
        </FilterTopRow>
      </FilterShell>

      {/* 選択中ツールバー */}
      {selectedIds.length > 0 && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <span className="font-medium text-sm text-blue-800">
            選択中 {selectedIds.length}件
          </span>
          {supportTab !== "ARCHIVED" ? (
            <>
              <button
                onClick={handleBulkArchive}
                disabled={bulkLoading}
                className="bg-red-500 text-white px-3 py-1.5 rounded text-sm hover:bg-red-600 disabled:opacity-50"
              >
                アーカイブ
              </button>
              <button
                onClick={() => setBulkAssigneeModalOpen(true)}
                disabled={bulkLoading}
                className="bg-[#2563EB] text-white px-3 py-1.5 rounded text-sm hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                担当CA変更
              </button>
              <button
                onClick={() => { setBulkStatusValue(""); setBulkEndReasons({}); setBulkStatusModalOpen(true); }}
                disabled={bulkLoading}
                className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                支援状況変更
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleBulkUnarchive}
                disabled={bulkLoading}
                className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                アーカイブ解除（支援中に戻す）
              </button>
              {isAdmin && (
                <button
                  onClick={handleHardDeleteClick}
                  disabled={bulkLoading || hardDeleteLoading || selectedIds.length === 0}
                  className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  完全削除
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setSelectedIds([])}
            className="ml-auto text-sm text-gray-500 hover:text-gray-700"
          >
            選択解除
          </button>
        </div>
      )}

      {/* テーブル */}
      <div className="mt-4 rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div className="p-4">
          <TableWrap>
            <Table className="table-fixed w-full">
              <colgroup>
                <col style={{ width: "3%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "4%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
              </colgroup>
              <thead>
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      checked={selectedIds.length === pageData.length && pageData.length > 0}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </Th>
                  <Th>求職者番号</Th>
                  <Th>氏名</Th>
                  <Th>フリガナ</Th>
                  <Th>性別</Th>
                  <Th>担当CA</Th>
                  {/* T-101 */}
                  <Th>応募日 / 配信日</Th>
                  <Th>経路</Th>
                  <Th>担当RC</Th>
                  <Th>登録日時</Th>
                  <Th>支援状況</Th>
                  <Th>ステータス</Th>
                </tr>
              </thead>
              <tbody>
                {pageData.map((cand) => (
                  <tr key={cand.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(cand.id)}
                        onChange={() => toggleSelect(cand.id)}
                        className="cursor-pointer"
                      />
                    </Td>
                    <Td className="overflow-hidden">
                      <div className="font-mono text-[13px] truncate">
                        {cand.candidateNumber}
                      </div>
                    </Td>
                    <Td className="overflow-hidden">
                      <Link
                        href={`/candidates/${cand.id}`}
                        className="block truncate text-[#2563EB] hover:underline cursor-pointer"
                        title={cand.name}
                      >
                        {cand.name}
                      </Link>
                    </Td>
                    <Td className="overflow-hidden">
                      <div className="truncate text-[13px] text-[#374151]/70" title={cand.nameKana || ""}>
                        {cand.nameKana || "-"}
                      </div>
                    </Td>
                    <Td className="overflow-hidden">
                      <div className="truncate text-[13px]">
                        {formatGender(cand.gender)}
                      </div>
                    </Td>
                    <Td className="overflow-hidden">
                      <div className="truncate text-[13px]" title={cand.employee?.name || ""}>
                        {cand.employee?.name || "-"}
                      </div>
                    </Td>
                    {/* T-101: 応募日 / 配信日 */}
                    <Td className="overflow-hidden">
                      <div className="truncate text-[13px]">{fmtJstSlash(cand.applicationDate)}</div>
                      <div className="truncate text-[11px] text-gray-500">{fmtJstSlash(cand.scoutDeliveryDate)}</div>
                    </Td>
                    {/* T-101: 経路（媒体）。マイナビ転職/エージェントの判別のため省略せず全文折り返し表示 */}
                    <Td className="whitespace-normal break-words">
                      <div className="text-[13px] break-words" title={cand.mediaSource || ""}>
                        {cand.mediaSource || "-"}
                      </div>
                    </Td>
                    <Td className="whitespace-normal break-words">
                      {(() => {
                        const rc = splitRecruiterDisplay(cand.recruiterName);
                        return (
                          <div className="text-[13px]" title={formatRecruiterName(cand.recruiterName) || "-"}>
                            <div>{rc.name}</div>
                            {rc.unit && <div className="text-[11px] text-gray-500">{rc.unit}</div>}
                          </div>
                        );
                      })()}
                    </Td>
                    <Td className="overflow-hidden">
                      <div className="truncate font-mono text-[12px] text-[#374151]/70">
                        {formatDate(cand.createdAt)}
                      </div>
                    </Td>
                    <Td>
                      {cand.supportStatus === "ARCHIVED" ? (
                        <span className="inline-flex items-center justify-center text-xs px-3 py-1 rounded-full bg-gray-200 text-gray-500 min-w-[96px]">
                          アーカイブ
                        </span>
                      ) : cand.supportStatus === "ENDED" ? (
                        <button
                          onClick={() => setEndModalCandidateId(cand.id)}
                          title={cand.supportEndReason ? REASON_LABEL_MAP[cand.supportEndReason] || "" : ""}
                          className="inline-flex items-center justify-center text-xs px-3 py-1 rounded-full bg-red-100 text-red-600 cursor-pointer hover:bg-red-200 min-w-[96px]"
                        >
                          終了{cand.supportEndReason ? `(${REASON_LABEL_MAP[cand.supportEndReason]?.slice(0, 6) || ""})` : ""}
                        </button>
                      ) : (
                        <select
                          value={cand.supportStatus}
                          onChange={(e) => handleSupportStatusChange(cand.id, e.target.value)}
                          className={`text-xs px-3 py-1 rounded-full border-0 cursor-pointer min-w-[96px] text-center ${SUPPORT_BADGE[cand.supportStatus]?.cls || "bg-gray-100 text-gray-600"}`}
                        >
                          <option value="BEFORE">支援前</option>
                          <option value="ACTIVE">支援中</option>
                          <option value="WAITING">待機</option>
                          <option value="ENDED">支援終了</option>
                        </select>
                      )}
                    </Td>
                    <Td>
                      {cand.supportSubStatus && (
                        <span className={`inline-flex items-center justify-center text-xs px-3 py-1 rounded-full min-w-[96px] ${SUB_STATUS_BADGE[cand.supportSubStatus] || "bg-gray-100 text-gray-600"}`}>
                          {cand.supportSubStatus}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
                {pageData.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="py-8 text-center text-[14px] text-[#374151]/60"
                    >
                      {debouncedSearch.trim()
                        ? "該当する求職者が見つかりません"
                        : "求職者が登録されていません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>

          {/* ページネーション */}
          <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-4">
            <div className="text-[13px] text-[#374151]/70">
              {debouncedSearch.trim() && (
                <span className="mr-2 text-[#2563EB]">
                  検索結果: {totalFiltered}件 /
                </span>
              )}
              全 {displayTotal.toLocaleString()} 件中{" "}
              {totalFiltered > 0
                ? `${displayStart}〜${displayEnd} 件を表示`
                : "0 件"}
            </div>
            <div className="flex items-center gap-2">
              {safePage > 1 ? (
                <button
                  onClick={() => setCurrentPage(safePage - 1)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                >
                  前へ
                </button>
              ) : (
                <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                  前へ
                </span>
              )}
              <span className="text-[13px] text-[#374151]">
                {safePage} / {totalPages}
              </span>
              {safePage < totalPages ? (
                <button
                  onClick={() => setCurrentPage(safePage + 1)}
                  className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]"
                >
                  次へ
                </button>
              ) : (
                <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">
                  次へ
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 新規登録モーダル */}
      <CandidateRegistrationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        employees={employees}
        onCreated={refreshCandidates}
      />
      {endModalCandidateId && (
        <SupportEndModal
          candidateId={endModalCandidateId}
          onClose={() => setEndModalCandidateId(null)}
          onSaved={() => { setEndModalCandidateId(null); refreshCandidates(); }}
        />
      )}

      {/* 一括担当CA変更モーダル */}
      {bulkAssigneeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[400px]">
            <h3 className="text-base font-semibold mb-4">
              担当CA一括変更（{selectedIds.length}件）
            </h3>
            <select
              id="bulk-assignee-select"
              defaultValue=""
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            >
              <option value="" disabled>
                担当CAを選択してください
              </option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setBulkAssigneeModalOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const sel = (
                    document.getElementById(
                      "bulk-assignee-select"
                    ) as HTMLSelectElement
                  )?.value;
                  if (!sel) {
                    toast.error("担当CAを選択してください");
                    return;
                  }
                  submitBulkAssignee(sel);
                }}
                className="px-4 py-2 text-sm bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8]"
              >
                変更する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一括支援状況変更モーダル */}
      {bulkStatusModalOpen && (() => {
        const canSubmitStatus =
          !!bulkStatusValue &&
          (bulkStatusValue !== "ENDED" ||
            selectedCandidates.every((c) => bulkEndReasons[c.id]));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
              <h3 className="text-base font-semibold mb-4">
                支援状況一括変更（{selectedIds.length}件）
              </h3>
              <select
                value={bulkStatusValue}
                onChange={(e) => {
                  setBulkStatusValue(e.target.value);
                  setBulkEndReasons({});
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
              >
                <option value="" disabled>
                  変更先の支援状況を選択してください
                </option>
                <option value="BEFORE">支援前</option>
                <option value="ACTIVE">支援中</option>
                <option value="WAITING">待機</option>
                <option value="ENDED">支援終了</option>
              </select>

              {bulkStatusValue === "ENDED" && (
                <div className="border-t pt-4 mt-4 space-y-4">
                  <div className="text-sm font-medium text-gray-700">
                    終了理由の選択
                  </div>
                  <div className="bg-blue-50 p-3 rounded-md">
                    <label className="text-xs text-gray-600 block mb-1">
                      全員に同じ理由を適用:
                    </label>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const next: Record<string, string> = {};
                        selectedCandidates.forEach(
                          (c) => (next[c.id] = e.target.value)
                        );
                        setBulkEndReasons(next);
                      }}
                      className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                    >
                      <option value="">選択してください</option>
                      {SUPPORT_END_REASONS.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">
                      個別に終了理由を選択してください:
                    </div>
                    {selectedCandidates.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-2"
                      >
                        <span className="w-28 text-sm truncate shrink-0" title={c.name}>
                          {c.name}
                        </span>
                        <select
                          value={bulkEndReasons[c.id] || ""}
                          onChange={(e) =>
                            setBulkEndReasons((prev) => ({
                              ...prev,
                              [c.id]: e.target.value,
                            }))
                          }
                          className={`flex-1 border rounded-md px-2 py-1.5 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none ${
                            bulkEndReasons[c.id]
                              ? "border-gray-300"
                              : "border-red-300 bg-red-50"
                          }`}
                        >
                          <option value="">選択してください</option>
                          {SUPPORT_END_REASONS.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setBulkStatusModalOpen(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    if (!bulkStatusValue) {
                      toast.error("支援状況を選択してください");
                      return;
                    }
                    submitBulkStatus(
                      bulkStatusValue,
                      bulkStatusValue === "ENDED"
                        ? bulkEndReasons
                        : undefined
                    );
                  }}
                  disabled={!canSubmitStatus}
                  className={`px-4 py-2 text-sm rounded-md ${
                    canSubmitStatus
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {bulkStatusValue === "ENDED"
                    ? "支援終了に変更"
                    : "変更する"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 完全削除確認モーダル */}
      {hardDeleteModalOpen && hardDeleteImpact && (() => {
        const total = hardDeleteImpact.summary.total;
        const withData = hardDeleteImpact.summary.withData;
        const hasWithData = withData > 0;
        const itemsWithData = hardDeleteImpact.items.filter((i) => i.hasAnyData);
        const canSubmit = !hasWithData || hardDeleteAck;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-xl p-6 w-[640px] max-h-[85vh] overflow-y-auto">
              {hasWithData ? (
                <h3 className="text-base font-semibold mb-3 text-red-700">
                  ⚠️ 関連データが残っている求職者が含まれています
                </h3>
              ) : (
                <h3 className="text-base font-semibold mb-3">
                  {total}件を完全削除します
                </h3>
              )}

              {hasWithData ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    以下の求職者には関連データ（面談記録・書類・エントリー等）が残っています。
                    この操作は<span className="font-semibold text-red-600">元に戻せません</span>。
                  </p>
                  <p className="text-sm text-gray-700">
                    関連データを持つ求職者: <span className="font-semibold">{withData}名</span>
                    （全{total}件中）
                  </p>
                  <div className="border border-gray-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600">求職者番号</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600">氏名</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600">面談</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600">書類</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600">エントリー</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600">マイページ回答</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-600">タスク</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsWithData.map((i) => (
                          <tr key={i.candidateId} className="border-t border-gray-200">
                            <td className="px-2 py-1.5 font-mono">{i.candidateNumber}</td>
                            <td className="px-2 py-1.5">{i.fullName}</td>
                            <td className="px-2 py-1.5 text-right">{i.counts.interviews}</td>
                            <td className="px-2 py-1.5 text-right">{i.counts.files}</td>
                            <td className="px-2 py-1.5 text-right">{i.counts.entries}</td>
                            <td className="px-2 py-1.5 text-right">{i.counts.jobResponses}</td>
                            <td className="px-2 py-1.5 text-right">{i.counts.tasks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <label className="flex items-start gap-2 mt-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hardDeleteAck}
                      onChange={(e) => setHardDeleteAck(e.target.checked)}
                      className="mt-0.5 cursor-pointer"
                    />
                    <span className="text-sm text-gray-700">
                      関連データが残っていることを理解した上で削除する
                    </span>
                  </label>
                </div>
              ) : (
                <p className="text-sm text-gray-700">
                  この操作は<span className="font-semibold text-red-600">元に戻せません</span>。続けますか？
                </p>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => {
                    setHardDeleteModalOpen(false);
                    setHardDeleteImpact(null);
                    setHardDeleteAck(false);
                  }}
                  disabled={hardDeleteLoading}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={executeHardDelete}
                  disabled={!canSubmit || hardDeleteLoading}
                  className={`px-4 py-2 text-sm rounded-md text-white ${
                    canSubmit && !hardDeleteLoading
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-gray-300 cursor-not-allowed"
                  }`}
                >
                  {hardDeleteLoading ? "削除中..." : hasWithData ? "全て完全削除する" : "完全削除する"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
