"use client";
import { inputCls } from "../types";

type Props = {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
};

export default function MemoTab({ value, onChange, label, placeholder }: Props) {
  return (
    <div>
      <h4 className="text-[13px] font-bold text-[#374151] mb-3">{label}</h4>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        rows={20}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  );
}
