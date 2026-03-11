"use client";

import { useState } from "react";
import type { AppState } from "@/types/jimu";
import { Q2_OPTIONS } from "@/data/jimu-questions";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface Q2ScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function Q2Screen({ state, onChange, onNext }: Q2ScreenProps) {
  const [selected, setSelected] = useState<string>(state.answers.q2);
  const [freeText, setFreeText] = useState(state.freeTexts.q2 || "");

  const route = state.q1Route || "personality";
  const questionData = Q2_OPTIONS[route] || Q2_OPTIONS["personality"];

  if (!questionData) return null;

  const handleNext = () => {
    const option = questionData.options.find((o) => o.id === selected);
    const score = option?.score || { general: 0, sales: 0 };

    const updates: Partial<AppState> = {
      answers: { ...state.answers, q2: selected },
      generalScore: state.generalScore + score.general,
      salesScore: state.salesScore + score.sales,
    };
    if (option?.hasTextInput) {
      updates.freeTexts = { ...state.freeTexts, q2: freeText };
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
          placeholder="あなたの気持ちを教えてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      )}

      <NextButton onClick={handleNext} disabled={!canProceed} />
    </div>
  );
}
