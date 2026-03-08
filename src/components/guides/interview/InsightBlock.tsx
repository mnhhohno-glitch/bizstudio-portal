interface InsightBlockProps {
  children: React.ReactNode;
}

export default function InsightBlock({ children }: InsightBlockProps) {
  return (
    <div className="border-l-4 border-[#F39200] bg-[#FFF8F0] rounded-r-lg p-4 md:p-5 my-6">
      <div className="flex gap-3">
        <span className="text-lg shrink-0">💡</span>
        <div className="text-sm md:text-base text-gray-700 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}
