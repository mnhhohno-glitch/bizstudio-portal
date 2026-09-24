"use client";

// T-213: 「実行履歴」サブタブ（/scout/conditions?view=runs）。1行＝scout_runs 1件を実行日時の新しい順に出す。
// 同じ条件が1日に何回も走る（1回50人前後）ため、条件一覧の「最新の実行日時」だけでは履歴が追えなかった。
// 列は条件一覧と同じ2段組み・同じ見た目に揃える。絞り込み（期間・号機・枯渇のみ・文字検索）はサーバー側
// （GET /api/scout/runs）で行い、100件ずつページングする。CSV は表示中の行を出す。
// 条件側の項目（検索条件の要約・テンプレート名・状態）は「その条件に現在設定されているもの」（実行時の値は RPA から届かない）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  isDrySentCount,
  periodDaysLabel,
  ratePercentLabel,
  searchTargetLabel,
  templateKindLabel,
  workPrefLabel,
  isDefaultWorkPrefectures,
  summarizePrefectures,
} from "@/lib/scout-conditions/constants";
import { addDaysYmd, jstTodayYmd, type HolidayMap } from "@/lib/scout-conditions/dates";
import type { MachineDto, RunHistoryResponse } from "@/lib/scout-conditions/types";
import { FilterField, FilterMultiSelectField, FILTER_INPUT_CLS } from "@/components/filters/FilterLayout";
import { DateTimeText } from "./DateText";
import { MachineLabel } from "./MachineLabel";
import { STATUS_BADGE } from "./ConditionTable";
import { buildRunsCsv, registDateLabel } from "./filter";

const TH = "sticky top-0 z-[1] whitespace-nowrap border-b border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2 text-left text-[11px] font-semibold text-[#6B7280]";
const TD = "whitespace-nowrap border-b border-[#F3F4F6] px-2 py-1.5 align-top text-[12px] text-[#374151]";
const COLUMN_COUNT = 9;

