"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeaveRequestItem } from "./detail-types";
import { BlockTitle } from "./detail-ui";

// T-096 タブ6: 有休。既存勤怠と統合（新規有休モデルなし）:
// - 残日数 = Employee.paidLeave。編集は既存 PATCH /api/attendance/admin/employees を呼ぶ
//   （approval.ts の decrement 整合を壊さない・サーバロジックは既存のまま）
// - 消化サマリ・履歴 = 既存 LeaveRequest の閲覧のみ。このタブから申請・承認はしない

function typeLabel(lr: LeaveRequestItem): string {
  if (lr.leaveType === "PAID_FULL") return "有給（全日）";
  if (lr.leaveType === "PAID_HALF") return `有給（半日${lr.halfDay ?? ""}）`;
  return "その他休暇";
}

const STATUS_LABEL: Record<LeaveRequestItem["status"], { label: string; cls: string }> = {
  PENDING: { label: "承認待ち", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "承認済", cls: "bg-green-50 text-green-700 border-green-200" },
  REJECTED: { label: "却下", cls: "bg-red-50 text-red-700 border-red-200" },
};

export default function LeaveTab({
  employeeId,
  paidLeave,
  leaveRequests,
}: {
  employeeId: string;
  paidLeave: number;
  leaveRequests: LeaveRequestItem[];
}) {
  const router = useRouter();
  const [paidLeaveInput, setPaidLeaveInput] = useState(String(paidLeave));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approved = leaveRequests.filter((lr) => lr.status === "APPROVED");
  const fullDays = approved.filter((lr) => lr.leaveType === "PAID_FULL").length;
  const halfCount = approved.filter((lr) => lr.leaveType === "PAID_HALF").length;
  const otherCount = approved.filter((lr) => lr.leaveType === "OTHER").length;

  const handleSave = async () => {
    const n = Number(paidLeaveInput);
    if (!Number.isFinite(n) || n < 0) {
      setError("0 以上の数値を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/attendance/admin/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, paidLeave: n }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `エラー ${res.status}`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-5 py-5">
      {/* 有給残日数 */}
      <BlockTitle>有給残日数</BlockTitle>
      <div className="flex items-end gap-3 max-w-md">
        <div className="flex-1">
          <label className="block text-[10px] text-gray-400 mb-1">残日数（日）</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={paidLeaveInput}
            onChange={(e) => {
              setPaidLeaveInput(e.target.value);
              setSaved(false);
            }}
            className="w-full border-0 border-b border-gray-300 rounded-none px-0 py-1.5 text-sm bg-transparent focus:ring-0 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-green-600">保存しました</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded bg-blue-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        ※ 勤怠管理（/attendance/admin/employees）と同じデータです。承認済みの有給申請で自動減算されます。
      </p>

      {/* 消化サマリ */}
      <div className="mt-5">
        <BlockTitle>消化サマリ（承認済み）</BlockTitle>
        <div className="flex gap-6 text-sm text-slate-700">
          <div>
            全日 <span className="font-semibold">{fullDays}</span> 日
          </div>
          <div>
            半日 <span className="font-semibold">{halfCount}</span> 回
          </div>
          {otherCount > 0 && (
            <div>
              その他休暇 <span className="font-semibold">{otherCount}</span> 件
            </div>
          )}
        </div>
      </div>

      {/* 消化履歴 */}
      <div className="mt-5">
        <BlockTitle>消化履歴</BlockTitle>
        {leaveRequests.length === 0 ? (
          <p className="text-sm text-gray-400">休暇申請はありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 border-b border-gray-200">
                  <th className="px-2 py-2 font-normal">日付</th>
                  <th className="px-2 py-2 font-normal">種別</th>
                  <th className="px-2 py-2 font-normal">ステータス</th>
                  <th className="px-2 py-2 font-normal">理由</th>
                </tr>
              </thead>
              <tbody>
                {leaveRequests.map((lr) => {
                  const st = STATUS_LABEL[lr.status];
                  return (
                    <tr key={lr.id} className="border-b border-gray-100">
                      <td className="px-2 py-2 font-mono text-[13px]">{lr.targetDate}</td>
                      <td className="px-2 py-2 text-[13px]">{typeLabel(lr)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-[13px] text-slate-600">{lr.reason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          ※ 申請・承認は従来どおり勤怠管理画面から行います（このタブは閲覧と残日数編集のみ）。
        </p>
      </div>
    </div>
  );
}
