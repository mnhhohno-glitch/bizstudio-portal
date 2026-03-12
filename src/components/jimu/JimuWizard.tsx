"use client";

import { useState, useCallback, useRef } from "react";
import type { AppState } from "@/types/jimu";
import { UNIFIED_SCENARIOS } from "@/data/jimu-scenarios";
import ProgressBar from "./ProgressBar";
import TopScreen from "./TopScreen";
import Q1Screen from "./Q1Screen";
import Q2Screen from "./Q2Screen";
import StoryScreen from "./StoryScreen";
import QuizScreen from "./QuizScreen";
import ReflectionScreen from "./ReflectionScreen";
import ReportScreen from "./ReportScreen";

const TOTAL_SCREENS = 10;

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
          body: JSON.stringify({
            state: newState,
            candidateName: newState.candidateName || undefined,
          }),
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
        return <TopScreen state={state} onChange={handleChange} onNext={handleNext} />;
      case 1:
        return <Q1Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 2:
        return <Q2Screen state={state} onChange={handleChange} onNext={handleNext} />;
      case 3:
        return (
          <StoryScreen state={state} onChange={handleChange} onNext={handleNext} />
        );
      case 4:
      case 5:
      case 6:
      case 7:
      case 8: {
        const quizIndex = state.currentScreen - 4;
        const scenario = UNIFIED_SCENARIOS[quizIndex];
        if (!scenario) return null;
        return (
          <QuizScreen
            key={state.currentScreen}
            state={state}
            scenario={scenario}
            onChange={handleChange}
            onNext={handleNext}
          />
        );
      }
      case 9:
        return (
          <ReflectionScreen state={state} onChange={handleChange} onNext={handleNext} />
        );
      case 10:
        return (
          <ReportScreen token={token} state={state} onChange={handleChange} />
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
