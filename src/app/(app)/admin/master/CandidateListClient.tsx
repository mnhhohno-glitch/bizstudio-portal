"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { Table, TableWrap, Th, Td } from "@/components/ui/Table";
import { toast } from "sonner";
import CandidateRegistrationModal from "./CandidateRegistrationModal";
import SupportEndModal from "@/components/candidates/SupportEndModal";
import { SUPPORT_END_REASONS, REASON_LABEL_MAP } from "@/lib/constants/support-end-reasons";
import { formatRecruiterName, splitRecruiterDisplay } from "@/lib/recruiterDisplay";
import { FilterShell, FilterTopRow, FilterGroup, FilterField, DateRangeField, FilterClearButton, FilterMultiSelectField, FILTER_INPUT_CLS } from "@/components/filters/FilterLayout";

// T-181: 担当CAフィルタで「担当CA未設定」を表す特別値（Employee.id と衝突しない固定文字列）
const UNASSIGNED_CA = "__UNASSIGNED__";

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
  // T-170: 追加5列（サーバ側 computeCandidateListMetrics の戻り値をそのまま持つ）
  desiredJobType?: string | null;
  desiredJobTypeFull?: string | null;
  desiredArea?: string | null;
  desiredAreaFull?: string | null;
  referralCount?: number;
  entryCount?: number;
  idleDays?: number | null;
  idleLevel?: "ok" | "warn" | "alert" | null;
};

// T-170追補: 「希望職種 / 希望エリア」列の並び替え状態。上段（職種）と下段（エリア）で別キー、
// 各キーは 昇順 → 降順 → 解除 の3状態。null は並び替えなし（＝求職者番号降順の元の並び）。
type DesiredSortKey = "job" | "area";
type DesiredSort = { key: DesiredSortKey; dir: "asc" | "desc" };

// T-170: 放置日数の文字色。DashboardTab の idleSignal と同じ閾値・同じ色を使う。
const IDLE_LEVEL_COLOR: Record<string, string> = {
  ok: "#16A34A",
  warn: "#CA8A04",
  alert: "#DC2626",
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

// 一覧（filtered）とタブ件数（tabCounts）で共通に使う絞り込み。
// タブ条件（supportStatus）と終了理由はここに含めない。
//   終了理由は ENDED 以外のステータスでは常に null なので、ここに入れると他タブの件数が全て 0 になる。
//   終了理由は ENDED タブの一覧にのみ適用する（filtered 側で処理）。
// 罠#17: 登録日・応募日・配信日はいずれも jstDateStr() で JST の暦日文字列に揃えてから比較する。
type NonTabFilters = {
  search: string;
  /** T-181: 担当CAの複数選択。空配列 ＝ 絞り込みなし。UNASSIGNED_CA は担当CA未設定を表す */
  caIds: string[];
  dateFrom: string;
  dateTo: string;
  gender: string;
  route: string;
  media: string;
  appDateFrom: string;
  appDateTo: string;
  delDateFrom: string;
  delDateTo: string;
};

function applyNonTabFilters(rows: CandidateRow[], f: NonTabFilters): CandidateRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((c) => {
    if (q) {
      const hit =
        c.candidateNumber.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (!!c.nameKana && c.nameKana.toLowerCase().includes(q)) ||
        (!!c.employee?.name && c.employee.name.toLowerCase().includes(q));
      if (!hit) return false;
    }
    // T-181: 担当CA（複数選択・OR）。判定は行データの employee.id で行う（表示整形は使わない）
    if (f.caIds.length > 0) {
      const empId = c.employee?.id || "";
      const hitCa = empId ? f.caIds.includes(empId) : f.caIds.includes(UNASSIGNED_CA);
      if (!hitCa) return false;
    }
    if (f.gender !== "ALL" && c.gender !== f.gender) return false;
    if (f.route !== "ALL" && (c.applicationRoute || "") !== f.route) return false;
    if (f.media !== "ALL" && (c.mediaSource || "") !== f.media) return false;
    // 登録日（旧実装は From が UTC・To がローカル解釈で非対称だった＝罠#17）
    if (f.dateFrom || f.dateTo) {
      const d = jstDateStr(c.createdAt);
      if (!d) return false;
      if (f.dateFrom && d < f.dateFrom) return false;
      if (f.dateTo && d > f.dateTo) return false;
    }
    // 応募日
    if (f.appDateFrom || f.appDateTo) {
      const d = jstDateStr(c.applicationDate);
      if (!d) return false;
      if (f.appDateFrom && d < f.appDateFrom) return false;
      if (f.appDateTo && d > f.appDateTo) return false;
    }
    // 配信日
    if (f.delDateFrom || f.delDateTo) {
      const d = jstDateStr(c.scoutDeliveryDate);
      if (!d) return false;
      if (f.delDateFrom && d < f.delDateFrom) return false;
      if (f.delDateTo && d > f.delDateTo) return false;
    }
    return true;
  });
}

