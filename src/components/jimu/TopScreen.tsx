"use client";

import { useState } from "react";
import type { AppState } from "@/types/jimu";
import NextButton from "./NextButton";

interface TopScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function TopScreen({ state, onChange, onNext }: TopScreenProps) {
  const [name, setName] = useState(state.candidateName);

  const handleStart = () => {
    onChange({ candidateName: name.trim() });
    onNext();
  };

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
      <div className="w-full max-w-xs space-y-4">
        <div className="text-left">
          <label className="text-sm font-medium text-[#1e3a5f]">
            お名前を入力してください
          </label>
          <input
            type="text"
            placeholder="例：山田 太郎"
            className="w-full mt-2 p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <NextButton
          onClick={handleStart}
          label="はじめる"
          disabled={!name.trim()}
        />
      </div>
    </div>
  );
}
