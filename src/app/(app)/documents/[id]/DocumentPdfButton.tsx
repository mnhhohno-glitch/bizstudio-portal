"use client";

export default function DocumentPdfButton() {
  const handlePdfExport = () => {
    const iframe = document.querySelector<HTMLIFrameElement>("#document-iframe");
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <button
      onClick={handlePdfExport}
      className="bg-[#2563EB] text-white rounded-md px-4 py-2 text-[14px] hover:bg-[#1D4ED8] shrink-0"
    >
      📥 PDF出力
    </button>
  );
}
