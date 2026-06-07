"use client";

// T-069 日報①：日報タブの本体。
// 上段＝スケジュール予定｜実績(完了)｜明日の予定。
// 下段＝当日実績(当月と同項目)｜縦棒+円4種｜所感2欄(気づき/振り返り)。
// 前日/翌日ナビ＋?date= 連動。集計は /api/daily-report?date=（computeWeeklyMatrix・両ソース統合・MIN方式を流用）。
// ②LINE通知・③AI壁打ちは別タスク。所感は CA×日付で素直に保存（AIに渡せる構造）。

import { useState, useEffect, useCallback, useRef } from "react";

type CUP = { recs: number; uniq: number; perPerson: number | null };
type DayMatrix = {
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: CUP; existing: CUP; total: CUP };
  entry: { fresh: CUP; existing: CUP; total: CUP };
  selection: { documentPass: number; offer: number; acceptance: number; decidedRevenue: number | null; decidedUnitPrice: number | null };
};
type Attr = Record<string, number>;
type JobSearch = { bmCount: number; exportCount: number; ratings: Attr; selectionRate: number | null };
type SchedEntry = { id: string; startTime: string; endTime: string; title: string; tag: string | null; tagColor: string | null; isCompleted: boolean };
type Report = { scheduleNote: string | null; metricsReflection: string | null; status: string } | null;
type Resp = {
  date: string;
  tomorrowDate: string;
  format: string;
  report: Report;
  scheduleSummary: { plannedCount: number; completedCount: number };
  scheduleEntries: SchedEntry[];
  tomorrowEntries: SchedEntry[];
  dayMatrix: DayMatrix | null;
  attributes: { total: number; rank: Attr; gender: Attr; jobType: Attr; ageBand: Attr } | null;
  jobSearch: JobSearch | null;
};

const numFmt = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const yenFmt = (v: number | null | undefined) => (v == null ? "—" : `¥${Math.round(v).toLocaleString()}`);

// 当日実績の行（当月実績タブと同項目・当日値）。
type MRow = { label: string; band?: boolean; value: (m: DayMatrix) => number | null; fmt?: (v: number | null) => string };
const ROWS: MRow[] = [
  { label: "初回面談", value: (m) => m.interview.first },
  { label: "求人面談（2回目）", value: (m) => m.interview.second },
  { label: "既存面談（3回目以降）", value: (m) => m.interview.thirdPlus },
  { label: "合計面談", band: true, value: (m) => m.interview.total },
  { label: "初回提案", value: (m) => m.proposal.fresh.uniq },
  { label: "既存提案", value: (m) => m.proposal.existing.uniq },
  { label: "合計提案", band: true, value: (m) => m.proposal.total.uniq },
  { label: "新規エントリー", value: (m) => m.entry.fresh.uniq },
  { label: "既存エントリー", value: (m) => m.entry.existing.uniq },
  { label: "合計エントリー", band: true, value: (m) => m.entry.total.uniq },
  { label: "書類通過", value: (m) => m.selection.documentPass },
  { label: "内定", value: (m) => m.selection.offer },
  { label: "決定", band: true, value: (m) => m.selection.acceptance },
  { label: "決定売上", value: (m) => m.selection.decidedRevenue, fmt: yenFmt },
  { label: "売上単価", value: (m) => m.selection.decidedUnitPrice, fmt: yenFmt },
];

// ===== Chart.js（cdnjs UMD・一度だけ注入） =====
let chartJsPromise: Promise<void> | null = null;
function loadChartJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Chart) return Promise.resolve();
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Chart.js load failed"));
    document.head.appendChild(s);
  });
  return chartJsPromise;
}

const RANK_ORDER = ["A+", "A", "B+", "B", "C", "D", "未評価"];
const RANK_COLORS: Record<string, string> = { "A+": "#15803D", A: "#22C55E", "B+": "#0891B2", B: "#2563EB", C: "#F59E0B", D: "#EF4444", 未評価: "#9CA3AF" };
const GENDER_ORDER = ["female", "male", "other", "未設定"];
const GENDER_LABELS: Record<string, string> = { female: "女", male: "男", other: "その他", 未設定: "未設定" };
const GENDER_COLORS: Record<string, string> = { female: "#EC4899", male: "#3B82F6", other: "#A78BFA", 未設定: "#9CA3AF" };
const AGE_ORDER = ["20代前半", "20代後半", "30代前半", "30代後半", "40代前半", "45歳以上", "不明"];
const AGE_COLORS: Record<string, string> = { "20代前半": "#60A5FA", "20代後半": "#3B82F6", "30代前半": "#22C55E", "30代後半": "#16A34A", "40代前半": "#F59E0B", "45歳以上": "#EF4444", 不明: "#9CA3AF" };
// 求人検索 aiMatchRating（A=好評価→D=要再検討）。選定率は A+B+C÷合計。
const RATING_ORDER = ["A", "B", "C", "D", "未評価"];
const RATING_COLORS: Record<string, string> = { A: "#16A34A", B: "#22C55E", C: "#F59E0B", D: "#EF4444", 未評価: "#9CA3AF" };
function todayJst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}
function shiftDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const nd = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
}
function mdLabel(dateStr: string): string { const [, m, d] = dateStr.split("-"); return `${parseInt(m)}/${parseInt(d)}`; }

