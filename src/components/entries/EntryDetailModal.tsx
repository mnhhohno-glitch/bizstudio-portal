"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import Link from "next/link";
import type { Entry, FlagData } from "./EntryBoard";

type Props = {
  entryId: string;
  flagData: FlagData;
  onClose: () => void;
  onSaved: () => void;
};

function toInputDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export default function EntryDetailModal({ entryId, flagData, onClose, onSaved }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean | null>>({});

  useEffect(() => {
    fetch(`/api/entries/${entryId}`)
      .then((r) => r.json())
      .then((data) => {
        setEntry(data.entry);
        const e = data.entry;
        setForm({
          companyName: e.companyName || "",
          jobTitle: e.jobTitle || "",
          externalJobNo: e.externalJobNo || "",
          jobDb: e.jobDb || "",
          prefecture: e.prefecture || "",
          jobCategory: e.jobCategory || "",
          status: e.status || "有効",
          entryFlag: e.entryFlag || "求人紹介",
          entryFlagDetail: e.entryFlagDetail || "",
          companyFlag: e.companyFlag || "",
          personFlag: e.personFlag || "",
          entryDate: toInputDate(e.entryDate),
          firstMeetingDate: toInputDate(e.firstMeetingDate),
          jobIntroDate: toInputDate(e.jobIntroDate),
          documentSubmitDate: toInputDate(e.documentSubmitDate),
          documentPassDate: toInputDate(e.documentPassDate),
          aptitudeTestExists: e.aptitudeTestExists,
          aptitudeTestDeadline: toInputDate(e.aptitudeTestDeadline),
          interviewPrepDate: toInputDate(e.interviewPrepDate),
          interviewPrepTime: e.interviewPrepTime || "",
          firstInterviewDate: toInputDate(e.firstInterviewDate),
          firstInterviewTime: e.firstInterviewTime || "",
          finalInterviewDate: toInputDate(e.finalInterviewDate),
          finalInterviewTime: e.finalInterviewTime || "",
          offerDate: toInputDate(e.offerDate),
          offerDeadline: toInputDate(e.offerDeadline),
          offerMeetingDate: toInputDate(e.offerMeetingDate),
          offerMeetingTime: e.offerMeetingTime || "",
          acceptanceDate: toInputDate(e.acceptanceDate),
          joinDate: toInputDate(e.joinDate),
          memo: e.memo || "",
        });
      })
      .catch(() => toast.error("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [entryId]);

  const set = (key: string, value: string | boolean | null) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast.success("保存しました");
      onSaved();
      onClose();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("このエントリーを削除しますか？")) return;
    try {
      await fetch(`/api/entries/${entryId}`, { method: "DELETE" });
      toast.success("削除しました");
      onSaved();
      onClose();
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const selectCls = inputCls;
  const labelCls = "block text-[12px] font-medium text-gray-600 mb-0.5";

  const currentEntryFlag = (form.entryFlag as string) || "";

  if (loading) return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl p-6" onClick={(e) => e.stopPropagation()}>読み込み中...</div>
    </div>
  );

  if (!entry) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between z-10">
          <h2 className="text-[15px] font-bold text-[#374151]">エントリー詳細</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Candidate info */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{entry.candidate.name}</span>
            <span className="text-xs text-gray-400">({entry.candidate.candidateNumber})</span>
            <Link href={`/candidates/${entry.candidateId}`} className="text-xs text-[#2563EB] hover:underline ml-auto">
              求職者詳細へ →
            </Link>
          </div>

          {/* Job info */}
          <div>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2">求人情報</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={labelCls}>紹介先企業</label><input className={inputCls} value={form.companyName as string} onChange={(e) => set("companyName", e.target.value)} /></div>
              <div className="col-span-2"><label className={labelCls}>求人タイトル</label><input className={inputCls} value={form.jobTitle as string} onChange={(e) => set("jobTitle", e.target.value)} /></div>
              <div><label className={labelCls}>外部求人NO</label><input className={inputCls} value={form.externalJobNo as string} onChange={(e) => set("externalJobNo", e.target.value)} /></div>
              <div><label className={labelCls}>求人DB</label>
                <select className={selectCls} value={form.jobDb as string} onChange={(e) => set("jobDb", e.target.value)}>
                  <option value="">-</option>
                  {["HITO-Link", "Circus", "マイナビJOB", "DODA求人", "直接求人"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>都道府県</label><input className={inputCls} value={form.prefecture as string} onChange={(e) => set("prefecture", e.target.value)} /></div>
              <div><label className={labelCls}>状況</label>
                <select className={selectCls} value={form.status as string} onChange={(e) => set("status", e.target.value)}>
                  {["circus未登録", "circus登録済", "有効"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Flags */}
          <div>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2">フラグ</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>エントリーフラグ</label>
                <select className={selectCls} value={currentEntryFlag} onChange={(e) => { set("entryFlag", e.target.value); set("entryFlagDetail", ""); set("companyFlag", ""); set("personFlag", ""); }}>
                  {flagData.entryFlags.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>フラグ詳細</label>
                <select className={selectCls} value={form.entryFlagDetail as string} onChange={(e) => set("entryFlagDetail", e.target.value)}>
                  <option value="">-</option>
                  {flagData.entryDetails[currentEntryFlag]?.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>企業対応</label>
                <select className={selectCls} value={form.companyFlag as string} onChange={(e) => set("companyFlag", e.target.value)}>
                  <option value="">-</option>
                  {flagData.companyFlags[currentEntryFlag]?.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>本人対応</label>
                <select className={selectCls} value={form.personFlag as string} onChange={(e) => set("personFlag", e.target.value)}>
                  <option value="">-</option>
                  {flagData.personFlags[currentEntryFlag]?.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2">日程</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>エントリー日</label><input type="date" className={inputCls} value={form.entryDate as string} onChange={(e) => set("entryDate", e.target.value)} /></div>
              <div><label className={labelCls}>初回面談日</label><input type="date" className={inputCls} value={form.firstMeetingDate as string} onChange={(e) => set("firstMeetingDate", e.target.value)} /></div>
              <div><label className={labelCls}>求人紹介日</label><input type="date" className={inputCls} value={form.jobIntroDate as string} onChange={(e) => set("jobIntroDate", e.target.value)} /></div>
              <div><label className={labelCls}>書類提出日</label><input type="date" className={inputCls} value={form.documentSubmitDate as string} onChange={(e) => set("documentSubmitDate", e.target.value)} /></div>
              <div><label className={labelCls}>書類通過日</label><input type="date" className={inputCls} value={form.documentPassDate as string} onChange={(e) => set("documentPassDate", e.target.value)} /></div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={!!form.aptitudeTestExists} onChange={(e) => set("aptitudeTestExists", e.target.checked)} className="rounded border-gray-300 text-[#2563EB]" />適性検査有</label>
                <div className="flex-1"><label className={labelCls}>期限</label><input type="date" className={inputCls} value={form.aptitudeTestDeadline as string} onChange={(e) => set("aptitudeTestDeadline", e.target.value)} /></div>
              </div>
              <div><label className={labelCls}>面接対策日</label><input type="date" className={inputCls} value={form.interviewPrepDate as string} onChange={(e) => set("interviewPrepDate", e.target.value)} /></div>
              <div><label className={labelCls}>面接対策時間</label><input className={inputCls} value={form.interviewPrepTime as string} onChange={(e) => set("interviewPrepTime", e.target.value)} placeholder="10:00" /></div>
              <div><label className={labelCls}>一次面接日</label><input type="date" className={inputCls} value={form.firstInterviewDate as string} onChange={(e) => set("firstInterviewDate", e.target.value)} /></div>
              <div><label className={labelCls}>一次面接時間</label><input className={inputCls} value={form.firstInterviewTime as string} onChange={(e) => set("firstInterviewTime", e.target.value)} placeholder="14:00" /></div>
              <div><label className={labelCls}>最終面接日</label><input type="date" className={inputCls} value={form.finalInterviewDate as string} onChange={(e) => set("finalInterviewDate", e.target.value)} /></div>
              <div><label className={labelCls}>最終面接時間</label><input className={inputCls} value={form.finalInterviewTime as string} onChange={(e) => set("finalInterviewTime", e.target.value)} placeholder="14:00" /></div>
              <div><label className={labelCls}>内定日</label><input type="date" className={inputCls} value={form.offerDate as string} onChange={(e) => set("offerDate", e.target.value)} /></div>
              <div><label className={labelCls}>承諾期限</label><input type="date" className={inputCls} value={form.offerDeadline as string} onChange={(e) => set("offerDeadline", e.target.value)} /></div>
              <div><label className={labelCls}>オファー面談日</label><input type="date" className={inputCls} value={form.offerMeetingDate as string} onChange={(e) => set("offerMeetingDate", e.target.value)} /></div>
              <div><label className={labelCls}>オファー面談時間</label><input className={inputCls} value={form.offerMeetingTime as string} onChange={(e) => set("offerMeetingTime", e.target.value)} placeholder="10:00" /></div>
              <div><label className={labelCls}>承諾日</label><input type="date" className={inputCls} value={form.acceptanceDate as string} onChange={(e) => set("acceptanceDate", e.target.value)} /></div>
              <div><label className={labelCls}>入社日</label><input type="date" className={inputCls} value={form.joinDate as string} onChange={(e) => set("joinDate", e.target.value)} /></div>
            </div>
          </div>

          {/* Memo */}
          <div>
            <h3 className="text-[13px] font-semibold text-[#374151] mb-2">メモ</h3>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={form.memo as string}
              onChange={(e) => set("memo", e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-5 py-3 flex items-center gap-2">
          <Link href={`/candidates/${entry.candidateId}`} className="text-sm text-[#2563EB] hover:underline">
            求職者詳細へ →
          </Link>
          <div className="ml-auto flex gap-2">
            <button onClick={handleDelete} className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5">削除</button>
            <button onClick={handleSave} disabled={saving} className="bg-[#2563EB] text-white rounded-md px-4 py-1.5 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
