"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";
import WorksheetExampleModal from "../WorksheetExampleModal";
import { worksheetExamples } from "@/lib/guides/interview/worksheet-examples";

interface Section05Props {
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
  axisResultUrl?: string;
}

const worksheetFields = [
  {
    number: 1,
    key: "reason_for_change",
    label: "なぜ転職するのか？",
    placeholder: "ネガティブな理由ではなく「向かう先」として書いてみましょう",
  },
  {
    number: 2,
    key: "work_values",
    label: "何を大切にして働きたいか？",
    placeholder: "あなたが仕事で「これは譲れない」と思う価値観を書いてみましょう",
  },
  {
    number: 3,
    key: "future_vision",
    label: "どんな自分になりたいか？",
    placeholder: "5年後・10年後のキャリアビジョンを具体的にイメージしてみましょう",
  },
];

export default function Section05Axis({ data, onChange, axisResultUrl }: Section05Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [modalFieldKey, setModalFieldKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [showResumeModal, setShowResumeModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allFilled =
    !!data["reason_for_change"]?.trim() &&
    !!data["work_values"]?.trim() &&
    !!data["future_vision"]?.trim();

  const parsedResume = data["parsed_resume"] || "";

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setUploadError("PDFファイルのみアップロード可能です");
      setTimeout(() => setUploadError(""), 3000);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("ファイルサイズは10MB以下にしてください");
      setTimeout(() => setUploadError(""), 3000);
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/guides/parse-resume", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "PDF解析に失敗しました");
      }

      onChange("parsed_resume", result.parsedResume);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "PDF解析に失敗しました"
      );
      setTimeout(() => setUploadError(""), 5000);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleGenerateAxis = async () => {
    if (!allFilled) return;

    setIsGenerating(true);
    setGenerateError("");

    try {
      const res = await fetch("/api/guides/generate-axis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason_for_change: data["reason_for_change"],
          work_values: data["work_values"],
          future_vision: data["future_vision"],
          parsed_resume: data["parsed_resume"] || undefined,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "AI生成に失敗しました");
      }

      onChange("ai_generated_axis", result.axis);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "AI生成に失敗しました"
      );
      setTimeout(() => setGenerateError(""), 3000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = () => {
    if (!confirm("再生成すると現在の内容が上書きされます。よろしいですか？")) return;
    handleGenerateAxis();
  };

  const handleExampleSelect = (text: string) => {
    if (!modalFieldKey) return;
    const currentValue = data[modalFieldKey] || "";
    const newValue = currentValue ? `${currentValue}\n\n${text}` : text;
    onChange(modalFieldKey, newValue);
    setModalFieldKey(null);
  };

  const currentExampleSet = modalFieldKey
    ? worksheetExamples.find((e) => e.fieldKey === modalFieldKey)
    : null;

  const axisContent = data["ai_generated_axis"] || "";
  const previewText = axisContent.length > 200 ? axisContent.slice(0, 200) + "..." : axisContent;
  const resumePreview = parsedResume.length > 300 ? parsedResume.slice(0, 300) + "..." : parsedResume;

  return (
    <SectionWrapper id="section-5" number="05" title="転職軸とは何か" bg="white">
      <div className="text-base leading-relaxed text-gray-700 mb-6">
        <p>
          転職軸とは、あなたが仕事において大切にしている価値観・信念・なりたい自分像のことです。
          これが言語化されていないと、面接でどんな質問をされても「ブレた回答」になってしまいます。
        </p>
      </div>

      <InsightBlock>
        転職軸は「逃げ」ではなく「向かう先」として語ることが重要。
        <br />
        ネガティブな理由をポジティブな動機に言い換える。
      </InsightBlock>

      <div className="border-2 border-[#003366] rounded-xl p-6 md:p-8 mt-8">
        <h3 className="text-lg font-bold text-[#003366] mb-1">✏️ 転職軸ワークシート</h3>
        <p className="text-sm text-gray-600 mb-6">
          3つの問いに答えて、あなたの「軸」を言語化しよう
        </p>

        {/* 職務経歴書アップロードエリア */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileUpload}
          className="hidden"
        />

        {isUploading ? (
          <div className="bg-[#F4F7F9] border-2 border-[#003366] rounded-xl p-6 text-center mb-6">
            <p className="text-sm font-medium text-[#003366]">📄 職務経歴書</p>
            <p className="text-sm text-[#003366] mt-2 animate-pulse">
              ⏳ PDFを解析しています...
            </p>
          </div>
        ) : uploadError ? (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 text-center mb-6">
            <p className="text-sm font-medium text-gray-700">📄 職務経歴書</p>
            <p className="text-sm text-red-600 mt-2">❌ {uploadError}</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              🔄 再度アップロード
            </button>
          </div>
        ) : parsedResume ? (
          <div className="bg-[#F0FFF4] border-2 border-green-300 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">📄 職務経歴書</p>
              <span className="text-green-600 font-medium text-sm">✅ 解析済み</span>
            </div>
            <div className="relative bg-white rounded-lg p-3 max-h-32 overflow-hidden">
              <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                {resumePreview}
              </p>
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
            </div>
            <div className="flex items-center gap-4 mt-3">
              <button
                type="button"
                onClick={() => setShowResumeModal(true)}
                className="text-[#003366] text-sm font-medium hover:underline"
              >
                📄 全文を見る
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-gray-500 text-sm hover:text-gray-700 transition-colors"
              >
                🔄 別のPDFをアップロード
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center mb-6">
            <p className="text-sm font-medium text-gray-700 mb-1">📄 職務経歴書（任意）</p>
            <p className="text-sm text-gray-500 mb-4">
              職務経歴書をアップロードすると、<br />
              AIがより精度の高い転職軸を生成できます
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              📎 PDFをアップロード
            </button>
            <p className="text-xs text-gray-400 mt-3">※ PDF形式・10MB以下</p>
          </div>
        )}

        <div className="space-y-6">
          {worksheetFields.map((field) => (
            <div key={field.key}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-[#003366]">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#003366] text-white text-xs font-bold mr-2">
                    {field.number}
                  </span>
                  {field.label}
                </label>
                <button
                  type="button"
                  onClick={() => setModalFieldKey(field.key)}
                  className="text-sm text-[#0090D1] hover:text-[#003366] cursor-pointer underline transition-colors"
                >
                  📝 例を見てみる
                </button>
              </div>
              <textarea
                value={data[field.key] || ""}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={4}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg p-4 text-base focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20 focus:outline-none transition-colors duration-200 placeholder:text-gray-400"
              />
            </div>
          ))}
        </div>

        {/* AI軸書き起こし */}
        <div className="border-t border-gray-200 mt-8 pt-8">
          {!axisContent ? (
            <>
              <button
                onClick={handleGenerateAxis}
                disabled={!allFilled || isGenerating}
                className={`bg-[#003366] text-white rounded-lg px-6 py-3 font-bold hover:bg-[#002244] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isGenerating ? "animate-pulse" : ""}`}
              >
                {isGenerating ? "⏳ AIが考えています..." : "🤖 AIで軸を書き起こす"}
              </button>

              {!allFilled && (
                <p className="text-xs text-gray-500 mt-2">
                  ※ 3つの問いすべてに回答するとボタンが有効になります
                </p>
              )}
            </>
          ) : (
            <div>
              <p className="text-lg font-bold text-[#003366] mb-3">
                ✨ あなたの自己分析レポート
              </p>
              <div className="bg-[#FFF8F0] border border-[#F39200] rounded-xl p-4">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {previewText}
                </p>
              </div>
              <div className="flex items-center gap-4 mt-3">
                {axisResultUrl && (
                  <Link
                    href={axisResultUrl}
                    className="text-[#003366] font-medium hover:underline"
                  >
                    📄 全文を見る →
                  </Link>
                )}
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className={`text-gray-500 text-sm hover:text-gray-700 cursor-pointer transition-colors ${isGenerating ? "animate-pulse" : ""}`}
                >
                  {isGenerating ? "⏳ AIが考えています..." : "🔄 再生成する"}
                </button>
              </div>
            </div>
          )}

          {generateError && (
            <p className="text-sm text-red-500 mt-2">{generateError}</p>
          )}
        </div>
      </div>

      {/* 例文モーダル */}
      {currentExampleSet && (
        <WorksheetExampleModal
          isOpen={!!modalFieldKey}
          onClose={() => setModalFieldKey(null)}
          exampleSet={currentExampleSet}
          onSelect={handleExampleSelect}
        />
      )}

      {/* 職務経歴書全文モーダル */}
      {showResumeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowResumeModal(false)}
          />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-[#003366]">
                職務経歴書の解析結果
              </h3>
              <button
                type="button"
                onClick={() => setShowResumeModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children, ...props }) => (
                    <h2 className="text-lg font-bold text-[#003366] mt-6 first:mt-0 mb-3 pb-1 border-b border-gray-200" {...props}>
                      {children}
                    </h2>
                  ),
                  h3: ({ children, ...props }) => (
                    <h3 className="text-base font-bold text-[#003366] mt-4 mb-2" {...props}>
                      {children}
                    </h3>
                  ),
                  p: ({ children, ...props }) => (
                    <p className="text-gray-700 leading-relaxed text-sm mb-3" {...props}>
                      {children}
                    </p>
                  ),
                  ul: ({ children, ...props }) => (
                    <ul className="text-gray-700 space-y-1 mb-3 list-disc pl-5 text-sm" {...props}>
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
                  hr: () => <hr className="border-gray-200 my-4" />,
                }}
              >
                {parsedResume}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </SectionWrapper>
  );
}
