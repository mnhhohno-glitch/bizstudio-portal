"use client";

import { useState } from "react";
import type { GuideConfig } from "@/lib/guides/types";

type Props = {
  config: GuideConfig;
  data: Record<string, string>;
  onSave: (data: Record<string, string>) => Promise<void>;
  isSaving: boolean;
  lastUpdated?: string;
};

export default function GuideForm({ config, data, onSave, isSaving, lastUpdated }: Props) {
  const [formData, setFormData] = useState<Record<string, string>>(data);
  const [saved, setSaved] = useState(false);

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await onSave(formData);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-8">
      {config.sections.map((section) => (
        <div key={section.id}>
          <h2 className="text-[18px] font-semibold text-[#374151] border-b border-[#E5E7EB] pb-2 mb-4">
            {section.title}
          </h2>
          {section.description && (
            <p className="text-[14px] text-[#6B7280] mb-4">{section.description}</p>
          )}
          <div className="space-y-5">
            {section.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-[14px] font-medium text-[#374151] mb-1">
                  {field.label}
                </label>
                <textarea
                  value={formData[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  rows={field.rows || 3}
                  placeholder={field.placeholder}
                  className="w-full border border-[#E5E7EB] rounded-md p-3 text-[14px] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] placeholder:text-[#9CA3AF]"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-4">
        <div className="text-[12px] text-[#6B7280]">
          {lastUpdated && `最終更新: ${formatDateTime(lastUpdated)}`}
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#2563EB] text-white rounded-md px-6 py-2 text-[14px] hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {isSaving ? "保存中..." : saved ? "✅ 保存しました" : "💾 保存する"}
        </button>
      </div>
    </div>
  );
}
