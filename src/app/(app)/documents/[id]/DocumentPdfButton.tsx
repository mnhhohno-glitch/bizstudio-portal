"use client";

import { useState } from "react";

export default function DocumentActions({ documentUrl }: { documentUrl: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    const fullUrl = new URL(documentUrl, window.location.origin).href;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePdfExport = () => {
    const iframe = document.querySelector<HTMLIFrameElement>("#document-iframe");
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <div className="flex gap-2 shrink-0">
      <button
        onClick={handleCopyUrl}
        className="border border-[#E5E7EB] bg-white text-[#374151] rounded-md px-4 py-2 text-[14px] hover:bg-[#F9FAFB]"
      >
        {copied ? "✅ コピーしました" : "🔗 URLをコピー"}
      </button>
      <button
        onClick={handlePdfExport}
        className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[14px] hover:bg-[#1D4ED8]"
      >
        📥 PDF出力
      </button>
    </div>
  );
}
