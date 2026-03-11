"use client";

import { useState } from "react";
import type { AppState } from "@/types/jimu";
import { Q3_OPTIONS } from "@/data/jimu-questions";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface Q3ScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function Q3Screen({ state, onChange, onNext }: Q3ScreenProps) {
  const [selected, setSelected] = useState<string>(state.answers.q3);
  const [freeText, setFreeText] = useState(state.freeTexts.q3 || "");

  const handleNext = () => {
    const option = Q3_OPTIONS.options.find((o) => o.id === selected);
    const score = option?.score || { general: 0, sales: 0 };

    const newGeneralScore = state.generalScore + score.general;
    const newSalesScore = state.salesScore + score.sales;

    const updates: Partial<AppState> = {
      answers: { ...state.answers, q3: selected },
      generalScore: newGeneralScore,
      salesScore: newSalesScore,
      detectedJobType: newGeneralScore >= newSalesScore ? "general" : "sales",
    };
    if (option?.hasTextInput) {
      updates.freeTexts = { ...state.freeTexts, q3: freeText };
    }
    onChange(updates);
    onNext();
  };

  const selectedOption = Q3_OPTIONS.options.find((o) => o.id === selected);
  const canProceed =
    !!selected &&
    (!selectedOption?.hasTextInput || freeText.trim().length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          {Q3_OPTIONS.question}
        </h2>
      </div>

      <div className="space-y-3">
        {Q3_OPTIONS.options.map((option) => (
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
          placeholder="「やった！」と感じる瞬間を教えてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      )}

      <NextButton onClick={handleNext} disabled={!canProceed} />
    </div>
  );
}