export default function RunHistory({
  machines,
  holidays,
  onOpenCondition,
}: {
  machines: MachineDto[];
  holidays: HolidayMap;
  /** レコード番号クリックでその条件の編集モーダル（既存）を開く */
  onOpenCondition: (conditionId: string) => void;
}) {
  const today = jstTodayYmd();
  // 既定は直近7日（今日を含む7日間）。開始のみ／終了のみも可。両方空なら全期間
  const [range, setRange] = useState<{ from: string; to: string }>({ from: addDaysYmd(today, -6), to: today });
  // 号機: null＝まだ触っていない（全号機）。空配列＝全解除（絞り込みなし）。条件一覧と同じ約束
  const [machineSel, setMachineSel] = useState<number[] | null>(null);
  const [dryOnly, setDryOnly] = useState(false);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RunHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const machineOptions = useMemo(
    () =>
      [...machines]
        .sort((a, b) => a.machineNo - b.machineNo)
        .map((m) => ({ value: String(m.machineNo), label: `${m.machineNo}号機` })),
    [machines],
  );
  const allMachineNos = useMemo(() => machineOptions.map((o) => Number(o.value)), [machineOptions]);
  const selectedMachineNos = machineSel ?? allMachineNos;

  // 文字検索は入力が止まってから反映する（1文字ごとに叩かない）
  useEffect(() => {
    const h = window.setTimeout(() => setQ(qInput.trim()), 400);
    return () => window.clearTimeout(h);
  }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (range.from) sp.set("from", range.from);
      if (range.to) sp.set("to", range.to);
      // 全号機選択＝絞り込みなし（machines を付けない）
      if (selectedMachineNos.length > 0 && selectedMachineNos.length < allMachineNos.length) sp.set("machines", selectedMachineNos.join(","));
      if (dryOnly) sp.set("dry", "1");
      if (q) sp.set("q", q);
      sp.set("page", String(page));
      const res = await fetch(`/api/scout/runs?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error("実行履歴の読み込みに失敗しました");
        return;
      }
      setData((await res.json()) as RunHistoryResponse);
    } finally {
      setLoading(false);
    }
  }, [range, selectedMachineNos, allMachineNos.length, dryOnly, q, page]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // 絞り込みを変えたら1ページ目に戻す
  const resetPage = () => setPage(1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 100;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const downloadCsv = () => {
    if (rows.length === 0) {
      toast.error("出力する行がありません");
      return;
    }
    const blob = new Blob([buildRunsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scout-runs_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* 絞り込み（条件一覧と同じ部品・同じ並び。日付タブは使わず期間指定のみ） */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-[#E5E7EB] px-4 py-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <FilterField label="期間（実行日時）">
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={range.from}
                onChange={(e) => {
                  resetPage();
                  setRange((r) => ({ ...r, from: e.target.value }));
                }}
                className={`w-[140px] ${FILTER_INPUT_CLS}`}
              />
              <span className="text-xs text-gray-400">〜</span>
              <input
                type="date"
                value={range.to}
                onChange={(e) => {
                  resetPage();
                  setRange((r) => ({ ...r, to: e.target.value }));
                }}
                className={`w-[140px] ${FILTER_INPUT_CLS}`}
              />
              <button
                type="button"
                onClick={() => {
                  resetPage();
                  setRange({ from: addDaysYmd(today, -6), to: today });
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-[#2563EB] hover:bg-gray-50"
                title="今日を含む直近7日に戻す"
              >
                直近7日
              </button>
              <button
                type="button"
                onClick={() => {
                  resetPage();
                  setRange({ from: "", to: "" });
                }}
                disabled={!range.from && !range.to}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-[#2563EB] hover:bg-gray-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
              >
                クリア
              </button>
            </div>
          </FilterField>

          <FilterMultiSelectField
            label="号機"
            options={machineOptions}
            selected={selectedMachineNos.map(String)}
            onChange={(next) => {
              resetPage();
              setMachineSel(next.map(Number));
            }}
            width="w-44"
            panelWidth="w-44"
            allLabel="全号機"
            allSelectedLabel="全号機"
            listSeparator=", "
          />

          <FilterField label="枯渇">
            <label className="flex h-[34px] items-center gap-1.5 text-[13px] text-[#374151]">
              <input
                type="checkbox"
                checked={dryOnly}
                onChange={(e) => {
                  resetPage();
                  setDryOnly(e.target.checked);
                }}
              />
              枯渇のみ
            </label>
          </FilterField>

          <FilterField label="文字検索">
            <input
              type="text"
              value={qInput}
              onChange={(e) => {
                resetPage();
                setQInput(e.target.value);
              }}
              placeholder="NO／検索条件／テンプレート名／担当者名"
              className={`w-[280px] ${FILTER_INPUT_CLS}`}
            />
          </FilterField>
        </div>

        <FilterField label="　">
          <div className="flex h-[34px] items-center text-[12px] text-[#6B7280]">
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-[#2563EB] underline" title="最新の状態を読み直す">
              再読込
            </button>
          </div>
        </FilterField>
      </div>

      {/* ツールバー: 総件数・ページング・CSV */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2 text-[12px]">
        <span className="text-[#374151]">
          全 <span className="font-semibold">{total}</span> 件
          {total > 0 && (
            <span className="ml-1 text-[#6B7280]">
              （{(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total)} 件を表示）
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40"
          >
            ‹ 前の100件
          </button>
          <span className="px-1 text-[#6B7280]">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-40"
          >
            次の100件 ›
          </button>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[#374151] hover:bg-[#F3F4F6]"
          title="表示中の行を出力"
        >
          CSVダウンロード（表示中）
        </button>
        <span className="ml-auto text-[11px] text-[#9CA3AF]">送信件数が10件未満の行は枯渇として赤く表示します</span>
      </div>

      {loading && !data ? (
        <div className="px-4 py-10 text-center text-[13px] text-[#9CA3AF]">読み込み中…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className={`${TH} w-[9%]`}>実行日時</th>
                <th className={`${TH} w-[6%]`}>
                  号機
                  <br />
                  担当者
                </th>
                <th className={`${TH} w-[7%]`}>条件</th>
                <th className={`${TH} w-[12%]`}>
                  検索対象
                  <br />
                  登録日
                </th>
                <th className={`${TH} w-[8%]`}>
                  ログイン
                  <br />
                  卒業年度
                </th>
                <th className={`${TH} w-[10%]`}>
                  経験社数
                  <br />
                  居住地
                </th>
                <th className={`${TH} w-[34%]`}>
                  希望勤務地
                  <br />
                  配信テンプレート
                </th>
                <th className={`${TH} w-[6%]`}>結果</th>
                <th className={`${TH} w-[8%]`}>
                  抽出
                  <br />
                  送信
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center text-[13px] text-[#9CA3AF]">
                    該当する実行履歴はありません
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const dry = r.isDry || isDrySentCount(r.sentCount);
                const sentRate = ratePercentLabel(r.sentCount, r.extractedCount);
                return (
                  <tr key={r.id} className={dry ? "bg-[#FEF2F2] hover:bg-[#FEE2E2]" : "hover:bg-[#F9FAFB]"}>
                    <td className={TD}>
                      <div>
                        <DateTimeText iso={r.executedAt} holidays={holidays} />
                      </div>
                      <div>
                        {dry ? (
                          <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-medium text-[#B91C1C]">枯渇</span>
                        ) : (
                          <span className="text-[#9CA3AF]">-</span>
                        )}
                      </div>
                    </td>
                    <td className={TD}>
                      <MachineLabel machineNo={r.machineNo} stacked />
                    </td>
                    <td className={TD}>
                      <button
                        type="button"
                        onClick={() => onOpenCondition(r.conditionId)}
                        className="font-mono font-semibold tabular-nums text-[#1D4ED8] underline decoration-dotted underline-offset-2 hover:text-[#2563EB]"
                        title="この条件の設定を開く"
                      >
                        {r.recordNo ?? "-"}
                      </button>
                      <div>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[r.status] ?? ""}`}>
                          {conditionStatusLabel(r.status)}
                        </span>
                      </div>
                    </td>
                    <td className={TD}>
                      <div>{searchTargetLabel(r.searchTarget)}</div>
                      <div>
                        <span className="text-[10px] text-[#6B7280]">{r.registDateMode === "PERIOD" ? "期間" : "日付"}</span> {registDateLabel(r)}
                      </div>
                    </td>
                    <td className={TD}>
                      <div>{periodDaysLabel(r.lastLoginDays)}</div>
                      <div>{gradYearRangeLabel(r.gradYearFrom, r.gradYearTo)}</div>
                    </td>
                    <td className={TD}>
                      <div>{companyCountLabel(r.companyCount)}</div>
                      <div className="max-w-[160px] whitespace-normal" title={r.residencePrefectures.join("/") || undefined}>
                        {areaLabel(r.residenceMode, r.residencePrefectures)}
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="max-w-[380px] whitespace-normal" title={r.workPrefectures.join("/") || undefined}>
                        <span className="whitespace-nowrap">{workPrefLabel(r.workPrefMode, r.workPrefectures)}</span>
                        {r.workPrefMode !== "ALL" && r.workPrefectures.length > 0 && !isDefaultWorkPrefectures(r.workPrefectures) && (
                          <div className="text-[10px] text-[#6B7280]">{summarizePrefectures(r.workPrefectures)}</div>
                        )}
                      </div>
                      <div className="max-w-[380px] truncate" title={r.templateName ?? undefined}>
                        {r.templateName ? (
                          <>
                            <span className="mr-1 rounded bg-[#F3F4F6] px-1 text-[10px] text-[#6B7280]">{templateKindLabel(r.templateKind)}</span>
                            {r.templateName}
                          </>
                        ) : (
                          <span className="text-[#9CA3AF]">未設定</span>
                        )}
                      </div>
                    </td>
                    {/* その実行の検索結果件数（母数）。RPA が送ってこない実行は "-" */}
                    <td className={`${TD} tabular-nums`}>
                      <div>{r.searchResultCount ?? "-"}</div>
                    </td>
                    <td className={`${TD} tabular-nums`}>
                      <div>{r.extractedCount}</div>
                      <div className={dry ? "font-semibold text-[#B91C1C]" : "text-[#6B7280]"}>
                        {r.sentCount}
                        {sentRate ? ` (${sentRate})` : ""}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
