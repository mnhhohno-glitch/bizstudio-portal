"use client";

interface OptionButtonProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function OptionButton({ label, selected, onClick }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all duration-200 text-sm leading-relaxed ${
        selected
          ? "bg-[#e8f4fd] border-[#1e3a5f] text-[#1e3a5f] font-medium"
          : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );
}
