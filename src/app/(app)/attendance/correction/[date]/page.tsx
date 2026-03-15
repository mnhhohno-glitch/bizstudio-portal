"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster, toast } from "sonner";

type Punch = { id: string; type: string; timestamp: string; isManualEdit: boolean };
type Attendance = { id: string; status: string; clockIn: string | null; clockOut: string | null; isFinalized: boolean };

const TYPE_LABEL: Record<string, string> = {
  CLOCK_IN: "出勤", CLOCK_OUT: "退勤",
  BREAK_START: "休憩開始", BREAK_END: "休憩終了",
  INTERRUPT_START: "中断開始", INTERRUPT_END: "中断終了",
};

const MOD_TYPES = [
  { value: "CLOCK_IN_EDIT", label: "出勤時刻の修正" },
  { value: "CLOCK_OUT_EDIT", label: "退勤時刻の修正" },
  { value: "BREAK_START_EDIT", label: "休憩開始時刻の修正" },
  { value: "BREAK_END_EDIT", label: "休憩終了時刻の修正" },
  { value: "INTERRUPT_START_EDIT", label: "中断開始時刻の修正" },
  { value: "INTERRUPT_END_EDIT", label: "中断終了時刻の修正" },
  { value: "ADD_BREAK", label: "休憩の追加" },
  { value: "ADD_INTERRUPT", label: "中断の追加" },
];

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

export default function CorrectionPage() {
  const { date } = useParams<{ date: string }>();
  const router = useRouter();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loading, setLoading] = useState(true);

  // Correction form state
  const [requestType, setRequestType] = useState("");
  const [afterTime, setAfterTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Inline edit state (for pre-finalized)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/attendance/status")
      .then((r) => r.json())
      .then(() => {
        // Fetch specific date data
        return fetch(`/api/attendance/history?month=${date?.substring(0, 7)}`);
      })
      .then((r) => r.json())
      .then((data) => {
        const record = data.records?.find((r: { date: string }) =>
          new Date(r.date).toISOString().split("T")[0] === date
        );
        if (record) {
          setAttendance(record);
          // Need to fetch punches for this specific date
          return fetch("/api/attendance/status").then((r) => r.json());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Fetch punches via dedicated endpoint
    fetch(`/api/attendance/correction/${date}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.attendance) setAttendance(data.attendance);
        if (data.punches) setPunches(data.punches);
      })
      .catch(() => {});
  }, [date]);

  const handleInlineEdit = (punch: Punch) => {
    const d = new Date(punch.timestamp);
    setEditTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setEditingId(punch.id);
  };

  const handleInlineSave = async (punchId: string, originalTs: string) => {
    if (!editTime) return;
    setSaving(true);
    try {
      const orig = new Date(originalTs);
      const [h, m] = editTime.split(":").map(Number);
      const newTs = new Date(orig);
      newTs.setHours(h, m, 0, 0);

      const res = await fetch("/api/attendance/punch/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punchEventId: punchId, newTimestamp: newTs.toISOString() }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); return; }
      toast.success("修正しました");
      setEditingId(null);
      window.location.reload();
    } catch { toast.error("修正に失敗しました"); }
    finally { setSaving(false); }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestType || !reason.trim()) {
      toast.error("修正種別と理由を入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const afterValue = afterTime ? new Date(`${date}T${afterTime}:00+09:00`).toISOString() : null;
      const res = await fetch("/api/attendance/correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: date, requestType, afterValue, reason }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); return; }
      toast.success("修正申請を送信しました");
      router.push("/attendance/history");
    } catch { toast.error("送信に失敗しました"); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return <div className="py-20 text-center text-[14px] text-[#6B7280]">読み込み中...</div>;
  }

  const d = new Date(date + "T00:00:00");
  const dateLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${["日", "月", "火", "水", "木", "金", "土"][d.getDay()]}）`;
  const isFinalized = attendance?.isFinalized ?? false;

  return (
    <div className="mx-auto max-w-lg">
      <Toaster position="top-center" richColors />

      <div className="mb-6">
        <Link href="/attendance/history" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 履歴に戻る</Link>
        <h1 className="mt-2 text-[18px] font-bold text-[#1E3A8A]">打刻修正 - {dateLabel}</h1>
      </div>

      {/* Punch timeline */}
      {punches.length > 0 && (
        <div className="mb-6 rounded-[8px] border border-[#E5E7EB] bg-white">
          <div className="border-b border-[#E5E7EB] px-4 py-3">
            <h3 className="text-[14px] font-bold text-[#374151]">打刻記録</h3>
          </div>
          <div className="divide-y divide-[#F3F4F6]">
            {punches.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-[13px] text-[#374151]">{TYPE_LABEL[p.type] ?? p.type}</span>
                <div className="flex-1">
                  {editingId === p.id ? (
                    <div className="flex items-center gap-2">
                      <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="rounded border border-[#D1D5DB] px-2 py-1 text-[14px]" />
                      <button onClick={() => handleInlineSave(p.id, p.timestamp)} disabled={saving} className="rounded bg-[#2563EB] px-3 py-1 text-[12px] text-white">保存</button>
                      <button onClick={() => setEditingId(null)} className="text-[12px] text-[#6B7280]">取消</button>
                    </div>
                  ) : (
                    <span className="text-[14px] font-medium tabular-nums">{formatTime(p.timestamp)}</span>
                  )}
                </div>
                {!isFinalized && editingId !== p.id && (
                  <button onClick={() => handleInlineEdit(p)} className="text-[12px] text-[#9CA3AF] hover:text-[#2563EB]">編集</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Correction form (for finalized records) */}
      {isFinalized && (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-6">
          <h3 className="mb-4 text-[15px] font-bold text-[#374151]">修正申請</h3>
          <p className="mb-4 text-[13px] text-[#6B7280]">確定済みの勤怠を修正するには、管理者の承認が必要です。</p>

          <form onSubmit={handleSubmitCorrection} className="space-y-4">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#374151]">修正種別 *</label>
              <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]">
                <option value="">選択してください</option>
                {MOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#374151]">修正後の時刻</label>
              <input type="time" value={afterTime} onChange={(e) => setAfterTime(e.target.value)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-[#374151]">修正理由 *</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="修正理由を入力してください" className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </div>
            <button type="submit" disabled={submitting} className="w-full rounded-[8px] bg-[#2563EB] py-2.5 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">
              {submitting ? "送信中..." : "修正申請を送信"}
            </button>
          </form>
        </div>
      )}

      {!isFinalized && punches.length > 0 && (
        <p className="mt-4 text-center text-[13px] text-[#6B7280]">
          確定前の打刻は上の「編集」ボタンから直接修正できます
        </p>
      )}
    </div>
  );
}
