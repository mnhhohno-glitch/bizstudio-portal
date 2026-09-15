"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  DefaultZIndexes,
} from "recharts";
import { WEEKDAY_JA } from "@/lib/scout-conditions/dates";

// T-135 T-B: スカウトダッシュボード専用の推移グラフ（analytics とは独立）。
// 棒=配信数・応募数（左軸・件数）／ 折れ線=応募率（右軸・％）。
// 比較系列（前月/前年）は同色の半透明＋点線で重ね描き。
// 応募率は「配信数0 の点は null（0%ではなく欠損）」として線を切る（0%と配信なしの混同防止）。
//
// 応募数の軸の扱い（実装判断=(a)）: 応募数は配信数より2桁小さいため左軸では棒が小さく見えるが、
// 右軸の応募率ラインが応募パフォーマンスを可視化し、正確な応募件数は Tooltip で読める。
// シンプル優先で応募数も左軸の棒に置く（(a)）。
//
// T-198: 日別のときだけ横軸に曜日を出す（「1日(月)」）。土曜=薄い青・日曜=薄い赤の背景を棒／線より下のレイヤーに敷く。
// 曜日は page.tsx がサーバー由来の JST 日付（YYYY-MM-DD）から算出して weekday（0=日…6=土）で渡す。
// 比較表示（前月/前年）でも背景色は表示中の月の曜日のまま（weekday は主系列の日付から作るため自動的にそうなる）。

export type TrendPoint = {
  label: string;
  /** 0=日 … 6=土。日別のときだけ入る（時間別・月別は null） */
  weekday: number | null;
  delivery: number | null;
  apply: number | null;
  applyRate: number | null;
  cmpDelivery: number | null;
  cmpApply: number | null;
  cmpApplyRate: number | null;
};

export type Comparison = "none" | "prevMonth" | "prevYear";
export type Unit = "day" | "hour" | "month";

const COLOR = {
  delivery: "#2563EB",
  apply: "#16A34A",
  rate: "#EA580C",
};

const CMP_LABEL: Record<Exclude<Comparison, "none">, string> = {
  prevMonth: "前月",
  prevYear: "前年",
};

/** 土曜=薄い青 / 日曜=薄い赤。棒・線の視認性を損なわない濃さに抑える */
const WEEKEND_FILL: Record<number, string> = { 6: "#2563EB", 0: "#DC2626" };
const WEEKEND_OPACITY = 0.07;

function unitSuffix(unit: Unit): string {
  return unit === "day" ? "日" : unit === "hour" ? "時" : "月";
}

export default function ScoutTrendChart({
  data,
  comparison,
  unit,
}: {
  data: TrendPoint[];
  comparison: Comparison;
  unit: Unit;
}) {
  const showCmp = comparison !== "none";
  const cmpName = showCmp ? CMP_LABEL[comparison] : "";
  const suffix = unitSuffix(unit);

  // T-198: ラベル → 曜日。日別のときだけ中身が入る
  const weekdayByLabel = new Map<string, number>();
  if (unit === "day") for (const d of data) if (d.weekday != null) weekdayByLabel.set(d.label, d.weekday);
  const weekendPoints = unit === "day" ? data.filter((d) => d.weekday === 0 || d.weekday === 6) : [];

  const formatTick = (v: string) => {
    const wd = weekdayByLabel.get(v);
    return wd == null ? `${v}${suffix}` : `${v}${suffix}(${WEEKDAY_JA[wd]})`;
  };

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
        {/* T-198: 土日の帯。zIndex を棒・線より下（グリッドと棒背景の間）に固定する */}
        {weekendPoints.map((d) => (
          <ReferenceArea
            key={`weekend-${d.label}`}
            x1={d.label}
            x2={d.label}
            yAxisId="count"
            zIndex={DefaultZIndexes.barBackground - 10}
            fill={WEEKEND_FILL[d.weekday as 0 | 6]}
            fillOpacity={WEEKEND_OPACITY}
            stroke="none"
            ifOverflow="visible"
          />
        ))}
        <XAxis
          dataKey="label"
          tick={{ fontSize: unit === "day" ? 11 : 12, fill: "#6B7280" }}
          tickFormatter={formatTick}
          {...(unit === "day"
            ? { interval: 0 as const, angle: -40, textAnchor: "end" as const, height: 52 }
            : {})}
        />
        {/* 左軸: 件数 */}
        <YAxis
          yAxisId="count"
          tick={{ fontSize: 12, fill: "#6B7280" }}
          allowDecimals={false}
          label={{ value: "件数", angle: -90, position: "insideLeft", fontSize: 11, fill: "#9CA3AF" }}
        />
        {/* 右軸: 応募率(%) */}
        <YAxis
          yAxisId="rate"
          orientation="right"
          tick={{ fontSize: 12, fill: "#6B7280" }}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, "auto"]}
          label={{ value: "応募率", angle: 90, position: "insideRight", fontSize: 11, fill: "#9CA3AF" }}
        />
        <Tooltip
          formatter={(value, name) => {
            const n = String(name);
            const v = typeof value === "number" ? value : null;
            if (v == null) return ["—", n];
            return n.includes("応募率") ? [`${v.toFixed(2)}%`, n] : [v.toLocaleString(), n];
          }}
          labelFormatter={(label) => formatTick(String(label))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />

        {/* 比較系列（背面に半透明で重ねるため先に描画） */}
        {showCmp && (
          <Bar yAxisId="count" dataKey="cmpDelivery" name={`${cmpName}配信数`} fill={COLOR.delivery} fillOpacity={0.28} />
        )}
        {showCmp && (
          <Bar yAxisId="count" dataKey="cmpApply" name={`${cmpName}応募数`} fill={COLOR.apply} fillOpacity={0.28} />
        )}

        {/* 主系列（棒） */}
        <Bar yAxisId="count" dataKey="delivery" name="配信数" fill={COLOR.delivery} />
        <Bar yAxisId="count" dataKey="apply" name="応募数" fill={COLOR.apply} />

        {/* 比較の応募率（点線・半透明） */}
        {showCmp && (
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="cmpApplyRate"
            name={`${cmpName}応募率`}
            stroke={COLOR.rate}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeOpacity={0.55}
            dot={false}
            connectNulls={false}
          />
        )}

        {/* 主系列の応募率（右軸・実線・配信0はnullで線を切る） */}
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="applyRate"
          name="応募率"
          stroke={COLOR.rate}
          strokeWidth={2}
          dot={{ r: 2 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
