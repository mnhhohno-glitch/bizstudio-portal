"use client";

// T-069 日報①：日報タブの本体。
// 上段＝スケジュール予定｜実績(完了)｜明日の予定。
// 下段＝当日実績(当月と同項目)｜縦棒+円4種｜所感2欄(気づき/振り返り)。
// 前日/翌日ナビ＋?date= 連動。集計は /api/daily-report?date=（computeWeeklyMatrix・両ソース統合・MIN方式を流用）。
// ②LINE通知・③AI壁打ちは別タスク。所感は CA×日付で素直に保存（AIに渡せる構造）。

import { useState, useEffect, useCallback, useRef } from "react";
import ScheduleEntryFormModal, { type EditEntryData } from "@/components/schedule/ScheduleEntryFormModal";
import ScheduleChatDrawer from "@/components/schedule/ScheduleChatDrawer";
import CalendarConnectButton from "@/components/schedule/CalendarConnectButton";

type CUP = { recs: number; uniq: number; perPerson: number | null };
type DayMatrix = {
  interview: { first: number; second: number; thirdPlus: number; total: number };
  proposal: { fresh: CUP; existing: CUP; total: CUP };
  entry: { fresh: CUP; existing: CUP; total: CUP };
  selection: { documentPass: number; offer: number; acceptance: number; decidedRevenue: number | null; decidedUnitPrice: number | null };
};
type Attr = Record<string, number>;
type JobSearch = { bmCount: number; exportCount: number; ratings: Attr; selectionRate: number | null };
type SchedEntry = { id: string; startTime: string; endTime: string; title: string; note?: string | null; tag: string | null; tagColor: string | null; isCompleted: boolean; sortOrder?: number };
type Schedule = { id: string; date: string; summary: string | null; status: string; entries: SchedEntry[] };
type Report = { reportBody: string | null; commentConfirmedAt: string | null; status: string } | null;
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
function mdJpLabel(dateStr: string): string { const [, m, d] = dateStr.split("-"); return `${parseInt(m)}月${parseInt(d)}日`; }

