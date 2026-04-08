"use client";
import { useState } from "react";
import { inputCls, labelCls } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { d: Record<string, any>; set: (k: string, v: any) => void };

const WORK_STYLE_OPTIONS = [
  { key: "fullRemote", label: "フルリモート" },
  { key: "hybrid", label: "ハイブリッド" },
  { key: "flextime", label: "フレックス勤務" },
  { key: "listed", label: "上場企業" },
  { key: "startup", label: "スタートアップ" },
  { key: "housing", label: "住宅手当" },
  { key: "severancePay", label: "退職金制度" },
  { key: "fixedOvertimeNG", label: "固定残業NG" },
  { key: "bonusRequired", label: "賞与必須" },
  { key: "overseasTravel", label: "海外勤務・出張あり" },
  { key: "overseasResident", label: "海外常駐希望" },
  { key: "useEnglish", label: "英語を使う仕事" },
];

export default function DesiredConditions({ d, set }: Props) {
  const [subTab, setSubTab] = useState<"job" | "industry" | "area">("job");

  const prefs: Record<string, boolean> = (() => {
    try { return JSON.parse(d.workStylePreferences || "{}"); } catch { return {}; }
  })();
  const togglePref = (key: string) => {
    const next = { ...prefs, [key]: !prefs[key] };
    set("workStylePreferences", JSON.stringify(next));
  };

  return (
    <div className="space-y-5">
      {/* Sub tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 inline-flex">
        {[{ key: "job", label: "職種" }, { key: "industry", label: "業種" }, { key: "area", label: "エリア" }].map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key as typeof subTab)}
            className={`px-3 py-1 text-[12px] font-medium rounded ${subTab === t.key ? "bg-white text-[#2563EB] shadow-sm" : "text-gray-500"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "job" && (
        <div className="space-y-3">
          <F label="希望職種1" value={d.desiredJobType1} onChange={(v) => set("desiredJobType1", v)} />
          <F label="希望職種メモ" value={d.desiredJobType1Memo} onChange={(v) => set("desiredJobType1Memo", v)} />
          <F label="希望職種2" value={d.desiredJobType2} onChange={(v) => set("desiredJobType2", v)} />
        </div>
      )}
      {subTab === "industry" && (
        <div className="space-y-3">
          <F label="希望業界1" value={d.desiredIndustry1} onChange={(v) => set("desiredIndustry1", v)} />
          <F label="業界メモ" value={d.desiredIndustry1Memo} onChange={(v) => set("desiredIndustry1Memo", v)} />
        </div>
      )}
      {subTab === "area" && (
        <div className="space-y-3">
          <F label="希望エリア" value={d.desiredArea} onChange={(v) => set("desiredArea", v)} />
          <F label="都道府県" value={d.desiredPrefecture} onChange={(v) => set("desiredPrefecture", v)} />
          <F label="市区町村" value={d.desiredCity} onChange={(v) => set("desiredCity", v)} />
          <F label="エリアメモ" value={d.desiredAreaMemo} onChange={(v) => set("desiredAreaMemo", v)} />
        </div>
      )}

      {/* 年収・条件 */}
      <div>
        <h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">年収・条件</h4>
        <div className="grid grid-cols-3 gap-3">
          <Num label="現年収（万円）" value={d.currentSalary} onChange={(v) => set("currentSalary", v)} />
          <Num label="希望下限（万円）" value={d.desiredSalaryMin} onChange={(v) => set("desiredSalaryMin", v)} />
          <Num label="希望上限（万円）" value={d.desiredSalaryMax} onChange={(v) => set("desiredSalaryMax", v)} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <F label="希望休日" value={d.desiredDayOff} onChange={(v) => set("desiredDayOff", v)} />
          <F label="希望残業" value={d.desiredOvertimeMax} onChange={(v) => set("desiredOvertimeMax", v)} />
          <F label="転勤" value={d.desiredTransfer} onChange={(v) => set("desiredTransfer", v)} />
        </div>
      </div>

      {/* スキル */}
      <div>
        <h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">スキル</h4>
        <div className="grid grid-cols-3 gap-3">
          <F label="自動車免許" value={d.driverLicenseFlag} onChange={(v) => set("driverLicenseFlag", v)} />
          <F label="語学力" value={d.languageSkillFlag} onChange={(v) => set("languageSkillFlag", v)} />
          <F label="語学メモ" value={d.languageSkillMemo} onChange={(v) => set("languageSkillMemo", v)} />
          <F label="日本語力" value={d.japaneseSkillFlag} onChange={(v) => set("japaneseSkillFlag", v)} />
          <F label="タイピング" value={d.typingFlag} onChange={(v) => set("typingFlag", v)} />
          <F label="Excel" value={d.excelFlag} onChange={(v) => set("excelFlag", v)} />
          <F label="Word" value={d.wordFlag} onChange={(v) => set("wordFlag", v)} />
          <F label="PPT" value={d.pptFlag} onChange={(v) => set("pptFlag", v)} />
        </div>
      </div>

      {/* 働き方チェックボックス */}
      <div>
        <h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">働き方</h4>
        <div className="grid grid-cols-3 gap-2">
          {WORK_STYLE_OPTIONS.map((opt) => (
            <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!prefs[opt.key]} onChange={() => togglePref(opt.key)} className="w-3.5 h-3.5 accent-[#2563EB]" />
              <span className="text-[12px] text-[#374151]">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 優先条件 */}
      <div>
        <h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">優先条件</h4>
        <div className="grid grid-cols-3 gap-3">
          <F label="1位" value={d.priorityCondition1} onChange={(v) => set("priorityCondition1", v)} />
          <F label="2位" value={d.priorityCondition2} onChange={(v) => set("priorityCondition2", v)} />
          <F label="3位" value={d.priorityCondition3} onChange={(v) => set("priorityCondition3", v)} />
        </div>
        <div className="mt-2">
          <label className={labelCls}>優先条件メモ</label>
          <textarea value={d.priorityConditionMemo || ""} onChange={(e) => set("priorityConditionMemo", e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (<div><label className={labelCls}>{label}</label><input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>);
}
function Num({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (<div><label className={labelCls}>{label}</label><input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={inputCls} /></div>);
}
