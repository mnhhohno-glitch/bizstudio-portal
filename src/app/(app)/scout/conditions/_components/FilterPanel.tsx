"use client";

// T-194: 左の絞り込みパネル（UI仕様の並び：号機／状態／検索対象／登録日／最終ログイン日／卒業年度／経験社数／希望勤務地／テンプレート種別／実行日）
import {
  AREA_CHIP_MODES,
  COMPANY_COUNT_OPTIONS,
  CONDITION_STATUSES,
  PERIOD_DAYS_OPTIONS,
  REGIST_DATE_MODES,
  SEARCH_TARGETS,
  TEMPLATE_KINDS,
  gradYearOptions,
  summarizePrefectures,
} from "@/lib/scout-conditions/constants";
import type { HolidayMap } from "@/lib/scout-conditions/dates";
import type { MachineDto } from "@/lib/scout-conditions/types";
import { DateField } from "./DateText";
import { MachineChip } from "./MachineLabel";
import type { FilterState } from "./filter";

const CHIP = (selected: boolean) =>
  [
    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
    selected ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#D1D5DB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]",
  ].join(" ");

const SELECT = "w-full rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[#F3F4F6] px-4 py-3">
      <div className="mb-2 text-[12px] font-semibold text-[#374151]">{title}</div>
      {children}
    </div>
  );
}

function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export default function FilterPanel({
  filter,
  onChange,
  machines,
  holidays,
  currentYear,
  count,
  onReset,
  onSearch,
  onOpenPrefModal,
}: {
  filter: FilterState;
  onChange: (next: FilterState) => void;
  machines: MachineDto[];
  holidays: HolidayMap;
  currentYear: number;
  count: number;
  onReset: () => void;
  onSearch: () => void;
  onOpenPrefModal: () => void;
}) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => onChange({ ...filter, [key]: value });
  const years = gradYearOptions(currentYear);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="border-b border-[#E5E7EB] px-4 py-3 text-[14px] font-semibold text-[#374151]">絞り込み</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="号機">
          <div className="flex flex-wrap gap-1.5">
            {machines.map((m) => (
              <MachineChip
                key={m.id}
                machineNo={m.machineNo}
                selected={filter.machineNos.includes(m.machineNo)}
                onClick={() => set("machineNos", toggleIn(filter.machineNos, m.machineNo))}
                disabled={!m.isActive && !filter.machineNos.includes(m.machineNo)}
              />
            ))}
          </div>
        </Section>

        <Section title="状態">
          <div className="flex flex-wrap gap-1.5">
            {CONDITION_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={CHIP(filter.statuses.includes(s.value))}
                onClick={() => set("statuses", toggleIn(filter.statuses, s.value))}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="検索対象（自社が送信した会員）">
          <div className="flex flex-wrap gap-1.5">
            {SEARCH_TARGETS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={CHIP(filter.searchTargets.includes(s.value))}
                onClick={() => set("searchTargets", toggleIn(filter.searchTargets, s.value))}
              >
                {s.label}
                {s.sub && <span className="ml-1 text-[10px] opacity-70">({s.sub})</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section title="登録日">
          <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-[#374151]">
            <label className="flex items-center gap-1">
              <input type="radio" name="f-regist" checked={filter.registMode === ""} onChange={() => set("registMode", "")} />
              指定なし
            </label>
            {REGIST_DATE_MODES.map((m) => (
              <label key={m.value} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="f-regist"
                  checked={filter.registMode === m.value}
                  onChange={() => set("registMode", m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
          {/* 選んだ方だけを表示し、同時には出さない */}
          {filter.registMode === "PERIOD" && (
            <select
              className={SELECT}
              value={filter.registDays ?? ""}
              onChange={(e) => set("registDays", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">すべての期間</option>
              {PERIOD_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}日以内
                </option>
              ))}
            </select>
          )}
          {filter.registMode === "DATE" && (
            <div className="grid grid-cols-2 gap-2">
              <DateField value={filter.registFrom} onChange={(v) => set("registFrom", v)} holidays={holidays} />
              <DateField value={filter.registTo} onChange={(v) => set("registTo", v)} holidays={holidays} />
            </div>
          )}
        </Section>

        <Section title="最終ログイン日">
          <select
            className={SELECT}
            value={filter.lastLoginDays ?? ""}
            onChange={(e) => set("lastLoginDays", e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">指定なし</option>
            {PERIOD_DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}日以内
              </option>
            ))}
          </select>
        </Section>

        <Section title="卒業年度">
          <div className="flex items-center gap-2">
            <select
              className={SELECT}
              value={filter.gradYearFrom ?? ""}
              onChange={(e) => set("gradYearFrom", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">指定なし</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
            <span className="text-[12px] text-[#6B7280]">〜</span>
            <select
              className={SELECT}
              value={filter.gradYearTo ?? ""}
              onChange={(e) => set("gradYearTo", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">指定なし</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="経験社数">
          <select className={SELECT} value={filter.companyCount} onChange={(e) => set("companyCount", e.target.value)}>
            <option value="">指定なし</option>
            {COMPANY_COUNT_OPTIONS.map((o) => (
              <option key={String(o.value)} value={o.value === null ? "null" : String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </Section>

        <Section title="希望勤務地">
          <div className="flex flex-wrap gap-1.5">
            {AREA_CHIP_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={CHIP(filter.areaModes.includes(m.value))}
                onClick={() => set("areaModes", toggleIn(filter.areaModes, m.value))}
              >
                {m.label}
              </button>
            ))}
            <button type="button" className={CHIP(filter.prefectures.length > 0)} onClick={onOpenPrefModal}>
              都道府県指定{filter.prefectures.length > 0 ? `：${summarizePrefectures(filter.prefectures)}` : ""}
            </button>
            {filter.prefectures.length > 0 && (
              <button
                type="button"
                className="text-[11px] text-[#6B7280] underline hover:text-[#374151]"
                onClick={() => set("prefectures", [])}
              >
                解除
              </button>
            )}
          </div>
        </Section>

        <Section title="テンプレート種別">
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className={CHIP(filter.templateKinds.includes(k.value))}
                onClick={() => set("templateKinds", toggleIn(filter.templateKinds, k.value))}
              >
                {k.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="実行日">
          <div className="grid grid-cols-2 gap-2">
            <DateField value={filter.execFrom} onChange={(v) => set("execFrom", v)} holidays={holidays} />
            <DateField value={filter.execTo} onChange={(v) => set("execTo", v)} holidays={holidays} />
          </div>
        </Section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] px-4 py-3">
        <div className="text-[13px] text-[#374151]">
          該当 <span className="text-[16px] font-semibold">{count}</span> 件
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
          >
            リセット
          </button>
          <button
            type="button"
            onClick={onSearch}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
          >
            検索
          </button>
        </div>
      </div>
    </aside>
  );
}
