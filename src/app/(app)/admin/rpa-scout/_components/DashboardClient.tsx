"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { PageTitle } from "@/components/ui/PageTitle";
import { addDaysYmd, mondayOfWeek, nowJstYmd } from "@/lib/rpa-scout/jst";
import {
  UNCLASSIFIED,
  SEARCH_COUNT_DROP_THRESHOLD,
  ACHIEVEMENT_WARN,
  ACHIEVEMENT_ALERT,
  achievementLevel,
  axisPct,
  trimTopEntries,
  shortJstDate,
  shortJstDateTime,
  buildAnalysisPrompt,
  type AxisEntry,
  type DashboardData,
} from "@/lib/rpa-scout/dashboard";

type Segment = "week" | "month" | "30d" | "custom";

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "week", label: "今週" },
  { value: "month", label: "今月" },
  { value: "30d", label: "過去30日" },
  { value: "custom", label: "期間指定" },
];

// 円グラフ・横棒の系列色（モックの配色）
const AREA_COLORS = ["#2563EB", "#0EA5E9", "#818CF8", "#C084FC", "#D1D5DB"];
const SEND_COLORS = ["#2563EB", "#93C5FD", "#D1D5DB"];
const BAR_COLORS = ["#2563EB", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE"];
const NA_COLOR = "#D1D5DB";

const nf = (n: number) => n.toLocaleString("ja-JP");

function barColor(i: number, label: string): string {
  return label === UNCLASSIFIED || label === "その他"
    ? NA_COLOR
    : BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)];
}

