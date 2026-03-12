"use client";

import { useState, useEffect, useRef } from "react";
import type { AppState } from "@/types/jimu";
import { Q1_OPTIONS } from "@/data/jimu-questions";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface Q1ScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function Q1Screen({ state, onChange, onNext }: Q1ScreenProps) {
  const [selected, setSelected] = useState<string>(state.answers.q1);
  const [freeText, setFreeText] = useState(state.freeTexts.q1 || "");
  const [showConditionMsg, setShowConditionMsg] = useState(false);
  const autoAdvanceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  const handleSelect = (optionId: string) => {
    setSelected(optionId);

    if (optionId === "condition") {
      setShowConditionMsg(true);
      onChange({
        answers: { ...state.answers, q1: optionId },
      });
      autoAdvanceRef.current = setTimeout(() => {
        onNext();
      }, 1500);
    } else {
      setShowConditionMsg(false);
      onChange({
        answers: { ...state.answers, q1: optionId },
      });
    }
  };

  const handleNext = () => {
    const updates: Partial<AppState> = {
      answers: { ...state.answers, q1: selected },
    };
    if (selected === "other") {
      updates.freeTexts = { ...state.freeTexts, q1: freeText };
    }
    onChange(updates);
    onNext();
  };

  const selectedOption = Q1_OPTIONS.find((o) => o.id === selected);
  const canProceed =
    !!selected &&
    selected !== "condition" &&
    (selected !== "other" || freeText.trim().length > 0);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500 mb-4">
        まず最初に、あなたの気持ちを教えてください。
        <br />
        正解・不正解はありません。
      </p>
      <div>
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          事務を目指した理由を、一番正直に選んでください
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          正直な答えが、一番いい結果につながります
        </p>
      </div>

      <div className="space-y-3">
        {Q1_OPTIONS.map((option) => (
          <OptionButton
            key={option.id}
            label={option.label}
            selected={selected === option.id}
            onClick={() => handleSelect(option.id)}
          />
        ))}
      </div>

      {showConditionMsg && selected === "condition" && (
        <div className="bg-[#e8f4fd] rounded-lg p-4 text-sm text-[#1e3a5f] animate-fade-in">
          それは大切な理由ですね。もう少し一緒に掘り下げてみましょう 🙂
        </div>
      )}

      {selected === "other" && selectedOption?.hasTextInput && (
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={3}
          placeholder="あなたが事務を目指した理由を教えてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      )}

      {selected !== "condition" && (
        <NextButton onClick={handleNext} disabled={!canProceed} />
      )}
    </div>
  );
}
