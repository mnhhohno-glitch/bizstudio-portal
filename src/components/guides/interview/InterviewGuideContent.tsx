"use client";

import { useState, useEffect, useRef } from "react";
import Section01Tension from "./sections/Section01Tension";
import Section02Essence from "./sections/Section02Essence";
import Section03Preparation from "./sections/Section03Preparation";
import Section04Categories from "./sections/Section04Categories";
import Section05Axis from "./sections/Section05Axis";
import Section06Logic from "./sections/Section06Logic";
import Section07Strengths from "./sections/Section07Strengths";
import Section08Prep from "./sections/Section08Prep";
import Section09Research from "./sections/Section09Research";
import Section10Action from "./sections/Section10Action";

interface InterviewGuideContentProps {
  candidateName: string;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  lastUpdated?: string;
  showCopyButton?: boolean;
  onCopyUrl?: () => void;
  copyButtonText?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function InterviewGuideContent({
  candidateName,
  data,
  onChange,
  onSave,
  isSaving,
  lastUpdated,
  showCopyButton,
  onCopyUrl,
  copyButtonText,
}: InterviewGuideContentProps) {
  const [saved, setSaved] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  // 初回読み込み完了を待ってからフラグON
  useEffect(() => {
    const timer = setTimeout(() => {
      hasLoadedRef.current = true;
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // デバウンス自動保存
  useEffect(() => {
    if (!hasLoadedRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
      setAutoSaveStatus("saving");
      try {
        await onSaveRef.current();
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 3000);
      } catch {
        setAutoSaveStatus("idle");
      }
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data]);

  const handleSave = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setAutoSaveStatus("idle");
    await onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* ヘッダーバー */}
      <div className="sticky top-0 z-10 bg-[#003366] text-white px-6 py-4 rounded-t-xl flex items-center justify-between">
        <div>
          <p className="text-lg font-bold">面接対策ガイド</p>
          <p className="text-sm opacity-80">{candidateName} さん</p>
        </div>
        <div className="flex items-center gap-3">
          {autoSaveStatus === "saving" && (
            <span className="text-xs text-white/70">⏳ 自動保存中...</span>
          )}
          {autoSaveStatus === "saved" && (
            <span className="text-xs text-white/70">✅ 保存済み</span>
          )}
          {showCopyButton && onCopyUrl && (
            <button
              onClick={onCopyUrl}
              className="bg-white/20 hover:bg-white/30 text-white text-sm rounded-md px-3 py-1.5 transition-colors"
            >
              {copyButtonText || "🔗 求職者用URLをコピー"}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[#F39200] hover:bg-[#e08600] text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "保存中..." : saved ? "✅ 保存しました" : "💾 保存する"}
          </button>
        </div>
      </div>

      {/* セクション */}
      <Section01Tension />
      <Section02Essence />
      <Section03Preparation />
      <Section04Categories />
      <Section05Axis data={data} onChange={onChange} />
      <Section06Logic />
      <Section07Strengths />
      <Section08Prep data={data} onChange={onChange} />
      <Section09Research />
      <Section10Action data={data} onChange={onChange} />

      {/* フッターバー */}
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-xl flex items-center justify-between">
        <div>
          {lastUpdated && (
            <p className="text-sm text-gray-500">
              最終更新: {formatDate(lastUpdated)}
            </p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#003366] hover:bg-[#002244] text-white rounded-md px-6 py-2 disabled:opacity-50 transition-colors"
        >
          {isSaving ? "保存中..." : saved ? "✅ 保存しました" : "💾 保存する"}
        </button>
      </div>
    </div>
  );
}
