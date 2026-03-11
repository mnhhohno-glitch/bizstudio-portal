"use client";

interface NextButtonProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}

export default function NextButton({ onClick, disabled = false, label = "次へ" }: NextButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full bg-[#1e3a5f] text-white rounded-lg px-6 py-3 font-bold text-base hover:bg-[#16304f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
