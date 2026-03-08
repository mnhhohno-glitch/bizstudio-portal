"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AxisResultProps {
  content: string;
  candidateName: string;
  backUrl: string;
}

export default function AxisResult({ content, candidateName, backUrl }: AxisResultProps) {
  return (
    <div className="bg-[#F4F7F9] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link
          href={backUrl}
          className="inline-flex items-center text-[14px] text-[#2563EB] hover:underline mb-4"
        >
          ← ガイドに戻る
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#003366]">✨ 自己分析レポート</h1>
          <p className="text-sm text-gray-500 mt-1">{candidateName} さん</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 md:p-8 shadow-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ children, ...props }) => (
                <h2
                  className="text-xl font-bold text-[#003366] mt-8 first:mt-0 mb-4 pb-2 border-b border-gray-200"
                  {...props}
                >
                  {children}
                </h2>
              ),
              h3: ({ children, ...props }) => (
                <h3 className="text-lg font-bold text-[#003366] mt-6 mb-3" {...props}>
                  {children}
                </h3>
              ),
              p: ({ children, ...props }) => (
                <p className="text-gray-700 leading-relaxed text-base mb-4" {...props}>
                  {children}
                </p>
              ),
              ul: ({ children, ...props }) => (
                <ul className="text-gray-700 space-y-2 mb-4 list-none pl-0" {...props}>
                  {children}
                </ul>
              ),
              li: ({ children, ...props }) => (
                <li className="text-gray-700 leading-relaxed" {...props}>
                  {children}
                </li>
              ),
              strong: ({ children, ...props }) => (
                <strong className="font-bold text-[#003366]" {...props}>
                  {children}
                </strong>
              ),
              hr: () => <hr className="border-gray-200 my-6" />,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>

        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => window.print()}
            className="bg-[#003366] text-white rounded-lg px-6 py-2.5 font-medium hover:bg-[#002244] transition-colors"
          >
            📥 PDF出力
          </button>
          <Link
            href={backUrl}
            className="border border-gray-300 bg-white text-gray-700 rounded-lg px-6 py-2.5 font-medium hover:bg-gray-50 transition-colors"
          >
            ✏️ ガイドに戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
