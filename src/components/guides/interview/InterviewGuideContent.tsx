"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
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
  axisResultUrl?: string;
}

const sectionTitles = [
  "面接で緊張してしまう理由",
  "面接の本質とは何か",
  "面接準備の正しい順番",
  "面接質問の3大分類",
  "転職軸とは何か",
  "「軸でつなぐ」最強のロジック",
  "強みの整理と具体的な伝え方",
  "評価を上げる話し方の技術",
  "企業研究と逆質問",
  "まとめ：今日から始めるアクション",
];

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
  axisResultUrl,
}: InterviewGuideContentProps) {
  const [saved, setSaved] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isDesktop, setIsDesktop] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  const totalSlides = 10;
  const contentRef = useRef<HTMLDivElement>(null);

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

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

  // レスポンシブ判定
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  // スライド切り替え時スクロールリセット
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [currentSlide]);

  const goNext = useCallback(
    () => setCurrentSlide((prev) => Math.min(prev + 1, totalSlides - 1)),
    []
  );
  const goPrev = useCallback(
    () => setCurrentSlide((prev) => Math.max(prev - 1, 0)),
    []
  );

  // キーボード操作
  useEffect(() => {
    if (!isDesktop) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDesktop, goNext, goPrev]);

  const handleSave = async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setAutoSaveStatus("idle");
    await onSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sections: ReactNode[] = [
    <Section01Tension key="s1" />,
    <Section02Essence key="s2" />,
    <Section03Preparation key="s3" />,
    <Section04Categories key="s4" />,
    <Section05Axis key="s5" data={data} onChange={onChange} axisResultUrl={axisResultUrl} />,
    <Section06Logic key="s6" />,
    <Section07Strengths key="s7" />,
    <Section08Prep key="s8" data={data} onChange={onChange} />,
    <Section09Research key="s9" />,
    <Section10Action key="s10" data={data} onChange={onChange} />,
  ];

  const hasSection5Data =
    !!data["reason_for_change"]?.trim() ||
    !!data["work_values"]?.trim() ||
    !!data["future_vision"]?.trim();
  const hasSection8Data =
    !!data["prep_point"]?.trim() ||
    !!data["prep_reason"]?.trim() ||
    !!data["prep_example"]?.trim() ||
    !!data["prep_conclusion"]?.trim();

  const getIndicatorStyle = (index: number) => {
    if (index === currentSlide) return "bg-[#003366] text-white font-bold";
    if ((index === 4 && hasSection5Data) || (index === 7 && hasSection8Data))
      return "bg-[#F39200] text-white";
    return "bg-gray-100 text-gray-500 hover:bg-gray-200";
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

      {isDesktop ? (
        <>
          {/* スライドナビ */}
          <div className="flex items-center justify-center gap-2 py-4 bg-white border-b border-gray-200">
            <button
              onClick={goPrev}
              disabled={currentSlide === 0}
              className={`w-8 h-8 flex items-center justify-center text-sm font-bold text-[#003366] transition-colors ${
                currentSlide === 0 ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-100 rounded-full cursor-pointer"
              }`}
            >
              ◀
            </button>
            {Array.from({ length: totalSlides }, (_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs cursor-pointer transition-colors ${getIndicatorStyle(i)}`}
              >
                {String(i + 1).padStart(2, "0")}
              </button>
            ))}
            <button
              onClick={goNext}
              disabled={currentSlide === totalSlides - 1}
              className={`w-8 h-8 flex items-center justify-center text-sm font-bold text-[#003366] transition-colors ${
                currentSlide === totalSlides - 1 ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-100 rounded-full cursor-pointer"
              }`}
            >
              ▶
            </button>
          </div>

          {/* スライドコンテンツ */}
          <div
            ref={contentRef}
            className="overflow-y-auto"
            style={{ height: "calc(100vh - 280px)" }}
          >
            {sections[currentSlide]}
          </div>
        </>
      ) : (
        <>
          {sections.map((section, index) => (
            <div key={index}>{section}</div>
          ))}
        </>
      )}

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
