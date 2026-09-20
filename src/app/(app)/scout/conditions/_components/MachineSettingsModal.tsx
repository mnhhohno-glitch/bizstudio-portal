"use client";

// T-215: 号機の稼働オン/オフを画面から切り替える中央モーダル（/scout/conditions の絞り込みエリア「号機設定」から開く）。
//   これまで RpaScoutMachine.isActive は seed / スクリプトでしか変えられなかった。
//   - 号機番号順に一覧。担当者名は MachineLabel と同じ既存の紐付け（recruiterDisplay の RC_ROSTER）をそのまま表示する。
//   - 切替は即時保存（PATCH /api/scout/machines/[id]）。失敗したら元に戻してトーストを出す。
//   - 稼働オフにしても、その号機の条件・実績は消さない（一覧・CSV には従来どおり出る）。
//   - 稼働オフが効くのは既存ロジック側: 一覧の警告帯（予約切れ・有効なし）・重なり判定・同日の他号機パネル・
//     日付切替（activate.ts）・朝のまとめ通知（daily-summary.ts）・外部 API（停止中の号機は拒否）。
//   - 「配信条件の絞り込みの号機選択」はこれまでどおり全号機を出す（停止中の号機の過去実績も見られるように）。
import { useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import type { MachineDto } from "@/lib/scout-conditions/types";
import { machineRecruiterName } from "./MachineLabel";
import { machineColor } from "@/lib/scout-conditions/constants";

export default function MachineSettingsModal({
  machines,
  onClose,
  onChanged,
}: {
  machines: MachineDto[];
  onClose: () => void;
  /** 保存できた号機の新しい稼働状態を親（ConditionsClient）の data に反映する */
  onChanged: (machineId: string, isActive: boolean) => void;
}) {
  const overlayClose = useOverlayClose(onClose);
  const [savingId, setSavingId] = useState<string | null>(null);
  const rows = [...machines].sort((a, b) => a.machineNo - b.machineNo);

  const toggle = async (m: MachineDto) => {
    if (savingId) return;
    const next = !m.isActive;
    setSavingId(m.id);
    // 先に画面へ反映し、失敗したら戻す（切替は1列だけなので取り消しも1回で足りる）
    onChanged(m.id, next);
    try {
      const res = await fetch(`/api/scout/machines/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        onChanged(m.id, m.isActive);
        toast.error(j?.error ?? "号機の稼働設定を保存できませんでした");
        return;
      }
      toast.success(`${m.machineNo}号機を${next ? "稼働" : "停止"}にしました`);
    } catch {
      onChanged(m.id, m.isActive);
      toast.error("通信に失敗しました");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" {...overlayClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <div className="text-[15px] font-semibold text-[#374151]">号機設定</div>
          <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
            閉じる
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="mb-3 text-[12px] leading-snug text-[#6B7280]">
            稼働オフにした号機は、朝のまとめ通知・予約切れの警告・同日の重なり判定・日付切替の対象から外れ、RPA の外部 API も受け付けなくなります。
            条件・実績は消えません（一覧の号機の絞り込みには停止中の号機も出ます）。
          </p>
          <div className="overflow-hidden rounded-[8px] border border-[#E5E7EB]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#6B7280]">
                  <th className="px-3 py-2 font-medium">号機</th>
                  <th className="px-3 py-2 font-medium">担当者</th>
                  <th className="w-[92px] px-3 py-2 text-right font-medium">稼働</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const c = machineColor(m.machineNo);
                  const name = machineRecruiterName(m.machineNo);
                  const busy = savingId === m.id;
                  return (
                    <tr key={m.id} className="border-t border-[#E5E7EB]">
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${c.dot}`} />
                          <span className="font-semibold text-[#374151]">{m.machineNo}号機</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[#6B7280]">{name || "-"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className={`text-[11px] ${m.isActive ? "text-[#16A34A]" : "text-[#9CA3AF]"}`}>
                            {m.isActive ? "稼働" : "停止"}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={m.isActive}
                            aria-label={`${m.machineNo}号機の稼働`}
                            disabled={busy}
                            onClick={() => void toggle(m)}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              m.isActive ? "bg-[#2563EB]" : "bg-[#D1D5DB]"
                            } ${busy ? "opacity-50" : "cursor-pointer"}`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                m.isActive ? "translate-x-[18px]" : "translate-x-[3px]"
                              }`}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end border-t border-[#E5E7EB] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
