interface NgOkComparisonProps {
  ng: string;
  ok: string;
  ngLabel?: string;
  okLabel?: string;
}

export default function NgOkComparison({
  ng,
  ok,
  ngLabel = "NG",
  okLabel = "OK",
}: NgOkComparisonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
      <div className="border-l-4 border-red-400 bg-red-50 rounded-r-lg p-4">
        <p className="text-red-600 font-bold text-sm mb-2">❌ {ngLabel}</p>
        <p className="text-gray-700">{ng}</p>
      </div>
      <div className="border-l-4 border-green-400 bg-green-50 rounded-r-lg p-4">
        <p className="text-green-600 font-bold text-sm mb-2">✅ {okLabel}</p>
        <p className="text-gray-700">{ok}</p>
      </div>
    </div>
  );
}
