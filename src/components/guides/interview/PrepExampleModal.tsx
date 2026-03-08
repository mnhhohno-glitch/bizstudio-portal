"use client";

import { prepExamples } from "@/lib/guides/interview/prep-examples";

interface PrepExampleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const stepConfig = [
  { key: "point1" as const, letter: "P", label: "Point（結論）", color: "bg-[#003366]" },
  { key: "reason" as const, letter: "R", label: "Reason（理由）", color: "bg-[#0090D1]" },
  { key: "example" as const, letter: "E", label: "Example（具体例）", color: "bg-[#F39200]" },
  { key: "point2" as const, letter: "P", label: "Point（再結論）", color: "bg-[#003366]" },
];

export default function PrepExampleModal({ isOpen, onClose }: PrepExampleModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* ヘッダー */}
        <div className="px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-[#003366]">
              PREP法 自己PRの例文集
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            以下の例を参考に、あなた自身の言葉で自己PRを組み立ててみましょう。
          </p>
        </div>

        {/* 本体 */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-6">
          {prepExamples.map((ex, idx) => (
            <div key={idx} className="bg-[#F4F7F9] rounded-xl p-5 space-y-4">
              <div>
                <p className="text-base font-bold text-[#003366]">
                  例{idx + 1}: {ex.title}
                </p>
                <span className="text-xs text-gray-500 bg-white rounded-full px-3 py-1 inline-block mt-1">
                  想定: {ex.occupation}
                </span>
              </div>

              {stepConfig.map((step) => (
                <div key={step.key}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`${step.color} w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white`}
                    >
                      {step.letter}
                    </span>
                    <span className="text-sm font-medium text-gray-600">
                      {step.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed ml-9">
                    {ex[step.key]}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="px-6 py-4 border-t border-gray-200 text-center shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="bg-[#003366] text-white rounded-lg px-8 py-2.5 font-medium hover:bg-[#002244] transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
