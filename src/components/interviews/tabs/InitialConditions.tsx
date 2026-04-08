"use client";
import { inputCls, labelCls } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { d: Record<string, any>; set: (k: string, v: any) => void };

export default function InitialConditions({ d, set }: Props) {
  return (
    <div className="space-y-5">
      <Section title="業種">
        <div className="grid grid-cols-3 gap-3">
          <F label="第一希望" value={d.regIndustry1} onChange={(v) => set("regIndustry1", v)} />
          <F label="第二希望" value={d.regIndustry2} onChange={(v) => set("regIndustry2", v)} />
          <F label="第三希望" value={d.regIndustry3} onChange={(v) => set("regIndustry3", v)} />
        </div>
      </Section>
      <Section title="職種">
        <div className="grid grid-cols-3 gap-3">
          <F label="第一希望" value={d.regJobType1} onChange={(v) => set("regJobType1", v)} />
          <F label="第二希望" value={d.regJobType2} onChange={(v) => set("regJobType2", v)} />
          <F label="第三希望" value={d.regJobType3} onChange={(v) => set("regJobType3", v)} />
        </div>
      </Section>
      <Section title="エリア">
        <div className="grid grid-cols-2 gap-3">
          <F label="都道府県" value={d.regAreaPrefecture} onChange={(v) => set("regAreaPrefecture", v)} />
          <F label="市区町村" value={d.regAreaCity} onChange={(v) => set("regAreaCity", v)} />
        </div>
      </Section>
      <Section title="条件">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>雇用形態</label>
            <select value={d.regEmploymentType || ""} onChange={(e) => set("regEmploymentType", e.target.value)} className={inputCls}>
              <option value="">-</option>
              <option value="正社員">正社員</option>
              <option value="契約社員">契約社員</option>
              <option value="派遣社員">派遣社員</option>
              <option value="パート">パート</option>
            </select>
          </div>
          <Num label="年収下限（万円）" value={d.regSalaryMin} onChange={(v) => set("regSalaryMin", v)} />
          <Num label="年収上限（万円）" value={d.regSalaryMax} onChange={(v) => set("regSalaryMax", v)} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <F label="休日" value={d.regHolidays} onChange={(v) => set("regHolidays", v)} />
          <F label="残業" value={d.regOvertime} onChange={(v) => set("regOvertime", v)} />
          <F label="仕事の特徴" value={d.regJobFeatures} onChange={(v) => set("regJobFeatures", v)} />
          <F label="会社の特徴" value={d.regCompanyFeatures} onChange={(v) => set("regCompanyFeatures", v)} />
        </div>
      </Section>
      <Section title="フリーメモ">
        <textarea value={d.regFreeMemo || ""} onChange={(e) => set("regFreeMemo", e.target.value)} rows={4} className={inputCls} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div><h4 className="text-[13px] font-bold text-[#374151] mb-2 border-b pb-1">{title}</h4>{children}</div>);
}
function F({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (<div><label className={labelCls}>{label}</label><input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputCls} /></div>);
}
function Num({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (<div><label className={labelCls}>{label}</label><input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={inputCls} /></div>);
}
