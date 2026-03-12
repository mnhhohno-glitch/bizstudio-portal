"use client";

import { useState } from "react";

type UrlType = "interview" | "consultation";
type InterviewMethod = "in-person" | "online" | "flexible" | "phone";

interface InterviewUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidateName: string;
  advisorName: string | null;
}

const INTERVIEW_METHOD_OPTIONS: { value: InterviewMethod; label: string }[] = [
  { value: "in-person", label: "対面" },
  { value: "online", label: "オンライン" },
  { value: "flexible", label: "どちらでも可" },
];

const CONSULTATION_METHOD_OPTIONS: { value: InterviewMethod; label: string }[] = [
  { value: "phone", label: "電話" },
  { value: "online", label: "オンライン" },
];

export default function InterviewUrlModal({
  isOpen,
  onClose,
  candidateName,
  advisorName,
}: InterviewUrlModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [urlType, setUrlType] = useState<UrlType>("interview");
  const [method, setMethod] = useState<InterviewMethod>("online");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setStep(1);
    setUrlType("interview");
    setMethod("online");
    setGeneratedUrl("");
    setGenerating(false);
    setCopied(false);
    onClose();
  };

  const doGenerate = async (type: UrlType, interviewMethod: string) => {
    setGenerating(true);
    try {
      const res = await fetch("/api/schedule-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName,
          advisorName: advisorName || "",
          interviewMethod,
          type,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGeneratedUrl(data.url);
      setStep(3);
    } catch {
      alert("URL生成に失敗しました。もう一度お試しください。");
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectType = (type: UrlType) => {
    if (!advisorName) return;
    setUrlType(type);
    setMethod(type === "consultation" ? "phone" : "online");
    setStep(2);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const methodOptions =
    urlType === "consultation"
      ? CONSULTATION_METHOD_OPTIONS
      : INTERVIEW_METHOD_OPTIONS;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-[8px] w-full max-w-[520px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <h2 className="text-[15px] font-bold text-[#374151]">URL生成</h2>
          <button
            onClick={handleClose}
            className="text-[#6B7280] hover:text-[#374151] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="p-6">
          {/* ステップインジケーター */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${
                    step >= s
                      ? "bg-[#2563EB] text-white"
                      : "bg-[#E5E7EB] text-[#6B7280]"
                  }`}
                >
                  {s}
                </div>
                {s < 3 && (
                  <div
                    className={`w-8 h-0.5 ${
                      step > s ? "bg-[#2563EB]" : "bg-[#E5E7EB]"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {!advisorName && (
            <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
              担当アドバイザーが設定されていません。求職者マスターで担当CAを設定してください。
            </div>
          )}

          {/* ステップ1: 用途選択 */}
          {step === 1 && (
            <div>
              <p className="text-[13px] text-[#6B7280] mb-4">
                生成するURLの用途を選択してください
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => handleSelectType("interview")}
                  disabled={!advisorName || generating}
                  className="w-full text-left border border-[#E5E7EB] rounded-lg p-4 hover:border-[#2563EB] hover:bg-[#F0F7FF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#E5E7EB] disabled:hover:bg-white"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📅</span>
                    <div>
                      <p className="text-[14px] font-bold text-[#374151]">
                        面接希望日の回収
                      </p>
                      <p className="text-[12px] text-[#6B7280] mt-0.5">
                        求職者に面接希望日時を入力してもらうURLを生成します
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleSelectType("consultation")}
                  disabled={!advisorName || generating}
                  className="w-full text-left border border-[#E5E7EB] rounded-lg p-4 hover:border-[#2563EB] hover:bg-[#F0F7FF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#E5E7EB] disabled:hover:bg-white"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🤝</span>
                    <div>
                      <p className="text-[14px] font-bold text-[#374151]">
                        面談調整
                      </p>
                      <p className="text-[12px] text-[#6B7280] mt-0.5">
                        求職者との面談日程を調整するURLを生成します
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* ステップ2: 形式選択 */}
          {step === 2 && (
            <div>
              <p className="text-[13px] text-[#6B7280] mb-4">
                {urlType === "interview" ? "面接方式" : "面談形式"}を選択してください
              </p>
              <div className="space-y-2 mb-6">
                {methodOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                      method === opt.value
                        ? "border-[#2563EB] bg-[#F0F7FF]"
                        : "border-[#E5E7EB] hover:border-[#93C5FD]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="interviewMethod"
                      value={opt.value}
                      checked={method === opt.value}
                      onChange={() => setMethod(opt.value)}
                      className="accent-[#2563EB]"
                    />
                    <span className="text-[14px] text-[#374151]">
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 border border-[#E5E7EB] rounded-md px-4 py-2.5 text-[13px] text-[#374151] hover:bg-[#F5F7FA] transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={() => doGenerate(urlType, method)}
                  disabled={generating}
                  className="flex-1 bg-[#2563EB] text-white rounded-md px-4 py-2.5 text-[13px] font-bold hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? "生成中..." : "URLを生成"}
                </button>
              </div>
            </div>
          )}

          {/* ステップ3: URL表示・コピー */}
          {step === 3 && (
            <div>
              <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3">
                <p className="text-[13px] text-green-700 font-bold">
                  URLが生成されました
                </p>
              </div>
              <div className="mb-2 text-[12px] text-[#6B7280]">
                対象：{candidateName} 様 ／ 担当：{advisorName} ／ 用途：
                {urlType === "interview" ? "面接希望日の回収" : "面談調整"}
                {" ／ 方式："}
                {methodOptions.find((o) => o.value === method)?.label}
              </div>
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-md p-3 mb-4">
                <p className="text-[12px] text-[#374151] break-all font-mono leading-relaxed">
                  {generatedUrl}
                </p>
              </div>
              <button
                onClick={handleCopy}
                className={`w-full rounded-md px-4 py-2.5 text-[13px] font-bold transition-colors ${
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                }`}
              >
                {copied ? "✅ コピーしました" : "URLをコピー"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
