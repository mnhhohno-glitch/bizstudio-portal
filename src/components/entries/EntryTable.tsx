"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";
import type { Entry, FlagData } from "./EntryBoard";

/* ========== Types ========== */

type ColConfig = { key: string; label: string; width: number; sortKey: string | null };

type Props = {
  entries: Entry[];
  flagData: FlagData | null;
  activeTab: string;
  sortField: string | null;
  sortDir: "asc" | "desc";
  onSort: (field: string) => void;
  onFlagUpdate: (entryId: string, flags: Record<string, string | null>) => void;
  onFieldUpdate: (entryId: string, fields: Record<string, unknown>) => Promise<void>;
  onRowClick: (entryId: string) => void;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
};

/* ========== Column Definitions ========== */

const COMMON_COLS: ColConfig[] = [
  { key: "candidate", label: "求職者", width: 120, sortKey: "candidate" },
  { key: "ca", label: "担当CA", width: 80, sortKey: "ca" },
  { key: "company", label: "紹介先企業", width: 160, sortKey: "company" },
  { key: "jobDb", label: "求人DB", width: 80, sortKey: "jobDb" },
  { key: "entryFlags", label: "エントリーフラグ", width: 130, sortKey: "entryFlag" },
  { key: "statusFlags", label: "対応状況", width: 130, sortKey: "companyFlag" },
  { key: "entryDate", label: "エントリー日", width: 80, sortKey: "entryDate" },
];

const TAB_EXTRA: Record<string, ColConfig[]> = {
  "求人紹介": [],
  "エントリー": [
    { key: "docSubmit", label: "書類提出日", width: 85, sortKey: "documentSubmitDate" },
  ],
  "書類選考": [
    { key: "docDates", label: "書類提出日", width: 100, sortKey: "documentSubmitDate" },
    { key: "aptitudeDates", label: "適性検査", width: 100, sortKey: "aptitudeTestExists" },
  ],
  "面接": [
    { key: "interviewPrep", label: "面接対策", width: 95, sortKey: "interviewPrepDate" },
    { key: "firstInterview", label: "一次面接", width: 95, sortKey: "firstInterviewDate" },
    { key: "finalInterview", label: "最終面接", width: 95, sortKey: "finalInterviewDate" },
  ],
  "内定": [
    { key: "offerDate", label: "内定日", width: 85, sortKey: "offerDate" },
    { key: "offerDeadline", label: "承諾期限", width: 85, sortKey: "offerDeadline" },
    { key: "offerMeeting", label: "オファー面談", width: 95, sortKey: "offerMeetingDate" },
    { key: "acceptance", label: "承諾日", width: 85, sortKey: "acceptanceDate" },
  ],
  "入社済": [
    { key: "acceptance", label: "承諾日", width: 85, sortKey: "acceptanceDate" },
    { key: "joinDate", label: "入社日", width: 85, sortKey: "joinDate" },
  ],
  "全件": [],
};

const MEMO_COL: ColConfig = { key: "memo", label: "メモ", width: 50, sortKey: null };

function getColumns(tab: string): ColConfig[] {
  return [...COMMON_COLS, ...(TAB_EXTRA[tab] || []), MEMO_COL];
}

/* ========== Helpers ========== */

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(5, 10).replace("-", "/");
}

function fmtDateFull(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10).replace(/-/g, "/");
}

function getRowClass(entry: Entry) {
  if (entry.personFlag === "見送り通知未送信") return "bg-white";
  if (!entry.isActive) return "bg-gray-300 text-gray-400";
  if (SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "")) return "bg-gray-200 text-gray-500";
  return "bg-white";
}

function isEnded(entry: Entry) {
  if (entry.personFlag === "見送り通知未送信") return false;
  return !entry.isActive || SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "");
}

function isCompanyFlagRed(entry: Entry): boolean {
  const f = entry.companyFlag;
  if (!f) return false;
  if (f === "希望日提出済") return true;
  if (!f.includes("済")) return true;
  if (entry.entryFlagDetail === "承諾" && f !== "入社報告済") return true;
  return false;
}