// 新規（未記入）の日にコメント入力を開いたときの定型文。
// 各見出しの下に空行3つを入れて、記入スペースを広く確保する。
const COMMENT_TEMPLATE = [
  "■1. スケジュール予定実施率（　％）",
  "（予定と実際の行動結果に関する乖離理由やコメントを記載）",
  "", "", "",
  "■2. 今日やったこと（事実・実績）",
  "", "", "",
  "■3. うまくいった点・工夫（気づき）",
  "", "", "",
  "■4. 難しかった点・課題（改善点）",
  "", "", "",
  "■5. 感じたこと（成長・感情）",
  "", "", "",
  "■6. 次にやること（アクション）",
  "", "", "",
].join("\n");

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
  const [body, setBody] = useState(""); // 統合コメント本文（reportBody）
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null); // コメント確定日時
  const [submitting, setSubmitting] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [accordionOpen, setAccordionOpen] = useState(false); // 右コメント入力パネル
  const [modalOpen, setModalOpen] = useState(false); // 中央コメント表示・編集
  // AIアシスト会話
  const [aiMessages, setAiMessages] = useState<{ role: "user" | "assistant"; content: string; advice?: string; rewrittenBody?: string }[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  // スケジュール（上段予定枠で作成・編集・完了。既存 /api/schedule・モーダル/ドロワーを再利用）
  const [sched, setSched] = useState<Schedule | null>(null);
  // T-082: 明日の DailySchedule（id + entries）を当日とは別に持つ。
  // ＋追加/AI/同期 が今日の scheduleId に紐付くと当日実績の母数に明日予定が混入するため、
  // 明日操作は必ず tomorrowSched.id へルーティングする。
  const [tomorrowSched, setTomorrowSched] = useState<Schedule | null>(null);
  const [calConnected, setCalConnected] = useState(false);
  const [calEvents, setCalEvents] = useState<{ id: string; summary: string; start: string; end: string }[]>([]);
  // T-082: モーダル/ドロワーは今日/明日のどちらに対する操作かを target で持つ。
  const [entryModalTarget, setEntryModalTarget] = useState<"today" | "tomorrow" | null>(null);
  const [editingEntry, setEditingEntry] = useState<EditEntryData | null>(null);
  const [aiDrawerTarget, setAiDrawerTarget] = useState<"today" | "tomorrow" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingTomorrow, setSyncingTomorrow] = useState(false);

  // 最新値・dirty・debounce を ref で保持（離脱前/日付移動の即時保存・クロージャ対策）。
  const bodyRef = useRef(body); bodyRef.current = body;
  const dateRef = useRef(date); dateRef.current = date;
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitted = data?.report?.status === "SUBMITTED";
  const confirmed = confirmedAt != null;

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
        setBody(d.report?.reportBody ?? "");
        setConfirmedAt(d.report?.commentConfirmedAt ?? null);
        dirtyRef.current = false; // ロード直後は未編集
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // スケジュール（予定・実績）取得。既存 /api/schedule?date= を流用（schedule.id・entries）。
  // T-082: 明日の DailySchedule も同時に取得（明日操作を tomorrowSched.id にルーティングするため）。
  const fetchSchedule = useCallback(async () => {
    try {
      const tomorrowStr = shiftDate(date, 1);
      const [t, m] = await Promise.all([
        fetch(`/api/schedule?date=${date}`),
        fetch(`/api/schedule?date=${tomorrowStr}`),
      ]);
      if (t.ok) setSched((await t.json()).schedule ?? null);
      if (m.ok) setTomorrowSched((await m.json()).schedule ?? null);
    } catch { /* */ }
  }, [date]);
  const fetchCalendar = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar/events?date=${date}`);
      if (res.ok) { const d = await res.json(); setCalConnected(!!d.connected); setCalEvents(d.events ?? []); }
    } catch { /* */ }
  }, [date]);
  useEffect(() => { void fetchSchedule(); void fetchCalendar(); }, [fetchSchedule, fetchCalendar]);

  // schedule が無ければ空で作成して id を返す（手動追加・既存 handleOpenAddModal と同じ）。
  // T-082: 今日/明日 target で対象 DailySchedule を確保。明日操作は tomorrowSched に紐付けて
  // 今日の DailySchedule に明日予定が混入することを防ぐ。
  const ensureSchedule = async (target: "today" | "tomorrow"): Promise<string | null> => {
    const cur = target === "today" ? sched : tomorrowSched;
    if (cur) return cur.id;
    const targetDate = target === "today" ? date : shiftDate(date, 1);
    try {
      const res = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: targetDate, entries: [] }) });
      if (res.ok) { const s = (await res.json()).schedule; await fetchSchedule(); return s?.id ?? null; }
    } catch { /* */ }
    return null;
  };
  const handleAddEntry = async (target: "today" | "tomorrow" = "today") => {
    const id = await ensureSchedule(target);
    if (id) { setEditingEntry(null); setEntryModalTarget(target); }
  };
  const handleEditEntry = (e: SchedEntry, target: "today" | "tomorrow" = "today") => {
    setEditingEntry({ id: e.id, startTime: e.startTime, endTime: e.endTime, title: e.title, note: e.note, tag: e.tag ?? "", tagColor: e.tagColor ?? "#6B7280" });
    setEntryModalTarget(target);
  };
  const handleDeleteEntry = async (id: string) => { if (!confirm("この予定を削除しますか？")) return; try { await fetch(`/api/schedule/entry/${id}`, { method: "DELETE" }); fetchSchedule(); } catch { /* */ } };
  const handleToggleComplete = async (e: SchedEntry) => {
    // 楽観更新（target ＝ 今日のみ：明日は未来予定なので完了チェックは出さない）
    setSched((s) => (s ? { ...s, entries: s.entries.map((x) => (x.id === e.id ? { ...x, isCompleted: !x.isCompleted } : x)) } : s));
    try {
      await fetch(`/api/schedule/entry/${e.id}/complete`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isCompleted: !e.isCompleted }) });
    } catch { fetchSchedule(); }
  };
  // AI作成の保存（既存 SchedulePanel.handleAiSave と同じ：有→PUT、無→POST）。
  // T-082: target に応じて対象 DailySchedule（今日 sched / 明日 tomorrowSched）に保存。
  const handleAiSave = async (target: "today" | "tomorrow", entries: { startTime: string; endTime: string; title: string; note?: string | null; tag: string; tagColor: string; sortOrder: number }[], summary: string) => {
    const formatted = entries.map((e, i) => ({ startTime: e.startTime, endTime: e.endTime, title: e.title, note: e.note || null, tag: e.tag, tagColor: e.tagColor, entryType: "AI_GENERATED", sortOrder: e.sortOrder ?? i }));
    const cur = target === "today" ? sched : tomorrowSched;
    const targetDate = target === "today" ? date : shiftDate(date, 1);
    try {
      if (cur) await fetch(`/api/schedule/${cur.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, entries: formatted }) });
      else await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: targetDate, summary, entries: formatted }) });
      setAiDrawerTarget(null); fetchSchedule();
    } catch { /* */ }
  };
  // カレンダー同期（既存 handleSyncCalendar 同等。重複バグは対象外＝当日枠と同じ呼び出しに揃える）。
  // T-082: target ＝ 今日/明日 を取って tomorrowSched.id で明日分を同期。
  const handleSyncCalendar = async (target: "today" | "tomorrow" = "today") => {
    const cur = target === "today" ? sched : tomorrowSched;
    if (!cur) { alert("先に予定を追加してください"); return; }
    const label = target === "today" ? "現在のスケジュール" : "明日のスケジュール";
    if (!confirm(`${label}をGoogleカレンダーに同期しますか？`)) return;
    const setter = target === "today" ? setSyncing : setSyncingTomorrow;
    setter(true);
    try {
      const res = await fetch(`/api/schedule/${cur.id}/sync-calendar`, { method: "POST" });
      if (res.ok) { const d = await res.json(); alert(`${d.synced}件を同期しました（新規: ${d.created}件、更新: ${d.updated}件${d.errors ? `、エラー: ${d.errors}件` : ""}）`); }
      else alert("同期に失敗しました");
    } catch { alert("同期に失敗しました"); } finally { setter(false); }
  };

  // 下書き保存（自動保存・提出なし）。dirty のときだけ送る。本文編集はサーバ側で未確定に戻る。
  const saveDraft = useCallback((opts?: { keepalive?: boolean }) => {
    if (!dirtyRef.current) return Promise.resolve();
    dirtyRef.current = false;
    return fetch("/api/daily-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: opts?.keepalive,
      body: JSON.stringify({ date: dateRef.current, reportBody: bodyRef.current }),
    }).then(() => { setSavedMsg("自動保存しました"); setTimeout(() => setSavedMsg(""), 1500); }).catch(() => {});
  }, []);

  // 本文入力：dirty マーク＋未確定に戻す＋debounce 自動保存（2.5秒）。
  const onBodyChange = (v: string) => {
    setBody(v); bodyRef.current = v;
    setConfirmedAt(null); // 編集したら未確定（提出不可）に戻す
    dirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveDraft(); }, 2500);
  };

  // コメント入力を開く：新規（本文空）なら定型文を初期表示。記入済みは保存内容のまま。
  const openAccordion = () => {
    if (!body.trim()) { setBody(COMMENT_TEMPLATE); bodyRef.current = COMMENT_TEMPLATE; }
    setAccordionOpen(true);
  };

  // AIアシスト送信：所感本文＋当日数字を渡し、整理本文＋上司視点アドバイスを得る。
  const handleAiSend = async () => {
    const msg = aiInput.trim();
    if (!msg || aiLoading) return;
    const history = aiMessages.map((m) => ({ role: m.role, content: m.content }));
    setAiMessages((prev) => [...prev, { role: "user", content: msg }]);
    setAiInput("");
    setAiLoading(true);
    try {
      const res = await fetch("/api/daily-report/assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, reportBody: bodyRef.current, message: msg, chatHistory: history }),
      });
      if (res.ok) {
        const j = await res.json() as { message: string; rewrittenBody: string; advice: string };
        setAiMessages((prev) => [...prev, { role: "assistant", content: j.message || "(応答なし)", advice: j.advice, rewrittenBody: j.rewrittenBody }]);
      } else {
        setAiMessages((prev) => [...prev, { role: "assistant", content: "エラー：AI応答の取得に失敗しました" }]);
      }
    } catch {
      setAiMessages((prev) => [...prev, { role: "assistant", content: "エラー：通信に失敗しました" }]);
    } finally { setAiLoading(false); }
  };

  // AIの整理本文を本文に反映（onBodyChange 経由で自動保存＆未確定化）。
  const applyRewrite = (rewritten: string) => { onBodyChange(rewritten); };

  // 確定：本文保存＋確定状態に。
  const handleConfirm = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = false;
    try {
      const res = await fetch("/api/daily-report", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, reportBody: body, confirmComment: true }),
      });
      if (res.ok) { const j = await res.json(); setConfirmedAt(j.report?.commentConfirmedAt ?? new Date().toISOString()); setData((d) => (d ? { ...d, report: j.report } : d)); setSavedMsg("コメントを確定しました"); setTimeout(() => setSavedMsg(""), 2000); }
    } catch { setSavedMsg("確定に失敗しました"); }
  };

  // 日付移動：移動前に現在日の下書きを即時保存（書きかけが消えないように）。
  const changeDate = useCallback((nd: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void saveDraft({ keepalive: true });
    setAccordionOpen(false); setModalOpen(false);
    setDate(nd);
  }, [saveDraft]);

  // 画面離脱前に即時保存（keepalive）。
  useEffect(() => {
    const handler = () => { if (dirtyRef.current) void saveDraft({ keepalive: true }); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveDraft]);

  // 提出：保存＋完了状態＋LINE WORKS 通知（確定済みのみ）。
  const handleSubmit = async () => {
    if (!confirmed) { setSavedMsg("コメントを確定してください"); setTimeout(() => setSavedMsg(""), 2000); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = false;
    setSubmitting(true);
    setSavedMsg("");
    try {
      const res = await fetch("/api/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, reportBody: body, submit: true }),
      });
      if (res.ok) {
        const j = await res.json();
        setData((d) => (d ? { ...d, report: j.report } : d));
        setSavedMsg("提出しました（LINE WORKS に通知）");
        setTimeout(() => setSavedMsg(""), 3000);
      } else { const e = await res.json().catch(() => ({})); setSavedMsg(e.error || "提出に失敗しました"); }
    } catch { setSavedMsg("提出に失敗しました"); } finally { setSubmitting(false); }
  };

  const schedEntries = sched?.entries ?? [];
  const planned = schedEntries.length;
  const completed = schedEntries.filter((e) => e.isCompleted).length;
  // T-081: CA 以外（数字を出さないフォーマット）はスケジュール表示の高さ制限を外して全件展開。
  // CA は従来通り max-h-[200px] スクロールでコンパクト表示。
  const expandSchedule = !!data && data.format !== "CA";
  const schedScrollCls = expandSchedule ? "divide-y divide-[#F3F4F6]" : "max-h-[200px] overflow-y-auto divide-y divide-[#F3F4F6]";
  const rate = planned > 0 ? Math.round((completed / planned) * 100) : null;

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* ヘッダ：前日/翌日ナビ＋右上に提出（下書きは自動保存） */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E7EB]">
        <h2 className="text-[14px] font-medium text-[#374151]">📝 日報</h2>
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => changeDate(shiftDate(date, -1))} className="px-2 py-1 text-[13px] border border-gray-200 rounded hover:bg-gray-50">←前日</button>
          <input type="date" value={date} onChange={(e) => e.target.value && changeDate(e.target.value)} className="text-[13px] border border-gray-200 rounded px-2 py-1" />
          <button onClick={() => changeDate(shiftDate(date, 1))} className="px-2 py-1 text-[13px] border border-gray-200 rounded hover:bg-gray-50">翌日→</button>
          <button onClick={() => changeDate(todayJst())} className="px-2 py-1 text-[12px] text-[#2563EB] hover:underline">今日</button>
        </div>
        {loading && <span className="text-[12px] text-[#9CA3AF]">読み込み中...</span>}
        <div className="ml-auto flex items-center gap-2">
          {savedMsg && <span className="text-[12px] text-green-600">{savedMsg}</span>}
          {confirmed ? <span className="text-[11px] text-[#16A34A] font-medium">✓ 確定済み</span> : <span className="text-[11px] text-[#9CA3AF]">未確定</span>}
          {submitted && <span className="text-[11px] text-[#16A34A] font-medium">／提出済み</span>}
          <button onClick={openAccordion} className="border border-[#2563EB] text-[#2563EB] rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-blue-50">📝 コメント入力</button>
          <button onClick={() => setModalOpen(true)} className="border border-gray-300 text-[#374151] rounded-lg px-3 py-2 text-[13px] font-medium hover:bg-gray-50">👁 コメント表示</button>
          <button onClick={handleSubmit} disabled={submitting || !confirmed} title={!confirmed ? "コメントを確定すると提出できます" : ""} className="bg-[#16A34A] text-white rounded-lg px-5 py-2 text-[13px] font-medium hover:bg-[#15803D] disabled:opacity-50">
            {submitting ? "提出中..." : submitted ? "再提出" : "提出"}
          </button>
        </div>
      </div>

      {/* カレンダー連携バー（3列の外側上部・予定列から外出して3列の予定行を横並びに揃える） */}
      <div className="px-4 pt-3">
        <CalendarConnectButton isConnected={calConnected} onConnect={() => void fetchCalendar()} onDisconnect={() => { setCalConnected(false); void fetchCalendar(); }} />
      </div>

      {/* 上段：スケジュール 予定（作成導線つき）｜実績(完了チェック)｜明日（3列のヘッダ高さ＝同じ1行ダーク帯で揃う） */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4 border-b border-[#E5E7EB]">
        {/* 予定枠：作成導線（+予定追加・AI作成・カレンダー同期）＋編集/削除 */}
        <div className="border border-[#E5E7EB] rounded-lg overflow-hidden flex flex-col">
          <div className="bg-[#3C3C3C] text-white px-3 py-1.5 text-[12px] font-medium flex items-center gap-1.5 flex-wrap">
            <span>スケジュール予定</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => handleAddEntry("today")} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5">＋追加</button>
              <button onClick={() => setAiDrawerTarget("today")} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5">✏️AI</button>
              <button onClick={() => handleSyncCalendar("today")} disabled={syncing} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5 disabled:opacity-50">{syncing ? "同期中" : "📅同期"}</button>
            </div>
          </div>
          <div className={schedScrollCls}>
            {schedEntries.length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-[#9CA3AF] text-center">予定がありません。「＋追加」または「✏️AI」で作成</div>
            ) : schedEntries.map((e) => (
              <div key={e.id} className="px-3 py-1.5 flex items-center gap-2 text-[12px] group">
                <span className="tabular-nums text-[#6B7280] shrink-0">{e.startTime}</span>
                <span className="text-[#374151] truncate flex-1">{e.title}</span>
                {e.tag && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: e.tagColor ?? "#E5E7EB", color: "#374151" }}>{e.tag}</span>}
                <button onClick={() => handleEditEntry(e, "today")} className="shrink-0 text-[11px] text-[#6B7280] opacity-0 group-hover:opacity-100 hover:text-[#2563EB]">編集</button>
                <button onClick={() => handleDeleteEntry(e.id)} className="shrink-0 text-[11px] text-[#9CA3AF] opacity-0 group-hover:opacity-100 hover:text-red-500">削除</button>
              </div>
            ))}
          </div>
        </div>
        {/* 実績枠：完了チェック（read-only 解除） */}
        <div className="border border-[#E5E7EB] rounded-lg overflow-hidden flex flex-col">
          <div className="bg-[#3C3C3C] text-white px-3 py-1.5 text-[12px] font-medium">スケジュール実績（完了 {completed}/{planned}{rate != null ? ` ・${rate}%` : ""}）</div>
          <div className={schedScrollCls}>
            {schedEntries.length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-[#9CA3AF] text-center">予定がありません</div>
            ) : schedEntries.map((e) => (
              <label key={e.id} className="px-3 py-1.5 flex items-center gap-2 text-[12px] cursor-pointer hover:bg-[#F9FAFB]">
                <input type="checkbox" checked={e.isCompleted} onChange={() => handleToggleComplete(e)} className="shrink-0" />
                <span className="tabular-nums text-[#6B7280] shrink-0">{e.startTime}</span>
                <span className={`truncate ${e.isCompleted ? "text-[#9CA3AF] line-through" : "text-[#374151]"}`}>{e.title}</span>
              </label>
            ))}
          </div>
        </div>
        {/* 明日：当日枠と同じ＋追加/AI/同期＋編集/削除。tomorrowSched.id にルーティングし当日実績の母数に混入させない（T-082） */}
        <div className="border border-[#E5E7EB] rounded-lg overflow-hidden flex flex-col">
          <div className="bg-[#3C3C3C] text-white px-3 py-1.5 text-[12px] font-medium flex items-center gap-1.5 flex-wrap">
            <span>明日の予定（{data ? mdLabel(data.tomorrowDate) : ""}）</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => handleAddEntry("tomorrow")} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5">＋追加</button>
              <button onClick={() => setAiDrawerTarget("tomorrow")} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5">✏️AI</button>
              <button onClick={() => handleSyncCalendar("tomorrow")} disabled={syncingTomorrow} className="text-[11px] bg-white/15 hover:bg-white/25 rounded px-1.5 py-0.5 disabled:opacity-50">{syncingTomorrow ? "同期中" : "📅同期"}</button>
            </div>
          </div>
          <div className={schedScrollCls}>
            {(tomorrowSched?.entries ?? []).length === 0 ? (
              <div className="px-3 py-4 text-[12px] text-[#9CA3AF] text-center">明日の予定は未登録です。「＋追加」または「✏️AI」で作成</div>
            ) : (tomorrowSched?.entries ?? []).map((e) => (
              <div key={e.id} className="px-3 py-1.5 flex items-center gap-2 text-[12px] group">
                <span className="tabular-nums text-[#6B7280] shrink-0">{e.startTime}</span>
                <span className="text-[#374151] truncate flex-1">{e.title}</span>
                {e.tag && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: e.tagColor ?? "#E5E7EB", color: "#374151" }}>{e.tag}</span>}
                <button onClick={() => handleEditEntry(e, "tomorrow")} className="shrink-0 text-[11px] text-[#6B7280] opacity-0 group-hover:opacity-100 hover:text-[#2563EB]">編集</button>
                <button onClick={() => handleDeleteEntry(e.id)} className="shrink-0 text-[11px] text-[#9CA3AF] opacity-0 group-hover:opacity-100 hover:text-red-500">削除</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 下段：当日実績（やや広く）｜グラフ（広く）。コメントはアコーディオン/ポップアップへ移動。 */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 p-4">
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

        {/* グラフ（コメント欄を外した分、全幅で広く） */}
        <div>
          {data?.dayMatrix && data.attributes ? (
            <DailyCharts matrix={data.dayMatrix} attributes={data.attributes} jobSearch={data.jobSearch} />
          ) : (
            <div className="text-[12px] text-[#9CA3AF] py-4">グラフは CA のみ表示されます。</div>
          )}
        </div>
      </div>

      {/* 右スライド：コメント入力アコーディオン */}
      {accordionOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setAccordionOpen(false)} />
          {/* 幅を画面半分（min 440px・画面狭時は w-full） */}
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-1/2 sm:min-w-[440px] bg-white shadow-2xl flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-[#3C3C3C] text-white">
              <span className="text-[14px] font-semibold">コメント入力</span>
              <span className="text-[13px] text-[#D1D5DB]">日報コメント｜{mdJpLabel(date)}</span>
              <button onClick={() => setAccordionOpen(false)} className="ml-auto text-white hover:text-gray-300 text-lg px-1">✕</button>
            </div>
            {/* 上：本文（1.8倍の縦幅）／中：AIチャット表示／下：AIチャット入力（パネル最下部に固定） */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <textarea
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                className="w-full h-[540px] border border-gray-300 rounded px-2 py-1.5 text-[12px] resize-y leading-relaxed"
              />
              {/* AIチャットの表示エリア */}
              <div className="border border-gray-200 rounded-lg p-3 bg-[#F9FAFB]">
                <div className="text-[12px] font-medium text-[#374151] mb-2">🤖 AIと会話して日報を整理・アドバイス</div>
                {aiMessages.length === 0 ? (
                  <div className="text-[11px] text-[#9CA3AF] py-3">「今日の所感を整理して」「アドバイスして」など送ると、6項目を保ったまま整理＋上司視点の助言を返します。</div>
                ) : (
                  <div className="space-y-2">
                    {aiMessages.map((m, i) => (
                      <div key={i} className={m.role === "user" ? "text-right" : ""}>
                        <div className={`inline-block text-left rounded-lg px-2.5 py-1.5 text-[12px] max-w-[90%] ${m.role === "user" ? "bg-[#DBEAFE] text-[#1E3A8A]" : "bg-white border border-gray-200 text-[#374151]"}`}>
                          <div className="whitespace-pre-wrap">{m.content}</div>
                          {m.advice && (
                            <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-[#6B7280] whitespace-pre-wrap">💡 {m.advice}</div>
                          )}
                          {m.rewrittenBody && (
                            <button onClick={() => applyRewrite(m.rewrittenBody!)} className="mt-2 text-[11px] text-[#2563EB] border border-[#2563EB] rounded px-2 py-0.5 hover:bg-blue-50">本文に反映</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {aiLoading && <div className="text-[11px] text-[#9CA3AF]">AI が考えています…</div>}
                  </div>
                )}
              </div>
            </div>
            {/* 確定バー */}
            <div className="px-4 py-2 border-t border-gray-200 flex items-center gap-2 bg-white">
              {confirmed ? <span className="text-[12px] text-[#16A34A]">✓ 確定済み</span> : <span className="text-[12px] text-[#9CA3AF]">未確定（確定すると提出可）</span>}
              <button onClick={handleConfirm} className="ml-auto bg-[#2563EB] text-white rounded-lg px-5 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]">確定</button>
            </div>
            {/* AIチャット入力欄をパネル最下部に固定 */}
            <div className="px-4 py-3 border-t border-gray-200 bg-[#F9FAFB]">
              <div className="flex gap-2">
                <input
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleAiSend(); } }}
                  placeholder="AIに相談（例：今日の所感を整理して／アドバイスして）"
                  className="flex-1 border border-gray-300 rounded px-2 py-2 text-[12px]"
                />
                <button onClick={handleAiSend} disabled={aiLoading || !aiInput.trim()} className="bg-[#2563EB] text-white rounded px-4 py-2 text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50">
                  {aiLoading ? "..." : "送信"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 中央ポップアップ：コメント表示・編集 */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto bg-white rounded-xl shadow-2xl w-full max-w-[680px] max-h-[85vh] flex flex-col overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-200 bg-[#3C3C3C] text-white">
                <span className="text-[14px] font-semibold">日報コメント（{mdLabel(date)}）</span>
                {confirmed ? <span className="text-[11px] text-green-300">✓ 確定済み</span> : <span className="text-[11px] text-gray-300">未確定</span>}
                <button onClick={() => setModalOpen(false)} className="ml-auto text-white hover:text-gray-300 text-lg px-1">✕</button>
              </div>
              <div className="p-5 overflow-y-auto">
                <textarea
                  value={body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  className="w-full h-[360px] border border-gray-300 rounded px-3 py-2 text-[13px] resize-y leading-relaxed"
                />
              </div>
              <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-2">
                <span className="text-[11px] text-[#9CA3AF]">編集は自動保存されます（編集すると未確定に戻ります）</span>
                <button onClick={handleConfirm} className="ml-auto bg-[#2563EB] text-white rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-[#1D4ED8]">確定</button>
                <button onClick={() => setModalOpen(false)} className="border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-[13px] font-medium hover:bg-gray-50">閉じる</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* スケジュール：手動追加/編集モーダル（既存コンポーネント再利用）。target に応じて today/tomorrow の scheduleId にルーティング */}
      {entryModalTarget && (entryModalTarget === "today" ? sched : tomorrowSched) && (
        <ScheduleEntryFormModal
          onClose={() => { setEntryModalTarget(null); setEditingEntry(null); }}
          onSaved={() => { setEntryModalTarget(null); setEditingEntry(null); fetchSchedule(); }}
          scheduleId={(entryModalTarget === "today" ? sched : tomorrowSched)!.id}
          editEntry={editingEntry}
        />
      )}

      {/* スケジュール：AI作成ドロワー（既存コンポーネント再利用・target に応じて日付/scheduleId を切替） */}
      <ScheduleChatDrawer
        isOpen={aiDrawerTarget !== null}
        onClose={() => setAiDrawerTarget(null)}
        date={aiDrawerTarget === "tomorrow" ? shiftDate(date, 1) : date}
        scheduleId={(aiDrawerTarget === "tomorrow" ? tomorrowSched?.id : sched?.id) ?? null}
        existingEntries={(aiDrawerTarget === "tomorrow" ? (tomorrowSched?.entries ?? []) : schedEntries).map((e) => ({ startTime: e.startTime, endTime: e.endTime, title: e.title, note: e.note ?? null, tag: e.tag ?? "", tagColor: e.tagColor ?? "#6B7280", sortOrder: e.sortOrder ?? 0 }))}
        calendarEvents={calEvents}
        onSave={(entries, summary) => handleAiSave(aiDrawerTarget ?? "today", entries, summary)}
      />
    </div>
  );
}

function SchedCol({ title, entries, emptyText, noLimit }: { title: string; entries: SchedEntry[]; emptyText?: string; noLimit?: boolean }) {
  // T-081: noLimit=true（CA以外）のとき高さ制限を外して全件縦展開。
  return (
    <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
      <div className="bg-[#3C3C3C] text-white px-3 py-1.5 text-[12px] font-medium">{title}</div>
      <div className={noLimit ? "divide-y divide-[#F3F4F6]" : "max-h-[220px] overflow-y-auto divide-y divide-[#F3F4F6]"}>
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
    // 棒は細くスタイリッシュに（barPercentage:0.3、categoryPercentage:0.7）。棒上に数値。
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
            borderRadius: 4,
            barPercentage: 0.3,
            categoryPercentage: 0.7,
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
    // 細くスタイリッシュ（barPercentage:0.3）＋親コンテナを max-w-[280px] で詰め、2本が間延びしないように。
    if (jobBarRef.current && jobSearch) {
      charts.current.push(new Chart(jobBarRef.current, {
        type: "bar",
        data: {
          labels: ["BM数", "出力数"],
          datasets: [{
            label: "件数",
            data: [jobSearch.bmCount, jobSearch.exportCount],
            backgroundColor: ["#2563EB", "#F59E0B"],
            borderRadius: 4,
            barPercentage: 0.3,
            categoryPercentage: 0.6,
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
        {/* 求人検索は 2 本のため幅を詰める（max-w で間延び解消・左寄せ） */}
        <div className="w-full md:w-[280px] shrink-0">
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
