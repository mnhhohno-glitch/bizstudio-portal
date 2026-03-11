"use client";

import { useState } from "react";
import type { AppState, QuizResult } from "@/types/jimu";
import type { Scenario } from "@/data/jimu-scenarios";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface QuizScreenProps {
  state: AppState;
  scenario: Scenario;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function QuizScreen({
  state,
  scenario,
  onChange,
  onNext,
}: QuizScreenProps) {
  const existingResult = state.quizResults.find(
    (r) => r.questionNumber === scenario.questionNumber
  );

  const [selected, setSelected] = useState<string>(
    existingResult?.selectedAnswer || ""
  );
  const [submitted, setSubmitted] = useState(!!existingResult);

  const selectedOption = scenario.options.find((o) => o.id === selected);

  const handleSubmit = () => {
    if (!selected || !selectedOption) return;

    const result: QuizResult = {
      questionNumber: scenario.questionNumber,
      selectedAnswer: selected,
      correct: selectedOption.result === "correct",
      scene: scenario.scene,
    };

    const existingResults = state.quizResults.filter(
      (r) => r.questionNumber !== scenario.questionNumber
    );

    onChange({
      quizResults: [...existingResults, result],
    });

    setSubmitted(true);
  };

  const handleNext = () => {
    onNext();
  };

  const resultType = submitted ? selectedOption?.result : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="inline-block bg-[#e8f4fd] text-[#1e3a5f] text-xs font-medium px-3 py-1 rounded-full">
          シナリオ {scenario.questionNumber}/5
        </span>
        <span className="text-xs text-gray-400">{scenario.scene}</span>
      </div>

      <div className="bg-gray-50 rounded-lg p-5">
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
          {scenario.scenario}
        </p>
      </div>

      <div className="space-y-3">
        {scenario.options.map((option) => (
          <OptionButton
            key={option.id}
            label={option.label}
            selected={selected === option.id}
            onClick={() => {
              if (!submitted) setSelected(option.id);
            }}
          />
        ))}
      </div>

      {!submitted && (
        <NextButton
          onClick={handleSubmit}
          disabled={!selected}
          label="回答する"
        />
      )}

      {submitted && resultType && (
        <div className="animate-fade-in space-y-4">
          <div
            className={`rounded-lg p-4 ${
              resultType === "correct"
                ? "bg-green-50 border border-green-200"
                : resultType === "partial"
                ? "bg-yellow-50 border border-yellow-200"
                : "bg-red-50 border border-red-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0 mt-0.5">
                {resultType === "correct" && "✓"}
                {resultType === "partial" && "△"}
                {resultType === "incorrect" && "✗"}
              </span>
              <div>
                <p
                  className={`text-sm font-bold mb-1 ${
                    resultType === "correct"
                      ? "text-green-700"
                      : resultType === "partial"
                      ? "text-yellow-700"
                      : "text-red-700"
                  }`}
                >
                  {resultType === "correct" && "正解！"}
                  {resultType === "partial" && "惜しい！"}
                  {resultType === "incorrect" && "不正解"}
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {resultType === "correct"
                    ? scenario.correctExplanation
                    : scenario.incorrectExplanation}
                </p>
              </div>
            </div>
          </div>

          <NextButton onClick={handleNext} label="次へ" />
        </div>
      )}
    </div>
  );
}