function isPersonFlagRed(entry: Entry): boolean {
  const f = entry.personFlag;
  if (!f) return false;
  if (f === "日程回収済") return true;
  if (!f.includes("済")) return true;
  if (entry.entryFlagDetail === "承諾" && f !== "入社済") return true;
  return false;
}

function getFieldValue(entry: Entry, key: string): string | null {
  switch (key) {
    case "candidate": return entry.candidate.name;
    case "ca": return entry.candidate.employee?.name || null;
    case "company": return entry.companyName;
    case "jobDb": return entry.jobDb;
    case "entryFlag": return entry.entryFlag;
    case "entryFlagDetail": return entry.entryFlagDetail;
    case "companyFlag": return entry.companyFlag;
    case "personFlag": return entry.personFlag;
    case "entryDate": return entry.entryDate;
    case "documentSubmitDate": return entry.documentSubmitDate;
    case "documentPassDate": return entry.documentPassDate;
    case "aptitudeTestExists": return entry.aptitudeTestExists ? "1" : "0";
    case "aptitudeTestDeadline": return entry.aptitudeTestDeadline;
    case "interviewPrepDate": return entry.interviewPrepDate;
    case "firstInterviewDate": return entry.firstInterviewDate;
    case "finalInterviewDate": return entry.finalInterviewDate;
    case "offerDate": return entry.offerDate;
    case "offerDeadline": return entry.offerDeadline;
    case "offerMeetingDate": return entry.offerMeetingDate;
    case "acceptanceDate": return entry.acceptanceDate;
    case "joinDate": return entry.joinDate;
    default: return null;
  }
}

