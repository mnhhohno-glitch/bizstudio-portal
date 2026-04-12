"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ENTRY_ROUTE_OPTIONS,
  PREFECTURE_CODES,
  ROUTE_RANK_MAP,
  buildEntryJobId,
} from "@/lib/constants/job-types";
import type { Entry } from "./EntryBoard";

type Props = {
  entry: Entry;
  onClose: () => void;
  onSaved: (updated: Entry) => void;
};

// 既存の entryJobId を {jobNumber, prefCode} に逆算する（再編集用）。
// 形式: {rank}_{jobNumber}_{prefCode} — jobNumber 自体には "_" が入らない前提。
function parseEntryJobId(
  id: string | null | undefined,
): { jobNumber: string; prefCode: number | null } {
  if (!id) return { jobNumber: "", prefCode: null };
  const parts = id.split("_");
  if (parts.length !== 3) return { jobNumber: "", prefCode: null };
  const [, num, pref] = parts;
  const prefNum = Number(pref);
  return {
    jobNumber: num && num !== "__" ? num : "",
    prefCode: Number.isFinite(prefNum) && prefNum > 0 ? prefNum : null,
  };
}

export default function EntryRouteSwitchModal({ entry, onClose, onSaved }: Props) {
  const parsed = useMemo(
    () => parseEntryJobId(entry.entryJobId),
    [entry.entryJobId],
  );

  const [entryRoute, setEntryRoute] = useState(entry.entryRoute || "");
  const [jobNumber, setJobNumber] = useState(parsed.jobNumber);
  const [prefCode, setPrefCode] = useState<number | null>(parsed.prefCode);
  const [jobDbUrl, setJobDbUrl] = useState(entry.jobDbUrl || "");
  const [saving, setSaving] = useState(false);

  const previewId = useMemo(
    () => buildEntryJobId(entryRoute, jobNumber, prefCode),
    [entryRoute, jobNumber, prefCode],
  );

  const isComplete = Boolean(entryRoute && jobNumber.trim() && prefCode != null);

  const save = async () => {
    setSaving(true);
    try {
      // 媒体が未選択の場合は切替解除として保存
      const payload: Record<string, string | null> = {
        entryRoute: entryRoute || null,
        entryJobId: entryRoute && isComplete ? previewId : null,
        jobDbUrl: jobDbUrl.trim() || null,
      };
      const res = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error("保存に失敗しました");
        return;
      }
      const data = await res.json();
      toast.success("エントリー媒体を更新しました");
      onSaved(data.entry);
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    setEntryRoute("");
    setJobNumber("");
    setPrefCode(null);
    setJobDbUrl("");
  };

  const inputCls = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
  const labelCls = "block text-[13px] font-medium text-[#374151] mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { if (!saving) onClose(); }}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3">
          <h2 className="text-[15px] font-bold text-[#374151]">エントリー媒体切替</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">紹介時とは別の媒体でエントリーする場合に使用</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-gray-50 rounded-md px-3 py-2 text-[11px] text-gray-600">
            <div>求職者: <span className="font-medium text-gray-800">{entry.candidate.name}</span></div>
            <div>企業: <span className="font-medium text-gray-800">{entry.companyName}</span></div>
            {entry.jobDb && <div>元の媒体: <span className="font-medium text-gray-800">{entry.jobDb}</span></div>}
          </div>

          {/* ステップ1: エントリー媒体 */}
          <div>
            <label className={labelCls}>① エントリー媒体</label>
            <select
              className={inputCls}
              value={entryRoute}
              onChange={(e) => setEntryRoute(e.target.value)}
            >
              <option value="">（切替なし）</option>
              {ENTRY_ROUTE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}（ランク{ROUTE_RANK_MAP[r]}）
                </option>
              ))}
            </select>
          </div>

          {/* ステップ2: 媒体別求人番号 */}
          <div>
            <label className={labelCls}>② 媒体別求人番号</label>
            <input
              type="text"
              className={inputCls}
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value.replace(/_/g, ""))}
              placeholder="例: 331553"
            />
          </div>

          {/* ステップ3: 都道府県 */}
          <div>
            <label className={labelCls}>③ 都道府県</label>
            <select
              className={inputCls}
              value={prefCode ?? ""}
              onChange={(e) => setPrefCode(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">選択してください</option>
              {PREFECTURE_CODES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}（{p.code}）
                </option>
              ))}
            </select>
          </div>

          {/* リアルタイムプレビュー */}
          <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-blue-700 mb-0.5">生成される求人ID</div>
            <div className={`font-mono text-base ${isComplete ? "text-blue-700 font-semibold" : "text-gray-400"}`}>
              {previewId}
            </div>
          </div>

          {/* 求人DB URL（任意） */}
          <div>
            <label className={labelCls}>求人DB URL（任意）</label>
            <input
              type="url"
              className={inputCls}
              value={jobDbUrl}
              onChange={(e) => setJobDbUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="border-t px-5 py-3 flex gap-2">
          <button
            onClick={clear}
            disabled={saving}
            className="border border-gray-300 bg-white text-gray-600 rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            クリア
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving || (entryRoute !== "" && !isComplete)}
            title={entryRoute !== "" && !isComplete ? "媒体・求人番号・都道府県すべて入力してください" : ""}
            className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