// T-181: currentEmployeeId は担当CAフィルタの初期値に使っていたが、複数選択化に伴い
// 初期状態は「絞り込みなし（ALL）」に統一したため参照していない（page.tsx が渡すので型のみ残す）。
export default function CandidateListClient({
  initialCandidates,
  employees,
  isAdmin = false,
}: CandidateListClientProps) {
  const [candidates, setCandidates] = useState<CandidateRow[]>(initialCandidates);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("ACTIVE");
  const [endModalCandidateId, setEndModalCandidateId] = useState<string | null>(null);
  // T-181: 担当CAは複数選択。空配列＝絞り込みなし（従来の "ALL" と同じ意味）
  const [caFilter, setCaFilter] = useState<string[]>([]);
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
  // T-170追補: 希望職種 / 希望エリアの並び替え（この列のみ）
  const [desiredSort, setDesiredSort] = useState<DesiredSort | null>(null);
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

  // 絞り込みは1回だけ実行し、タブ件数・一覧の両方をこの結果から導出する。
  // 旧実装は filtered と tabCounts で別々にフィルタを書いており、後から追加された
  // 経路・媒体・応募日・配信日が tabCounts 側に反映されていなかった（＝件数が絞り込みに連動しない原因）。
  const baseRows = useMemo(
    () =>
      applyNonTabFilters(candidates, {
        search: debouncedSearch,
        caIds: caFilter,
        dateFrom,
        dateTo,
        gender: genderFilter,
        route: routeFilter,
        media: mediaFilter,
        appDateFrom,
        appDateTo,
        delDateFrom,
        delDateTo,
      }),
    [candidates, debouncedSearch, caFilter, dateFrom, dateTo, genderFilter, routeFilter, mediaFilter, appDateFrom, appDateTo, delDateFrom, delDateTo]
  );

  // T-181: 担当CAの選択肢。社員一覧（active・employeeNumber順）に加えて、
  // 行データに担当CAとして居るのに社員一覧に無い人（退職・無効化された社員）も末尾に足す。
  // これを足さないと「全選択（＝担当あり）」にも「未設定」にも入らない行が生まれ、件数が合わなくなる。
  const caOptions = useMemo(() => {
    const base = employees.map((e) => ({ value: e.id, label: e.name }));
    const known = new Set(base.map((o) => o.value));
    const extra = new Map<string, string>();
    for (const c of candidates) {
      if (c.employee?.id && !known.has(c.employee.id)) extra.set(c.employee.id, c.employee.name);
    }
    return [
      ...base,
      ...[...extra]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ja")),
    ];
  }, [employees, candidates]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: 0, BEFORE: 0, ACTIVE: 0, WAITING: 0, ENDED: 0, ARCHIVED: 0 };
    for (const c of baseRows) {
      counts[c.supportStatus] = (counts[c.supportStatus] || 0) + 1;
      if (c.supportStatus !== "ARCHIVED") counts.ALL += 1;
    }
    return counts;
  }, [baseRows]);

  const filtered = useMemo(() => {
    let result =
      supportTab === "ALL"
        ? baseRows.filter((c) => c.supportStatus !== "ARCHIVED")
        : baseRows.filter((c) => c.supportStatus === supportTab);
    // 終了理由は ENDED タブの一覧にのみ適用（タブ件数には効かせない）
    if (supportTab === "ENDED" && endReasonFilter !== "ALL") {
      result = result.filter((c) => c.supportEndReason === endReasonFilter);
    }
    return result;
  }, [baseRows, supportTab, endReasonFilter]);

  // T-170追補: 希望職種 / 希望エリアの並び替え。フィルタ・支援タブ・フリー検索の結果（filtered）に
  // 後段で掛けるだけなので、絞り込み条件やタブ件数には一切影響しない。
  // 空欄（null）は昇順・降順どちらでも末尾に固定する（sign を掛けない）。
  const sorted = useMemo(() => {
    if (!desiredSort) return filtered;
    const pick = (c: CandidateRow) =>
      (desiredSort.key === "job" ? c.desiredJobType : c.desiredArea) || "";
    const sign = desiredSort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = pick(a);
      const vb = pick(b);
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return sign * va.localeCompare(vb, "ja");
    });
  }, [filtered, desiredSort]);

  // 昇順 → 降順 → 解除。別キーを押したときは、そのキーの昇順から始める（他方は解除）。
  const toggleDesiredSort = (key: DesiredSortKey) => {
    setDesiredSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };
  const desiredSortMark = (key: DesiredSortKey) =>
    desiredSort?.key === key ? (desiredSort.dir === "asc" ? "▲" : "▼") : "";

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

  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const skip = (safePage - 1) * PAGE_SIZE;
  const pageData = sorted.slice(skip, skip + PAGE_SIZE);

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await fetch("/api/master/candidates?include=employee,metrics");
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates);
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

  // 下部ページャの「全 N 件中」は常に現在タブの絞り込み後件数（＝実際に一覧に出る件数）
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
      <div className="mt-4 flex items-center justify-between border-b border-gray-200">
        <div className="flex">
          {SUPPORT_TABS.map((tab) => (
            <button
              key={tab.key}
              // T-181: 担当CAの選択はタブ切替でリセットしない（タブ側の絞り込みだけ変える）
              onClick={() => { setSupportTab(tab.key); setCurrentPage(1); setSelectedIds([]); if (tab.key !== "ENDED") setEndReasonFilter("ALL"); }}
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
        {/* 母数はフィルタ前の全取得件数（タブによらず一定）／分子は絞り込み後のアーカイブ除く総件数 */}
        <div className="pr-1 text-sm text-gray-900">
          全 <span className="font-semibold">{candidates.length.toLocaleString()}</span> 件中{" "}
          <span className="font-semibold">{tabCounts.ALL.toLocaleString()}</span> 件
        </div>
      </div>

      {/* フィルタ（T-105: 上段 担当者/期間/検索 ＋ 下段 区分 の2段） */}
      <FilterShell>
        <FilterTopRow>
          {/* 担当者 */}
          <FilterGroup label="担当者">
            {/* T-181: 複数選択。「全選択」＝CA名を全部ON（未設定はOFF）＝担当CAが設定されている人のみ */}
            <FilterMultiSelectField
              label="担当CA"
              options={caOptions}
              specialOption={{ value: UNASSIGNED_CA, label: "未設定" }}
              selected={caFilter}
              onChange={(next) => { setCaFilter(next); setCurrentPage(1); }}
              width="w-44"
              allSelectedLabel="担当あり（全員）"
              moreUnit="名"
            />
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
            {(caFilter.length > 0 || dateFrom || dateTo || genderFilter !== "ALL" || endReasonFilter !== "ALL" || routeFilter !== "ALL" || mediaFilter !== "ALL" || appDateFrom || appDateTo || delDateFrom || delDateTo) && (
              <FilterClearButton onClick={() => {
                setCaFilter([]);
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
                <option value="求職者紹介">求職者紹介</option>
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

          {/* T-181: 絞り込み後の該当件数（数える作業をなくすのが目的。タブのバッジ件数は従来どおり） */}
          <span className="ml-auto self-end inline-flex items-center rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] text-[#374151]">
            <span className="font-medium">該当 <span className="text-[#2563EB]">{filtered.length.toLocaleString()}</span> 件</span>
          </span>
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
            <Table className="table-fixed w-full min-w-[1686px]">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 56 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                {/* T-170 */}
                <col style={{ width: 190 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 72 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
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
                  {/* T-170追補: 上段=希望職種 / 下段=希望エリア。見出しの「職種」「エリア」で個別に並び替え */}
                  <Th>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleDesiredSort("job")}
                        title="希望職種で並び替え（昇順→降順→解除）"
                        className={`cursor-pointer hover:underline ${desiredSort?.key === "job" ? "text-[#2563EB]" : ""}`}
                      >
                        職種{desiredSortMark("job")}
                      </button>
                      <span className="text-[#374151]/40">/</span>
                      <button
                        type="button"
                        onClick={() => toggleDesiredSort("area")}
                        title="希望エリアで並び替え（昇順→降順→解除）"
                        className={`cursor-pointer hover:underline ${desiredSort?.key === "area" ? "text-[#2563EB]" : ""}`}
                      >
                        エリア{desiredSortMark("area")}
                      </button>
                    </div>
                  </Th>
                  <Th className="text-right">求人紹介数</Th>
                  <Th className="text-right">エントリー数</Th>
                  <Th className="text-right">放置日数</Th>
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
                    {/* T-170: 希望職種(上段) / 希望エリア(下段) / 求人紹介数 / エントリー数 / 放置日数 */}
                    <Td className="overflow-hidden">
                      {!cand.desiredJobType && !cand.desiredArea ? (
                        <div className="text-[13px]">-</div>
                      ) : (
                        <>
                          <div
                            className="truncate whitespace-nowrap text-[13px]"
                            title={cand.desiredJobTypeFull || ""}
                          >
                            {cand.desiredJobType || "-"}
                          </div>
                          <div
                            className="truncate whitespace-nowrap text-[11px] text-gray-500"
                            title={cand.desiredAreaFull || ""}
                          >
                            {cand.desiredArea || "-"}
                          </div>
                        </>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">
                      <span className="text-[13px]">{cand.referralCount ?? 0}</span>
                    </Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">
                      <span className="text-[13px]">{cand.entryCount ?? 0}</span>
                    </Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">
                      <span
                        className="text-[13px]"
                        style={cand.idleLevel ? { color: IDLE_LEVEL_COLOR[cand.idleLevel] } : undefined}
                      >
                        {cand.idleDays == null ? "-" : `${cand.idleDays}日`}
                      </span>
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
                      colSpan={16}
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
              全 {totalFiltered.toLocaleString()} 件中{" "}
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
