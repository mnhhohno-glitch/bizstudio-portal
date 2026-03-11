"use client";

import { useState } from "react";
import type { AppState } from "@/types/jimu";
import NextButton from "./NextButton";

interface PastExperienceScreenProps {
  state: AppState;
  onChange: (updates: Partial<AppState>) => void;
  onNext: () => void;
}

export default function PastExperienceScreen({
  state,
  onChange,
  onNext,
}: PastExperienceScreenProps) {
  const isSales = state.detectedJobType === "sales";
  const [pastExperience, setPastExperience] = useState(
    state.reflection.pastExperience
  );
  const [happiestMoment, setHappiestMoment] = useState(
    state.reflection.happiestMoment
  );

  const handleNext = () => {
    onChange({
      reflection: {
        ...state.reflection,
        pastExperience,
        happiestMoment,
      },
    });
    onNext();
  };

  const canProceed = pastExperience.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-[#e8f4fd] rounded-lg p-4 mb-6">
        <p className="text-sm text-[#1e3a5f]">
          最後の質問です。
          <br />
          事務の仕事と、あなた自身の経験をつなげてみましょう。
        </p>
      </div>

      {/* ③ 過去の近い体験 */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-[#1e3a5f]">
          あなたの過去の経験（バイト・前職・学校・日常生活なんでもOK）で、今日見た事務の仕事に&quot;近いな&quot;と感じた体験を教えてください。
        </h2>

        <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 leading-relaxed">
          <p className="font-medium mb-1">💡 こんな体験はありませんか？</p>
          {isSales ? (
            <>
              <p>・誰かの段取り・準備を先回りしてやったら感謝された</p>
              <p>・おかしいと思ったことに自分から声をかけて、トラブルを防いだ</p>
              <p>・複数の人の要望を整理して、うまくさばいた経験</p>
              <p className="mt-2">
                例文：「飲食店のバイトで、ランチの混雑時間に合わせて事前に
                食材の仕込みリストを自分で作るようにしたら、先輩に
                &quot;回転が早くなった&quot;と言われました」
              </p>
            </>
          ) : (
            <>
              <p>・書類やデータを丁寧に整理して、誰かに「助かった」と言われた</p>
              <p>・自分で気づいて改善したこと（ファイルの整理方法を変えた、連絡のやり方を工夫した、など）</p>
              <p>・バラバラな情報をまとめて、周りが動きやすくなった</p>
              <p className="mt-2">
                例文：「前職の飲食店でシフト表の管理を任されていて、
                いつも直前に混乱していたのを、2週間前に確定するルールに
                変えたら店長に&quot;助かる&quot;と言われました」
              </p>
            </>
          )}
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
          {isSales ? (
            <p>例文：「&quot;鈴木がいると安心する&quot;と言ってもらえたとき」</p>
          ) : (
            <p>例文：「&quot;ちゃんとやってくれてるから安心&quot;と言ってもらえたとき」</p>
          )}
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
