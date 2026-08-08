"use client";

import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { displayPatternName } from "@/lib/rpa-scout/pattern-name";
import { fmtJstDateTime, type RpaMachine, type RpaPattern, type RpaTemplate } from "./types";
import UpdateLogModal from "./UpdateLogModal";

export default function StatusBoardClient() {
  const [machines, setMachines] = useState<RpaMachine[]>([]);
  const [patterns, setPatterns] = useState<RpaPattern[]>([]);
  const [templates, setTemplates] = useState<RpaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMachine, setModalMachine] = useState<RpaMachine | null>(null);

  const load = useCallback(async () => {
    const [mRes, pRes, tRes] = await Promise.all([
      fetch("/api/rpa-scout/machines"),
      fetch("/api/rpa-scout/patterns"),
      fetch("/api/rpa-scout/templates"),
    ]);
    if (mRes.ok) setMachines((await mRes.json()).machines);
    if (pRes.ok) setPatterns((await pRes.json()).patterns);
    if (tRes.ok) setTemplates((await tRes.json()).templates);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success("コピーしました");
    });
  };

  return (
    <div>
      <Toaster position="top-center" richColors />
      <div className="mb-4 flex items-center justify-between">
        <PageTitle>RPAスカウト 状況ボード</PageTitle>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {machines.map((m) => {
            const log = m.latestLog;
            // 状況ボード上の表示・コピーは選択中号機（=カードの号機）を使う
            const patternDisplay = log ? displayPatternName(m.machineNo, log.patternName) : null;
            return (
              <div
                key={m.id}
                className="rounded-[8px] border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-bold text-[#374151]">
                      {m.machineNo}号機
                    </span>
                    {m.isActive ? (
                      <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-medium text-[#166534]">
                        稼働
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#E5E7EB] px-2 py-0.5 text-[11px] font-medium text-[#6B7280]">
                        停止
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setModalMachine(m)}
                    className="rounded-[6px] bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
                  >
                    更新
                  </button>
                </div>

                <div className="space-y-1 text-[13px] text-[#374151]">
                  <div className="text-[#6B7280]">
                    {m.accountName}（{m.mynaviSaveName}）
                  </div>
                  <div className="mt-2 border-t border-[#F3F4F6] pt-2">
                    <div className="mb-0.5 text-[11px] font-semibold text-[#6B7280]">
                      現在のパターン
                    </div>
                    {patternDisplay ? (
                      <div className="flex items-start gap-1">
                        <span className="break-all font-medium">{patternDisplay}</span>
                        <button
                          onClick={() => copy(patternDisplay)}
                          title="パターン名をコピー"
                          className="shrink-0 rounded px-1 text-[#6B7280] hover:bg-[#F3F4F6]"
                        >
                          📋
                        </button>
                      </div>
                    ) : (
                      <span className="text-[#9CA3AF]">記録なし</span>
                    )}
                  </div>
                  <div>
                    <div className="mb-0.5 mt-1 text-[11px] font-semibold text-[#6B7280]">
                      現在の件名
                    </div>
                    {log ? (
                      <span className="break-all">{log.subjectName}</span>
                    ) : (
                      <span className="text-[#9CA3AF]">-</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#F3F4F6] pt-2 text-[12px] text-[#6B7280]">
                    <span>
                      検索件数:{" "}
                      <span className="font-semibold text-[#374151]">
                        {log?.searchCount != null ? log.searchCount.toLocaleString() : "-"}
                      </span>
                    </span>
                    <span>最終更新: {log ? fmtJstDateTime(log.recordedAt) : "-"}</span>
                    <span>記録者: {log?.recordedByName ?? "-"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalMachine && (
        <UpdateLogModal
          machine={modalMachine}
          patterns={patterns}
          templates={templates}
          onClose={() => setModalMachine(null)}
          onSaved={() => {
            setModalMachine(null);
            load();
          }}
        />
      )}
    </div>
  );
}
