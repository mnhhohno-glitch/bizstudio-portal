"use client";

import NextButton from "./NextButton";

interface TopScreenProps {
  onNext: () => void;
}

export default function TopScreen({ onNext }: TopScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 text-center px-4">
      <div className="space-y-4">
        <div className="text-5xl">✨</div>
        <h1 className="text-xl font-bold text-[#1e3a5f] leading-relaxed">
          あなたが事務で輝く理由を、
          <br />
          一緒に見つけましょう
        </h1>
        <p className="text-sm text-gray-400">所要時間：約10〜15分</p>
      </div>
      <div className="w-full max-w-xs">
        <NextButton onClick={onNext} label="はじめる" />
      </div>
    </div>
  );
}
