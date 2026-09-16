"use client";

// T-194: 一覧（列で分ける形）。横幅が足りない分は横スクロール。
// 予約日と配信日は同じ列に2行（1行目=予約登録日時、2行目=配信日）。送信件数10件未満は枯渇として行ごと色を変える。
// T-197: 先頭に NO（レコード番号 1-001）列を追加。操作列の「詳細」は「条件設定」に置き換え。
// T-198: 作成日列を削除し、実行日時列を予約日/配信日の右隣へ移した（実行済みかどうかを左寄りで確認できるようにするため）。
// T-203: 抽出・送信は最新1件ではなくその条件の全実行の合計（枯渇回も含む）。実行日時は最新のまま。枯渇判定は従来どおり最新1件で見る（isDryRow）。
// T-202: 横スクロールを減らすため、検索対象/登録日・ログイン/卒業年度・経験社数/居住地・希望勤務地/配信テンプレートを
//   予約日/配信日と同じ「1列2段」にまとめた（各段の書式は従来のまま）。予約の並び替え（▲▼）はチェックボックスの右隣へ移動。
//   ▲▼の更新は PATCH ではなく bulk(action=move) を通るので、T-201 の「実績があると状態以外は変えられない」ロックの対象外（従来どおり動く）。
// T-204: 複製直後の複製元・複製先（pinnedIds）は絞り込みの対象外でも出すので、どの行かが分かるよう黄色で塗る。
//   枯渇（送信10件未満）の赤とは別色にし、枯渇と重なったときは黄色を優先する（例外表示であることを見失わないため。
//   枯渇であることは「枯渇」バッジと送信件数の赤字が残るので分かる）。
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

const TH = "sticky top-0 z-[1] whitespace-nowrap border-b border-[#E5E7EB] bg-[#F9FAFB] px-1.5 py-2 text-left text-[11px] font-semibold text-[#6B7280]";
const TD = "whitespace-nowrap border-b border-[#F3F4F6] px-1.5 py-1.5 align-top text-[12px] text-[#374151]";
const MOVE_BTN = "px-1 py-0.5 text-[10px] leading-none text-[#374151] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30";
const COLUMN_COUNT = 15;

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
  pinnedIds,
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
  /** T-204: 絞り込みの対象外でも表示している行（複製元・複製先）。黄色で塗って区別する */
  pinnedIds: string[];
  /** T-195: 号機内の予約列での先頭／末尾判定（絞り込み前の全件から計算） */
  queueBounds: Record<string, { canUp: boolean; canDown: boolean }>;
}) {
  const pinned = new Set(pinnedIds);
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
            <th className={`${TH} px-1`}>
              <span className="sr-only">予約の並び替え</span>
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
            <th className={TH}>
              検索対象
              <br />
              登録日
            </th>
            <th className={TH}>
              ログイン
              <br />
              卒業年度
            </th>
            <th className={TH}>
              経験社数
              <br />
              居住地
            </th>
            <th className={TH}>
              希望勤務地
              <br />
              配信テンプレート
            </th>
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
            const isPinned = pinned.has(c.id);
            const run = c.latestRun;
            const hasRuns = c.runs.length > 0;
            // T-203: 抽出・送信は全実行の合計を出すので、何回分かをホバーで補う
            const runsTitle = hasRuns ? `全${c.runs.length}回の合計` : undefined;
            const bounds = queueBounds[c.id] ?? { canUp: false, canDown: false };
            // T-202: 並び替えは従来どおり「予約」の行だけ。予約以外は押せない見た目で置いておく
            const queued = c.status === "QUEUED";
            return (
              <tr
                key={c.id}
                onClick={() => onEdit(c)}
                className={[
                  "cursor-pointer transition-colors",
                  isPinned
                    ? "bg-[#FEF9C3] hover:bg-[#FEF08A]"
                    : dry
                      ? "bg-[#FEF2F2] hover:bg-[#FEE2E2]"
                      : "hover:bg-[#F9FAFB]",
                ].join(" ")}
              >
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} aria-label="選択" />
                </td>
                <td className={`${TD} px-1`} onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex flex-col overflow-hidden rounded border border-[#D1D5DB]">
                    <button
                      type="button"
                      onClick={() => onMove(c, "up")}
                      disabled={!queued || !bounds.canUp}
                      title="予約の順番を上へ（同じ号機の中だけ）"
                      aria-label="上へ"
                      className={MOVE_BTN}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(c, "down")}
                      disabled={!queued || !bounds.canDown}
                      title="予約の順番を下へ（同じ号機の中だけ）"
                      aria-label="下へ"
                      className={`${MOVE_BTN} border-t border-[#D1D5DB]`}
                    >
                      ▼
                    </button>
                  </span>
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
                <td className={TD}>
                  <div>{searchTargetLabel(c.searchTarget)}</div>
                  <div>
                    <span className="text-[10px] text-[#6B7280]">{c.registDateMode === "PERIOD" ? "期間" : "日付"}</span>{" "}
                    {registDateLabel(c)}
                  </div>
                </td>
                <td className={TD}>
                  <div>{periodDaysLabel(c.lastLoginDays)}</div>
                  <div>{gradYearRangeLabel(c.gradYearFrom, c.gradYearTo)}</div>
                </td>
                <td className={TD}>
                  <div>{companyCountLabel(c.companyCount)}</div>
                  <div
                    className="max-w-[160px] whitespace-normal"
                    title={c.residencePrefectures.join("/") || undefined}
                  >
                    {areaLabel(c.residenceMode, c.residencePrefectures)}
                  </div>
                </td>
                <td className={TD}>
                  <div className="max-w-[200px] whitespace-normal" title={c.workPrefectures.join("/") || undefined}>
                    <span className="whitespace-nowrap">{workPrefLabel(c.workPrefMode, c.workPrefectures)}</span>
                    {c.workPrefMode !== "ALL" && c.workPrefectures.length > 0 && !isDefaultWorkPrefectures(c.workPrefectures) && (
                      <div className="text-[10px] text-[#6B7280]">{summarizePrefectures(c.workPrefectures)}</div>
                    )}
                  </div>
                  <div className="max-w-[160px] truncate" title={c.templateName ?? undefined}>
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
                  </div>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{c.plannedCount ?? "-"}</td>
                <td className={`${TD} text-right tabular-nums`} title={runsTitle}>
                  {c.totalExtractedCount ?? "-"}
                </td>
                <td className={`${TD} text-right tabular-nums ${dry ? "font-semibold text-[#B91C1C]" : ""}`} title={runsTitle}>
                  {c.totalSentCount ?? "-"}
                </td>
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(c)}
                      className="rounded border border-[#2563EB] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#1D4ED8] hover:bg-[#EFF6FF]"
                    >
                      条件設定
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(c)}
                      className="rounded border border-[#D1D5DB] px-1.5 py-0.5 text-[11px] text-[#374151] hover:bg-white"
                    >
                      複製
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      disabled={hasRuns}
                      title={hasRuns ? "実績があるため削除できません（状態を「完了」にしてください）" : undefined}
                      className="rounded border border-[#FECACA] px-1.5 py-0.5 text-[11px] text-[#B91C1C] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      削除
                    </button>
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
