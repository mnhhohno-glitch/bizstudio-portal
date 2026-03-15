"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster, toast } from "sonner";

export default function LeaveRequestPage() {
  const router = useRouter();
  const [targetDate, setTargetDate] = useState("");
  const [leaveType, setLeaveType] = useState("PAID_FULL");
  const [halfDay, setHalfDay] = useState("");
  const [reason, setReason] = useState("");
  const [paidLeave, setPaidLeave] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/attendance/history")
      .then((r) => r.json())
      .then((data) => setPaidLeave(data.paidLeave ?? 0))
      .catch(() => {});
  }, []);

  const isPaid = leaveType === "PAID_FULL" || leaveType === "PAID_HALF";
  const deduction = leaveType === "PAID_HALF" ? 0.5 : leaveType === "PAID_FULL" ? 1 : 0;
  const insufficient = isPaid && paidLeave < deduction;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDate) { toast.error("日付を選択してください"); return; }
    if (insufficient) { toast.error("有給残日数が不足しています"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/attendance/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDate,
          leaveType,
          halfDay: leaveType === "PAID_HALF" ? (halfDay || "AM") : null,
          reason: reason.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); return; }
      toast.success("休暇申請を送信しました");
      router.push("/attendance/history");
    } catch { toast.error("送信に失敗しました"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Toaster position="top-center" richColors />

      <div className="mb-6">
        <Link href="/attendance" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 打刻画面に戻る</Link>
        <h1 className="mt-2 text-[18px] font-bold text-[#1E3A8A]">休暇申請</h1>
      </div>

      {/* Paid leave balance */}
      <div className="mb-6 rounded-[8px] border border-[#E5E7EB] bg-white p-4 text-center">
        <p className="text-[13px] text-[#6B7280]">有給残日数</p>
        <p className={`text-[24px] font-bold ${insufficient ? "text-red-600" : "text-[#374151]"}`}>
          {paidLeave}日
        </p>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[#374151]">対象日 *</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" />
          </div>

          <div>
            <label className="mb-2 block text-[13px] font-medium text-[#374151]">休暇種別 *</label>
            <div className="space-y-2">
              {[
                { value: "PAID_FULL", label: "有給（全日）" },
                { value: "PAID_HALF", label: "有給（半日）" },
                { value: "OTHER", label: "その他休暇" },
              ].map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="leaveType" value={opt.value} checked={leaveType === opt.value} onChange={() => setLeaveType(opt.value)} className="accent-[#2563EB]" />
                  <span className="text-[14px] text-[#374151]">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {leaveType === "PAID_HALF" && (
            <div>
              <label className="mb-2 block text-[13px] font-medium text-[#374151]">半日区分</label>
              <div className="flex gap-4">
                {[
                  { value: "AM", label: "午前" },
                  { value: "PM", label: "午後" },
                ].map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="halfDay" value={opt.value} checked={halfDay === opt.value} onChange={() => setHalfDay(opt.value)} className="accent-[#2563EB]" />
                    <span className="text-[14px] text-[#374151]">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[#374151]">理由（任意）</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" />
          </div>

          {insufficient && (
            <p className="text-[13px] text-red-600 font-medium">有給残日数が不足しています</p>
          )}

          <button type="submit" disabled={submitting || insufficient} className="w-full rounded-[8px] bg-[#2563EB] py-2.5 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {submitting ? "送信中..." : "休暇申請を送信"}
          </button>
        </form>
      </div>
    </div>
  );
}
