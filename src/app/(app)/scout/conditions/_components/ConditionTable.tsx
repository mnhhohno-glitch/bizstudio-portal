"use client";

// T-194: 一覧（列で分ける形）。横幅が足りない分は横スクロール。
// 予約日と配信日は同じ列に2行（1行目=予約登録日時、2行目=配信日）。送信件数10件未満は枯渇として行ごと色を変える。
// T-197: 先頭に NO（レコード番号 1-001）列を追加。操作列の「詳細」は「条件設定」に置き換え。
// T-198: 作成日列を削除し、実行日時列を予約日/配信日の右隣へ移した（実行済みかどうかを左寄りで確認できるようにするため）。
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  periodDaysLabel,
  searchTargetLabel,
  templateKindLabel,
  workPrefLabel,
  isDefaultWorkPrefectures,
  summarizePrefectures,
} from "@/lib/scout-conditions/constants";
import { type HolidayMap } from "@/lib/scout-conditions/dates";
import type { ConditionDto } from "@/lib/scout-conditions/types";
import { DateText, DateTimeText } from "./DateText";
import { MachineLabel } from "./MachineLabel";
import { isDryRow, registDateLabel } from "./filter";

const STATUS_BADGE: Record<string, string> = {
  RUNNING: "bg-[#DCFCE7] text-[#15803D]",
  QUEUED: "bg-[#DBEAFE] text-[#1D4ED8]",
  DRY: "bg-[#FEE2E2] text-[#B91C1C]",
  DONE: "bg-[#E5E7EB] text-[#4B5563]",
};

const TH = "sticky top-0 z-[1] whitespace-nowrap border-b border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2 text-left text-[11px] font-semibold text-[#6B7280]";
const TD = "whitespace-nowrap border-b border-[#F3F4F6] px-2 py-1.5 align-top text-[12px] text-[#374151]";
const COLUMN_COUNT = 18;

