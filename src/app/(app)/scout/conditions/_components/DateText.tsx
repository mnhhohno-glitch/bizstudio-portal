"use client";

// T-194: 日付表示の共通部品。すべての日付に曜日を付け、土曜=青／日曜・祝日=赤、祝日はホバーで名称。
import {
  dayColorClass,
  dayKind,
  formatYmdShort,
  formatYmdWithWeekday,
  instantToJstDateTime,
  instantToJstYmd,
  ymdWeekdayLabel,
  type HolidayMap,
} from "@/lib/scout-conditions/dates";

export function DateText({
  ymd,
  holidays,
  short = false,
  className = "",
}: {
  ymd: string | null | undefined;
  holidays: HolidayMap;
  short?: boolean;
  className?: string;
}) {
  if (!ymd) return <span className={`text-[#9CA3AF] ${className}`}>-</span>;
  const kind = dayKind(ymd, holidays);
  const name = holidays[ymd];
  return (
    <span
      className={`${dayColorClass(kind)} ${className}`}
      title={name ? `${formatYmdWithWeekday(ymd)} ${name}` : formatYmdWithWeekday(ymd)}
    >
      {short ? formatYmdShort(ymd) : formatYmdWithWeekday(ymd)}
      {name ? <span className="ml-0.5 rounded bg-[#FEE2E2] px-1 text-[10px] text-[#B91C1C]">祝</span> : null}
    </span>
  );
}

/** 真の instant（ISO）を JST の「YYYY-MM-DD(曜) HH:mm」で表示 */
export function DateTimeText({
  iso,
  holidays,
  className = "",
}: {
  iso: string | null | undefined;
  holidays: HolidayMap;
  className?: string;
}) {
  if (!iso) return <span className={`text-[#9CA3AF] ${className}`}>-</span>;
  const ymd = instantToJstYmd(iso);
  const time = instantToJstDateTime(iso).slice(11);
  return (
    <span className={className}>
      <DateText ymd={ymd} holidays={holidays} />
      <span className="ml-1 text-[#374151]">{time}</span>
    </span>
  );
}

/** 日付入力欄の下に出す「選んだ日の曜日・祝日名」 */
export function DateNote({ ymd, holidays }: { ymd: string; holidays: HolidayMap }) {
  if (!ymd) return <div className="mt-0.5 h-[14px] text-[11px] text-[#9CA3AF]">&nbsp;</div>;
  const kind = dayKind(ymd, holidays);
  const name = holidays[ymd];
  return (
    <div className={`mt-0.5 text-[11px] ${dayColorClass(kind) || "text-[#6B7280]"}`}>
      {ymdWeekdayLabel(ymd)}曜日{name ? `・${name}` : ""}
    </div>
  );
}

/** type=date 入力＋曜日/祝日ノート */
export function DateField({
  value,
  onChange,
  holidays,
  className = "",
  min,
  max,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  holidays: HolidayMap;
  className?: string;
  min?: string;
  max?: string;
  /** T-201: 実績のある条件など編集させない行でグレーアウトする */
  disabled?: boolean;
}) {
  return (
    <div className={className}>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] text-[#374151] disabled:cursor-not-allowed disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF]"
      />
      <DateNote ymd={value} holidays={holidays} />
    </div>
  );
}
