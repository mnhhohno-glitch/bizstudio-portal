"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Toaster, toast } from "sonner";

type Employee = { id: string; employeeNumber: string; name: string; paidLeave: number; isExemptFromAttendance: boolean };

export default function AttendanceEmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLeave, setEditLeave] = useState("");

  const fetchData = () => {
    setLoading(true);
    fetch("/api/attendance/admin/employees")
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async (empId: string) => {
    try {
      const res = await fetch("/api/attendance/admin/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: empId, paidLeave: Number(editLeave) }),
      });
      if (!res.ok) { toast.error("更新に失敗しました"); return; }
      toast.success("有給日数を更新しました");
      setEditingId(null);
      fetchData();
    } catch { toast.error("更新に失敗しました"); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Toaster position="top-center" richColors />
      <div className="mb-6 flex items-center gap-3">
        <Link href="/attendance/admin" className="text-[14px] text-[#6B7280] hover:text-[#374151]">&larr; 管理者メニュー</Link>
        <h1 className="text-[18px] font-bold text-[#1E3A8A]">従業員管理</h1>
      </div>

      <div className="rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-[12px] font-medium text-[#6B7280]">
                <th className="px-4 py-3">社員NO</th>
                <th className="px-4 py-3">氏名</th>
                <th className="px-4 py-3">有給残日数</th>
                <th className="px-4 py-3">打刻</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                  <td className="px-4 py-3 font-mono">{emp.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium">{emp.name}</td>
                  <td className="px-4 py-3">
                    {editingId === emp.id ? (
                      <div className="flex items-center gap-2">
                        <input type="number" step="0.5" value={editLeave} onChange={(e) => setEditLeave(e.target.value)}
                          className="w-20 rounded border border-[#D1D5DB] px-2 py-1 text-[14px]" />
                        <span className="text-[#6B7280]">日</span>
                        <button onClick={() => handleSave(emp.id)} className="rounded bg-[#2563EB] px-3 py-1 text-[12px] text-white hover:bg-[#1D4ED8]">保存</button>
                        <button onClick={() => setEditingId(null)} className="text-[12px] text-[#6B7280]">取消</button>
                      </div>
                    ) : (
                      <span className="font-medium">{emp.paidLeave}日</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => {
                        try {
                          await fetch("/api/attendance/admin/employees", {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ employeeId: emp.id, isExemptFromAttendance: !emp.isExemptFromAttendance }),
                          });
                          fetchData();
                        } catch { toast.error("更新に失敗しました"); }
                      }}
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${emp.isExemptFromAttendance ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}
                    >
                      {emp.isExemptFromAttendance ? "不要" : "必要"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {editingId !== emp.id && (
                      <button onClick={() => { setEditingId(emp.id); setEditLeave(String(emp.paidLeave)); }}
                        className="text-[12px] text-[#2563EB] hover:underline">有給設定</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
