import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";
import NgOkComparison from "../NgOkComparison";

export default function Section06Logic() {
  return (
    <SectionWrapper id="section-6" number="06" title="「軸でつなぐ」最強のロジック" bg="soft">
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        面接で一貫性のある回答ができる人は、すべての答えを一本の「軸」でつないでいます。
      </p>

      <div className="flex flex-col md:flex-row items-center justify-center gap-4 my-8">
        <div className="bg-white border-2 border-[#003366] rounded-xl px-6 py-4 text-center font-bold text-[#003366]">
          過去の経験
        </div>
        <span className="text-[#F39200] text-2xl font-bold hidden md:block">→</span>
        <span className="text-[#F39200] text-2xl font-bold md:hidden">↓</span>
        <div className="bg-white border-2 border-[#003366] rounded-xl px-6 py-4 text-center font-bold text-[#003366]">
          転職軸
        </div>
        <span className="text-[#F39200] text-2xl font-bold hidden md:block">→</span>
        <span className="text-[#F39200] text-2xl font-bold md:hidden">↓</span>
        <div className="bg-white border-2 border-[#003366] rounded-xl px-6 py-4 text-center font-bold text-[#003366]">
          入社後の貢献
        </div>
      </div>

      <p className="text-base leading-relaxed text-gray-700 mb-8">
        前職で何を学び何に気づいたか、その経験が転職軸（価値観・なりたい自分）を形成し、
        その軸を御社で実現したいという流れです。
      </p>

      <h3 className="text-lg font-bold text-[#003366] mb-3">退職理由の伝え方</h3>
      <NgOkComparison
        ng="「上司と合わなかった」「給与が低かった」"
        ok="「〇〇を実現できる環境を求めて」「△△に挑戦したく」→「逃げ」ではなく「向かう先」として語る。"
      />

      <h3 className="text-lg font-bold text-[#003366] mb-3 mt-8">志望動機の伝え方</h3>
      <NgOkComparison
        ng="「御社の理念に共感しました」"
        ok="「理念の〇〇という部分が、自身の△△という経験に基づく軸と合致したため共感しました」"
      />

      <InsightBlock>
        この「一本の線」が説得力の源泉。「なぜ？」を5回繰り返されても崩れないロジックが完成する。
      </InsightBlock>
    </SectionWrapper>
  );
}