function applySortAndGroup(entries: Entry[], sortField: string | null, sortDir: "asc" | "desc") {
  return [...entries].sort((a, b) => {
    const aEnded = isEnded(a) ? 1 : 0;
    const bEnded = isEnded(b) ? 1 : 0;
    if (aEnded !== bEnded) return aEnded - bEnded;
    if (!sortField) return 0;
    const aVal = getFieldValue(a, sortField);
    const bVal = getFieldValue(b, sortField);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = aVal.localeCompare(bVal);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

/* ========== Cell Components ========== */

function InlineDateCell({ value, entryId, field, onUpdate }: {
  value: string | null; entryId: string; field: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const cur = value ? value.slice(0, 10) : "";

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v !== cur) onUpdate(entryId, { [field]: v ? `${v}T12:00:00.000Z` : null });
    setEditing(false);
  };

  if (editing) {
    return (
      <input type="date" autoFocus defaultValue={cur} onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full text-[11px] border border-[#2563EB] rounded px-0.5 py-0.5 outline-none"
        onClick={(e) => e.stopPropagation()} />
    );
  }

  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={fmtDateFull(value)}
      className={`cursor-pointer rounded px-0.5 block min-h-[20px] w-full text-center leading-[20px] ${value ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 text-[10px] hover:border-gray-400"}`}>
      {fmtDate(value) || "MM/DD"}
    </span>
  );
}

function InlineDateTimeCell({ dateValue, timeValue, entryId, dateField, timeField, onUpdate }: {
  dateValue: string | null; timeValue: string | null; entryId: string;
  dateField: string; timeField: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const [editDate, setEditDate] = useState(false);
  const [editTime, setEditTime] = useState(false);
  const curDate = dateValue ? dateValue.slice(0, 10) : "";

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v !== curDate) onUpdate(entryId, { [dateField]: v ? `${v}T12:00:00.000Z` : null });
    setEditDate(false);
  };

  const handleTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value.trim();
    if (v !== (timeValue || "")) onUpdate(entryId, { [timeField]: v || null });
    setEditTime(false);
  };

  return (
    <div className="text-center">
      {editDate ? (
        <input type="date" autoFocus defaultValue={curDate} onBlur={handleDateBlur}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full text-[11px] border border-[#2563EB] rounded px-0.5 py-0.5 outline-none"
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <span onClick={(e) => { e.stopPropagation(); setEditDate(true); }}
          title={fmtDateFull(dateValue)}
          className={`cursor-pointer rounded px-0.5 block min-h-[18px] leading-[18px] ${dateValue ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 text-[10px] hover:border-gray-400"}`}>
          {fmtDate(dateValue) || "MM/DD"}
        </span>
      )}
      {editTime ? (
        <input type="text" autoFocus defaultValue={timeValue || ""} placeholder="HH:mm"
          onBlur={handleTimeBlur}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full text-[10px] border border-[#2563EB] rounded px-0.5 py-0 mt-0.5 outline-none"
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <span onClick={(e) => { e.stopPropagation(); setEditTime(true); }}
          className={`text-[10px] block cursor-pointer rounded mt-0.5 min-h-[14px] leading-[14px] ${timeValue ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 hover:border-gray-400"}`}>
          {timeValue || "HH:mm"}
        </span>
      )}
    </div>
  );
}

function AptitudeCell({ value, entryId, onUpdate }: {
  value: boolean; entryId: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <select value={value ? "あり" : "なし"}
      onChange={(e) => { e.stopPropagation(); onUpdate(entryId, { aptitudeTestExists: e.target.value === "あり" }); }}
      onClick={(e) => e.stopPropagation()}
      className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]">
      <option value="なし">なし</option>
      <option value="あり">あり</option>
    </select>
  );
}

function MemoCell({ value, entryId, onUpdate }: {
  value: string | null; entryId: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value || "");
  const ref = useRef<HTMLDivElement>(null);

  const save = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed !== (value || "")) {
      onUpdate(entryId, { memo: trimmed || null });
    }
    setOpen(false);
  }, [text, value, entryId, onUpdate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) save();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, save]);

  return (
    <div ref={ref} className="relative flex justify-center">
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setText(value || ""); setOpen(!open); }}
        title={value || ""}
        className={`text-[14px] leading-none ${value ? "text-[#2563EB]" : "text-gray-300"}`}>
        📝
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
          onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder="メモを入力..." rows={4}
            className="w-full text-[12px] border border-gray-200 rounded p-2 resize-none focus:outline-none focus:border-[#2563EB]" />
          <div className="flex justify-end mt-1">
            <button type="button" onClick={save}
              className="text-[11px] bg-[#2563EB] text-white rounded px-2 py-0.5 hover:bg-[#1D4ED8]">
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== Sort Indicator ========== */

