"use client";

import { useState } from "react";
import type { AppState, StoryResponses } from "@/types/jimu";
import { UNIFIED_STORY } from "@/data/jimu-story";
import { UNIFIED_SCENARIOS } from "@/data/jimu-scenarios";
import OptionButton from "./OptionButton";
import NextButton from "./NextButton";

const UNIFIED_REFLECTION_OPTIONS = [
  { id: "r1", label: "問1：取締役会議の資料更新（正確さ）", value: 1 },
  { id: "r2", label: "問2：急ぎの見積書作成（スピード × 正確さ）", value: 2 },
  { id: "r3", label: "問3：他部署への経費精算フォロー（社内調整）", value: 3 },
  { id: "r4", label: "問4：契約書の金額ミス発見（気づきと先回り）", value: 4 },
  { id: "r5", label: "問5：3つの同時依頼の優先判断（マルチタスク）", value: 5 },
];

interface ReflectionScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function ReflectionScreen({
  state,
  onChange,
  onNext,
}: ReflectionScreenProps) {
  const story = UNIFIED_STORY;
  const scenarios = UNIFIED_SCENARIOS;

  const [storyOpen, setStoryOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<number | null>(
    state.reflection.mostImpressiveScenario
  );
  const [whyText, setWhyText] = useState(state.reflection.whyImpressive);
  const [pastExperience, setPastExperience] = useState(
    state.reflection.pastExperience
  );
  const [happiestMoment, setHappiestMoment] = useState(
    state.reflection.happiestMoment
  );

  const getStoryAnswerLabel = (checkpointId: string) => {
    const key = checkpointId as keyof StoryResponses;
    const answerId = state.storyResponses[key];
    if (!answerId) return null;
    for (const section of story) {
      if (section.checkpoint?.id === checkpointId) {
        const opt = section.checkpoint.options.find((o) => o.id === answerId);
        return opt?.label || null;
      }
    }
    return null;
  };

  const getQuizResult = (questionNumber: number) => {
    return state.quizResults.find((r) => r.questionNumber === questionNumber);
  };

  const getQuizAnswerLabel = (questionNumber: number) => {
    const result = getQuizResult(questionNumber);
    if (!result) return null;
    const scenario = scenarios.find((s) => s.questionNumber === questionNumber);
    if (!scenario) return null;
    const opt = scenario.options.find((o) => o.id === result.selectedAnswer);
    return opt?.label || null;
  };

  const getQuizResultIcon = (questionNumber: number) => {
    const result = getQuizResult(questionNumber);
    if (!result) return null;
    const scenario = scenarios.find((s) => s.questionNumber === questionNumber);
    const opt = scenario?.options.find((o) => o.id === result.selectedAnswer);
    if (!opt) return null;
    switch (opt.result) {
      case "correct":
        return { icon: "✓", color: "text-green-600", label: "正解" };
      case "partial":
        return { icon: "△", color: "text-yellow-600", label: "惜しい" };
      case "incorrect":
        return { icon: "✗", color: "text-red-500", label: "不正解" };
    }
  };

  const handleNext = () => {
    onChange({
      reflection: {
        mostImpressiveScenario: selectedScenario,
        whyImpressive: whyText,
        pastExperience,
        happiestMoment,
      },
    });
    onNext();
  };

  const canProceed =
    selectedScenario !== null &&
    whyText.trim().length > 0 &&
    pastExperience.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-[#e8f4fd] rounded-lg p-4 mb-6">
        <p className="text-sm text-[#1e3a5f]">
          お疲れさまでした。最後に、今日の体験を振り返りましょう。
        </p>
        <p className="text-sm text-[#1e3a5f] mt-2">
          ストーリーやシナリオを見返しながら、あなたが一番心に残った場面を教えてください。
          <br />
          ここで書いた内容が、あなただけの志望動機のもとになります。
        </p>
      </div>

      {/* ストーリーアコーディオン */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setStoryOpen(!storyOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-[#1e3a5f] hover:bg-gray-100 transition-colors"
        >
          <span>📖 ストーリーを見返す</span>
          <span className="text-gray-400">{storyOpen ? "▲" : "▼"}</span>
        </button>
        {storyOpen && (
          <div className="px-4 py-4 space-y-4 max-h-96 overflow-y-auto">
            {story.map((section) => (
              <div key={section.id}>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                  {section.content}
                </p>
                {section.checkpoint && (
                  <div className="mt-2 ml-3 pl-3 border-l-2 border-[#1e3a5f]">
                    <p className="text-xs font-medium text-[#1e3a5f]">
                      💬 {section.checkpoint.question}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      → あなたの回答：
                      {getStoryAnswerLabel(section.checkpoint.id) || "（未回答）"}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* シナリオアコーディオン */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setScenarioOpen(!scenarioOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-[#1e3a5f] hover:bg-gray-100 transition-colors"
        >
          <span>📝 シナリオの回答を見返す</span>
          <span className="text-gray-400">{scenarioOpen ? "▲" : "▼"}</span>
        </button>
        {scenarioOpen && (
          <div className="px-4 py-4 space-y-4 max-h-96 overflow-y-auto">
            {scenarios.map((scenario) => {
              const resultInfo = getQuizResultIcon(scenario.questionNumber);
              const answerLabel = getQuizAnswerLabel(scenario.questionNumber);
              const result = getQuizResult(scenario.questionNumber);
              const selectedOpt = scenario.options.find(
                (o) => o.id === result?.selectedAnswer
              );

              return (
                <div
                  key={scenario.questionNumber}
                  className="border-b border-gray-100 pb-3 last:border-b-0"
                >
                  <p className="text-xs font-medium text-[#1e3a5f]">
                    シナリオ {scenario.questionNumber}/5：{scenario.scene}
                  </p>
                  {answerLabel && resultInfo ? (
                    <>
                      <p className="text-xs text-gray-600 mt-1">
                        あなたの回答：{answerLabel}
                        <span className={`ml-1 font-bold ${resultInfo.color}`}>
                          （{resultInfo.icon} {resultInfo.label}）
                        </span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        {selectedOpt?.result === "correct"
                          ? scenario.correctExplanation
                          : scenario.incorrectExplanation}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">（未回答）</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ① 一番印象に残ったシナリオ */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-[#1e3a5f]">
          5つのシナリオの中で、一番印象に残った場面はどれですか？
        </h3>
        <div className="space-y-2">
          {UNIFIED_REFLECTION_OPTIONS.map((opt) => (
            <OptionButton
              key={opt.id}
              label={opt.label}
              selected={selectedScenario === opt.value}
              onClick={() => setSelectedScenario(opt.value)}
            />
          ))}
        </div>
      </div>

      {/* ② なぜ印象に残ったか */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-[#1e3a5f]">
          その場面が印象に残った理由を、短くていいので書いてみてください。
        </h3>
        <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 leading-relaxed">
          <p className="font-medium mb-1">💡 ヒント：</p>
          <p>・「自分もこういう場面で同じように動くと思ったから」</p>
          <p>・「こういう判断ができる人になりたいと思ったから」</p>
          <p>・「この仕事で&quot;ありがとう&quot;と言われたら嬉しいと思ったから」</p>
          <p className="mt-2">
            例文：「間違いに気づいて自分から動くのは勇気がいるけど、
            それで相手の信頼を守れるのはやりがいがあると思った」
          </p>
        </div>
        <textarea
          value={whyText}
          onChange={(e) => setWhyText(e.target.value)}
          rows={4}
          placeholder="印象に残った理由を書いてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      </div>

      {/* ③ 過去の近い体験 */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          あなたの過去の経験（バイト・前職・学校・日常生活なんでもOK）で、今日見た事務の仕事に&quot;近いな&quot;と感じた体験を教えてください。
        </h2>

        <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 leading-relaxed">
          <p className="font-medium mb-1">💡 こんな体験はありませんか？</p>
          <p>・書類やデータを丁寧に整理して、誰かに「助かった」と言われた</p>
          <p>・誰かの段取り・準備を先回りしてやったら感謝された</p>
          <p>・おかしいと思ったことに自分から声をかけて、トラブルを防いだ</p>
          <p>・複数の人の要望を整理して、うまくさばいた経験</p>
          <p>・自分で気づいて改善したこと（ファイルの整理方法を変えた、連絡のやり方を工夫した、など）</p>
          <p className="mt-2">
            例文：「前職の飲食店でシフト表の管理を任されていて、いつも直前に混乱していたのを、2週間前に確定するルールに変えたら店長に&quot;助かる&quot;と言われました」
          </p>
        </div>

        <textarea
          value={pastExperience}
          onChange={(e) => setPastExperience(e.target.value)}
          rows={5}
          placeholder="過去の体験を書いてください"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      </div>

      {/* ④ 一番うれしかった瞬間 */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-[#1e3a5f]">
          その体験で、あなたが一番うれしかったのはどんな瞬間でしたか？
        </h3>
        <p className="text-xs text-gray-400">（任意）</p>

        <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 leading-relaxed">
          <p>例文：「&quot;中村さんがいると安心する&quot;と言ってもらえたとき」</p>
        </div>

        <textarea
          value={happiestMoment}
          onChange={(e) => setHappiestMoment(e.target.value)}
          rows={3}
          placeholder="一番うれしかった瞬間（任意）"
          className="w-full border border-gray-300 rounded-lg p-4 text-sm focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/20 focus:outline-none placeholder:text-gray-400"
        />
      </div>

      <NextButton onClick={handleNext} disabled={!canProceed} />
    </div>
  );
}
