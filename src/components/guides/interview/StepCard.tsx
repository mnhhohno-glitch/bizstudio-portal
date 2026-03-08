interface StepCardProps {
  step: number;
  title: string;
  subtitle: string;
  description: string;
}

export default function StepCard({ step, title, subtitle, description }: StepCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <p className="text-[#F39200] text-2xl font-black mb-2">STEP {step}</p>
      <p className="font-bold text-[#003366]">{title}</p>
      <p className="text-sm text-gray-500">{subtitle}</p>
      <p className="text-gray-700 mt-3">{description}</p>
    </div>
  );
}