function SortIndicator({ sortKey, sortField, sortDir }: {
  sortKey: string | null; sortField: string | null; sortDir: "asc" | "desc";
}) {
  if (!sortKey) return null;
  const active = sortField === sortKey;
  if (active) {
    return <span className="ml-0.5 text-[9px] text-yellow-300">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
  return <span className="ml-0.5 text-[9px] text-white/30">⇅</span>;
}

/* ========== Main Component ========== */

export default function EntryTable({
  entries, flagData, activeTab, sortField, sortDir, onSort,
  onFlagUpdate, onFieldUpdate, onRowClick,
  selectedIds, onSelectToggle, onSelectAll, onDeselectAll,
}: Props) {
  const cols = getColumns(activeTab);
  const sorted = applySortAndGroup(entries, sortField, sortDir);
  const entryFlagOptions = flagData?.entryFlags.filter((f) => f !== "応募") || [];
  const allIds = entries.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const minWidth = 36 + cols.reduce((sum, c) => sum + c.width, 0);

  function renderCell(entry: Entry, col: ColConfig) {
    const companyOptions = flagData?.companyFlags[entry.entryFlag || ""] || [];
    const personOptions = flagData?.personFlags[entry.entryFlag || ""] || [];

    switch (col.key) {
      case "candidate":
        return (
          <td key={col.key} className="px-2 py-1.5 whitespace-nowrap">
            <Link href={`/candidates/${entry.candidateId}`} className="font-medium text-[#2563EB] hover:underline" onClick={(e) => e.stopPropagation()}>
              {entry.candidate.name}
            </Link>
            <div className="text-gray-400 text-[10px]">{entry.candidate.candidateNumber}</div>
          </td>
        );
      case "ca":
        return <td key={col.key} className="px-2 py-1.5 whitespace-nowrap text-[11px] text-gray-600">{entry.candidate.employee?.name || "-"}</td>;
      case "company":
        return (
          <td key={col.key} className="px-2 py-1.5 cursor-pointer hover:text-[#2563EB]" onClick={() => onRowClick(entry.id)} title={entry.companyName}>
            <div className="whitespace-nowrap truncate max-w-[160px]">{entry.companyName}</div>
            {entry.jobTitle && <div className="text-[10px] text-gray-400 truncate max-w-[160px]">{entry.jobTitle}</div>}
          </td>
        );
      case "jobDb":
        return (
          <td key={col.key} className="px-2 py-1.5 text-center">
            <div className="text-[11px]">{entry.jobDb || "-"}</div>
            {entry.externalJobNo && <div className="text-[10px] text-gray-400">{entry.externalJobNo}</div>}
          </td>
        );
      case "entryFlags":
        return (
          <td key={col.key} className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
            <select value={entry.entryFlag || ""}
              onChange={(e) => onFlagUpdate(entry.id, { entryFlag: e.target.value, entryFlagDetail: null, companyFlag: null, personFlag: null })}
              className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]">
              {entryFlagOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={entry.entryFlagDetail || ""}
              onChange={(e) => onFlagUpdate(entry.id, { entryFlagDetail: e.target.value })}
              className="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 mt-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] text-gray-500">
              <option value="">-</option>
              {flagData?.entryDetails[entry.entryFlag || ""]?.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </td>
        );
      case "statusFlags":
        return (
          <td key={col.key} className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
            {companyOptions.length > 0 ? (
              <select value={entry.companyFlag || ""}
                onChange={(e) => onFlagUpdate(entry.id, { companyFlag: e.target.value || null })}
                className={`w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${isCompanyFlagRed(entry) ? "text-red-600 font-semibold" : !entry.companyFlag ? "text-gray-400" : ""}`}>
                <option value="" className="text-gray-400">企業対応</option>
                {companyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <div className="text-gray-300 text-[11px] px-1 py-0.5">-</div>}
            {personOptions.length > 0 ? (
              <select value={entry.personFlag || ""}
                onChange={(e) => onFlagUpdate(entry.id, { personFlag: e.target.value || null })}
                className={`w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 mt-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${isPersonFlagRed(entry) ? "text-red-600 font-semibold" : !entry.personFlag ? "text-gray-400" : ""}`}>
                <option value="" className="text-gray-400">本人対応</option>
                {personOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <div className="text-gray-300 text-[10px] px-1 py-0.5 mt-0.5">-</div>}
          </td>
        );
      case "entryDate":
        return <td key={col.key} className="px-2 py-1.5 text-center text-[11px]" title={fmtDateFull(entry.entryDate)}>{fmtDate(entry.entryDate)}</td>;
      case "docSubmit":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.documentSubmitDate} entryId={entry.id} field="documentSubmitDate" onUpdate={onFieldUpdate} /></td>;
      case "docDates":
        return (
          <td key={col.key} className="px-1 py-0.5 text-center text-[11px]">
            <InlineDateCell value={entry.documentSubmitDate} entryId={entry.id} field="documentSubmitDate" onUpdate={onFieldUpdate} />
            <div className="mt-0.5"><InlineDateCell value={entry.documentPassDate} entryId={entry.id} field="documentPassDate" onUpdate={onFieldUpdate} /></div>
          </td>
        );
      case "aptitudeDates":
        return (
          <td key={col.key} className="px-1 py-0.5 text-center text-[11px]" onClick={(e) => e.stopPropagation()}>
            <AptitudeCell value={entry.aptitudeTestExists} entryId={entry.id} onUpdate={onFieldUpdate} />
            <div className="mt-0.5"><InlineDateCell value={entry.aptitudeTestDeadline} entryId={entry.id} field="aptitudeTestDeadline" onUpdate={onFieldUpdate} /></div>
          </td>
        );
      case "interviewPrep":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.interviewPrepDate} timeValue={entry.interviewPrepTime} entryId={entry.id} dateField="interviewPrepDate" timeField="interviewPrepTime" onUpdate={onFieldUpdate} /></td>;
      case "firstInterview":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.firstInterviewDate} timeValue={entry.firstInterviewTime} entryId={entry.id} dateField="firstInterviewDate" timeField="firstInterviewTime" onUpdate={onFieldUpdate} /></td>;
      case "finalInterview":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.finalInterviewDate} timeValue={entry.finalInterviewTime} entryId={entry.id} dateField="finalInterviewDate" timeField="finalInterviewTime" onUpdate={onFieldUpdate} /></td>;
      case "offerDate":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.offerDate} entryId={entry.id} field="offerDate" onUpdate={onFieldUpdate} /></td>;
      case "offerDeadline":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.offerDeadline} entryId={entry.id} field="offerDeadline" onUpdate={onFieldUpdate} /></td>;
      case "offerMeeting":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.offerMeetingDate} timeValue={entry.offerMeetingTime} entryId={entry.id} dateField="offerMeetingDate" timeField="offerMeetingTime" onUpdate={onFieldUpdate} /></td>;
      case "acceptance":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.acceptanceDate} entryId={entry.id} field="acceptanceDate" onUpdate={onFieldUpdate} /></td>;
      case "joinDate":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.joinDate} entryId={entry.id} field="joinDate" onUpdate={onFieldUpdate} /></td>;
      case "memo":
        return <td key={col.key} className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}><MemoCell value={entry.memo} entryId={entry.id} onUpdate={onFieldUpdate} /></td>;
      default:
        return <td key={col.key} />;
    }
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="text-[12px] border-collapse" style={{ minWidth }}>
        <colgroup>
          <col style={{ width: 36, minWidth: 36 }} />
          {cols.map((c, i) => <col key={i} style={{ width: c.width, minWidth: c.width }} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#1E3A8A] text-white">
            <th className="px-1 py-1.5 text-center">
              <input type="checkbox" checked={allSelected}
                onChange={() => allSelected ? onDeselectAll() : onSelectAll(allIds)}
                className="w-3.5 h-3.5 rounded border-white/50 text-[#2563EB]" />
            </th>
            {cols.map((c) => (
              <th key={c.key}
                className={`px-2 py-1 text-left whitespace-nowrap text-[11px] font-semibold ${c.sortKey ? "cursor-pointer select-none hover:bg-[#1E3A8A]/80" : ""}`}
                onClick={() => c.sortKey && onSort(c.sortKey)}>
                {c.key === "entryFlags" ? (
                  <div>
                    <div>エントリーフラグ <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">フラグ詳細</div>
                  </div>
                ) : c.key === "statusFlags" ? (
                  <div>
                    <div>企業対応 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">本人対応</div>
                  </div>
                ) : c.key === "docDates" ? (
                  <div>
                    <div>書類提出日 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">書類通過日</div>
                  </div>
                ) : c.key === "aptitudeDates" ? (
                  <div>
                    <div>適性検査 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">検査期限</div>
                  </div>
                ) : (
                  <>{c.label}<SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const rowClass = getRowClass(entry);
            const inactive = !entry.isActive;
            return (
              <tr key={entry.id} className={`${rowClass} border-b border-gray-200 hover:bg-blue-50/30 ${inactive ? "line-through" : ""}`}>
                <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(entry.id)}
                    onChange={() => onSelectToggle(entry.id)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB]" />
                </td>
                {cols.map((col) => renderCell(entry, col))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
