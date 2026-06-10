"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Table, Th, Td, TableWrap } from "@/components/ui/Table";
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
  PENDING: { label: "承認待ち", cls: "border-[#D97706]/30 bg-[#D97706]/10 text-[#D97706]" },
  APPROVED: { label: "承認済", cls: "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]" },
  REJECTED: { label: "却下", cls: "border-[#DC2626]/30 bg-[#DC2626]/10 text-[#DC2626]" },
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
      // 既存の勤怠側 admin API をそのまま呼ぶ（/attendance/admin/employees と同一経路）
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
    <div className="space-y-6">
      <Card>
        <CardBody>
          <BlockTitle>有給残日数</BlockTitle>
          <div className="flex items-end gap-3 max-w-md">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                残日数（日）
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={paidLeaveInput}
                onChange={(e) => {
                  setPaidLeaveInput(e.target.value);
                  setSaved(false);
                }}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {saved && <span className="text-sm text-green-600">保存しました</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            ※ 勤怠管理（/attendance/admin/employees）と同じデータです。承認済みの有給申請で自動減算されます。
          </p>

          <div className="mt-6">
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
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <BlockTitle>消化履歴</BlockTitle>
          {leaveRequests.length === 0 ? (
            <p className="text-sm text-slate-500">休暇申請はありません。</p>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>日付</Th>
                    <Th>種別</Th>
                    <Th>ステータス</Th>
                    <Th>理由</Th>
                  </tr>
                </thead>
                <tbody>
                  {leaveRequests.map((lr) => {
                    const st = STATUS_LABEL[lr.status];
                    return (
                      <tr key={lr.id}>
                        <Td>
                          <span className="font-mono text-[13px]">{lr.targetDate}</span>
                        </Td>
                        <Td>{typeLabel(lr)}</Td>
                        <Td>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${st.cls}`}
                          >
                            {st.label}
                          </span>
                        </Td>
                        <Td>
                          <span className="text-[13px] text-slate-600">{lr.reason || "-"}</span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
          <p className="mt-3 text-xs text-slate-500">
            ※ 申請・承認は従来どおり勤怠管理画面から行います（このタブは閲覧と残日数編集のみ）。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
