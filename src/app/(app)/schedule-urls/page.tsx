"use client";

import { useState } from "react";
import { toast } from "sonner";

const URLS = [
  {
    label: "マイナビ転職",
    description: "マイナビ転職のスカウト応募者向け",
    url: "https://schedule.bizstudio.co.jp/",
    color: "border-blue-300 bg-blue-50",
    iconBg: "bg-blue-100 text-blue-600",
  },
  {
    label: "マイナビエージェント",
    description: "マイナビエージェントの応募者向け",
    url: "https://schedule.bizstudio.co.jp/agent",
    color: "border-green-300 bg-green-50",
    iconBg: "bg-green-100 text-green-600",
  },
  {
    label: "媒体指定なし",
    description: "媒体を問わない汎用的な日程調整用",
    url: "https://schedule.bizstudio.co.jp/open",
    color: "border-gray-300 bg-gray-50",
    iconBg: "bg-gray-100 text-gray-600",
  },
];

export default function ScheduleUrlsPage() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (url: string, index: number) => {
    await navigator.clipboard.writeText(url);
    toast.success("コピーしました");
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-[#374151] mb-2">日程調整URL</h1>
      <p className="text-sm text-gray-500 mb-6">
        求職者にお送りする面談日程調整のURLです。用途に応じたURLをコピーしてご使用ください。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {URLS.map((item, i) => (
          <div
            key={i}
            className={`rounded-xl border-2 p-5 shadow-sm hover:shadow-md transition-shadow ${item.color}`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-3 ${item.iconBg}`}>
              📅
            </div>
            <h2 className="font-bold text-[15px] text-[#374151] mb-1">{item.label}</h2>
            <p className="text-xs text-gray-500 mb-3">{item.description}</p>
            <div className="bg-white rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 truncate mb-3" title={item.url}>
              {item.url}
            </div>
            <button
              onClick={() => handleCopy(item.url, i)}
              className="w-full bg-[#2563EB] text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
            >
              {copiedIndex === i ? "コピーしました ✓" : "URLをコピー"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
