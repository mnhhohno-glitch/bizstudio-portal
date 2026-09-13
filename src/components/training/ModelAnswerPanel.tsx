import { splitGradingPoints } from "@/lib/training-work";

// 記述ワークの模範解答・採点ポイント表示（T-192）。
// 呼び出し側で「回答送信後」かつ modelAnswer が null でないことを確認してから描画する。
// 採点ポイントのチェックは自己採点用の画面上の状態のみで、どこにも保存しない
// （非制御 input のため、サーバーコンポーネントからもそのまま使える）。
export default function ModelAnswerPanel({
  modelAnswer,
  gradingPoints,
  idPrefix,
}: {
  modelAnswer: string;
  gradingPoints: string | null;
  idPrefix: string;
}) {
  const points = splitGradingPoints(gradingPoints);
  return (
    <div className="mt-3 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] p-3">
      <p className="text-[12px] font-semibold text-[#15803D]">模範解答</p>
      <p className="mt-1 text-[14px] text-[#374151] whitespace-pre-wrap leading-6">{modelAnswer}</p>
      {points.length > 0 && (
        <div className="mt-3 border-t border-[#BBF7D0] pt-2">
          <p className="text-[12px] font-semibold text-[#15803D]">
            採点ポイント
            <span className="ml-2 font-normal text-[#6B7280]">
              （自分の回答に含まれていた項目にチェック。チェックは保存されません）
            </span>
          </p>
          <ul className="mt-1.5 space-y-1">
            {points.map((p, i) => {
              const id = `${idPrefix}-gp-${i}`;
              return (
                <li key={id} className="flex items-start gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[#16A34A]"
                  />
                  <label htmlFor={id} className="text-[13px] text-[#374151] leading-5 cursor-pointer">
                    {p}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
