"use client";

import { useState, useEffect, useRef } from "react";
import type { AppState, StoryResponses } from "@/types/jimu";
import { GENERAL_STORY, SALES_STORY } from "@/data/jimu-story";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

interface StoryScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function StoryScreen({ state, onChange, onNext }: StoryScreenProps) {
  const story = state.detectedJobType === "sales" ? SALES_STORY : GENERAL_STORY;

  const getInitialVisible = () => {
    const responses = state.storyResponses;
    let visible = 1;
    for (const section of story) {
      if (section.checkpoint) {
        const key = section.checkpoint.id as keyof StoryResponses;
        if (responses[key]) {
          visible++;
        } else {
          break;
        }
      } else {
        visible++;
      }
    }
    return Math.min(visible, story.length);
  };

  const [visibleCount, setVisibleCount] = useState(getInitialVisible);
  const [pendingAnswer, setPendingAnswer] = useState<Record<string, string>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevVisibleRef = useRef(visibleCount);

  useEffect(() => {
    if (visibleCount > prevVisibleRef.current) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
    prevVisibleRef.current = visibleCount;
  }, [visibleCount]);

  const handleCheckpointAnswer = (checkpointId: string, optionId: string) => {
    setPendingAnswer((prev) => ({ ...prev, [checkpointId]: optionId }));

    const key = checkpointId as keyof StoryResponses;
    const newResponses = { ...state.storyResponses, [key]: optionId };
    onChange({ storyResponses: newResponses });

    setTimeout(() => {
      setVisibleCount((prev) => {
        const currentSection = story.findIndex(
          (s) => s.checkpoint?.id === checkpointId
        );
        const nextVisible = currentSection + 2;
        return Math.max(prev, Math.min(nextVisible, story.length));
      });
    }, 300);
  };

  const isAnswered = (checkpointId: string) => {
    const key = checkpointId as keyof StoryResponses;
    return !!(state.storyResponses[key] || pendingAnswer[checkpointId]);
  };

  const getSelectedAnswer = (checkpointId: string) => {
    const key = checkpointId as keyof StoryResponses;
    return state.storyResponses[key] || pendingAnswer[checkpointId] || "";
  };

  const allCheckpointsAnswered = story
    .filter((s) => s.checkpoint)
    .every((s) => isAnswered(s.checkpoint!.id));

  const allSectionsVisible = visibleCount >= story.length;

  return (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <span className="inline-block bg-[#e8f4fd] text-[#1e3a5f] text-xs font-medium px-3 py-1 rounded-full">
          {state.detectedJobType === "sales" ? "営業事務" : "一般事務"}の1日
        </span>
      </div>

      {story.slice(0, visibleCount).map((section, idx) => (
        <div
          key={section.id}
          className={idx >= getInitialVisible() ? "animate-fade-in" : ""}
        >
          <div className="bg-gray-50 rounded-lg p-5">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
              {section.content}
            </p>
          </div>

          {section.checkpoint && (
            <div className="mt-4 ml-2 pl-4 border-l-2 border-[#1e3a5f]">
              <p className="text-base font-medium text-[#1e3a5f] mb-3">
                💬 {section.checkpoint.question}
              </p>
              <div className="space-y-2">
                {section.checkpoint.options.map((opt) => (
                  <OptionButton
                    key={opt.id}
                    label={opt.label}
                    selected={getSelectedAnswer(section.checkpoint!.id) === opt.id}
                    onClick={() => {
                      if (!isAnswered(section.checkpoint!.id)) {
                        handleCheckpointAnswer(section.checkpoint!.id, opt.id);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div ref={bottomRef} />

      {allCheckpointsAnswered && allSectionsVisible && (
        <div className="animate-fade-in pt-4">
          <NextButton onClick={onNext} label="次へ進む" />
        </div>
      )}
    </div>
  );
}
