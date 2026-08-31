"use client";

import { useState } from "react";
import { ALL_AREA_GROUPS } from "@/lib/rpa-scout/area";

// エリア選択（マイナビ同等の2段階UI＋東日本/西日本/全国のワンタッチボタン）
export default function AreaSelector({
  areaType,
  prefectures,
  onChange,
}: {
  areaType: string | null;
  prefectures: string[];
  onChange: (areaType: string | null, prefectures: string[]) => void;
}) {
  const [activeRegion, setActiveRegion] = useState(ALL_AREA_GROUPS[0].region);

  const oneTouch = (type: string) => onChange(type, []);

  const togglePref = (pref: string) => {
    const next = prefectures.includes(pref)
      ? prefectures.filter((p) => p !== pref)
      : [...prefectures, pref];
    onChange("PREFECTURES", next);
  };

  const activeGroup = ALL_AREA_GROUPS.find((g) => g.region === activeRegion);

  const btn = (selected: boolean) =>
    [
      "rounded-[6px] border px-3 py-1.5 text-[13px]",
      selected
        ? "border-[#2563EB] bg-[#EFF6FF] font-medium text-[#2563EB]"
        : "border-[#D1D5DB] text-[#374151] hover:bg-[#F9FAFB]",
    ].join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => oneTouch("EAST")} className={btn(areaType === "EAST")}>
          東日本
        </button>
        <button type="button" onClick={() => oneTouch("WEST")} className={btn(areaType === "WEST")}>
          西日本
        </button>
        <button
          type="button"
          onClick={() => oneTouch("NATIONWIDE")}
          className={btn(areaType === "NATIONWIDE")}
        >
          全国
        </button>
        <button
          type="button"
          onClick={() => onChange("PREFECTURES", prefectures)}
          className={btn(areaType === "PREFECTURES")}
        >
          県指定
        </button>
      </div>

      {areaType === "PREFECTURES" && (
        <div className="flex gap-0 overflow-hidden rounded-[6px] border border-[#D1D5DB]">
          <div className="w-28 shrink-0 border-r border-[#E5E7EB] bg-[#F9FAFB]">
            {ALL_AREA_GROUPS.map((g) => {
              const count = g.prefectures.filter((p) => prefectures.includes(p)).length;
              return (
                <button
                  type="button"
                  key={g.region}
                  onClick={() => setActiveRegion(g.region)}
                  className={[
                    "block w-full px-3 py-2 text-left text-[13px]",
                    activeRegion === g.region
                      ? "bg-white font-medium text-[#2563EB]"
                      : "text-[#374151] hover:bg-[#F3F4F6]",
                  ].join(" ")}
                >
                  {g.region}
                  {count > 0 && <span className="ml-1 text-[11px] text-[#2563EB]">({count})</span>}
                </button>
              );
            })}
          </div>
          <div className="flex-1 p-3">
            <div className="grid grid-cols-3 gap-1">
              {activeGroup?.prefectures.map((pref) => (
                <label key={pref} className="flex items-center gap-1.5 text-[13px] text-[#374151]">
                  <input
                    type="checkbox"
                    checked={prefectures.includes(pref)}
                    onChange={() => togglePref(pref)}
                  />
                  {pref}
                </label>
              ))}
            </div>
            {prefectures.length > 0 && (
              <div className="mt-2 border-t border-[#F3F4F6] pt-2 text-[12px] text-[#6B7280]">
                選択中: {prefectures.join("/")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
