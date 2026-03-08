import SectionWrapper from "../SectionWrapper";
import InsightBlock from "../InsightBlock";

const tableRows = [
  { before: "審査される場", after: "未来を共に描く対話の場" },
  { before: "評価を勝ち取る", after: "お互いを理解し合う" },
  { before: "正解を言わなければ", after: "自分らしく伝える" },
];

export default function Section02Essence() {
  return (
    <SectionWrapper id="section-2" number="02" title="面接の本質とは何か" bg="soft">
      <h3 className="text-lg font-bold text-[#003366] mb-3">
        面接は「審査の場」ではなく「対話の場」
      </h3>
      <p className="text-base leading-relaxed text-gray-700 mb-6">
        面接官は「落とすため」ではなく「一緒に働ける人か確認するため」に面接をしています。
        あなたも「この会社で自分は活き活きと働けるか」を確かめる場です。
      </p>

      <div className="overflow-x-auto mb-6">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#003366] text-white">
              <th className="p-3 text-left font-medium">Before（今の解釈）</th>
              <th className="p-3 text-left font-medium">After（書き換え後）</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-gray-50" : ""}>
                <td className="border border-gray-200 p-3 text-gray-700">{row.before}</td>
                <td className="border border-gray-200 p-3 text-gray-700 font-medium">
                  {row.after}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InsightBlock>
        この解釈の転換だけで、面接当日のパフォーマンスは大きく変わります。
      </InsightBlock>
    </SectionWrapper>
  );
}