export default function DashboardClient() {
  const today = nowJstYmd();
  const [segment, setSegment] = useState<Segment>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [machine, setMachine] = useState(""); // "" = 全号機
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptModalText, setPromptModalText] = useState<string | null>(null);

  const range = useMemo((): { from: string; to: string } | null => {
    switch (segment) {
      case "week":
        return { from: mondayOfWeek(today), to: today };
      case "month":
        return { from: `${today.slice(0, 8)}01`, to: today };
      case "30d":
        return { from: addDaysYmd(today, -29), to: today };
      case "custom":
        return customFrom && customTo && customFrom <= customTo
          ? { from: customFrom, to: customTo }
          : null;
    }
  }, [segment, customFrom, customTo, today]);

  const load = useCallback(async () => {
    if (!range) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (machine) params.set("machine", machine);
    const res = await fetch(`/api/rpa-scout/dashboard?${params.toString()}`);
    if (res.ok) {
      setData(await res.json());
    } else {
      setError("集計の取得に失敗しました");
    }
    setLoading(false);
  }, [range, machine]);

  useEffect(() => {
    load();
  }, [load]);

  const segmentLabel = SEGMENTS.find((s) => s.value === segment)?.label ?? "";
  const machineLabel = useMemo(() => {
    if (!machine) return "全号機";
    const m = data?.allMachines.find((x) => x.machineNo === Number(machine));
    return `${machine}号機${m && !m.isActive ? "（停止）" : ""}`;
  }, [machine, data]);

  // 表示中データをプロンプト化してクリップボードへ（fetchし直さない）
  const copyPrompt = async () => {
    if (!data) return;
    const text = buildAnalysisPrompt(data, { periodLabel: segmentLabel, machineLabel });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("コピーしました");
    } catch {
      // クリップボード不可の環境向けフォールバック（全文表示モーダル）
      setPromptModalText(text);
    }
  };

  const total = data?.kpi.changeCount ?? 0;

  return (
    <div>
      <Toaster position="top-center" richColors />

      {/* ヘッダ＋フィルタ */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
        <PageTitle>配信条件ダッシュボード</PageTitle>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <button
            onClick={copyPrompt}
            disabled={!data}
            className="rounded-[8px] border border-[#2563EB] bg-white px-3.5 py-1.5 font-semibold text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-40"
          >
            📋 プロンプト
          </button>
          <div className="flex overflow-hidden rounded-[8px] border border-[#E5E7EB] bg-white">
            {SEGMENTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSegment(s.value)}
                className={
                  segment === s.value
                    ? "bg-[#2563EB] px-3 py-1.5 font-semibold text-white"
                    : "px-3 py-1.5 text-[#6B7280] hover:bg-[#F8FAFC]"
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          {segment === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1"
              />
              <span className="text-[#6B7280]">〜</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1"
              />
            </>
          )}
          <select
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            className="rounded-[8px] border border-[#E5E7EB] bg-white px-2.5 py-1.5"
          >
            <option value="">全号機</option>
            {(data?.allMachines.length
              ? data.allMachines
              : [1, 2, 3, 4, 5, 6].map((n) => ({ machineNo: n, isActive: true }))
            ).map((m) => (
              <option key={m.machineNo} value={m.machineNo}>
                {m.machineNo}号機{m.isActive ? "" : "（停止）"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {segment === "custom" && !range && (
        <div className="py-8 text-center text-[13px] text-[#9CA3AF]">期間を指定してください</div>
      )}
      {error && <div className="py-8 text-center text-[13px] text-[#DC2626]">{error}</div>}
      {loading && !data && (
        <div className="py-10 text-center text-[14px] text-[#6B7280]">読み込み中...</div>
      )}

      {data && (
        <div className={loading ? "opacity-60" : ""}>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            <Kpi label="配信変更回数" value={nf(data.kpi.changeCount)}>
              <Diff diff={data.kpi.changeCount - data.kpi.prevChangeCount} suffix="" />
            </Kpi>
            <Kpi
              label="使用パターン数"
              value={
                <>
                  {data.kpi.usedPatternCount}
                  <span className="text-[13px] text-[#6B7280]"> / {data.kpi.activePatternTotal}</span>
                </>
              }
            >
              <span className="text-[#6B7280]">未使用 30日以上: {data.kpi.unused30dCount}</span>
            </Kpi>
            <Kpi label="検索件数 合計" value={nf(data.kpi.searchTotal)}>
              {data.kpi.prevSearchTotal != null && data.kpi.prevSearchTotal > 0 ? (
                <Diff
                  diff={Math.round(
                    ((data.kpi.searchTotal - data.kpi.prevSearchTotal) / data.kpi.prevSearchTotal) *
                      100
                  )}
                  suffix="%"
                />
              ) : (
                <span className="text-[#6B7280]">前期間 -</span>
              )}
            </Kpi>
            <Kpi label="平均検索件数 / 回" value={data.kpi.searchAvg != null ? nf(data.kpi.searchAvg) : "-"}>
              {data.kpi.prevSearchAvg != null ? (
                <span
                  className={
                    data.kpi.searchAvg != null && data.kpi.searchAvg < data.kpi.prevSearchAvg
                      ? "text-[#DC2626]"
                      : "text-[#059669]"
                  }
                >
                  前期間 {nf(data.kpi.prevSearchAvg)}
                </span>
              ) : (
                <span className="text-[#6B7280]">前期間 -</span>
              )}
            </Kpi>
            <Kpi
              label="3日以内の連続使用"
              value={`${data.kpi.continuousUseCount}件`}
              warn={data.kpi.continuousUseCount > 0}
            >
              <span className="text-[#6B7280]">
                {data.kpi.continuousUseCount > 0 ? "要ローテーション確認" : "問題なし"}
              </span>
            </Kpi>
          </div>

          {/* 号機別 */}
          <Band title="号機別の稼働状況" note="現在パターン＝最新ログ / 件数推移＝直近5回" />
          <div className="rounded-[10px] border border-[#E5E7EB] bg-white p-4">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <Mth>号機</Mth>
                    <Mth>状態</Mth>
                    <Mth>現在のパターン</Mth>
                    <Mth right>変更回数</Mth>
                    <Mth right>最新検索件数</Mth>
                    <Mth>件数推移</Mth>
                    <Mth right>前回比</Mth>
                  </tr>
                </thead>
                <tbody>
                  {data.machineRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-[#9CA3AF]">
                        データがありません
                      </td>
                    </tr>
                  ) : (
                    data.machineRows.map((m) => (
                      <tr key={m.machineNo} className="border-b border-[#F1F5F9] last:border-b-0">
                        <Mtd>{m.machineNo}号機</Mtd>
                        <Mtd>
                          {m.isActive ? (
                            <span className="rounded-[4px] bg-[#ECFDF5] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#059669]">
                              稼働
                            </span>
                          ) : (
                            <span className="rounded-[4px] bg-[#F3F4F6] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#6B7280]">
                              停止
                            </span>
                          )}
                        </Mtd>
                        <Mtd className="max-w-[340px]">
                          <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={m.latestPatternName ?? ""}>
                            {m.latestPatternName ?? "-"}
                          </span>
                        </Mtd>
                        <Mtd right>{m.changeCount}</Mtd>
                        <Mtd right>{m.latestSearchCount != null ? nf(m.latestSearchCount) : "-"}</Mtd>
                        <Mtd>
                          <Spark values={m.recent5} />
                        </Mtd>
                        <Mtd right>
                          {m.prevDiffPct == null ? (
                            <span className="text-[#9CA3AF]">-</span>
                          ) : m.prevDiffPct < 0 ? (
                            <span className="font-semibold text-[#DC2626]">▼ {m.prevDiffPct}%</span>
                          ) : m.prevDiffPct > 0 ? (
                            <span className="font-semibold text-[#059669]">▲ +{m.prevDiffPct}%</span>
                          ) : (
                            <span>± 0%</span>
                          )}
                        </Mtd>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[11px] text-[#6B7280]">
              件数推移の下降（▼）はリストの撃ち尽くしサイン。パターン切替またはリスト開放待ちの判断材料。停止中の号機は非表示（右上の号機選択で過去実績を確認可能）。
            </div>
          </div>

          {/* 予実（想定件数 vs 実績） */}
          <Band
            title="予実管理"
            note="実績記録済み × 想定件数ありの計画のみ集計"
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="期間サマリ">
              {data.planVsActual.planCount === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">対象なし</div>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-2 py-1">
                    <div>
                      <div className="text-[11.5px] text-[#6B7280]">想定 → 実績</div>
                      <div className="text-[19px] font-bold tabular-nums text-[#1F2937]">
                        {nf(data.planVsActual.expectedTotal)} → {nf(data.planVsActual.actualTotal)}
                      </div>
                    </div>
                    <AchievementBadge
                      actual={data.planVsActual.actualTotal}
                      expected={data.planVsActual.expectedTotal}
                      large
                    />
                  </div>
                  <div className="mt-1.5 border-t border-[#F1F5F9] pt-1.5 text-[11.5px] text-[#6B7280]">
                    対象計画: {data.planVsActual.planCount}件
                  </div>
                </>
              )}
              {(data.planVsActual.missingExpectedCount > 0 ||
                data.planVsActual.noActualCount > 0) && (
                <div className="mt-1 text-[11px] text-[#9CA3AF]">
                  {data.planVsActual.missingExpectedCount > 0 && (
                    <div>想定未入力: {data.planVsActual.missingExpectedCount}件（分母から除外）</div>
                  )}
                  {data.planVsActual.noActualCount > 0 && (
                    <div>実績なし（停止記録）: {data.planVsActual.noActualCount}件（分母から除外）</div>
                  )}
                </div>
              )}
            </Card>

            <Card title="号機別の予実">
              {data.planVsActual.planCount === 0 || data.planVsActual.machineRows.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">対象なし</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr>
                        <Mth>号機</Mth>
                        <Mth right>想定</Mth>
                        <Mth right>実績</Mth>
                        <Mth right>達成率</Mth>
                      </tr>
                    </thead>
                    <tbody>
                      {data.planVsActual.machineRows.map((m) => (
                        <tr key={m.machineNo} className="border-b border-[#F1F5F9] last:border-b-0">
                          <Mtd>{m.machineNo}号機</Mtd>
                          <Mtd right>{m.expected > 0 ? nf(m.expected) : "-"}</Mtd>
                          <Mtd right>{m.expected > 0 ? nf(m.actual) : "-"}</Mtd>
                          <Mtd right>
                            {m.pct == null ? (
                              <span className="text-[#9CA3AF]">-</span>
                            ) : (
                              <AchievementBadge actual={m.actual} expected={m.expected} />
                            )}
                          </Mtd>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="乖離の大きい計画 TOP5">
              {data.planVsActual.worst5.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">対象なし</div>
              ) : (
                data.planVsActual.worst5.map((w) => (
                  <div
                    key={w.planId}
                    className="flex items-baseline gap-2 border-b border-[#F1F5F9] py-1.5 text-[12px] last:border-b-0"
                  >
                    <span className="shrink-0 whitespace-nowrap text-[#6B7280]">
                      {shortJstDate(w.planDate)} {w.machineNo}号機
                    </span>
                    <span
                      className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                      title={w.patternName}
                    >
                      {w.patternName}
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-[#6B7280]">
                      {nf(w.expected)}→{nf(w.actual)}件
                    </span>
                    <AchievementBadge actual={w.actual} expected={w.expected} />
                  </div>
                ))
              )}
              <div className="mt-2 text-[11px] text-[#6B7280]">
                達成率 {Math.round(ACHIEVEMENT_ALERT * 100)}%未満＝赤 /{" "}
                {Math.round(ACHIEVEMENT_WARN * 100)}%未満＝琥珀。慢性的に低い号機・パターンはリスト枯渇のサイン。
              </div>
            </Card>
          </div>

          {/* 条件軸別 使用構成 */}
          <Band
            title="条件軸別の使用構成（使用率）"
            note="期間内の変更回数ベース / 未分類＝条件パース不能の移行パターン"
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <DonutCard title="エリア別" center={`エリア\n${total}回`} entries={data.axes.area} total={total} colors={AREA_COLORS} />
            <DonutCard title="送信状態別" center={`送信状態\n${total}回`} entries={data.axes.sendStatus} total={total} colors={SEND_COLORS} />
            <BarCard title="登録日区分別" entries={data.axes.regist} total={total} />
            <BarCard title="卒業年度帯別" sub="年代の代替指標" entries={trimTopEntries(data.axes.gradYear, 4)} total={total} />
            <BarCard title="経験社数別" entries={data.axes.companyCount} total={total} />
            <Card title="パターン使用回数 TOP5">
              {data.top5.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">データがありません</div>
              ) : (
                data.top5.map((t, i) => (
                  <HRow
                    key={t.name}
                    name={t.name}
                    width={data.top5[0].count > 0 ? (t.count / data.top5[0].count) * 100 : 0}
                    color={BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]}
                    right={`${t.count}回`}
                  />
                ))
              )}
            </Card>
          </div>

          {/* アラート */}
          <Band title="ローテーション注意" note="連続使用と枯渇の検知" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="3日以内の連続使用（同一パターン）">
              {data.alerts.continuousUse.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">該当なし</div>
              ) : (
                data.alerts.continuousUse.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-2 border-b border-[#F1F5F9] py-1.5 text-[12px] last:border-b-0"
                  >
                    <span className="shrink-0 rounded-[4px] bg-[#FEF2F2] px-1.5 py-0.5 text-[10.5px] font-bold text-[#DC2626]">
                      連続
                    </span>
                    <span className="min-w-0 break-all">
                      {a.machineNos.map((n) => `${n}号機`).join("・")}: {a.patternName}（3日間で
                      {a.count}回）
                    </span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[#6B7280]">
                      最終 {shortJstDateTime(a.lastAt)}
                    </span>
                  </div>
                ))
              )}
            </Card>
            <Card title="検索件数の下降（撃ち尽くしサイン）">
              {data.alerts.searchDrop.length === 0 ? (
                <div className="py-4 text-center text-[12px] text-[#9CA3AF]">該当なし</div>
              ) : (
                data.alerts.searchDrop.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-2 border-b border-[#F1F5F9] py-1.5 text-[12px] last:border-b-0"
                  >
                    <span
                      className={
                        a.dropPct >= 30
                          ? "shrink-0 rounded-[4px] bg-[#FEF2F2] px-1.5 py-0.5 text-[10.5px] font-bold text-[#DC2626]"
                          : "shrink-0 rounded-[4px] bg-[#FFFBEB] px-1.5 py-0.5 text-[10.5px] font-bold text-[#D97706]"
                      }
                    >
                      ▼{a.dropPct}%
                    </span>
                    <span className="min-w-0 break-all">
                      {a.machineNo}号機: {a.patternName} 直近 {nf(a.prevCount)}→{nf(a.lastCount)}件
                    </span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[#6B7280]">
                      {shortJstDate(a.lastAt)}
                    </span>
                  </div>
                ))
              )}
              <div className="mt-2 text-[11px] text-[#6B7280]">
                直近2回の検索件数を比較し、-{Math.round(SEARCH_COUNT_DROP_THRESHOLD * 100)}
                %超で表示。開放日パターンへの切替やエリア変更の判断材料。
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* クリップボード不可環境向けフォールバック */}
      {promptModalText != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPromptModalText(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-[720px] flex-col rounded-[10px] bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#1E3A5F]">分析用プロンプト</span>
              <span className="text-[12px] text-[#6B7280]">
                自動コピーできなかったため、全文を選択してコピーしてください
              </span>
            </div>
            <textarea
              readOnly
              value={promptModalText}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-[320px] flex-1 rounded-[6px] border border-[#E5E7EB] p-2 font-mono text-[12px]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(promptModalText)
                    .then(() => {
                      toast.success("コピーしました");
                      setPromptModalText(null);
                    })
                    .catch(() => toast.error("コピーできませんでした。全文を選択してコピーしてください"));
                }}
                className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8]"
              >
                コピー
              </button>
              <button
                onClick={() => setPromptModalText(null)}
                className="rounded-[6px] border border-[#D1D5DB] px-4 py-1.5 text-[13px]"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 小物コンポーネント ----

function Kpi({
  label,
  value,
  warn,
  children,
}: {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-3">
      <div className="mb-1 text-[11.5px] text-[#6B7280]">{label}</div>
      <div className={`text-[22px] font-bold ${warn ? "text-[#DC2626]" : "text-[#1F2937]"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px]">{children}</div>
    </div>
  );
}

function Diff({ diff, suffix }: { diff: number; suffix: string }) {
  if (diff > 0)
    return <span className="text-[#059669]">前期間 +{nf(diff)}{suffix}</span>;
  if (diff < 0) return <span className="text-[#DC2626]">前期間 {nf(diff)}{suffix}</span>;
  return <span className="text-[#6B7280]">前期間 ±0{suffix}</span>;
}

// 達成率バッジ。閾値は dashboard.ts の ACHIEVEMENT_WARN / ACHIEVEMENT_ALERT に集約
function AchievementBadge({
  actual,
  expected,
  large,
}: {
  actual: number;
  expected: number;
  large?: boolean;
}) {
  if (expected <= 0) return <span className="text-[#9CA3AF]">-</span>;
  const level = achievementLevel(actual, expected);
  const tone =
    level === "alert"
      ? "bg-[#FEE2E2] text-[#DC2626]"
      : level === "warn"
        ? "bg-[#FEF3C7] text-[#B45309]"
        : "bg-[#ECFDF5] text-[#059669]";
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-[4px] font-bold tabular-nums ${tone} ${
        large ? "px-2 py-1 text-[15px]" : "px-1.5 py-0.5 text-[10.5px]"
      }`}
    >
      {Math.round((actual / expected) * 100)}%
    </span>
  );
}

function Band({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2.5 mt-5 flex items-center justify-between rounded-[6px] bg-[#EFF6FF] px-3 py-1.5 text-[13.5px] font-bold text-[#1E3A5F]">
      {title}
      <small className="font-normal text-[#6B7280]">{note}</small>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3.5">
      <h3 className="mb-2.5 text-[12.5px] font-bold text-[#1E3A5F]">
        {title}
        {sub && <small className="ml-1.5 font-normal text-[#6B7280]">{sub}</small>}
      </h3>
      {children}
    </div>
  );
}

function HRow({
  name,
  width,
  color,
  right,
}: {
  name: string;
  width: number;
  color: string;
  right: string;
}) {
  return (
    <div className="my-1.5 grid grid-cols-[130px_1fr_48px] items-center gap-2 text-[12px]">
      <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={name}>
        {name}
      </span>
      <div className="h-4 overflow-hidden rounded-[4px] bg-[#F1F5F9]">
        <div className="h-full rounded-[4px]" style={{ width: `${width}%`, background: color }} />
      </div>
      <span className="text-right text-[#6B7280] tabular-nums">{right}</span>
    </div>
  );
}

function BarCard({
  title,
  sub,
  entries,
  total,
}: {
  title: string;
  sub?: string;
  entries: AxisEntry[];
  total: number;
}) {
  return (
    <Card title={title} sub={sub}>
      {total === 0 ? (
        <div className="py-4 text-center text-[12px] text-[#9CA3AF]">データがありません</div>
      ) : (
        entries.map((e, i) => (
          <HRow
            key={e.label}
            name={e.label}
            width={axisPct(e.count, total)}
            color={barColor(i, e.label)}
            right={`${axisPct(e.count, total)}%`}
          />
        ))
      )}
    </Card>
  );
}

function DonutCard({
  title,
  center,
  entries,
  total,
  colors,
}: {
  title: string;
  center: string;
  entries: AxisEntry[];
  total: number;
  colors: string[];
}) {
  // conic-gradient は丸め前の実比率で描く（合計がぴったり100%になるように）
  let acc = 0;
  const stops: string[] = [];
  entries.forEach((e, i) => {
    if (total === 0 || e.count === 0) return;
    const start = (acc / total) * 100;
    acc += e.count;
    const end = (acc / total) * 100;
    stops.push(`${colors[i % colors.length]} ${start}% ${end}%`);
  });
  return (
    <Card title={title}>
      {total === 0 ? (
        <div className="py-4 text-center text-[12px] text-[#9CA3AF]">データがありません</div>
      ) : (
        <div className="flex items-center gap-4">
          <div
            className="relative h-[120px] w-[120px] flex-none rounded-full"
            style={{ background: `conic-gradient(${stops.join(", ")})` }}
          >
            <div className="absolute inset-[26px] flex items-center justify-center whitespace-pre-line rounded-full bg-white text-center text-[11px] text-[#6B7280]">
              {center}
            </div>
          </div>
          <div className="min-w-0 flex-1 text-[11.5px]">
            {entries.map((e, i) => (
              <div key={e.label} className="my-1 flex items-center gap-1.5">
                <span
                  className="h-[9px] w-[9px] flex-none rounded-[2px]"
                  style={{ background: colors[i % colors.length] }}
                />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{e.label}</span>
                <b className="ml-auto pl-2 tabular-nums">
                  {axisPct(e.count, total)}%（{e.count}回）
                </b>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v != null);
  const max = nums.length ? Math.max(...nums) : 0;
  return (
    <span className="inline-flex h-6 items-end gap-[2px]">
      {values.map((v, i) => (
        <i
          key={i}
          className="block w-[7px] rounded-t-[2px]"
          style={{
            height: v == null || max === 0 ? 3 : Math.max(4, Math.round((v / max) * 22)),
            background:
              v == null ? "#E5E7EB" : i === values.length - 1 ? "#2563EB" : "#BFDBFE",
          }}
        />
      ))}
    </span>
  );
}

function Mth({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[#E5E7EB] px-2 py-1.5 text-[12px] font-semibold text-[#6B7280] ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Mtd({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 py-2 align-middle ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
