"use client";

// T-214: 編集モーダルの右パネル「同日の他号機の条件」。
// 対象は他の稼働中号機の条件で、配信日がフォームの配信日と同じもの（配信日が空なら今日）。状態は有効・予約のみ。
// 1行: 号機・レコード番号・状態バッジ・検索条件の要約（一覧の2段の要約を横に詰めたもの）・テンプレート名。
// 重なる行（フォームの入力と 7 軸すべてが交わる。判定は overlap.ts）は赤い背景にする。データは親（モーダル）が持つ。
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  periodDaysLabel,
  searchTargetLabel,
  workPrefLabel,
} from "@/lib/scout-conditions/constants";
import { formatYmdWithWeekday } from "@/lib/scout-conditions/dates";
import type { ConditionDto } from "@/lib/scout-conditions/types";
import { STATUS_BADGE } from "./ConditionTable";
import { MachineLabel } from "./MachineLabel";
import { registDateLabel } from "./filter";

export default function SameDayPanel({
  date,
  rows,
  loading,
  overlapIds,
  onOpen,
}: {
  /** 見出しに出す日付（"YYYY-MM-DD"） */
  date: string;
  rows: ConditionDto[];
  loading: boolean;
  /** フォームの入力と重なる行の id */
  overlapIds: Set<string>;
  /** 行のレコード番号クリックでその条件を開く（任意） */
  onOpen?: (c: ConditionDto) => void;
}) {
  return (
    <aside className="rounded-[4px] border border-[#E5E7EB]">
      <div className="flex items-baseline gap-2 border-l-4 border-[#6B7280] bg-[#F3F4F6] px-3 py-1.5">
        <span className="text-[13px] font-bold text-[#374151]">同日の他号機</span>
        <span className="text-[11px] text-[#6B7280]">{formatYmdWithWeekday(date)}・有効/予約のみ</span>
        {overlapIds.size > 0 && (
          <span className="ml-auto rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[10px] font-semibold text-[#B91C1C]">重なり {overlapIds.size}件</span>
        )}
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {loading && rows.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-[#9CA3AF]">読み込み中…</div>}
        {!loading && rows.length === 0 && (
          <div className="px-3 py-6 text-center text-[12px] text-[#9CA3AF]">同日の他号機の条件はありません</div>
        )}
        {rows.map((c) => {
          const hit = overlapIds.has(c.id);
          return (
            <div
              key={c.id}
              className={["border-b border-[#F3F4F6] px-3 py-2 text-[11px] leading-snug last:border-b-0", hit ? "bg-[#FEE2E2]" : "bg-white"].join(" ")}
              title={hit ? "この条件と検索条件が重なっています（7軸すべてが交わる）" : undefined}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <MachineLabel machineNo={c.machineNo} compact />
                <button
                  type="button"
                  onClick={onOpen ? () => onOpen(c) : undefined}
                  className={`font-mono font-semibold tabular-nums ${onOpen ? "text-[#1D4ED8] underline decoration-dotted underline-offset-2" : "text-[#374151]"}`}
                >
                  {c.recordNo ?? "-"}
                </button>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[c.status] ?? ""}`}>{conditionStatusLabel(c.status)}</span>
                {c.status === "QUEUED" && <span className="text-[10px] text-[#6B7280]">#{c.queueOrder}</span>}
                {hit && <span className="rounded border border-[#FCA5A5] bg-white px-1 py-0.5 text-[10px] font-medium text-[#B91C1C]">重なり</span>}
              </div>
              {/* 一覧の2段の要約を横に詰めたもの（検索対象/登録日・ログイン/卒業年度・経験社数/居住地・希望勤務地） */}
              <div className="mt-1 whitespace-normal text-[#374151]">
                {searchTargetLabel(c.searchTarget)}／{registDateLabel(c)}／ログイン{periodDaysLabel(c.lastLoginDays)}／卒{gradYearRangeLabel(c.gradYearFrom, c.gradYearTo)}／
                {companyCountLabel(c.companyCount)}／居住地 {areaLabel(c.residenceMode, c.residencePrefectures)}／勤務地 {workPrefLabel(c.workPrefMode, c.workPrefectures)}
              </div>
              <div className="mt-0.5 truncate text-[#6B7280]" title={c.templateName ?? undefined}>
                {c.templateName ?? <span className="text-[#9CA3AF]">テンプレート未設定</span>}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