export default function ConditionTable({
  rows,
  holidays,
  selected,
  onToggle,
  onToggleAll,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
  queueBounds,
}: {
  rows: ConditionDto[];
  holidays: HolidayMap;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  /** 行クリック／「条件設定」で値入りの中央モーダルを開く */
  onEdit: (c: ConditionDto) => void;
  onDuplicate: (c: ConditionDto) => void;
  onDelete: (c: ConditionDto) => void;
  /** T-195: 予約（QUEUED）の上へ／下へ。同じ号機の中でだけ入れ替える */
  onMove: (c: ConditionDto, direction: "up" | "down") => void;
  /** T-195: 号機内の予約列での先頭／末尾判定（絞り込み前の全件から計算） */
  queueBounds: Record<string, { canUp: boolean; canDown: boolean }>;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.id));

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={(e) => onToggleAll(e.target.checked)}
                aria-label="すべて選択"
              />
            </th>
            <th className={TH}>NO</th>
            <th className={TH}>号機</th>
            <th className={TH}>状態</th>
            <th className={TH}>
              予約日
              <br />
              配信日
            </th>
            <th className={TH}>実行日時</th>
            <th className={TH}>検索対象</th>
            <th className={TH}>登録日</th>
            <th className={TH}>ログイン</th>
            <th className={TH}>卒業年度</th>
            <th className={TH}>経験社数</th>
            <th className={TH}>居住地</th>
            <th className={TH}>希望勤務地</th>
            <th className={TH}>配信テンプレート</th>
            <th className={`${TH} text-right`}>予定</th>
            <th className={`${TH} text-right`}>抽出</th>
            <th className={`${TH} text-right`}>送信</th>
            <th className={TH}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center text-[13px] text-[#9CA3AF]">
                該当する配信条件はありません
              </td>
            </tr>
          )}
          {rows.map((c) => {
            const dry = isDryRow(c);
            const run = c.latestRun;
            const hasRuns = c.runs.length > 0;
            const bounds = queueBounds[c.id] ?? { canUp: false, canDown: false };
            return (
              <tr
                key={c.id}
                onClick={() => onEdit(c)}
                className={["cursor-pointer transition-colors", dry ? "bg-[#FEF2F2] hover:bg-[#FEE2E2]" : "hover:bg-[#F9FAFB]"].join(" ")}
              >
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} aria-label="選択" />
                </td>
                <td className={`${TD} font-mono font-semibold tabular-nums`}>{c.recordNo ?? "-"}</td>
                <td className={TD}>
                  <MachineLabel machineNo={c.machineNo} />
                </td>
                <td className={TD}>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[c.status] ?? ""}`}>
                    {conditionStatusLabel(c.status)}
                  </span>
                  {dry && c.status !== "DRY" && (
                    <span className="ml-1 rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-medium text-[#B91C1C]">枯渇</span>
                  )}
                  {c.status === "QUEUED" && <span className="ml-1 text-[10px] text-[#6B7280]">#{c.queueOrder}</span>}
                </td>
                <td className={TD}>
                  <div className="text-[11px] text-[#6B7280]">
                    <DateTimeText iso={c.createdAt} holidays={holidays} />
                  </div>
                  <div className="font-medium">
                    <DateText ymd={c.deliveryDate} holidays={holidays} />
                  </div>
                </td>
                <td className={TD}>
                  <DateTimeText iso={run?.executedAt} holidays={holidays} />
                </td>
                <td className={TD}>{searchTargetLabel(c.searchTarget)}</td>
                <td className={TD}>
                  <span className="text-[10px] text-[#6B7280]">{c.registDateMode === "PERIOD" ? "期間" : "日付"}</span>{" "}
                  {registDateLabel(c)}
                </td>
                <td className={TD}>{periodDaysLabel(c.lastLoginDays)}</td>
                <td className={TD}>{gradYearRangeLabel(c.gradYearFrom, c.gradYearTo)}</td>
                <td className={TD}>{companyCountLabel(c.companyCount)}</td>
                <td className={`${TD} max-w-[220px] !whitespace-normal`} title={c.residencePrefectures.join("/") || undefined}>
                  {areaLabel(c.residenceMode, c.residencePrefectures)}
                </td>
                <td className={`${TD} max-w-[220px] !whitespace-normal`} title={c.workPrefectures.join("/") || undefined}>
                  <span className="whitespace-nowrap">{workPrefLabel(c.workPrefMode, c.workPrefectures)}</span>
                  {c.workPrefMode !== "ALL" && c.workPrefectures.length > 0 && !isDefaultWorkPrefectures(c.workPrefectures) && (
                    <div className="text-[10px] text-[#6B7280]">{summarizePrefectures(c.workPrefectures)}</div>
                  )}
                </td>
                <td className={`${TD} max-w-[260px] truncate`} title={c.templateName ?? undefined}>
                  {c.templateName ? (
                    <>
                      <span className="mr-1 rounded bg-[#F3F4F6] px-1 text-[10px] text-[#6B7280]">
                        {templateKindLabel(c.templateKind)}
                      </span>
                      {c.templateName}
                    </>
                  ) : (
                    <span className="text-[#9CA3AF]">未設定</span>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{c.plannedCount ?? "-"}</td>
                <td className={`${TD} text-right tabular-nums`}>{run ? run.extractedCount : "-"}</td>
                <td className={`${TD} text-right tabular-nums ${dry ? "font-semibold text-[#B91C1C]" : ""}`}>
                  {run ? run.sentCount : "-"}
                </td>
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(c)}
                      className="rounded border border-[#2563EB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#1D4ED8] hover:bg-[#EFF6FF]"
                    >
                      条件設定
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(c)}
                      className="rounded border border-[#D1D5DB] px-2 py-0.5 text-[11px] text-[#374151] hover:bg-white"
                    >
                      複製
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      disabled={hasRuns}
                      title={hasRuns ? "実績があるため削除できません（状態を「完了」にしてください）" : undefined}
                      className="rounded border border-[#FECACA] px-2 py-0.5 text-[11px] text-[#B91C1C] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      削除
                    </button>
                    {c.status === "QUEUED" && (
                      <span className="ml-1 inline-flex overflow-hidden rounded border border-[#D1D5DB]">
                        <button
                          type="button"
                          onClick={() => onMove(c, "up")}
                          disabled={!bounds.canUp}
                          title="予約の順番を上へ（同じ号機の中だけ）"
                          aria-label="上へ"
                          className="px-1.5 py-0.5 text-[11px] text-[#374151] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => onMove(c, "down")}
                          disabled={!bounds.canDown}
                          title="予約の順番を下へ（同じ号機の中だけ）"
                          aria-label="下へ"
                          className="border-l border-[#D1D5DB] px-1.5 py-0.5 text-[11px] text-[#374151] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
