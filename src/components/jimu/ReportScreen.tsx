"use client";

import { useState, useEffect, useCallback } from "react";
import type { AppState } from "@/types/jimu";

interface ReportScreenProps {
  token: string;
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
}

interface ParsedReport {
  part1: string;
  part2: string;
  fullText: string;
}

function parseReport(text: string): ParsedReport {
  const part2Marker = "■ パート2";
  const idx = text.indexOf(part2Marker);

  if (idx === -1) {
    return { part1: text, part2: "", fullText: text };
  }

  let part1 = text.substring(0, idx).trim();
  let part2 = text.substring(idx).trim();

  const cleanSeparators = (s: string) =>
    s.replace(/^[━─═]+\n?/gm, "").replace(/\n[━─═]+$/gm, "");

  part1 = cleanSeparators(part1);
  part2 = cleanSeparators(part2);

  return { part1, part2, fullText: text };
}

function ReportSection({
  title,
  content,
  variant,
}: {
  title: string;
  content: string;
  variant: "material" | "final";
}) {
  const lines = content.split("\n");

  return (
    <div
      className={`rounded-lg p-5 ${
        variant === "material"
          ? "bg-[#e8f4fd]"
          : "bg-white border-2 border-[#1e3a5f]"
      }`}
    >
      <h3
        className={`text-base font-bold mb-4 ${
          variant === "material" ? "text-[#1e3a5f]" : "text-[#1e3a5f]"
        }`}
      >
        {title}
      </h3>
      <div className="space-y-1">
        {lines.map((line, i) => {
          if (line.startsWith("【") && line.includes("】")) {
            return (
              <p key={i} className="text-sm font-bold text-[#1e3a5f] mt-4 first:mt-0">
                {line}
              </p>
            );
          }
          if (line.trim() === "") {
            return <div key={i} className="h-2" />;
          }
          return (
            <p key={i} className="text-sm text-gray-700 leading-relaxed">
              {line}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportScreen({
  token,
  state,
  onChange,
}: ReportScreenProps) {
  const [loading, setLoading] = useState(!state.reportText);
  const [error, setError] = useState("");
  const [report, setReport] = useState(state.reportText);
  const [copied, setCopied] = useState(false);

  const generateReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch("/api/jimu-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "レポートの作成に失敗しました");
      }

      const data = await res.json();
      setReport(data.report);
      onChange({ reportText: data.report });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("タイムアウトしました。もう一度お試しください。");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "レポートの作成に失敗しました。もう一度お試しください。"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [token, onChange]);

  useEffect(() => {
    if (!state.reportText) {
      generateReport();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="w-8 h-8 border-3 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">レポートを作成しています...</p>
        <p className="text-xs text-gray-400">30秒ほどお待ちください</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="text-4xl">⚠️</div>
        <p className="text-sm text-red-600 text-center">{error}</p>
        <button
          type="button"
          onClick={generateReport}
          className="bg-[#1e3a5f] text-white rounded-lg px-6 py-3 font-bold text-sm hover:bg-[#16304f] transition-colors"
        >
          もう一度試す
        </button>
      </div>
    );
  }

  if (!report) return null;

  const parsed = parseReport(report);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="text-4xl">🎉</div>
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          あなたの職種志望動機が
          <br />
          完成しました！
        </h2>
      </div>

      {parsed.part1 && (
        <ReportSection
          title="■ パート1：あなたの志望動機の素材"
          content={parsed.part1.replace(/■ パート1[^\n]*\n?/, "").trim()}
          variant="material"
        />
      )}

      {parsed.part2 && (
        <ReportSection
          title="■ パート2：面接で使える志望動機（完成版）"
          content={parsed.part2.replace(/■ パート2[^\n]*\n?/, "").trim()}
          variant="final"
        />
      )}

      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 leading-relaxed">
        <p className="font-medium text-gray-600 mb-2">
          💡 企業への志望動機について
        </p>
        <p>
          これは&quot;なぜ事務職をやりたいか&quot;の志望動機です。
        </p>
        <p>面接では&quot;なぜこの会社か&quot;も聞かれます。</p>
        <p>
          企業の事業内容・社風・求人情報を調べて、
          &quot;この会社だからこそ&quot;の理由も準備しましょう。
        </p>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="w-full bg-[#1e3a5f] text-white rounded-lg px-6 py-3 font-bold text-base hover:bg-[#16304f] transition-colors"
      >
        {copied ? "コピーしました！" : "レポートをコピー"}
      </button>
    </div>
  );
}
