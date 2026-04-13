"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { getJobTypeOptionsForRoute } from "@/lib/constants/job-types";
import type { FlagData } from "./EntryBoard";

type CandidateOption = {
  id: string;
  name: string;
  candidateNumber: string;
};

type Props = {
  flagData: FlagData;
  onClose: () => void;
  onCreated: () => void;
};

export default function EntryCreateModal({ flagData, onClose, onCreated }: Props) {
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateOption | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [externalJobNo, setExternalJobNo] = useState("");
  const [jobDb, setJobDb] = useState("");
  const [jobType, setJobType] = useState("");
  const [prefecture, setPrefecture] = useState("");
  const [entryFlag, setEntryFlag] = useState("求人紹介");
  const [entryFlagDetail, setEntryFlagDetail] = useState("検討中");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/candidates")
      .then((r) => r.json())
      .then((data) => setCandidates(data.candidates || data || []))
      .catch(() => {});
  }, []);

  const filtered = searchQuery.length > 0
    ? candidates.filter(
        (c) =>
          c.name.includes(searchQuery) ||
          c.candidateNumber.includes(searchQuery)
      ).slice(0, 20)
    : [];

  const handleSubmit = async () => {
    if (!selectedCandidate || !companyName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: selectedCandidate.id,
          companyName: companyName.trim(),
          jobTitle: jobTitle.trim(),
          externalJobNo: externalJobNo.trim() || null,
          jobDb: jobDb || null,
          jobType: jobType || null,
          prefecture: prefecture.trim() || null,
          entryFlag,
          entryFlagDetail,
          entryDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "登録に失敗しました");
      }
      toast.success("エントリーを登録しました");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const labelCls = "block text-[13px] font-medium text-[#374151] mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-[#374151]">エントリー新規登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Candidate search */}
          <div className="relative">
            <label className={labelCls}>求職者（必須）</label>
            {selectedCandidate ? (
              <div className="flex items-center gap-2 border border-gray-300 rounded-md px-3 py-2 text-sm">
                <span className="font-medium">{selectedCandidate.name}</span>
                <span className="text-gray-400 text-xs">({selectedCandidate.candidateNumber})</span>
                <button onClick={() => { setSelectedCandidate(null); setSearchQuery(""); }} className="ml-auto text-gray-400 hover:text-red-500">✕</button>
              </div>
            ) : (
              <>
                <input
                  className={inputCls}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="求職者名 or 番号で検索..."
                />
                {showDropdown && filtered.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filtered.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedCandidate(c); setShowDropdown(false); setSearchQuery(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                      >
                        {c.name} <span className="text-gray-400 text-xs">({c.candidateNumber})</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Job info */}
          <div>
            <label className={labelCls}>紹介先企業（必須）</label>
            <input className={inputCls} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>求人タイトル</label>
            <input className={inputCls} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>外部求人NO</label>
              <input className={inputCls} value={externalJobNo} onChange={(e) => setExternalJobNo(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>求人DB</label>
              <select
                className={inputCls}
                value={jobDb}
                onChange={(e) => {
                  const next = e.target.value;
                  setJobDb(next);
                  // 媒体変更時、選択中の求人種別が新しい媒体の候補に含まれない場合はクリア
                  const nextOptions = getJobTypeOptionsForRoute(next || null);
                  if (jobType && !nextOptions.includes(jobType)) {
                    setJobType("");
                  }
                }}
              >
                <option value="">-</option>
                {["HITO-Link", "Circus", "マイナビJOB", "DODA求人", "直接求人"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>求人種別</label>
            <select className={inputCls} value={jobType} onChange={(e) => setJobType(e.target.value)}>
              <option value="">-</option>
              {getJobTypeOptionsForRoute(jobDb || null).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>都道府県</label>
            <input className={inputCls} value={prefecture} onChange={(e) => setPrefecture(e.target.value)} />
          </div>

          {/* Flags */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>エントリーフラグ</label>
              <select className={inputCls} value={entryFlag} onChange={(e) => { setEntryFlag(e.target.value); setEntryFlagDetail(""); }}>
                {flagData.entryFlags.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>フラグ詳細</label>
              <select className={inputCls} value={entryFlagDetail} onChange={(e) => setEntryFlagDetail(e.target.value)}>
                <option value="">-</option>
                {flagData.entryDetails[entryFlag]?.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>エントリー日</label>
            <input type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-300 bg-white text-gray-700 rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-50">キャンセル</button>
          <button
            onClick={handleSubmit}
            disabled={!selectedCandidate || !companyName.trim() || saving}
            className="flex-1 bg-[#2563EB] text-white rounded-md px-3 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "登録中..." : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}
