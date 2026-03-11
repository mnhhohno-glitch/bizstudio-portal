"use client";

import { useState, useCallback, useRef } from "react";
import type { AppState } from "@/types/jimu";
import { GENERAL_SCENARIOS, SALES_SCENARIOS } from "@/data/jimu-scenarios";
import ProgressBar from "./ProgressBar";
import TopScreen from "./TopScreen";
import Q1Screen from "./Q1Screen";
import Q2Screen from "./Q2Screen";
import Q3Screen from "./Q3Screen";
import Q4Screen from "./Q4Screen";
import StoryScreen from "./StoryScreen";
import QuizScreen from "./QuizScreen";

const TOTAL_SCREENS = 14;

interface JimuWizardProps {
  token: string;
  initialState: AppState;
}

export default function JimuWizard({ token, initialState }: JimuWizardProps) {
  const [state, setState] = useState<AppState>(initialState);
  const savingRef = useRef(false);

  const saveState = useCallback(
    async (newState: AppState) => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        await fetch(`/api/jimu/${token}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: newState }),
        });
      } catch {
        // silent fail
      } finally {
        savingRef.current = false;
      }
    },
    [token]
  );

  const handleChange = useCallback(
    (updates: Partial<AppState>) => {
      setState((prev) => {
        const next = { ...prev, ...updates };
        return next;
      });
    },
    []
  );

  const goToScreen = useCallback(
    (screen: number) => {
      setState((prev) => {
        const next = { ...prev, currentScreen: screen };
        saveState(next);
        return next;
      });
    },
    [saveState]
  );

  const handleNext = useCallback(() => {
    goToScreen(state.currentScreen + 1);
  }, [state.currentScreen, goToScreen]);

  const renderScreen = () => {
    switch (state.currentScreen) {
      case 0:
        return <TopScreen onNext={handleNext} />;
      case 1:
        return <Q1Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 2:
        return <Q2Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 3:
        return <Q3Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 4:
        return <Q4Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 5:
        return (
          <StoryScreen state={state} onChange={handleChange} onNext={handleNext} />
        );
      case 6:
      case 7:
      case 8:
      case 9:
      case 10: {
        const quizIndex = state.currentScreen - 6;
        const scenarios =
          state.detectedJobType === "sales" ? SALES_SCENARIOS : GENERAL_SCENARIOS;
        const scenario = scenarios[quizIndex];
        if (!scenario) return null;
        return (
          <QuizScreen
            state={state}
            scenario={scenario}
            onChange={handleChange}
            onNext={handleNext}
          />
        );
      }
      case 11:
      case 12:
        return (
          <div className="py-12 text-center text-gray-400">
            <p className="text-lg font-bold text-[#1e3a5f] mb-2">振り返り画面</p>
            <p>フェーズ3で実装予定</p>
          </div>
        );
      case 13:
        return (
          <div className="py-12 text-center text-gray-400">
            <p className="text-lg font-bold text-[#1e3a5f] mb-2">レポート画面</p>
            <p>フェーズ4で実装予定</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans">
      <div className="max-w-lg mx-auto px-4 py-6">
        {state.currentScreen > 0 && (
          <div className="mb-6">
            <ProgressBar current={state.currentScreen} total={TOTAL_SCREENS} />
          </div>
        )}
        {renderScreen()}
      </div>
    </div>
  );
}
