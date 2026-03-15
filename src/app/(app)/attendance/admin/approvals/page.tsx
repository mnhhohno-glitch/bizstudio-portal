"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";

type PendingItem = {
  id: string;
  type: "modification" | "leave";
  token: string;
  employeeName: string;
  targetDate: string;
  requestType: string;
  reason: string | null;
  createdAt: string;
};

const MOD_LABEL: Record<string, string> = {
  CLOCK_IN_EDIT: "出勤修正", CLOCK_OUT_EDIT: "退勤修正",
  BREAK_START_EDIT: "休憩開始修正", BREAK_END_EDIT: "休憩終了修正",
  INTERRUPT_START_EDIT: "中断開始修正", INTERRUPT_END_EDIT: "中断終了修正",
  ADD_BREAK: "休憩追加", ADD_INTERRUPT: "中断追加",
  PAID_FULL: "有給(全日)", PAID_HALF: "有給(半日)", OTHER: "その他休暇",
};

function formatDate(d: string): string {
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<"all" | "modification" | "leave">("all");
  const headerCheckRef = useRef<HTMLInputElement>(null);

  const fetchItems = () => {
    setLoading(true);
    fetch("/api/attendance/admin/approvals")
      .then((r) => r.json())
      .then((d) => { setItems(d.pending ?? []); setSelected(new Set()); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.type === filter);

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = selected.size > 0 && selected.size < filtered.length;
    }
  }, [selected, filtered]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((i) => i.token)));
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}件の申請を一括承認しますか？`)) return;
    setProcessing(true);
    let successCount = 0;
    for (const token of selected) {
      try {
        const res = await fetch(`/api/attendance/approve/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        });
        if (res.ok) successCount++;
      } catch { /* continue */ }
    }
    toast.success(`${successCount}件の申請を承認しました`);
    setProcessing(false);
    fetchItems();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Toaster position="top-center" richColors />
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/attendance/admin" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 管理者メニュー</Link>
          <h1 className="text-[18px] font-bold text-[#1E3A8A]">承認待ち一覧</h1>
        </div>
        <div className="flex gap-2">
          {(["all", "modification", "leave"] as const).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setSelected(new Set()); }}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${filter === f ? "bg-[#2563EB] text-white" : "bg-gray-100 text-[#374151] hover:bg-gray-200"}`}>
              {f === "all" ? "全て" : f === "modification" ? "打刻修正" : "有給"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-white p-12 text-center text-[14px] text-[#6B7280]">承認待ちの申請はありません</div>
      ) : (
        <>
          <div className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[12px] font-medium text-[#6B7280]">
                  <th className="w-10 px-3 py-3">
                    <input ref={headerCheckRef} type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleAll} className="h-4 w-4 accent-[#2563EB]" />
                  </th>
                  <th className="px-3 py-3">申請者</th>
                  <th className="px-3 py-3">対象日</th>
                  <th className="px-3 py-3">種別</th>
                  <th className="px-3 py-3">申請日</th>
                  <th className="px-3 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(item.token)}
                        onChange={() => setSelected((prev) => { const next = new Set(prev); next.has(item.token) ? next.delete(item.token) : next.add(item.token); return next; })}
                        className="h-4 w-4 accent-[#2563EB]" />
                    </td>
                    <td className="px-3 py-3 font-medium">{item.employeeName}</td>
                    <td className="px-3 py-3">{formatDate(item.targetDate)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${item.type === "leave" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                        {MOD_LABEL[item.requestType] ?? item.requestType}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[#6B7280]">{formatDate(item.createdAt)}</td>
                    <td className="px-3 py-3">
                      <Link href={`/attendance/approve/${item.token}`}
                        className="text-[12px] text-[#2563EB] hover:underline">詳細</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected.size > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-[#BFDBFE] bg-[#EEF2FF] px-4 py-2.5">
              <span className="text-[13px] font-medium text-[#2563EB]">{selected.size}件選択中</span>
              <button onClick={handleBulkApprove} disabled={processing}
                className="rounded-[6px] bg-green-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50">
                {processing ? "処理中..." : "一括承認"}
              </button>
              <button onClick={() => setSelected(new Set())}
                className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#F3F4F6]">
                選択解除
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
