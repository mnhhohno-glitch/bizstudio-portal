"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PunchType } from "@prisma/client";
import { toast } from "sonner";

type Props = {
  status: string;
  availableActions: PunchType[];
};

const BUTTON_CONFIG: Record<PunchType, { label: string; color: string; activeColor: string }> = {
  CLOCK_IN: { label: "出勤", color: "bg-green-600 hover:bg-green-700", activeColor: "bg-green-600" },
  BREAK_START: { label: "休憩開始", color: "bg-blue-500 hover:bg-blue-600", activeColor: "bg-blue-500" },
  BREAK_END: { label: "休憩終了", color: "bg-blue-500 hover:bg-blue-600", activeColor: "bg-blue-500" },
  INTERRUPT_START: { label: "中断開始", color: "bg-amber-500 hover:bg-amber-600", activeColor: "bg-amber-500" },
  INTERRUPT_END: { label: "中断終了", color: "bg-amber-500 hover:bg-amber-600", activeColor: "bg-amber-500" },
  CLOCK_OUT: { label: "退勤", color: "bg-red-500 hover:bg-red-600", activeColor: "bg-red-500" },
};

const ALL_TYPES: PunchType[] = ["CLOCK_IN", "BREAK_START", "BREAK_END", "INTERRUPT_START", "INTERRUPT_END", "CLOCK_OUT"];

export default function PunchPanel({ status, availableActions }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ code: string; message: string }[] | null>(null);

  const handlePunch = async (punchType: PunchType) => {
    const now = new Date().toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
    const config = BUTTON_CONFIG[punchType];

    if (!confirm(`${now} に${config.label}を打刻しますか？`)) return;

    setLoading(true);
    setValidationErrors(null);
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ punchType }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.validationErrors) {
          setValidationErrors(data.validationErrors);
        } else {
          toast.error(data.error || "打刻に失敗しました");
        }
        return;
      }

      toast.success(`${config.label}を打刻しました`);
      router.refresh();
      // Re-fetch to update UI
      window.location.reload();
    } catch {
      toast.error("打刻に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // Show only relevant buttons based on status
  const visibleTypes = status === "NOT_STARTED"
    ? (["CLOCK_IN"] as PunchType[])
    : status === "FINISHED"
      ? []
      : ALL_TYPES.filter((t) => t !== "CLOCK_IN");

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-3">
        {visibleTypes.map((type) => {
          const config = BUTTON_CONFIG[type];
          const isActive = availableActions.includes(type);
          return (
            <button
              key={type}
              type="button"
              disabled={!isActive || loading}
              onClick={() => handlePunch(type)}
              className={`h-14 min-w-[100px] rounded-[8px] px-5 text-[15px] font-bold text-white transition-all ${
                isActive
                  ? `${config.color} shadow-md active:scale-95`
                  : "bg-gray-300 cursor-not-allowed opacity-50"
              } disabled:opacity-50`}
            >
              {loading ? "..." : config.label}
            </button>
          );
        })}
      </div>

      {status === "FINISHED" && (
        <p className="mt-4 text-center text-[14px] text-[#6B7280]">本日の勤務は終了しました</p>
      )}

      {/* Validation Error Modal */}
      {validationErrors && validationErrors.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-[8px] bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-[16px] font-bold text-red-600">退勤できません</h3>
            <div className="space-y-3 mb-6">
              {validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 rounded-[6px] bg-red-50 p-3">
                  <span className="text-red-500 shrink-0">!</span>
                  <p className="text-[14px] text-red-700">{err.message}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {validationErrors.some((e) => e.code === "BREAK_NOT_ENDED") && (
                <button
                  onClick={() => { setValidationErrors(null); handlePunch("BREAK_END"); }}
                  className="h-12 rounded-[8px] bg-blue-500 text-white font-bold hover:bg-blue-600"
                >
                  休憩終了を打刻
                </button>
              )}
              {validationErrors.some((e) => e.code === "INTERRUPT_NOT_ENDED") && (
                <button
                  onClick={() => { setValidationErrors(null); handlePunch("INTERRUPT_END"); }}
                  className="h-12 rounded-[8px] bg-amber-500 text-white font-bold hover:bg-amber-600"
                >
                  中断終了を打刻
                </button>
              )}
              <button
                onClick={() => setValidationErrors(null)}
                className="h-10 rounded-[6px] border border-[#E5E7EB] text-[14px] text-[#374151] hover:bg-[#F9FAFB]"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
