"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
  PieChart, Pie, LineChart, Line, CartesianGrid,
} from "recharts";
import { CONTACT_PURPOSES } from "@/constants/contact-purpose";
import { useOverlayClose } from "@/hooks/useOverlayClose";

/* ---------- Types ---------- */
type DashboardData = {
  lastLoginAt: string | null;
  mypageAccessCount: number | null;
  idleDays: number | null;
  lastContactDate: string | null;
  nextContactDate: string | null;
  nextContactAt: string | null;
  nextContactPurpose: string | null;
  nextContactNote: string | null;
  interestedCount: number;
  wantToApplyCount: number;
  mypageReaction: { total: number; interested: number; wantToApply: number; unanswered: number };
  lastProposalDate: string | null;
  deliveryCount: number;
  entryCompanies: number;
  inSelectionCompanies: number;
  funnel: { entry: number; doc: number; first: number; second: number; offer: number };
  passRate: { doc: number | null; first: number | null; second: number | null };
  stageBreakdown: { document: number; first: number; second: number; offer: number };
  viewsDaily: { date: string; count: number }[];
};

type ContactLog = {
  id: string;
  method: "TEL" | "MESSAGE";
  content: string;
  contactedAt: string;
  author: { id: string; name: string } | null;
};

/* ---------- JST date/time helpers（罠#17: 必ず Asia/Tokyo 経由・toISOString().slice 禁止）---------- */
// ISO(UTC) → JST の { date:"YYYY-MM-DD", time:"HH:MM" }
function isoToJstParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const s = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" }); // "YYYY-MM-DD HH:MM:SS"
  const [date, time] = s.split(" ");
  return { date: date ?? "", time: (time ?? "").slice(0, 5) };
}
// JST の date(+time) → ISO(UTC)。ブラウザTZに依存しないよう +09:00 を明示。
function jstPartsToIso(date: string, time: string): string | null {
  if (!date) return null;
  return new Date(`${date}T${time || "00:00"}:00+09:00`).toISOString();
}
// ISO → JST "YYYY/MM/DD HH:MM"
function fmtJstDateTime(iso: string): string {
  const s = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Tokyo" });
  const [d, t] = s.split(" ");
  return `${(d ?? "").replace(/-/g, "/")} ${(t ?? "").slice(0, 5)}`;
}

