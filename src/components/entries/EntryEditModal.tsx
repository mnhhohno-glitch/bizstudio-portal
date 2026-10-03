"use client";

import { useState } from "react";
import { toast } from "sonner";
import { JOB_TYPE_BY_ROUTE, getJobTypeOptionsForRoute } from "@/lib/constants/job-types";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import type { Entry } from "./EntryBoard";
import { documentPassDateFromInput, documentPassDateToInput } from "@/lib/entries/documentPassDate";

type Props = {
  entry: Entry;
  onClose: () => void;
  onSaved: (updated: Entry) => void;
};

const JOB_DB_OPTIONS = Object.keys(JOB_TYPE_BY_ROUTE);

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function toIsoOrNull(dateInput: string): string | null {
  if (!dateInput) return null;
  return `${dateInput}T12:00:00.000Z`;
}

export default function EntryEditModal({ entry, onClose, onSaved }: Props) {
  const [companyName, setCompanyName] = useState(entry.companyName || "");
  const [jobTitle, setJobTitle] = useState(entry.jobTitle || "");
  // T-161: 職種（紹介履歴タブの職種バッジの元データ）。サイト経由等で自動で埋まらなかった行を人が補えるようにする。
  const [jobCategory, setJobCategory] = useState(entry.jobCategory || "");
  const [jobDb, setJobDb] = useState(entry.jobDb || "");
  const [jobType, setJobType] = useState(entry.jobType || "");
  const [externalJobNo, setExternalJobNo] = useState(entry.externalJobNo || "");
  const [entryDate, setEntryDate] = useState(toDateInput(entry.entryDate));
  const [documentSubmitDate, setDocumentSubmitDate] = useState(toDateInput(entry.documentSubmitDate));
  // 書類通過日：選考段階（面接・内定・選考終了後）に関係なく確認・訂正・空欄化できる。
  // 日付定義は書類選考タブのセルと同じ（保存=JST日付のUTC正午、表示=JST日付）。src/lib/entries/documentPassDate.ts
  const initialDocumentPassDate = documentPassDateToInput(entry.documentPassDate);
  const [documentPassDate, setDocumentPassDate] = useState(initialDocumentPassDate);
  const [memo, setMemo] = useState(entry.memo || "");
  const [saving, setSaving] = useState(false);
  const overlayClose = useOverlayClose(onClose);

  const jobTypeOptions = getJobTypeOptionsForRoute(entry.entryRoute || jobDb);

  const handleJobDbChange = (value: string) => {
    setJobDb(value);
    const nextOptions = getJobTypeOptionsForRoute(entry.entryRoute || value);
    if (jobType && !nextOptions.includes(jobType)) {
      setJobType("");
    }
  };

  const canSave = companyName.trim() !== "" && jobDb !== "" && entryDate !== "";

  const handleSave = async () => {
    if (!canSave || saving) return;
    // 変更した項目だけを送る（書類通過日だけを直したときに、他の日付・フラグ・有効/無効を動かさないため）。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {};
    const trimmedOrNull = (v: string) => v.trim() || null;
    if (companyName.trim() !== (entry.companyName || "").trim()) payload.companyName = companyName.trim();
    if (trimmedOrNull(jobTitle) !== trimmedOrNull(entry.jobTitle || "")) payload.jobTitle = trimmedOrNull(jobTitle);
    if (trimmedOrNull(jobCategory) !== trimmedOrNull(entry.jobCategory || "")) payload.jobCategory = trimmedOrNull(jobCategory);
    if ((jobDb || null) !== (entry.jobDb || null)) payload.jobDb = jobDb || null;
    if ((jobType || null) !== (entry.jobType || null)) payload.jobType = jobType || null;
    if (trimmedOrNull(externalJobNo) !== trimmedOrNull(entry.externalJobNo || "")) payload.externalJobNo = trimmedOrNull(externalJobNo);
    if (entryDate !== toDateInput(entry.entryDate)) payload.entryDate = toIsoOrNull(entryDate);
    if (documentSubmitDate !== toDateInput(entry.documentSubmitDate)) payload.documentSubmitDate = toIsoOrNull(documentSubmitDate);
    if (documentPassDate !== initialDocumentPassDate) payload.documentPassDate = documentPassDateFromInput(documentPassDate);
    if (trimmedOrNull(memo) !== trimmedOrNull(entry.memo || "")) payload.memo = trimmedOrNull(memo);

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("更新に失敗しました");
        return;
      }
      const data = await res.json();
      toast.success("エントリーを更新しました");
      onSaved(data.entry);
    } catch {
      toast.error("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" {...overlayClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">エントリー編集</h2>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* 読み取り専用情報 */}
          <div className="text-xs text-gray-600 space-y-1">
            <div>
              <span className="text-gray-400">求職者: </span>
              <span className="font-medium text-gray-700">{entry.candidate.name}</span>
              <span className="text-gray-400 ml-1">({entry.candidate.candidateNumber})</span>
            </div>
            <div>
              <span className="text-gray-400">担当CA: </span>
              <span className="font-medium text-gray-700">{entry.candidate.employee?.name || "-"}</span>
            </div>
          </div>

          {/* 求人情報 */}
          <fieldset className="border border-gray-200 rounded-md p-3">
            <legend className="px-1 text-xs text-gray-500">求人情報</legend>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  企業名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">求人タイトル</label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">職種</label>
                <input
                  type="text"
                  value={jobCategory}
                  onChange={(e) => setJobCategory(e.target.value)}
                  disabled={saving}
                  placeholder="例: 営業 / 事務"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    求人DB <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={jobDb}
                    onChange={(e) => handleJobDbChange(e.target.value)}
                    disabled={saving}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                  >
                    <option value=""></option>
                    {JOB_DB_OPTIONS.map((db) => (
                      <option key={db} value={db}>{db}</option>
                    ))}
                    {jobDb && !JOB_DB_OPTIONS.includes(jobDb) && (
                      <option value={jobDb}>{jobDb}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">求人種別</label>
                  <select
                    value={jobType}
                    onChange={(e) => setJobType(e.target.value)}
                    disabled={saving}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                  >
                    <option value=""></option>
                    {jobTypeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    {jobType && !jobTypeOptions.includes(jobType) && (
                      <option value={jobType}>{jobType}</option>
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">求人ID</label>
                <input
                  type="text"
                  value={externalJobNo}
                  onChange={(e) => setExternalJobNo(e.target.value)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
            </div>
          </fieldset>

          {/* 日付 */}
          <fieldset className="border border-gray-200 rounded-md p-3">
            <legend className="px-1 text-xs text-gray-500">日付</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  紹介日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">書類提出日</label>
                <input
                  type="date"
                  value={documentSubmitDate}
                  onChange={(e) => setDocumentSubmitDate(e.target.value)}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">書類通過日</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={documentPassDate}
                    onChange={(e) => setDocumentPassDate(e.target.value)}
                    disabled={saving}
                    data-testid="entry-edit-document-pass-date"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
                  />
                  {documentPassDate && (
                    <button
                      type="button"
                      onClick={() => setDocumentPassDate("")}
                      disabled={saving}
                      title="書類通過日を空欄にする"
                      className="shrink-0 text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                    >
                      クリア
                    </button>
                  )}
                </div>
              </div>
            </div>
          </fieldset>

          {/* メモ */}
          <fieldset className="border border-gray-200 rounded-md p-3">
            <legend className="px-1 text-xs text-gray-500">メモ</legend>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={saving}
              rows={4}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] focus:outline-none"
            />
          </fieldset>

          {!canSave && (
            <div className="text-xs text-red-500">企業名・求人DB・紹介日は必須です</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="px-4 py-2 text-sm font-medium bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
