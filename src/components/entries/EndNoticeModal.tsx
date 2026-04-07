"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Entry } from "./EntryBoard";

const END_REASONS = [
  { code: "SKILL_MISMATCH", label: "経験・スキル不一致" },
  { code: "COMPARISON", label: "他社比較による終了" },
  { code: "POSITION_CLOSED", label: "求人クローズ" },
  { code: "CULTURE_MISMATCH", label: "社風・カルチャー不一致" },
  { code: "CONDITION_MISMATCH", label: "条件面の不一致" },
  { code: "DOCUMENT_SCREENING", label: "書類段階での見送り" },
  { code: "OTHER", label: "その他（自由記述）" },
] as const;

type ReasonState = { code: string; text: string };

type Props = {
  selectedEntries: Entry[];
  onClose: () => void;
  onDone: () => void;
};

export default function EndNoticeModal({ selectedEntries, onClose, onDone }: Props) {
  const candidateName = selectedEntries[0]?.candidate.name || "";
  const advisorName = selectedEntries[0]?.candidate.employee?.name || "";

  const [step, setStep] = useState<"reason" | "result">("reason");
  const [reasons, setReasons] = useState<Record<string, ReasonState>>(() => {
    const init: Record<string, ReasonState> = {};
    for (const e of selectedEntries) init[e.id] = { code: "", text: "" };
    return init;
  });
  const [format, setFormat] = useState<"line" | "email">("line");
  const [generating, setGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allReasonsSelected = selectedEntries.every((e) => reasons[e.id]?.code);
  const allOtherFilled = selectedEntries.every((e) => {
    const r = reasons[e.id];
    return r?.code !== "OTHER" || r.text.trim();
  });
  const canGenerate = allReasonsSelected && allOtherFilled;

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.max(400, textareaRef.current.scrollHeight) + "px";
    }
  }, [generatedText]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/entries/generate-end-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName,
          advisorName,
          format,
          entries: selectedEntries.map((e) => ({
            companyName: e.companyName,
            reason: reasons[e.id].code,
            reasonText: reasons[e.id].code === "OTHER" ? reasons[e.id].text : null,
          })),
        }),
      });
      if (!res.ok) throw new Error("生成に失敗しました");
      const data = await res.json();
      setGeneratedText(data.message);
      setStep("result");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleComplete = async () => {
    const doUpdate = confirm("選択したエントリーの本人対応フラグを「見送り通知送信済」に更新しますか？");
    if (doUpdate) {
      setUpdating(true);
      try {
        const res = await fetch("/api/entries/bulk-flags", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryIds: selectedEntries.map((e) => e.id),
            personFlag: "見送り通知送信済",
          }),
        });
        if (!res.ok) throw new Error();
        toast.success("本人対応フラグを更新しました");
      } catch {
        toast.error("フラグの更新に失敗しました");
      } finally {
        setUpdating(false);
      }
    }
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-[15px] font-bold text-[#374151]">
            {step === "reason" ? "📝 選考終了案内の作成" : "📝 選考終了案内"}
          </h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#374151] text-xl leading-none">×</button>
        </div>

        <div className="px-6 pb-6">
          <p className="text-sm text-gray-600 mb-4">対象求職者: <span className="font-medium">{candidateName} 様</span></p>

          {step === "reason" ? (
            <>
              {/* Reason selection table */}
              <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                <div className="grid grid-cols-[1fr_180px] bg-gray-50 text-[12px] font-medium text-gray-500 border-b border-gray-200">
                  <div className="px-3 py-2">企業名</div>
                  <div className="px-3 py-2">理由</div>
                </div>
                {selectedEntries.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[1fr_180px] border-b border-gray-100 last:border-0">
                    <div className="px-3 py-2 text-[13px] text-gray-700 flex items-center">{entry.companyName}</div>
                    <div className="px-3 py-1.5">
                      <select
                        value={reasons[entry.id]?.code || ""}
                        onChange={(e) => setReasons((prev) => ({ ...prev, [entry.id]: { ...prev[entry.id], code: e.target.value, text: "" } }))}
                        className={`w-full text-[12px] border border-gray-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-[#2563EB] ${!reasons[entry.id]?.code ? "text-gray-400" : ""}`}
                      >
                        <option value="" className="text-gray-400">選択してください</option>
                        {END_REASONS.map((r) => (
                          <option key={r.code} value={r.code}>{r.label}</option>
                        ))}
                      </select>
                      {reasons[entry.id]?.code === "OTHER" && (
                        <input
                          type="text"
                          placeholder="理由を入力..."
                          value={reasons[entry.id]?.text || ""}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [entry.id]: { ...prev[entry.id], text: e.target.value } }))}
                          className="w-full mt-1 text-[12px] border border-gray-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-[#2563EB]"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Format selection */}
              <div className="mb-5">
                <label className="block text-[13px] font-medium text-gray-700 mb-2">送信形式</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="radio" checked={format === "line"} onChange={() => setFormat("line")} className="accent-[#2563EB]" />
                    LINE
                  </label>
                  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="radio" checked={format === "email"} onChange={() => setFormat("email")} className="accent-[#2563EB]" />
                    メール
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button onClick={onClose} className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50">
                  キャンセル
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || generating}
                  className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {generating ? "生成中..." : "📝 案内文を生成"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Generated text */}
              <textarea
                ref={textareaRef}
                value={generatedText}
                onChange={(e) => setGeneratedText(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-4 text-[13px] leading-relaxed text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 focus:border-[#2563EB] resize-none"
                style={{ minHeight: 400 }}
              />

              {/* Actions */}
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setStep("reason")}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← 理由選択に戻る
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="border border-gray-300 bg-white text-gray-700 rounded-md px-4 py-2 text-sm font-medium hover:bg-gray-50"
                  >
                    {copied ? "✅ コピーしました" : "📋 コピー"}
                  </button>
                  <button
                    onClick={handleComplete}
                    disabled={updating}
                    className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {updating ? "更新中..." : "✅ 完了"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