// "YYYY-MM-DD" → "M/D"
function fmtMD(d: string): string {
  const parts = (d ?? "").split("-");
  if (parts.length < 3) return d ?? "";
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

/* ---------- Helpers ---------- */
const DASH = "—";
function dash(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return DASH;
  return String(v);
}

// 放置日数 信号色: 緑 ≤7 / 黄 8〜14 / 赤 15〜 / 灰 null
function idleSignal(d: number | null): { bg: string; fg: string; label: string } {
  if (d === null) return { bg: "#F3F4F6", fg: "#6B7280", label: "接触記録なし" };
  if (d <= 7) return { bg: "#DCFCE7", fg: "#16A34A", label: "良好" };
  if (d <= 14) return { bg: "#FEF9C3", fg: "#CA8A04", label: "やや放置" };
  return { bg: "#FEE2E2", fg: "#DC2626", label: "要対応" };
}

/* ---------- Small UI atoms ---------- */
function Card({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="text-[12px] text-[#6B7280]">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight" style={{ color: accent ?? "#374151" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[#9CA3AF]">{sub}</div>}
    </div>
  );
}

const FUNNEL_COLORS = ["#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#16A34A"];

export default function DashboardTab({ candidateId }: { candidateId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // T-111: 次回連絡予定フォーム
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("");
  const [nextPurpose, setNextPurpose] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [savingNext, setSavingNext] = useState(false);

  // T-111: 連絡記録
  const [logs, setLogs] = useState<ContactLog[]>([]);
  const [logMethod, setLogMethod] = useState<"TEL" | "MESSAGE">("TEL");
  const [logContent, setLogContent] = useState("");
  const [addingLog, setAddingLog] = useState(false);
  // T-111追補: 次回連絡予定・連絡記録をまとめるモーダル
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const overlayCloseContact = useOverlayClose(() => setContactModalOpen(false));

  const loadDashboard = useCallback(async () => {
    const res = await fetch(`/api/candidates/${candidateId}/dashboard`);
    if (!res.ok) throw new Error();
    const d: DashboardData = await res.json();
    setData(d);
    // フォーム初期値をサーバ値へ同期（保存後の再取得でも最新に揃える）
    const parts = isoToJstParts(d.nextContactAt);
    setNextDate(parts.date);
    setNextTime(parts.time);
    setNextPurpose(d.nextContactPurpose ?? "");
    setNextNote(d.nextContactNote ?? "");
  }, [candidateId]);

  const loadLogs = useCallback(async () => {
    const res = await fetch(`/api/candidates/${candidateId}/contact-logs`);
    if (res.ok) setLogs((await res.json()).logs ?? []);
  }, [candidateId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([loadDashboard(), loadLogs()])
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadDashboard, loadLogs]);

  const saveNextContact = async () => {
    setSavingNext(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextContactAt: jstPartsToIso(nextDate, nextTime),
          nextContactPurpose: nextPurpose || null,
          nextContactNote: nextNote || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("次回連絡予定を保存しました");
      await loadDashboard();
    } catch {
      toast.error("保存に失敗しました");
    } finally {
      setSavingNext(false);
    }
  };

  const clearNextContact = async () => {
    setSavingNext(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextContactAt: null, nextContactPurpose: null, nextContactNote: null }),
      });
      if (!res.ok) throw new Error();
      toast.success("次回連絡予定をクリアしました");
      await loadDashboard();
    } catch {
      toast.error("クリアに失敗しました");
    } finally {
      setSavingNext(false);
    }
  };

  const addLog = async () => {
    if (!logContent.trim()) { toast.error("連絡内容を入力してください"); return; }
    setAddingLog(true);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: logMethod, content: logContent }),
      });
      if (!res.ok) throw new Error();
      toast.success("連絡記録を追加しました");
      setLogContent("");
      await Promise.all([loadLogs(), loadDashboard()]); // 最終接触日・放置日数の連動
    } catch {
      toast.error("追加に失敗しました");
    } finally {
      setAddingLog(false);
    }
  };

  const deleteLog = async (id: string) => {
    if (!confirm("この連絡記録を削除しますか？")) return;
    try {
      const res = await fetch(`/api/candidates/${candidateId}/contact-logs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await Promise.all([loadLogs(), loadDashboard()]);
    } catch {
      toast.error("削除に失敗しました");
    }
  };

  if (loading) return <div className="py-12 text-center text-[#9CA3AF]">読み込み中...</div>;
  if (error || !data) return <div className="py-12 text-center text-[#DC2626]">ダッシュボードの取得に失敗しました</div>;

  const sig = idleSignal(data.idleDays);
  const funnelData = [
    { stage: "エントリー", value: data.funnel.entry },
    { stage: "書類", value: data.funnel.doc },
    { stage: "一次", value: data.funnel.first },
    { stage: "二次", value: data.funnel.second },
    { stage: "内定", value: data.funnel.offer },
  ];
  // マイページ反応（母数ベース3分類: 未回答/気になる/応募したい）
  const reactionEntries = [
    { name: "未回答", value: data.mypageReaction.unanswered, color: "#9CA3AF" },
    { name: "気になる", value: data.mypageReaction.interested, color: "#CA8A04" },
    { name: "応募したい", value: data.mypageReaction.wantToApply, color: "#2563EB" },
  ];
  const reactionTotal = data.mypageReaction.total;

  // 追補1: 主要指標 縦リスト（14項目・単位付き・null は「—」・通過率は青字）
  const pctStr = (v: number | null) => (v === null ? DASH : `${v}%`);
  const metricRows: { label: string; value: string; blue?: boolean }[] = [
    { label: "最終ログイン日時", value: dash(data.lastLoginAt) },
    { label: "マイページ閲覧回数（累計）", value: data.mypageAccessCount == null ? DASH : `${data.mypageAccessCount}回` },
    { label: "最終求人提案日", value: dash(data.lastProposalDate) },
    { label: "求人配信数", value: `${data.deliveryCount}件` },
    { label: "最終接触日", value: dash(data.lastContactDate) },
    { label: "次回連絡予定日", value: dash(data.nextContactDate) },
    { label: "放置日数", value: data.idleDays == null ? DASH : `${data.idleDays}日` },
    { label: "気になる求人数", value: `${data.interestedCount}件` },
    { label: "応募したい求人数", value: `${data.wantToApplyCount}件` },
    { label: "エントリー社数", value: `${data.entryCompanies}社` },
    { label: "選考中企業数", value: `${data.inSelectionCompanies}社` },
    { label: "書類選考通過率", value: pctStr(data.passRate.doc), blue: true },
    { label: "一次面接通過率", value: pctStr(data.passRate.first), blue: true },
    { label: "二次面接通過率", value: pctStr(data.passRate.second), blue: true },
  ];

  // 追補2: 選考段階の内訳ドーナツ
  const stageEntries = [
    { name: "書類選考", value: data.stageBreakdown.document, color: "#93C5FD" },
    { name: "一次面接", value: data.stageBreakdown.first, color: "#60A5FA" },
    { name: "二次面接", value: data.stageBreakdown.second, color: "#3B82F6" },
    { name: "内定", value: data.stageBreakdown.offer, color: "#16A34A" },
  ];
  const stageTotal = stageEntries.reduce((s, x) => s + x.value, 0);

  return (
    <div className="pb-8">
      {/* ===== 最上段: 放置日数 信号 + 3カード ===== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border px-4 py-3" style={{ backgroundColor: sig.bg, borderColor: sig.fg + "55" }}>
          <div className="text-[12px]" style={{ color: sig.fg }}>放置日数</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[34px] font-bold leading-none" style={{ color: sig.fg }}>{data.idleDays === null ? DASH : data.idleDays}</span>
            {data.idleDays !== null && <span className="text-[13px]" style={{ color: sig.fg }}>日</span>}
          </div>
          <div className="mt-1 text-[11px] font-medium" style={{ color: sig.fg }}>{sig.label}</div>
        </div>
        <Card label="最終ログイン" value={dash(data.lastLoginAt)} sub="マイページ" />
        <Card label="最終接触" value={dash(data.lastContactDate)} sub="面談/メモ/求人提案の最新" />
        {/* 次回連絡予定カード: 「設定」ボタンでモーダルを開く */}
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-[#6B7280]">次回連絡予定</div>
            <button
              onClick={() => setContactModalOpen(true)}
              className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
            >
              設定
            </button>
          </div>
          <div className="mt-1 text-[20px] font-semibold leading-tight text-[#374151]">{dash(data.nextContactDate)}</div>
          <div className="mt-0.5 text-[11px] text-[#9CA3AF]">{data.nextContactPurpose ? data.nextContactPurpose : "面談予定/タスク期限"}</div>
        </div>
      </div>

      {/* ===== 信号バー下: 3カラム（左=主要指標 / 中央=折れ線+ファネル / 右=ドーナツ2つ） ===== */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 左: 主要指標 縦リスト */}
        <div className="lg:col-span-4">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="mb-2 text-[12px] font-medium text-[#6B7280]">主要指標</div>
            <div>
              {metricRows.map((row, i) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between rounded px-2 py-1.5 ${i % 2 === 1 ? "bg-[#F9FAFB]" : ""}`}
                >
                  <span className="text-[12px] text-[#6B7280]">{row.label}</span>
                  <span className={`text-[13px] font-semibold ${row.blue ? "text-[#2563EB]" : "text-[#374151]"}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 中央: マイページ閲覧の動き（折れ線・直近2週間） + 選考の進み（ファネル） */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-[12px] font-medium text-[#6B7280]">マイページ閲覧の動き（直近2週間）</div>
              <div className="text-[10px] text-[#9CA3AF]">日別・2026-06-25 から蓄積</div>
            </div>
            <div className="mt-2">
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data.viewsDaily} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtMD} interval={2} tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                  <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                  <Tooltip labelFormatter={(d) => fmtMD(String(d))} formatter={(value) => [`${value} 回`, "閲覧"]} />
                  <Line type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">閲覧が増えた直後は応募意欲が高いタイミング。配信・面談アクションの目安。</div>
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="mb-2 text-[12px] font-medium text-[#6B7280]">選考の進み（会社単位）</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                <YAxis type="category" dataKey="stage" width={64} tick={{ fontSize: 12, fill: "#374151" }} />
                <Tooltip formatter={(value) => [`${value} 社`, ""]} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {funnelData.map((_, i) => <Cell key={i} fill={FUNNEL_COLORS[i]} />)}
                  <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: "#374151" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">エントリー{data.entryCompanies}社 → 内定{data.funnel.offer}社。各段階の通過率は左の指標を参照。</div>
          </div>
        </div>

        {/* 右: マイページ反応ドーナツ + 選考段階ドーナツ */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="mb-2 text-[12px] font-medium text-[#6B7280]">マイページ反応の構成</div>
            {reactionTotal === 0 ? (
              <div className="py-8 text-center text-[13px] text-[#9CA3AF]">該当なし</div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={reactionEntries.filter((r) => r.value > 0)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                      {reactionEntries.filter((r) => r.value > 0).map((r) => <Cell key={r.name} fill={r.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} 件`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1 self-stretch text-[12px]">
                  {reactionEntries.map((r) => (
                    <div key={r.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />{r.name}</span>
                      <span className="font-semibold">{r.value}件</span>
                    </div>
                  ))}
                  <div className="mt-0.5 text-[11px] text-[#9CA3AF]">計 {reactionTotal} 件（マイページ掲載中）</div>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="mb-2 text-[12px] text-[#6B7280]">選考段階の内訳</div>
            {stageTotal === 0 ? (
              <div className="py-8 text-center text-[13px] text-[#9CA3AF]">該当なし</div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={stageEntries.filter((s) => s.value > 0)} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={2}>
                      {stageEntries.filter((s) => s.value > 0).map((s) => <Cell key={s.name} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} 社`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1 self-stretch text-[12px]">
                  {stageEntries.map((s) => (
                    <div key={s.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>
                      <span className="font-semibold">{s.value}社</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== T-111追補: 次回連絡予定・連絡記録 モーダル（上段カードの「設定」から開く） ===== */}
      {contactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" {...overlayCloseContact}>
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
              <h3 className="text-[14px] font-semibold text-[#374151]">次回連絡予定・連絡記録</h3>
              <button onClick={() => setContactModalOpen(false)} className="text-[18px] leading-none text-[#9CA3AF] hover:text-[#374151]">✕</button>
            </div>
            <div className="overflow-y-auto p-4">
             <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* 左カラム: 次回連絡予定 + 連絡登録 */}
              <div>
              {/* 次回連絡予定の設定 */}
              <div className="mb-2 text-[13px] font-semibold text-[#374151]">次回連絡予定</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#6B7280]">日付</span>
                  <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-[#6B7280]">時間</span>
                  <input type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} className="rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px]" />
                </label>
              </div>
              <label className="mt-3 flex flex-col gap-1">
                <span className="text-[11px] text-[#6B7280]">目的</span>
                <select value={nextPurpose} onChange={(e) => setNextPurpose(e.target.value)} className="rounded border border-[#E5E7EB] bg-white px-2 py-1.5 text-[13px]">
                  <option value="">選択してください</option>
                  {CONTACT_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="mt-3 flex flex-col gap-1">
                <span className="text-[11px] text-[#6B7280]">補足</span>
                <textarea value={nextNote} onChange={(e) => setNextNote(e.target.value)} rows={2} className="rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px]" placeholder="自由入力" />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={saveNextContact} disabled={savingNext || !nextDate} className="rounded-md bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50">保存</button>
                <button onClick={clearNextContact} disabled={savingNext} className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#F9FAFB] disabled:opacity-50">クリア</button>
                {data.nextContactAt && (
                  <span className="text-[11px] text-[#9CA3AF]">現在: {fmtJstDateTime(data.nextContactAt)}{data.nextContactPurpose ? ` / ${data.nextContactPurpose}` : ""}</span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[#9CA3AF]">面談が無くても設定できます。保存すると上段カード・主要指標の「次回連絡予定」に反映されます。</p>

              <div className="my-4 border-t border-[#E5E7EB]" />

              {/* 連絡登録 */}
              <div className="mb-2 text-[13px] font-semibold text-[#374151]">連絡登録</div>
              <div className="flex gap-1">
                <button onClick={() => setLogMethod("TEL")} className={`rounded px-3 py-1.5 text-[12px] ${logMethod === "TEL" ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"}`}>電話</button>
                <button onClick={() => setLogMethod("MESSAGE")} className={`rounded px-3 py-1.5 text-[12px] ${logMethod === "MESSAGE" ? "bg-[#2563EB] text-white" : "border border-[#E5E7EB] text-[#6B7280]"}`}>メール・LINE</button>
              </div>
              <textarea value={logContent} onChange={(e) => setLogContent(e.target.value)} rows={2} className="mt-2 w-full rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px]" placeholder="連絡内容" />
              <div className="mt-2">
                <button onClick={addLog} disabled={addingLog} className="rounded-md bg-[#16A34A] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50">追加</button>
              </div>
              </div>{/* /左カラム */}

              {/* 右カラム: 連絡履歴（スクロール） */}
              <div>
              <div className="mb-2 text-[13px] font-semibold text-[#374151]">連絡履歴</div>
              <div className="max-h-[60vh] overflow-y-auto pr-1">
              {logs.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-[#9CA3AF]">連絡記録はまだありません</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {logs.map((l) => (
                    <li key={l.id} className="rounded border border-[#F3F4F6] bg-[#F9FAFB] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${l.method === "TEL" ? "bg-[#DBEAFE] text-[#2563EB]" : "bg-[#DCFCE7] text-[#16A34A]"}`}>{l.method === "TEL" ? "電話" : "メール・LINE"}</span>
                          <span className="text-[11px] text-[#9CA3AF]">{fmtJstDateTime(l.contactedAt)}{l.author?.name ? ` ・ ${l.author.name}` : ""}</span>
                        </div>
                        <button onClick={() => deleteLog(l.id)} className="shrink-0 text-[11px] text-[#9CA3AF] hover:text-[#DC2626]">削除</button>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-[13px] text-[#374151]">{l.content}</div>
                    </li>
                  ))}
                </ul>
              )}
              </div>{/* /履歴スクロール */}
              </div>{/* /右カラム */}
             </div>{/* /grid */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
