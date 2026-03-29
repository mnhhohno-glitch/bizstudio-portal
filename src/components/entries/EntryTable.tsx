"use client";

import { SELECTION_ENDED_DETAILS } from "@/lib/constants/entry-flag-rules";
import type { Entry, FlagData } from "./EntryBoard";

type Props = {
  entries: Entry[];
  flagData: FlagData | null;
  onFlagUpdate: (entryId: string, flags: Record<string, string | null>) => void;
  onRowClick: (entryId: string) => void;
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

export default function EntryTable({ entries, flagData, onFlagUpdate, onRowClick }: Props) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[#1E3A8A] text-white">
            <th className="px-2 py-1.5 text-left whitespace-nowrap">求職者</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap">担当CA</th>
            <th className="px-2 py-1.5 text-left whitespace-nowrap">紹介先企業</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">求人DB</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">エントリーフラグ</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">フラグ詳細</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">企業対応</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">本人対応</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">エントリー日</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">書類提出</th>
            <th className="px-2 py-1.5 text-center whitespace-nowrap">書類通過</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const rowClass = getRowClass(entry);
            const inactive = !entry.isActive;
            const companyOptions = flagData?.companyFlags[entry.entryFlag || ""] || [];
            const personOptions = flagData?.personFlags[entry.entryFlag || ""] || [];

            return (
              <tbody key={entry.id} className={`${rowClass} border-b border-gray-200 hover:bg-blue-50/30`}>
                {/* Data row 1 */}
                <tr className={inactive ? "line-through" : ""}>
                  <td
                    className="px-2 py-1.5 whitespace-nowrap cursor-pointer hover:text-[#2563EB]"
                    onClick={() => onRowClick(entry.id)}
                  >
                    <span className="font-medium">{entry.candidate.name}</span>
                    <span className="text-gray-400 ml-1 text-[10px]">{entry.candidate.candidateNumber}</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-[11px] text-gray-600">
                    {entry.candidate.employee?.name || "-"}
                  </td>
                  <td
                    className="px-2 py-1.5 whitespace-nowrap max-w-[160px] truncate cursor-pointer hover:text-[#2563EB]"
                    onClick={() => onRowClick(entry.id)}
                    title={entry.companyName}
                  >
                    {entry.companyName}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-center text-[11px]">{entry.jobDb || "-"}</td>
                  <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={entry.entryFlag || ""}
                      onChange={(e) => onFlagUpdate(entry.id, { entryFlag: e.target.value, entryFlagDetail: null, companyFlag: null, personFlag: null })}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]"
                    >
                      {flagData?.entryFlags.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={entry.entryFlagDetail || ""}
                      onChange={(e) => onFlagUpdate(entry.id, { entryFlagDetail: e.target.value })}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]"
                    >
                      <option value="">-</option>
                      {flagData?.entryDetails[entry.entryFlag || ""]?.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                    {companyOptions.length > 0 ? (
                      <select
                        value={entry.companyFlag || ""}
                        onChange={(e) => onFlagUpdate(entry.id, { companyFlag: e.target.value || null })}
                        className={`text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${!entry.companyFlag ? "text-gray-400" : ""}`}
                      >
                        <option value="" className="text-gray-400">企業対応</option>
                        {companyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-300 text-[11px]">-</span>
                    )}
                  </td>
                  <td className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
                    {personOptions.length > 0 ? (
                      <select
                        value={entry.personFlag || ""}
                        onChange={(e) => onFlagUpdate(entry.id, { personFlag: e.target.value || null })}
                        className={`text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${!entry.personFlag ? "text-gray-400" : ""}`}
                      >
                        <option value="" className="text-gray-400">本人対応</option>
                        {personOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-300 text-[11px]">-</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.entryDate)}</td>
                  <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.documentSubmitDate)}</td>
                  <td className="px-2 py-1.5 text-center text-[11px]">{fmtDate(entry.documentPassDate)}</td>
                </tr>
                {/* Data row 2: sub-info */}
                <tr className={`text-[11px] text-gray-500 ${inactive ? "line-through" : ""}`}>
                  <td className="px-2 py-0.5" />
                  <td className="px-2 py-0.5" />
                  <td className="px-2 py-0.5 whitespace-nowrap max-w-[160px] truncate" title={entry.jobTitle}>
                    {entry.jobTitle || ""}
                  </td>
                  <td className="px-2 py-0.5 text-center whitespace-nowrap">{entry.externalJobNo || ""}</td>
                  <td className="px-2 py-0.5" colSpan={7} />
                </tr>
              </tbody>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
