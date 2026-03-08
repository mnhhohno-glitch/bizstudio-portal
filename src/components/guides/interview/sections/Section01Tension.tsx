import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";

export default function Section01Tension() {
  return (
    <SectionWrapper id="section-1" number="01" title="面接で緊張してしまう理由" bg="white">
      <div className="space-y-4 text-base leading-relaxed text-gray-700">
        <p>
          同じ1m幅の道でも、地上なら誰でも普通に歩けます。
          <br />
          「失敗しても大丈夫」という安心感があるからです。
        </p>
        <p>
          しかし、同じ道が高さ100mの場所にあったら？
          <br />
          足がすくんで、一歩も踏み出せなくなります。
        </p>
        <p>
          道の幅は変わっていない。変わったのは<strong>「状況への解釈」</strong>だけです。
        </p>
        <p>面接の緊張も、まったく同じ構造です。</p>
      </div>

      <InsightBlock>
        「評価される」という解釈が恐怖を生む。
        <br />
        「お互いを知る対話の場」と捉え直すだけで、パフォーマンスは劇的に変わる。
      </InsightBlock>
    </SectionWrapper>
  );
}
