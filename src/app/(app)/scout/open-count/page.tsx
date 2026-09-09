"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";

type Slot = {
  id: string;
  hourSlot: number;
  machineId: string | null;
  openCount: number;
  isAggregationTarget: boolean;
  machine: { id: string; recruiterName: string; machineLabel: string; machineNumber: number | null; isActive: boolean } | null;
};

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function yesterday(): string {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default function ScoutOpenCountPage() {
  const [date, setDate] = useState(yesterday());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/scout/slots?date=${date}`);
    if (res.ok) {
      const data = await res.json();
      setSlots(data.slots || []);
      const v: Record<string, number> = {};
      for (const s of data.slots || []) v[s.id] = s.openCount || 0;
      setValues(v);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    const updates = Object.entries(values).map(([id, openCount]) => ({ id, openCount }));
    const res = await fetch("/api/scout/open-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, updates }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`保存しました: ${data.successCount} 件`);
      load();
    } else {
      toast.error("保存に失敗しました");
    }
  };

  const groupedMachines = Array.from(
    new Map(
      slots
        .filter((s) => s.machine)
        .map((s) => [s.machineId, s.machine!]),
    ).values(),
  );

  return (
    <div>
      <ScoutNav />
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-bold text-[#374151]">開封数入力</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
          />
          <button
            onClick={save}
            disabled={saving || slots.length === 0}
            className="rounded-md bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "一括保存"}
          </button>
        </div>
      </div>

      <p className="mt-2 text-[12px] text-[#9CA3AF]">
        当面は手入力です。将来 Cowork で自動取り込み予定。
      </p>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : slots.length === 0 ? (
        <p className="mt-6 text-[#9CA3AF]">この日の配信枠はまだ作成されていません</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
          <table className="w-full text-[13px]">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="px-2 py-2 text-left font-medium border-r border-[#E5E7EB]">時刻</th>
                {groupedMachines.map((m) => (
                  <th key={m.id} className="px-2 py-2 text-center font-medium border-r border-[#E5E7EB]">
                    <div>{m.machineLabel}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{m.recruiterName}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour) => (
                <tr key={hour} className="border-t border-[#F3F4F6]">
                  <td className="px-2 py-2 font-medium text-[#374151] border-r border-[#E5E7EB]">
                    {hour}:00
                  </td>
                  {groupedMachines.map((m) => {
                    const slot = slots.find((s) => s.machineId === m.id && s.hourSlot === hour);
                    if (!slot) {
                      return <td key={m.id} className="border-r border-[#E5E7EB] px-2 py-1 text-center text-[#9CA3AF]">-</td>;
                    }
                    return (
                      <td key={m.id} className="border-r border-[#E5E7EB] px-2 py-1 text-center">
                        <input
                          type="number"
                          min={0}
                          value={values[slot.id] ?? 0}
                          onChange={(e) =>
                            setValues({ ...values, [slot.id]: parseInt(e.target.value, 10) || 0 })
                          }
                          className="w-20 rounded border border-[#E5E7EB] px-1 py-0.5 text-right text-[13px]"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
