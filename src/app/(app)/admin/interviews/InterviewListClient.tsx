"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Employee = { id: string; employeeNumber: string; name: string };

type InterviewRow = {
  id: string;
  interviewDate: string;
  startTime: string;
  endTime: string;
  interviewTool: string;
  interviewType: string;
  interviewCount: number | null;
  resultFlag: string | null;
  status: string;
  candidateBirthday: string | null;
  candidate: {
    id: string;
    candidateNumber: string;
    name: string;
    gender: string | null;
    birthday: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    employee: Employee | null;
  };
  interviewer: Employee;
  detail: { jobChangeTimeline: string | null; desiredPrefecture: string | null; desiredJobType1: string | null } | null;
  rating: { overallRank: string | null } | null;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 30;

const RESULT_BADGE: Record<string, { label: string; cls: string }> = {
  pass: { label: "合格", cls: "bg-green-100 text-green-700" },
  fail: { label: "不合格", cls: "bg-red-100 text-red-600" },
  pending: { label: "保留", cls: "bg-yellow-100 text-yellow-700" },
};

const RANK_BADGE: Record<string, string> = {
  S: "bg-purple-100 text-purple-700",
  A: "bg-blue-100 text-blue-700",
  B: "bg-green-100 text-green-700",
  C: "bg-yellow-100 text-yellow-700",
  D: "bg-red-100 text-red-600",
};

const TOOL_OPTIONS = ["電話", "オンライン", "対面"];
const TYPE_OPTIONS = ["新規面談", "既存面談", "フォロー面談", "面接対策"];

const COL_WIDTHS = [68, 115, 115, 120, 100, 110, 140, 90, 145, 240, 145, 130, 155];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtDateFull(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function fmtYM(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function calcAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}
function genderLabel(g: string | null) {
  if (g === "male") return "男性";
  if (g === "female") return "女性";
  if (g === "other") return "その他";
  return "-";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  employees: Employee[];
  currentEmployeeId: string | null;
}

export default function InterviewListClient({ employees, currentEmployeeId }: Props) {
  // Data
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Pagination / sort
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("interviewDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Filters
  const [rcName, setRcName] = useState("");
  const [caName, setCaName] = useState("");
  const [dateFrom, setDateFrom] = useState(() => toDateInputValue(new Date()));
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));
  const [candidateName, setCandidateName] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Date nav
  const [navDate, setNavDate] = useState(() => new Date());
  const [navMonth, setNavMonth] = useState(() => new Date());

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCandidateSearch, setModalCandidateSearch] = useState("");
  const [modalCandidateResults, setModalCandidateResults] = useState<{ id: string; candidateNumber: string; name: string }[]>([]);
  const [modalSelectedCandidate, setModalSelectedCandidate] = useState<{ id: string; candidateNumber: string; name: string } | null>(null);
  const [modalDate, setModalDate] = useState(() => toDateInputValue(new Date()));
  const [modalStartTime, setModalStartTime] = useState("10:00");
  const [modalEndTime, setModalEndTime] = useState("");
  const [modalTool, setModalTool] = useState("電話");
  const [modalType, setModalType] = useState("新規面談");
  const [modalMemo, setModalMemo] = useState("");
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [candidateSearching, setCandidateSearching] = useState(false);
  const candidateSearchRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    if (rcName) params.set("rcName", rcName);
    if (caName) params.set("caName", caName);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (candidateName) params.set("candidateName", candidateName);
    if (debouncedSearch) params.set("search", debouncedSearch);

    try {
      const res = await fetch(`/api/interviews?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setInterviews(data.interviews);
      setTotal(data.total);
    } catch {
      toast.error("面談一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, rcName, caName, dateFrom, dateTo, candidateName, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Date nav handlers
  const handleDateNav = (offset: number) => {
    const d = new Date(navDate);
    d.setDate(d.getDate() + offset);
    setNavDate(d);
    const val = toDateInputValue(d);
    setDateFrom(val);
    setDateTo(val);
    setPage(1);
  };
  const handleToday = () => {
    const d = new Date();
    setNavDate(d);
    const val = toDateInputValue(d);
    setDateFrom(val);
    setDateTo(val);
    setPage(1);
  };
  const handleMonthNav = (offset: number) => {
    const d = new Date(navMonth);
    d.setMonth(d.getMonth() + offset);
    setNavMonth(d);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setDateFrom(toDateInputValue(first));
    setDateTo(toDateInputValue(last));
    setPage(1);
  };
  const handleShowAll = () => {
    setDateFrom("");
    setDateTo("");
    setRcName("");
    setCaName("");
    setCandidateName("");
    setSearch("");
    setPage(1);
  };

  // Sort handler
  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortOrder(col === "interviewDate" ? "desc" : "asc");
    }
    setPage(1);
  };

  // Delete handler
  const handleDelete = async (id: string) => {
    if (!confirm("この面談記録を削除しますか？この操作は取り消せません。")) return;
    try {
      const res = await fetch(`/api/interviews/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("面談記録を削除しました");
      fetchData();
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  // Candidate search for modal
  const searchCandidates = useCallback(async (q: string) => {
    if (!q.trim()) { setModalCandidateResults([]); return; }
    setCandidateSearching(true);
    try {
      const res = await fetch(`/api/master/candidates?include=employee&search=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setModalCandidateResults(
          (data.candidates || []).slice(0, 10).map((c: { id: string; candidateNumber: string; name: string }) => ({
            id: c.id, candidateNumber: c.candidateNumber, name: c.name,
          }))
        );
      }
    } catch { /* silent */ } finally { setCandidateSearching(false); }
  }, []);

  useEffect(() => {
    if (candidateSearchRef.current) clearTimeout(candidateSearchRef.current);
    candidateSearchRef.current = setTimeout(() => searchCandidates(modalCandidateSearch), 300);
    return () => { if (candidateSearchRef.current) clearTimeout(candidateSearchRef.current); };
  }, [modalCandidateSearch, searchCandidates]);

  // Create new interview
  const handleCreate = async () => {
    if (!modalSelectedCandidate) { toast.error("求職者を選択してください"); return; }
    if (!modalDate) { toast.error("面談日を入力してください"); return; }
    if (!modalStartTime) { toast.error("開始時間を入力してください"); return; }
    setModalSubmitting(true);

    const interviewerUserId = currentEmployeeId || employees[0]?.id;
    if (!interviewerUserId) { toast.error("面談担当者が特定できません"); setModalSubmitting(false); return; }

    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: modalSelectedCandidate.id,
          interviewDate: modalDate,
          startTime: modalStartTime,
          endTime: modalEndTime || "",
          interviewTool: modalTool,
          interviewerUserId,
          interviewType: modalType,
          interviewMemo: modalMemo || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "登録に失敗しました");
      }
      toast.success("面談を登録しました");
      setModalOpen(false);
      resetModal();
      fetchData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setModalSubmitting(false);
    }
  };

  const resetModal = () => {
    setModalCandidateSearch("");
    setModalCandidateResults([]);
    setModalSelectedCandidate(null);
    setModalDate(toDateInputValue(new Date()));
    setModalStartTime("10:00");
    setModalEndTime("");
    setModalTool("電話");
    setModalType("新規面談");
    setModalMemo("");
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const displayStart = total > 0 ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const displayEnd = Math.min(safePage * PAGE_SIZE, total);

  // Sort icon (visible or invisible spacer to align all header heights)
  const SortIcon = ({ col, hidden }: { col?: string; hidden?: boolean }) => (
    <span className={`ml-1 inline-flex flex-col text-[9px] leading-none ${hidden ? "invisible" : "opacity-60"}`}>
      <span className={!hidden && sortBy === col && sortOrder === "asc" ? "text-white opacity-100" : "opacity-40"}>▲</span>
      <span className={!hidden && sortBy === col && sortOrder === "desc" ? "text-white opacity-100" : "opacity-40"}>▼</span>
    </span>
  );

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[#374151]">面談管理</h1>
          <p className="mt-1 text-[14px] text-[#374151]/80">面談レコードの一覧表示・新規登録・詳細遷移</p>
        </div>
      </div>

      {/* Action Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => { resetModal(); setModalOpen(true); }}
          className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]"
        >
          + 新規登録
        </button>
        <button
          onClick={handleShowAll}
          className="border border-gray-300 bg-white text-[#374151] rounded-md px-3 py-2 text-[13px] hover:bg-gray-50"
        >
          📋 全表示
        </button>
        <button
          onClick={() => toast.info("エクスポート機能は準備中です")}
          className="border border-gray-300 bg-white text-[#374151] rounded-md px-3 py-2 text-[13px] hover:bg-gray-50"
        >
          ↓ エクスポート
        </button>

        <div className="mx-2 h-6 border-l border-gray-300" />

        {/* Day nav */}
        <div className="flex items-center gap-1 text-[13px]">
          <button onClick={() => handleDateNav(-1)} className="px-2 py-1 rounded hover:bg-gray-100">◀</button>
          <button onClick={handleToday} className="px-2 py-1 rounded hover:bg-gray-100 font-medium">
            本日 {navDate.getMonth() + 1}/{navDate.getDate()}
          </button>
          <button onClick={() => handleDateNav(1)} className="px-2 py-1 rounded hover:bg-gray-100">▶</button>
        </div>

        <div className="mx-1 h-6 border-l border-gray-300" />

        {/* Month nav */}
        <div className="flex items-center gap-1 text-[13px]">
          <button onClick={() => handleMonthNav(-1)} className="px-2 py-1 rounded hover:bg-gray-100">◀</button>
          <span className="px-2 py-1 font-medium">{fmtYM(navMonth)}</span>
          <button onClick={() => handleMonthNav(1)} className="px-2 py-1 rounded hover:bg-gray-100">▶</button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[16px]">🔍</span>
        <input
          type="text"
          placeholder="担当RC"
          value={rcName}
          onChange={(e) => { setRcName(e.target.value); setPage(1); }}
          className="w-[110px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <input
          type="text"
          placeholder="担当CA"
          value={caName}
          onChange={(e) => { setCaName(e.target.value); setPage(1); }}
          className="w-[110px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="w-[130px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <span className="text-[13px] text-gray-500">〜</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="w-[130px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <input
          type="text"
          placeholder="求職者名"
          value={candidateName}
          onChange={(e) => { setCandidateName(e.target.value); setPage(1); }}
          className="w-[110px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
        <input
          type="text"
          placeholder="フリー検索…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[180px] border border-gray-300 rounded px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB]">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth: COL_WIDTHS.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr className="bg-[#185FA5] text-white text-[12px] whitespace-nowrap">
              <th className="px-2 py-2.5 text-center font-medium">操作<SortIcon hidden /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("rcName")}>担当RC<SortIcon col="rcName" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("caName")}>担当CA<SortIcon col="caName" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("interviewDate")}>面談日<SortIcon col="interviewDate" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("startTime")}>開始/終了<SortIcon col="startTime" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("interviewCount")}>回数/結果<SortIcon col="interviewCount" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("candidateName")}>求職者氏名<SortIcon col="candidateName" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("age")}>年齢/性別<SortIcon col="age" /></th>
              <th className="px-2 py-2.5 text-left font-medium">電話番号<SortIcon hidden /></th>
              <th className="px-2 py-2.5 text-left font-medium">メール/住所<SortIcon hidden /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("interviewCount")}>転職時期/評価<SortIcon col="interviewCount" /></th>
              <th className="px-2 py-2.5 text-left font-medium cursor-pointer select-none" onClick={() => handleSort("desiredPrefecture")}>希望都道府県<SortIcon col="desiredPrefecture" /></th>
              <th className="px-2 py-2.5 text-left font-medium">第一希望職種<SortIcon hidden /></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="py-12 text-center text-gray-400">読み込み中...</td></tr>
            ) : interviews.length === 0 ? (
              <tr><td colSpan={13} className="py-12 text-center text-gray-400">該当する面談記録がありません</td></tr>
            ) : interviews.map((r) => {
              const age = calcAge(r.candidateBirthday);
              const rb = r.resultFlag ? RESULT_BADGE[r.resultFlag] : null;
              const rank = r.rating?.overallRank;
              return (
                <tr key={r.id} className="border-t border-[#E5E7EB] hover:bg-[#F9FAFB]">
                  {/* 操作 */}
                  <td className="px-2 py-2 text-center whitespace-nowrap">
                    <Link
                      href={`/candidates/${r.candidate.id}?view=interview&from=interviews`}
                      className="text-[12px] text-[#2563EB] hover:underline mr-1"
                      title="詳細"
                    >✎</Link>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="text-[12px] text-red-500 hover:text-red-700"
                      title="削除"
                    >🗑</button>
                  </td>
                  {/* 担当RC */}
                  <td className="px-2 py-2">
                    <div className="text-[11px] text-gray-400">{r.interviewer.employeeNumber}</div>
                    <div className="text-[13px]">{r.interviewer.name}</div>
                  </td>
                  {/* 担当CA */}
                  <td className="px-2 py-2">
                    {r.candidate.employee ? (
                      <>
                        <div className="text-[11px] text-gray-400">{r.candidate.employee.employeeNumber}</div>
                        <div className="text-[13px]">{r.candidate.employee.name}</div>
                      </>
                    ) : <span className="text-gray-400">-</span>}
                  </td>
                  {/* 面談日 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px]">{fmtDateFull(r.interviewDate)}</div>
                    <div className="text-[11px] text-gray-500">{r.interviewTool}</div>
                  </td>
                  {/* 開始/終了 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px]">{r.startTime || "-"}</div>
                    <div className="text-[11px] text-gray-500">{r.endTime || "-"}</div>
                  </td>
                  {/* 回数/結果 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px]">{r.interviewCount != null ? `${r.interviewCount}回` : "-"}</div>
                    {rb && <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${rb.cls}`}>{rb.label}</span>}
                  </td>
                  {/* 求職者氏名 */}
                  <td className="px-2 py-2">
                    <Link
                      href={`/candidates/${r.candidate.id}?view=interview&from=interviews`}
                      className="text-[13px] text-[#2563EB] hover:underline"
                    >{r.candidate.name}</Link>
                    <div className="text-[11px] text-gray-400">{r.candidate.candidateNumber}</div>
                  </td>
                  {/* 年齢/性別 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px]">{age != null ? `${age}歳` : "-"}</div>
                    <div className="text-[11px] text-gray-500">{genderLabel(r.candidate.gender)}</div>
                  </td>
                  {/* 電話番号 */}
                  <td className="px-2 py-2 text-[13px]">{r.candidate.phone || "-"}</td>
                  {/* メール/住所 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px] truncate" title={r.candidate.email || ""}>{r.candidate.email || "-"}</div>
                    <div className="text-[11px] text-gray-500 truncate" title={r.candidate.address || ""}>{r.candidate.address || "-"}</div>
                  </td>
                  {/* 転職時期/評価 */}
                  <td className="px-2 py-2">
                    <div className="text-[13px]">{r.detail?.jobChangeTimeline || "-"}</div>
                    {rank && <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium ${RANK_BADGE[rank] || "bg-gray-100 text-gray-600"}`}>{rank}</span>}
                  </td>
                  {/* 希望都道府県 */}
                  <td className="px-2 py-2 text-[13px]">{r.detail?.desiredPrefecture || "-"}</td>
                  {/* 第一希望職種 */}
                  <td className="px-2 py-2 text-[13px]">{r.detail?.desiredJobType1 || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between border-t border-[#E5E7EB] pt-4">
        <div className="text-[13px] text-[#374151]/70">
          全 {total.toLocaleString()} 件中{" "}
          {total > 0 ? `${displayStart}〜${displayEnd} 件を表示` : "0 件"}
        </div>
        <div className="flex items-center gap-2">
          {safePage > 1 ? (
            <button onClick={() => setPage(safePage - 1)} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]">前へ</button>
          ) : (
            <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">前へ</span>
          )}
          <span className="text-[13px] text-[#374151]">{safePage} / {totalPages}</span>
          {safePage < totalPages ? (
            <button onClick={() => setPage(safePage + 1)} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA]">次へ</button>
          ) : (
            <span className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#374151]/40">次へ</span>
          )}
        </div>
      </div>

      {/* New Interview Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-semibold text-[#374151] mb-4">面談 新規登録</h2>

            {/* 求職者検索 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-1">求職者（必須）</label>
              {modalSelectedCandidate ? (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-2 text-[13px]">
                  <span>{modalSelectedCandidate.name}（{modalSelectedCandidate.candidateNumber}）</span>
                  <button onClick={() => { setModalSelectedCandidate(null); setModalCandidateSearch(""); }} className="text-gray-400 hover:text-red-500">✕</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="氏名 or 求職者番号で検索"
                    value={modalCandidateSearch}
                    onChange={(e) => setModalCandidateSearch(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                  />
                  {candidateSearching && <p className="text-[11px] text-gray-400 mt-1">検索中...</p>}
                  {modalCandidateResults.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded max-h-40 overflow-y-auto">
                      {modalCandidateResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setModalSelectedCandidate(c); setModalCandidateResults([]); setModalCandidateSearch(""); }}
                          className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50"
                        >
                          {c.name}（{c.candidateNumber}）
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 面談日 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-1">面談日（必須）</label>
              <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
            </div>

            {/* 開始時間 / 終了時間 */}
            <div className="mb-4 flex gap-3">
              <div className="flex-1">
                <label className="block text-[13px] font-medium text-[#374151] mb-1">開始時間（必須）</label>
                <input type="time" value={modalStartTime} onChange={(e) => setModalStartTime(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
              </div>
              <div className="flex-1">
                <label className="block text-[13px] font-medium text-[#374151] mb-1">終了時間</label>
                <input type="time" value={modalEndTime} onChange={(e) => setModalEndTime(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]" />
              </div>
            </div>

            {/* 面談手法 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-1">面談手法（必須）</label>
              <div className="flex gap-2">
                {TOOL_OPTIONS.map((t) => (
                  <label key={t} className="flex items-center gap-1 text-[13px] cursor-pointer">
                    <input type="radio" name="tool" value={t} checked={modalTool === t} onChange={() => setModalTool(t)} className="accent-[#2563EB]" />
                    {t}
                  </label>
                ))}
              </div>
            </div>

            {/* 面談種別 */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-1">面談種別</label>
              <select value={modalType} onChange={(e) => setModalType(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]">
                {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* メモ */}
            <div className="mb-4">
              <label className="block text-[13px] font-medium text-[#374151] mb-1">メモ</label>
              <textarea
                value={modalMemo}
                onChange={(e) => setModalMemo(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#2563EB]"
                placeholder="面談に関するメモ"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setModalOpen(false)} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-gray-50">キャンセル</button>
              <button onClick={handleCreate} disabled={modalSubmitting} className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-[13px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
                {modalSubmitting ? "登録中..." : "登録"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
