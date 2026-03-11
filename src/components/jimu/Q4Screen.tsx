"use client";

import { useState } from "react";
import type { AppState } from "@/types/jimu";
import { Q4_OPTIONS } from "@/data/jimu-questions";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface Q4ScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function Q4Screen({ state, onChange, onNext }: Q4ScreenProps) {
  const [selected, setSelected] = useState<string>(state.answers.q4);
  const [freeText, setFreeText] = useState(state.freeTexts.q4 || "");

  const jobType = state.detectedJobType || "general";
  const questionData = Q4_OPTIONS[jobType];

  if (!questionData) return null;

  const handleNext = () => {
    const option = questionData.options.find((o) => o.id === selected);
    const yarigaiWord = option?.hasTextInput
      ? freeText.trim()
      : option?.yarigaiWord || "";

    const updates: Partial<AppState> = {
      answers: { ...state.answers, q4: selected },
      yarigaiWord,
    };
    if (option?.hasTextInput) {
      updates.freeTexts = { ...state.freeTexts, q4: freeText };
    }
    onChange(updates);
    onNext();
  };

  const selectedOption = questionData.options.find((o) => o.id === selected);
  const canProceed =
    !!selected &&
    (!selectedOption?.hasTextInput || freeText.trim().length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          {questionData.question}
        </h2>
      </div>

      <div className="space-y-3">
        {questionData.options.map((option) => (
          <OptionButton
            key={option.id}
            label={option.label}
            selected={selected === option.id}
            onClick={() => setSelected(option.id)}
          />
        ))}
      </div>

      {selectedOption?.hasTextInput && (
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={3}
          placeholder="あなたが感じたいことを教えてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      )}

      <NextButton onClick={handleNext} disabled={!canProceed} />
    </div>
  );
}
