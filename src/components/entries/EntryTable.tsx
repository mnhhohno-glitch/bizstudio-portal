"use client";

import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";
import type { Entry, FlagData } from "./EntryBoard";

type Props = {
  entries: Entry[];
  flagData: FlagData | null;
  onFlagUpdate: (entryId: string, flags: Record<string, string | null>) => void;
  onRowClick: (entryId: string) => void;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
};

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(5, 10).replace("-", "/");
}

function getRowClass(entry: Entry) {
  if (!entry.isActive) return "bg-gray-200 text-gray-400";
  if (SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "")) return "bg-gray-100 text-gray-500";
  return "bg-white";
}

const COL = {
  candidate: { width: 120, label: "求職者" },
  ca: { width: 80, label: "担当CA" },
  company: { width: 160, label: "紹介先企業" },
  jobDb: { width: 80, label: "求人DB" },
  entryFlag: { width: 110, label: "エントリーフラグ" },
  flagDetail: { width: 110, label: "フラグ詳細" },
  companyFlag: { width: 110, label: "企業対応" },
  personFlag: { width: 110, label: "本人対応" },
  entryDate: { width: 80, label: "エントリー日" },
  docSubmit: { width: 80, label: "書類提出" },
  docPass: { width: 80, label: "書類通過" },
} as const;

export default function EntryTable({ entries, flagData, onFlagUpdate, onRowClick, selectedIds, onSelectToggle, onSelectAll, onDeselectAll }: Props) {
  const entryFlagOptions = flagData?.entryFlags.filter((f) => f !== "応募") || [];
  const allIds = entries.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="text-[12px] border-collapse" style={{ minWidth: 1160 }}>
        <colgroup>
          <col style={{ width: 36, minWidth: 36 }} />
          {Object.values(COL).map((c, i) => (
            <col key={i} style={{ width: c.width, minWidth: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-[#1E3A8A] text-white">
            <th className="px-1 py-1.5 text-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => allSelected ? onDeselectAll() : onSelectAll(allIds)}
                className="w-3.5 h-3.5 rounded border-white/50 text-[#2563EB]"
              />
            </th>
            {Object.values(COL).map((c, i) => (
              <th key={i} className="px-2 py-1.5 text-left whitespace-nowrap text-[11px] font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const rowClass = getRowClass(entry);
            const inactive = !entry.isActive;
            const companyOptions = flagData?.companyFlags[entry.entryFlag || ""] || [];
            const personOptions = flagData?.personFlags[entry.entryFlag || ""] || [];

            return (
              <tr key={entry.id} className={`${rowClass} border-b border-gray-200 hover:bg-blue-50/30 ${inactive ? "line-through" : ""}`}>
                {/* Checkbox */}
                <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => onSelectToggle(entry.id)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB]"
                  />
                </td>
                {/* 求職者 */}
                <td className="px-2 py-1.5 whitespace-nowrap cursor-pointer hover:text-[#2563EB]" onClick={() => onRowClick(entry.id)}>
                  <div className="font-medium">{entry.candidate.name}</div>
                  <div className="text-gray-400 text-[10px]">{entry.candidate.candidateNumber}</div>
                </td>
                {/* 担当CA */}
                <td className="px-2 py-1.5 whitespace-nowrap text-[11px] text-gray-600">
                  {entry.candidate.employee?.name || "-"}
                </td>
                {/* 紹介先企業 + 求人タイトル */}
                <td className="px-2 py-1.5 cursor-pointer hover:text-[#2563EB]" onClick={() => onRowClick(entry.id)} title={entry.companyName}>
                  <div className="whitespace-nowrap truncate max-w-[160px]">{entry.companyName}</div>
                  {entry.jobTitle && <div className="text-[10px] text-gray-400 truncate max-w-[160px]">{entry.jobTitle}</div>}
                </td>
                {/* 求人DB + 外部求人NO */}
                <td className="px-2 py-1.5 text-center">
                  <div className="text-[11px]">{entry.jobDb || "-"}</div>
                  {entry.externalJobNo && <div className="text-[10px] text-gray-400">{entry.externalJobNo}</div>}
                </td>
                {/* エントリーフラグ */}
                <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={entry.entryFlag || ""}
                    onChange={(e) => onFlagUpdate(entry.id, { entryFlag: e.target.value, entryFlagDetail: null, companyFlag: null, personFlag: null })}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]"
                  >
                    {entryFlagOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </td>
                {/* フラグ詳細 */}
                <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={entry.entryFlagDetail || ""}
                    onChange={(e) => onFlagUpdate(entry.id, { entryFlagDetail: e.target.value })}
                    className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]"
                  >
                    <option value="">-</option>
                    {flagData?.entryDetails[entry.entryFlag || ""]?.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </td>
                {/* 企業対応 */}
                <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                  {companyOptions.length > 0 ? (
                    <select
                      value={entry.companyFlag || ""}
                      onChange={(e) => onFlagUpdate(entry.id, { companyFlag: e.target.value || null })}
                      className={`w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${!entry.companyFlag ? "text-gray-400" : ""}`}
                    >
                      <option value="" className="text-gray-400">企業対応</option>
                      {companyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  ) : (
                    <span className="text-gray-300 text-[11px]">-</span>
                  )}
                </td>
                {/* 本人対応 */}
                <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                  {personOptions.length > 0 ? (
                    <select
                      value={entry.personFlag || ""}
                      onChange={(e) => onFlagUpdate(entry.id, { personFlag: e.target.value || null })}
                      className={`w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${!entry.personFlag ? "text-gray-400" : ""}`}
                    >
                      <option value="" className="text-gray-400">本人対応</option>
                      {personOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  ) : (
                    <span className="text-gray-300 text-[11px]">-</span>
                  )}
                </td>
                {/* エントリー日 */}
                <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.entryDate)}</td>
                {/* 書類提出 */}
                <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.documentSubmitDate)}</td>
                {/* 書類通過 */}
                <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.documentPassDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
