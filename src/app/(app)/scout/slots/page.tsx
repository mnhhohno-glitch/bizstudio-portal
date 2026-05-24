"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";

type Slot = {
  id: string;
  scoutNumber: string;
  deliveryDate: string;
  hourSlot: number;
  machineId: string | null;
  isMachine: boolean;
  isStaff: boolean;
  deliveryCategoryLarge: string;
  deliveryCategoryMedium: string | null;
  deliveryCategorySmall: string | null;
  mediaSource: string;
  searchConditionName: string | null;
  deliveryCount: number;
  openCount: number;
  isAggregationTarget: boolean;
  memo: string | null;
  machine: { id: string; recruiterName: string; machineLabel: string; machineNumber: number | null; isActive: boolean } | null;
};

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function today(): string {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export default function ScoutSlotsPage() {
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<Slot>>({});
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/scout/slots?date=${date}`);
    if (res.ok) {
      const data = await res.json();
      setSlots(data.slots || []);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const createDailySlots = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/scout/cron/create-daily-slots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-rpa-secret": "manual-ui-trigger", // 注意: 本番では認証突破できない（手動作成用に別途エンドポイント検討）
        },
        body: JSON.stringify({ targetDate: date }),
      });
      if (!res.ok) {
        toast.error("配信枠の自動作成 API は x-rpa-secret 認証のため UI から直接叩けません。Power Automate から呼ぶか、curl で叩いてください。");
        return;
      }
      const data = await res.json();
      toast.success(`${data.message || "作成完了"} (${data.created || 0}件)`);
      load();
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (slot: Slot) => {
    setEditingId(slot.id);
    setEditValues({
      deliveryCount: slot.deliveryCount,
      mediaSource: slot.mediaSource,
      searchConditionName: slot.searchConditionName,
      deliveryCategoryLarge: slot.deliveryCategoryLarge,
      deliveryCategoryMedium: slot.deliveryCategoryMedium,
      deliveryCategorySmall: slot.deliveryCategorySmall,
      isAggregationTarget: slot.isAggregationTarget,
      memo: slot.memo,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch("/api/scout/slots", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId, ...editValues }),
    });
    if (res.ok) {
      toast.success("更新しました");
      setEditingId(null);
      setEditValues({});
      load();
    } else {
      toast.error("更新に失敗しました");
    }
  };

  const duplicateRow = (src: Slot, targetHour: number) => {
    const target = slots.find((s) => s.machineId === src.machineId && s.hourSlot === targetHour);
    if (!target) return;
    fetch("/api/scout/slots", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: target.id,
        deliveryCount: src.deliveryCount,
        mediaSource: src.mediaSource,
        searchConditionName: src.searchConditionName,
        deliveryCategoryLarge: src.deliveryCategoryLarge,
        deliveryCategoryMedium: src.deliveryCategoryMedium,
        deliveryCategorySmall: src.deliveryCategorySmall,
        isAggregationTarget: true,
      }),
    }).then((r) => {
      if (r.ok) {
        toast.success(`${targetHour}時 枠に複製しました`);
        load();
      }
    });
  };

  // machineId ごとにグループ化
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
        <h1 className="text-[20px] font-bold text-[#374151]">配信枠管理</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
          />
          <button
            onClick={createDailySlots}
            disabled={creating}
            className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            この日の枠を自動作成
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-[#9CA3AF]">読み込み中...</p>
      ) : slots.length === 0 ? (
        <div className="mt-6 rounded-lg border border-[#E5E7EB] bg-white p-6 text-center">
          <p className="text-[#9CA3AF]">この日の配信枠はまだ作成されていません</p>
          <p className="mt-2 text-[12px] text-[#9CA3AF]">
            「この日の枠を自動作成」ボタン または Power Automate からの自動作成をお試しください
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
          <table className="w-full text-[12px]">
            <thead className="bg-[#F9FAFB] text-[#6B7280]">
              <tr>
                <th className="px-2 py-2 text-left font-medium border-r border-[#E5E7EB]">時刻</th>
                {groupedMachines.map((m) => (
                  <th key={m.id} className="px-2 py-2 text-center font-medium border-r border-[#E5E7EB]">
                    <div>{m.machineLabel}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{m.recruiterName}</div>
                    {!m.isActive && <div className="text-[10px] text-[#DC2626]">停止中</div>}
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
                      return <td key={m.id} className="px-2 py-2 text-center text-[#9CA3AF] border-r border-[#E5E7EB]">-</td>;
                    }
                    const editing = editingId === slot.id;
                    const isReadOnly = slot.isMachine;
                    return (
                      <td
                        key={m.id}
                        className={`px-2 py-1.5 border-r border-[#E5E7EB] text-center align-top ${
                          slot.isAggregationTarget ? "" : "bg-[#FAFAFA]"
                        }`}
                      >
                        {editing ? (
                          <div className="space-y-1">
                            <input
                              type="number"
                              value={editValues.deliveryCount ?? 0}
                              onChange={(e) =>
                                setEditValues({ ...editValues, deliveryCount: parseInt(e.target.value, 10) || 0 })
                              }
                              className="w-full rounded border border-[#E5E7EB] px-1 py-0.5 text-[12px]"
                            />
                            <select
                              value={editValues.deliveryCategoryMedium || ""}
                              onChange={(e) =>
                                setEditValues({ ...editValues, deliveryCategoryMedium: e.target.value })
                              }
                              className="w-full rounded border border-[#E5E7EB] px-1 py-0.5 text-[11px]"
                            >
                              <option value="">中項目</option>
                              <option value="個別配信">個別配信</option>
                              <option value="一斉配信">一斉配信</option>
                            </select>
                            <select
                              value={editValues.deliveryCategorySmall || ""}
                              onChange={(e) =>
                                setEditValues({ ...editValues, deliveryCategorySmall: e.target.value })
                              }
                              className="w-full rounded border border-[#E5E7EB] px-1 py-0.5 text-[11px]"
                            >
                              <option value="">小項目</option>
                              <option value="検索条件指定">検索条件指定</option>
                              <option value="検索条件未指定">検索条件未指定</option>
                            </select>
                            <input
                              type="text"
                              placeholder="検索条件名"
                              value={editValues.searchConditionName || ""}
                              onChange={(e) =>
                                setEditValues({ ...editValues, searchConditionName: e.target.value })
                              }
                              className="w-full rounded border border-[#E5E7EB] px-1 py-0.5 text-[11px]"
                            />
                            <label className="flex items-center gap-1 text-[10px] text-[#6B7280]">
                              <input
                                type="checkbox"
                                checked={editValues.isAggregationTarget ?? true}
                                onChange={(e) =>
                                  setEditValues({ ...editValues, isAggregationTarget: e.target.checked })
                                }
                              />
                              集計対象
                            </label>
                            <div className="flex gap-1">
                              <button
                                onClick={saveEdit}
                                className="flex-1 rounded bg-[#2563EB] px-1 py-0.5 text-[11px] text-white"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditValues({});
                                }}
                                className="flex-1 rounded border border-[#E5E7EB] px-1 py-0.5 text-[11px] text-[#6B7280]"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className={`font-medium ${slot.deliveryCount > 0 ? "text-[#374151]" : "text-[#9CA3AF]"}`}>
                              {slot.deliveryCount}
                            </div>
                            {slot.openCount > 0 && (
                              <div className="text-[10px] text-[#6B7280]">開封 {slot.openCount}</div>
                            )}
                            <div className="text-[10px] text-[#9CA3AF] truncate" title={slot.scoutNumber}>
                              {slot.scoutNumber}
                            </div>
                            {!isReadOnly && (
                              <div className="mt-1 flex justify-center gap-1">
                                <button
                                  onClick={() => startEdit(slot)}
                                  className="rounded border border-[#E5E7EB] px-1 text-[10px] text-[#6B7280] hover:bg-[#F9FAFB]"
                                >
                                  編集
                                </button>
                                {slot.deliveryCount > 0 && (
                                  <select
                                    onChange={(e) => {
                                      const h = parseInt(e.target.value, 10);
                                      if (Number.isFinite(h)) duplicateRow(slot, h);
                                      e.target.value = "";
                                    }}
                                    defaultValue=""
                                    className="rounded border border-[#E5E7EB] px-1 text-[10px] text-[#6B7280]"
                                  >
                                    <option value="">複製→</option>
                                    {HOURS.filter((h) => h !== hour).map((h) => (
                                      <option key={h} value={h}>{h}時</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[12px] text-[#9CA3AF]">
        グレーの背景セル: 集計対象外（停止中号機、または社員枠で未入力）<br />
        機械分（1〜6号機）の配信数は OneDrive エクセル取り込みで自動更新されます。社員枠（藤本 夏海・大野 望）は手入力です。
      </p>
    </div>
  );
}
