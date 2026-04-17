"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Toaster, toast } from "sonner";

type Punch = { id: string; type: string; timestamp: string; isManualEdit: boolean };
type Attendance = { id: string; status: string; clockIn: string | null; clockOut: string | null; isFinalized: boolean };

const PUNCH_TYPES = [
  { type: "CLOCK_IN", reqType: "CLOCK_IN_EDIT", label: "出勤" },
  { type: "BREAK_START", reqType: "BREAK_START_EDIT", label: "休憩開始" },
  { type: "BREAK_END", reqType: "BREAK_END_EDIT", label: "休憩終了" },
  { type: "INTERRUPT_START", reqType: "INTERRUPT_START_EDIT", label: "中断開始" },
  { type: "INTERRUPT_END", reqType: "INTERRUPT_END_EDIT", label: "中断終了" },
  { type: "CLOCK_OUT", reqType: "CLOCK_OUT_EDIT", label: "退勤" },
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

  // Multi-item correction form
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [times, setTimes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-finalize inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/attendance/correction/${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.attendance) setAttendance(d.attendance);
        if (d.punches) setPunches(d.punches);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date]);

  // Get current time for each punch type
  const currentTimes: Record<string, string | null> = {};
  for (const pt of PUNCH_TYPES) {
    const punch = punches.find((p) => p.type === pt.type);
    currentTimes[pt.type] = punch ? formatTime(punch.timestamp) : null;
  }

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
    const checkedTypes = PUNCH_TYPES.filter((pt) => checks[pt.type]);
    if (checkedTypes.length === 0) { toast.error("修正する項目にチェックを入れてください"); return; }
    if (!reason.trim()) { toast.error("修正理由を入力してください"); return; }

    // Validate all checked items have times
    for (const pt of checkedTypes) {
      if (!times[pt.type]) { toast.error(`${pt.label}の修正後の時刻を入力してください`); return; }
    }

    setSubmitting(true);
    try {
      const items = checkedTypes.map((pt) => ({
        requestType: currentTimes[pt.type]
          ? pt.reqType
          : pt.type === "BREAK_START"
            ? "ADD_BREAK_START"
            : pt.type === "BREAK_END"
              ? "ADD_BREAK_END"
              : pt.type === "INTERRUPT_START"
                ? "ADD_INTERRUPT_START"
                : pt.type === "INTERRUPT_END"
                  ? "ADD_INTERRUPT_END"
                  : pt.reqType,
        beforeValue: currentTimes[pt.type] ? (() => {
          const punch = punches.find((p) => p.type === pt.type);
          return punch ? punch.timestamp : null;
        })() : null,
        afterTime: times[pt.type],
      }));

      const res = await fetch("/api/attendance/correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: date, items, reason: reason.trim() }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error); return; }
      toast.success("修正申請を送信しました");
      router.push("/attendance/history");
    } catch { toast.error("送信に失敗しました"); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="py-20 text-center text-[14px] text-[#6B7280]">読み込み中...</div>;

  const d = new Date(date + "T00:00:00");
  const dateLabel = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${["日", "月", "火", "水", "木", "金", "土"][d.getDay()]}）`;
  const isFinalized = attendance?.isFinalized ?? false;
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const isPastDate = date < todayStr;
  const useCorrectionForm = isFinalized || isPastDate;

  return (
    <div className="mx-auto max-w-lg">
      <Toaster position="top-center" richColors />

      <div className="mb-6">
        <Link href="/attendance/history" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 履歴に戻る</Link>
        <h1 className="mt-2 text-[18px] font-bold text-[#1E3A8A]">打刻修正 - {dateLabel}</h1>
      </div>

      {/* Pre-finalize: inline edit (当日のみ) */}
      {!useCorrectionForm && punches.length > 0 && (
        <div className="mb-6 rounded-xl border border-[#E5E7EB] bg-white">
          <div className="border-b border-[#E5E7EB] px-4 py-3">
            <h3 className="text-[14px] font-bold text-[#374151]">打刻記録（確定前 - 直接編集可能）</h3>
          </div>
          <div className="divide-y divide-[#F3F4F6]">
            {punches.map((p) => {
              const label = PUNCH_TYPES.find((pt) => pt.type === p.type)?.label ?? p.type;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-[13px] text-[#374151] w-20">{label}</span>
                  <div className="flex-1">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-2">
                        <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
                          className="rounded border border-[#D1D5DB] px-2 py-1 text-[14px]" />
                        <button onClick={() => handleInlineSave(p.id, p.timestamp)} disabled={saving}
                          className="rounded bg-[#2563EB] px-3 py-1 text-[12px] text-white">保存</button>
                        <button onClick={() => setEditingId(null)} className="text-[12px] text-[#6B7280]">取消</button>
                      </div>
                    ) : (
                      <span className="text-[14px] font-medium tabular-nums">{formatTime(p.timestamp)}</span>
                    )}
                  </div>
                  {editingId !== p.id && (
                    <button onClick={() => { setEditTime(formatTime(p.timestamp)); setEditingId(p.id); }}
                      className="text-[12px] text-[#9CA3AF] hover:text-[#2563EB]">編集</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Post-finalize or past date: multi-item correction form */}
      {useCorrectionForm && (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
          <h3 className="mb-2 text-[15px] font-bold text-[#374151]">修正申請</h3>
          <p className="mb-4 text-[13px] text-[#6B7280]">修正する項目にチェックを入れ、修正後の時刻を入力してください。</p>

          <form onSubmit={handleSubmitCorrection}>
            <div className="rounded-lg border border-[#E5E7EB] overflow-hidden mb-4">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[#F9FAFB] text-left text-[11px] font-medium text-[#6B7280]">
                    <th className="px-3 py-2 w-8">修正</th>
                    <th className="px-3 py-2">項目</th>
                    <th className="px-3 py-2">現在の値</th>
                    <th className="px-3 py-2">修正後</th>
                  </tr>
                </thead>
                <tbody>
                  {PUNCH_TYPES.map((pt) => {
                    const current = currentTimes[pt.type];
                    const checked = checks[pt.type] ?? false;
                    return (
                      <tr key={pt.type} className="border-t border-[#F3F4F6]">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={checked}
                            onChange={(e) => setChecks({ ...checks, [pt.type]: e.target.checked })}
                            className="h-4 w-4 accent-[#2563EB]" />
                        </td>
                        <td className="px-3 py-2 font-medium">{pt.label}</td>
                        <td className="px-3 py-2 tabular-nums text-[#6B7280]">{current ?? "-"}</td>
                        <td className="px-3 py-2">
                          <input type="time" value={times[pt.type] ?? ""} disabled={!checked}
                            onChange={(e) => setTimes({ ...times, [pt.type]: e.target.value })}
                            className="rounded border border-[#D1D5DB] px-2 py-1 text-[13px] disabled:bg-gray-100 disabled:text-gray-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-[13px] font-medium text-[#374151]">修正理由 *</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                placeholder="修正理由を入力してください"
                className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </div>

            <button type="submit" disabled={submitting || !Object.values(checks).some(Boolean)}
              className="w-full rounded-lg bg-[#2563EB] py-2.5 text-[14px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">
              {submitting ? "送信中..." : "修正申請を送信"}
            </button>
          </form>
        </div>
      )}

      {!isFinalized && punches.length > 0 && (
        <p className="mt-4 text-center text-[13px] text-[#6B7280]">確定前の打刻は上の「編集」ボタンから直接修正できます</p>
      )}
    </div>
  );
}