export default function DailyReportView() {
  const [date, setDate] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("date");
      if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
    }
    return todayJst();
  });
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [scheduleNote, setScheduleNote] = useState("");
  const [metricsReflection, setMetricsReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // ?date= をURLに反映（②直リンクの土台）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState(null, "", url.toString());
  }, [date]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/daily-report?date=${date}`);
      if (res.ok) {
        const d: Resp = await res.json();
        setData(d);
        setScheduleNote(d.report?.scheduleNote ?? "");
        setMetricsReflection(d.report?.metricsReflection ?? "");
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg("");
    try {
      const res = await fetch("/api/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, scheduleNote, metricsReflection }),
      });
      if (res.ok) { setSavedMsg("保存しました"); setTimeout(() => setSavedMsg(""), 2000); }
      else setSavedMsg("保存に失敗しました");
    } catch { setSavedMsg("保存に失敗しました"); } finally { setSaving(false); }
  };

  const planned = data?.scheduleSummary.plannedCount ?? 0;
  const completed = data?.scheduleSummary.completedCount ?? 0;
  const rate = planned > 0 ? Math.round((completed / planned) * 100) : null;

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* ヘッダ：前日/翌日ナビ＋右上に保存（②で「下書き｜提出」を並べる予定の配置） */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E7EB]">
        <h2 className="text-[14px] font-medium text-[#374151]">📝 日報</h2>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => setDate(shiftDate(date, -1))} className="px-2 py-1 text-[13px] border border-gray-200 rounded hover:bg-gray-50">←前日</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="text-[13px] border border-gray-200 rounded px-2 py-1" />
          <button onClick={() => setDate(shiftDate(date, 1))} className="px-2 py-1 text-[13px] border border-gray-200 rounded hover:bg-gray-50">翌日→</button>
          <button onClick={() => setDate(todayJst())} className="px-2 py-1 text-[12px] text-[#2563EB] hover:underline">今日</button>
        </div>
        {loading && <span className="text-[12px] text-[#9CA3AF]">読み込み中...</span>}
        <div className="ml-auto flex items-center gap-2">
          {savedMsg && <span className="text-[12px] text-green-600">{savedMsg}</span>}
          <button onClick={handleSave} disabled={saving} className="bg-[#16A34A] text-white rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50">
            {saving ? "保存中..." : "💾 保存"}
          </button>
        </div>
      </div>

      {/* 上段：スケジュール 予定｜実績(完了)｜明日 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4 border-b border-[#E5E7EB]">
        <SchedCol title="スケジュール予定" entries={data?.scheduleEntries ?? []} />
        <SchedCol
          title={`スケジュール実績（完了 ${completed}/${planned}${rate != null ? ` ・${rate}%` : ""}）`}
          entries={(data?.scheduleEntries ?? []).filter((e) => e.isCompleted)}
          emptyText="完了した予定がありません"
        />
        <SchedCol title={`明日の予定（${data ? mdLabel(data.tomorrowDate) : ""}）`} entries={data?.tomorrowEntries ?? []} emptyText="明日の予定は未登録です" />
      </div>

      {/* 下段：当日実績｜グラフ｜所感 */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] gap-4 p-4">
        {/* 当日実績 */}
        <div>
          <div className="text-[12px] font-medium text-[#374151] mb-2">当日実績（{mdLabel(date)}）</div>
          {data?.dayMatrix ? (
            <table className="w-full text-[12px] border border-[#E5E7EB] rounded">
              <tbody className="divide-y divide-[#F3F4F6]">
                {ROWS.map((r) => (
                  <tr key={r.label} className={r.band ? "bg-[#FFF4E6]" : ""}>
                    <td className="px-2 py-1.5 text-[#374151]">{r.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium text-[#374151]">
                      {r.fmt ? r.fmt(r.value(data.dayMatrix!)) : numFmt(r.value(data.dayMatrix!))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[12px] text-[#9CA3AF] py-4">当日実績は CA のみ表示されます。</div>
          )}
        </div>

        {/* グラフ */}
        <div>
          {data?.dayMatrix && data.attributes ? (
            <DailyCharts matrix={data.dayMatrix} attributes={data.attributes} jobSearch={data.jobSearch} />
          ) : (
            <div className="text-[12px] text-[#9CA3AF] py-4">グラフは CA のみ表示されます。</div>
          )}
        </div>

        {/* 所感（円グラフが3種になった分、縦幅を拡大） */}
        <div className="flex flex-col gap-3 h-full">
          <div className="flex-1 flex flex-col min-h-[200px]">
            <div className="text-[12px] font-medium text-[#374151] mb-1">当日のスケジュールに関する気づき</div>
            <textarea
              value={scheduleNote}
              onChange={(e) => setScheduleNote(e.target.value)}
              placeholder="予定通りに行かなかった内容についてわかりやすく記載してください"
              className="flex-1 w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] resize-y min-h-[180px]"
            />
          </div>
          <div className="flex-1 flex flex-col min-h-[200px]">
            <div className="text-[12px] font-medium text-[#374151] mb-1">当日の数字に対する振り返り</div>
            <textarea
              value={metricsReflection}
              onChange={(e) => setMetricsReflection(e.target.value)}
              placeholder="当日の実績数字を見ての気づき・次への改善などを記載してください"
              className="flex-1 w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] resize-y min-h-[180px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SchedCol({ title, entries, emptyText }: { title: string; entries: SchedEntry[]; emptyText?: string }) {
  return (
    <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
      <div className="bg-[#3C3C3C] text-white px-3 py-1.5 text-[12px] font-medium">{title}</div>
      <div className="max-h-[220px] overflow-y-auto divide-y divide-[#F3F4F6]">
        {entries.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-[#9CA3AF] text-center">{emptyText ?? "予定がありません"}</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
              <span className="tabular-nums text-[#6B7280] shrink-0">{e.startTime}</span>
              {e.isCompleted && <span className="text-green-600 shrink-0">✓</span>}
              <span className="text-[#374151] truncate">{e.title}</span>
              {e.tag && <span className="ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: e.tagColor ?? "#E5E7EB", color: "#374151" }}>{e.tag}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DailyCharts({ matrix, attributes, jobSearch }: { matrix: DayMatrix; attributes: { total: number; rank: Attr; gender: Attr; jobType: Attr; ageBand: Attr }; jobSearch: JobSearch | null }) {
  const barRef = useRef<HTMLCanvasElement>(null);
  const jobBarRef = useRef<HTMLCanvasElement>(null);
  const rankRef = useRef<HTMLCanvasElement>(null);
  const genderRef = useRef<HTMLCanvasElement>(null);
  const ageRef = useRef<HTMLCanvasElement>(null);
  const ratingRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charts = useRef<any[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => { loadChartJs().then(() => setReady(true)).catch(() => {}); }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Chart = typeof window !== "undefined" ? (window as any).Chart : null;
    if (!ready || !Chart) return;
    const fg = barRef.current ? getComputedStyle(barRef.current).color : "#374151";
    const grid = "rgba(148,163,184,0.25)";
    charts.current.forEach((c) => c?.destroy());
    charts.current = [];

    // 棒の上に数値を描く inline プラグイン（datalabels 不使用）。
    const barValuePlugin = {
      id: "barValue",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      afterDatasetsDraw(chart: any) {
        const { ctx } = chart;
        chart.data.datasets.forEach((ds: { data: number[] }, di: number) => {
          const meta = chart.getDatasetMeta(di);
          meta.data.forEach((bar: { x: number; y: number }, i: number) => {
            const v = ds.data[i];
            if (v == null) return;
            ctx.save();
            ctx.fillStyle = fg;
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(String(v), bar.x, bar.y - 4);
            ctx.restore();
          });
        });
      },
    };

    // 縦棒：当日の主要4項目（初回面談・既存面談・紹介・エントリー）。
    // 既存面談 = 求人面談(2回目) + 既存面談(3回目以降)。書類通過以降は日々頻繁でないため除外。
    // 棒同士は隙間ゼロの箱型（barPercentage=1.0・categoryPercentage=1.0・borderWidth で区切り）。
    if (barRef.current) {
      const existingInterview = matrix.interview.second + matrix.interview.thirdPlus;
      charts.current.push(new Chart(barRef.current, {
        type: "bar",
        data: {
          labels: ["初回面談", "既存面談", "紹介", "エントリー"],
          datasets: [{
            label: "当日件数",
            data: [matrix.interview.first, existingInterview, matrix.proposal.total.uniq, matrix.entry.total.uniq],
            backgroundColor: ["#2563EB", "#0891B2", "#22C55E", "#F59E0B"],
            borderColor: "#ffffff",
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 16 } },
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: fg, font: { size: 11 } }, grid: { color: grid, display: false } }, y: { beginAtZero: true, ticks: { color: fg, precision: 0 }, grid: { color: grid } } },
        },
        plugins: [barValuePlugin],
      }));
    }

    // 求人検索の行動量：BM数（求人紹介数）・出力数（提案数）。面談系とは桁が違うため別グラフ。棒上に数値。
    if (jobBarRef.current && jobSearch) {
      charts.current.push(new Chart(jobBarRef.current, {
        type: "bar",
        data: {
          labels: ["BM数", "出力数"],
          datasets: [{
            label: "件数",
            data: [jobSearch.bmCount, jobSearch.exportCount],
            backgroundColor: ["#2563EB", "#F59E0B"],
            borderColor: "#ffffff",
            borderWidth: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          layout: { padding: { top: 16 } },
          plugins: { legend: { display: false } },
          scales: { x: { ticks: { color: fg, font: { size: 11 } }, grid: { color: grid, display: false } }, y: { beginAtZero: true, ticks: { color: fg, precision: 0 }, grid: { color: grid } } },
        },
        plugins: [barValuePlugin],
      }));
    }

    const buildPie = (el: HTMLCanvasElement | null, map: Attr, order: string[] | null, colorOf: (k: string, i: number) => string, labelOf: (k: string) => string) => {
      if (!el) return;
      const keys = order ? order.filter((k) => (map[k] ?? 0) > 0) : Object.keys(map).filter((k) => map[k] > 0).sort((a, b) => map[b] - map[a]);
      if (keys.length === 0) return;
      const total = keys.reduce((s, k) => s + map[k], 0);
      charts.current.push(new Chart(el, {
        type: "doughnut",
        data: { labels: keys.map(labelOf), datasets: [{ data: keys.map((k) => map[k]), backgroundColor: keys.map((k, i) => colorOf(k, i)), borderWidth: 1, borderColor: "#fff" }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: fg, boxWidth: 10, font: { size: 10 } } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tooltip: { callbacks: { label: (ctx: any) => `${ctx.label}: ${ctx.parsed}件 (${total ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)` } },
          },
        },
      }));
    };
    buildPie(rankRef.current, attributes.rank, RANK_ORDER, (k) => RANK_COLORS[k] ?? "#9CA3AF", (k) => k);
    buildPie(genderRef.current, attributes.gender, GENDER_ORDER, (k) => GENDER_COLORS[k] ?? "#9CA3AF", (k) => GENDER_LABELS[k] ?? k);
    buildPie(ageRef.current, attributes.ageBand, AGE_ORDER, (k) => AGE_COLORS[k] ?? "#9CA3AF", (k) => k);
    if (jobSearch) buildPie(ratingRef.current, jobSearch.ratings, RATING_ORDER, (k) => RATING_COLORS[k] ?? "#9CA3AF", (k) => k);

    return () => { charts.current.forEach((c) => c?.destroy()); charts.current = []; };
  }, [ready, matrix, attributes, jobSearch]);

  const n = attributes.total;
  const pie = (title: string, ref: { current: HTMLCanvasElement | null }, has: boolean) => (
    <div className="flex-1 min-w-[180px]">
      <div className="text-[11px] font-medium text-[#374151] mb-1">{title}</div>
      <div className="h-[160px]">{has ? <canvas ref={ref} /> : <div className="h-full flex items-center justify-center text-[11px] text-[#9CA3AF]">データなし</div>}</div>
    </div>
  );
  const selPct = jobSearch?.selectionRate != null ? `${(jobSearch.selectionRate * 100).toFixed(1)}%` : "—";

  return (
    <div className="space-y-4">
      {/* 行動量：当日の各段階数（面談系）｜求人検索（BM/出力）を隣に */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[#374151] mb-2">当日の各段階数</div>
          <div className="h-[200px]"><canvas ref={barRef} /></div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[#374151] mb-2 flex items-center gap-2">
            求人検索（BM/出力）
            <span className="ml-auto text-[11px] font-normal text-[#6B7280]">選定率 <span className="text-[15px] font-bold text-[#2563EB]">{selPct}</span></span>
          </div>
          <div className="h-[200px]"><canvas ref={jobBarRef} /></div>
        </div>
      </div>
      {/* 精度：求人検索の総合評価（ABCD）＋ 初回面談者属性 */}
      <div>
        <div className="text-[12px] font-medium text-[#374151] mb-2">当日の精度・属性</div>
        <div className="flex flex-wrap gap-3">
          {pie(`求人ABCD（選定率${selPct}）`, ratingRef, !!jobSearch && jobSearch.bmCount > 0)}
          {pie("ランク", rankRef, n > 0)}
          {pie("男女比", genderRef, n > 0)}
          {pie("年代", ageRef, n > 0)}
        </div>
        <div className="mt-1 text-[10px] text-[#9CA3AF]">求人ABCD＝当日BM（紹介保留含む）の aiMatchRating 構成比。選定率＝(A+B+C)÷合計BM（D・未評価除外）。ランク/男女比/年代＝当日の初回面談者{n}人。</div>
      </div>
    </div>
  );
}
