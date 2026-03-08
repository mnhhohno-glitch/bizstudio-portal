interface TimelineCardProps {
  label: string;
  sublabel: string;
  color: string;
  questions: string[];
  axisNote: string;
}

export default function TimelineCard({
  label,
  sublabel,
  color,
  questions,
  axisNote,
}: TimelineCardProps) {
  return (
    <div
      className="bg-white rounded-xl p-6 shadow-sm"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <p className="text-lg font-bold text-[#003366]">{label}</p>
      <p className="text-xs text-gray-500 mb-4">{sublabel}</p>
      <ul className="space-y-2 mb-4">
        {questions.map((q, i) => (
          <li key={i} className="text-gray-700 text-sm flex gap-2">
            <span className="shrink-0">•</span>
            <span>{q}</span>
          </li>
        ))}
      </ul>
      <div className="text-sm text-gray-600 bg-gray-50 rounded p-3">
        <span className="font-medium">回答の軸：</span>{axisNote}
      </div>
    </div>
  );
}
