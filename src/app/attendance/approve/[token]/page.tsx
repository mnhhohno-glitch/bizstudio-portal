"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Toaster, toast } from "sonner";

const MOD_TYPE_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤時刻の修正", CLOCK_OUT_EDIT: "退勤時刻の修正",
  BREAK_START_EDIT: "休憩開始の修正", BREAK_END_EDIT: "休憩終了の修正",
  INTERRUPT_START_EDIT: "中断開始の修正", INTERRUPT_END_EDIT: "中断終了の修正",
  ADD_BREAK: "休憩の追加", ADD_INTERRUPT: "中断の追加",
};
const LEAVE_LABEL: Record<string, string> = { PAID_FULL: "有給（全日）", PAID_HALF: "有給（半日）", OTHER: "その他休暇" };

function formatDate(d: string): string {
  const dt = new Date(d);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日（${days[dt.getDay()]}）`;
}
function formatTime(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type RequestData = {
  type: "modification" | "leave";
  status: string;
  employee: { name: string; paidLeave?: number };
  targetDate: string;
  requestType?: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  reason?: string | null;
  leaveType?: string;
  halfDay?: string | null;
  rejectionReason?: string | null;
};

export default function ApprovePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<RequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/attendance/approve/${token}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setData(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAction = async (action: "approve" | "reject") => {
    if (action === "reject" && !rejectionReason.trim()) {
      toast.error("差し戻し理由を入力してください");
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch(`/api/attendance/approve/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, rejectionReason: rejectionReason.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error); return; }
      toast.success(action === "approve" ? "承認しました" : "差し戻しました");
      setDone(true);
    } catch { toast.error("処理に失敗しました"); }
    finally { setProcessing(false); }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-[#6B7280]">読み込み中...</div>;
  if (notFound) return <div className="flex min-h-screen items-center justify-center text-[#6B7280]">申請が見つかりません</div>;
  if (!data) return null;

  const isPending = data.status === "PENDING" && !done;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <Toaster position="top-center" richColors />
      <div className="w-full max-w-md rounded-[8px] border border-[#E5E7EB] bg-white p-6 shadow-lg">
        <h1 className="mb-4 text-[18px] font-bold text-[#374151]">
          {data.type === "modification" ? "打刻修正申請" : "休暇申請"}
        </h1>

        {data.status !== "PENDING" && !done && (
          <div className="mb-4 rounded-[6px] bg-gray-100 p-3 text-[14px] text-[#6B7280]">
            この申請は既に{data.status === "APPROVED" ? "承認" : "差し戻し"}されています
            {data.rejectionReason && <p className="mt-1 text-[13px]">理由: {data.rejectionReason}</p>}
          </div>
        )}

        {done && (
          <div className="mb-4 rounded-[6px] bg-green-50 p-3 text-[14px] text-green-700">処理が完了しました</div>
        )}

        <div className="space-y-3 text-[14px]">
          <div><span className="text-[#6B7280]">申請者:</span> <span className="font-medium">{data.employee.name}</span></div>
          <div><span className="text-[#6B7280]">対象日:</span> <span className="font-medium">{formatDate(data.targetDate)}</span></div>

          {data.type === "modification" && (
            <>
              <div><span className="text-[#6B7280]">修正種別:</span> <span className="font-medium">{MOD_TYPE_LABEL[data.requestType ?? ""] ?? data.requestType}</span></div>
              {data.beforeValue && <div><span className="text-[#6B7280]">修正前:</span> <span className="font-medium">{formatTime(data.beforeValue)}</span></div>}
              {data.afterValue && <div><span className="text-[#6B7280]">修正後:</span> <span className="font-medium text-[#2563EB]">{formatTime(data.afterValue)}</span></div>}
              {data.reason && <div><span className="text-[#6B7280]">理由:</span> <span>{data.reason}</span></div>}
            </>
          )}

          {data.type === "leave" && (
            <>
              <div><span className="text-[#6B7280]">種別:</span> <span className="font-medium">{LEAVE_LABEL[data.leaveType ?? ""] ?? data.leaveType}</span></div>
              {data.halfDay && <div><span className="text-[#6B7280]">区分:</span> <span>{data.halfDay === "AM" ? "午前" : "午後"}</span></div>}
              {data.employee.paidLeave !== undefined && data.leaveType !== "OTHER" && (
                <div><span className="text-[#6B7280]">有給残:</span> <span>{data.employee.paidLeave}日 → {data.employee.paidLeave - (data.leaveType === "PAID_HALF" ? 0.5 : 1)}日</span></div>
              )}
              {data.reason && <div><span className="text-[#6B7280]">理由:</span> <span>{data.reason}</span></div>}
            </>
          )}
        </div>

        {isPending && (
          <div className="mt-6 space-y-3">
            <div className="flex gap-3">
              <button onClick={() => handleAction("approve")} disabled={processing}
                className="flex-1 rounded-[8px] bg-green-600 py-2.5 text-[14px] font-bold text-white hover:bg-green-700 disabled:opacity-50">
                {processing ? "処理中..." : "承認"}
              </button>
              <button onClick={() => handleAction("reject")} disabled={processing || !rejectionReason.trim()}
                className="flex-1 rounded-[8px] bg-red-500 py-2.5 text-[14px] font-bold text-white hover:bg-red-600 disabled:opacity-50">
                差し戻し
              </button>
            </div>
            <div>
              <label className="mb-1 block text-[13px] text-[#6B7280]">差し戻し理由（差し戻す場合は必須）</label>
              <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2}
                className="w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px]" placeholder="理由を入力..." />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
