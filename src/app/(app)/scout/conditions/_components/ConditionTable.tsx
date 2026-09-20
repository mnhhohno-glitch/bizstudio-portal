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
// T-206-fix: 行内ボタンは w-full をやめて固定幅（設定・複製・削除で同じ幅）。w-full のままだと
//   whitespace-nowrap の中で複製と削除が横に並んでしまい、削除が列の外へはみ出して見えなくなっていた。
//   数値列（予測/結果・抽出/送信）は他の列に合わせて左寄せ。2段組みの上下は同じ文字サイズにする。
// T-206-fix2: 全 th を w-0（中身ぴったり）にしたせいで余った横幅が右端に固まり、左は全列が窮屈なままだった。
//   そこで 14 列すべてに % の幅を振り、合計 100% になるようにした（COL_W）。表は幅指定のない列に最低幅を配ってから
//   余りを % の比で配るので、% は「余りをどの列にどれだけ配るか」の重みとして効き、横スクロールは増えない
//   （% が中身より狭い列は中身の幅を取り、残りの列が比に応じて分け合う）。
//   文字が長くなりやすい列（希望勤務地/配信テンプレート・検索対象/登録日）へ多めに、
//   中身の長さが安定している列（状態・号機・NO・複製/削除・数値）へは窮屈さが取れる程度に配る。
// T-209: 状態欄に「翌朝有効」バッジ（配信日が翌日で、翌朝に自動で有効になる予約）。「予約 #1」の並び順表示は従来どおり残す。
// T-213: 「結果」（検索結果件数）は合算ではなく初回の値（値を持つ最も古い実行）。「実行日時」の下段に実行回数を出す。
// T-206: 右端の「操作」列を廃止し、ボタンを左側の2段組み列に移した（NO/設定・複製/削除）。号機も「号機/担当者」の2段に。
//   押せる条件は変えていない（削除は実績がある条件では従来どおり押せない）。
//   数字は 予測/結果・抽出/送信 の2列4段。下段には達成率（結果÷予測）・送信率（送信÷抽出）を小数点第1位まで出す。
//   「予定」は人が感覚で入れている想定件数なので呼称を「予測」に、マイナビの検索結果件数（母数）を「結果」として並べる。
import {
  areaLabel,
  companyCountLabel,
  conditionStatusLabel,
  gradYearRangeLabel,
  periodDaysLabel,
  ratePercentLabel,
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

// T-213: 実行履歴タブ（RunHistory.tsx）でも同じ状態バッジを使うため export
export const STATUS_BADGE: Record<string, string> = {
  RUNNING: "bg-[#DCFCE7] text-[#15803D]",
  QUEUED: "bg-[#DBEAFE] text-[#1D4ED8]",
  DRY: "bg-[#FEE2E2] text-[#B91C1C]",
  DONE: "bg-[#E5E7EB] text-[#4B5563]",
};

const TH_BASE = "sticky top-0 z-[1] whitespace-nowrap border-b border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2 text-left text-[11px] font-semibold text-[#6B7280]";
// T-206-fix2: 列幅の配分（合計 100%）。数字を変えるときはここだけを直す。
const COL_W = {
  check: "w-[2%]",
  move: "w-[1.5%]",
  no: "w-[4%]",
  copy: "w-[4%]",
  machine: "w-[5%]",
  status: "w-[6%]",
  date: "w-[7.5%]",
  executed: "w-[6.5%]",
  search: "w-[11%]",
  login: "w-[8%]",
  company: "w-[9.5%]",
  workPref: "w-[22.5%]",
  planned: "w-[6%]",
  sent: "w-[6.5%]",
} as const;
const th = (w: string) => `${TH_BASE} ${w}`;
const TD = "whitespace-nowrap border-b border-[#F3F4F6] px-2 py-1.5 align-top text-[12px] text-[#374151]";
const MOVE_BTN = "px-1 py-0.5 text-[10px] leading-none text-[#374151] hover:bg-white disabled:cursor-not-allowed disabled:opacity-30";
// T-206: 2段組みに収めた行内ボタン（従来の「操作」列と同じ色・同じ押せる条件）
const ROW_BTN = "block w-[46px] rounded border px-1.5 py-0.5 text-center text-[11px] leading-[1.4]";
const COLUMN_COUNT = 14;

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
  nextMorningIds,
}: {
  rows: ConditionDto[];
  holidays: HolidayMap;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  /** 行クリック／「設定」で値入りの中央モーダルを開く */
  onEdit: (c: ConditionDto) => void;
  onDuplicate: (c: ConditionDto) => void;
  onDelete: (c: ConditionDto) => void;
  /** T-195: 予約（QUEUED）の上へ／下へ。同じ号機の中でだけ入れ替える */
  onMove: (c: ConditionDto, direction: "up" | "down") => void;
  /** T-204: 絞り込みの対象外でも表示している行（複製元・複製先）。黄色で塗って区別する */
  pinnedIds: string[];
  /** T-209: 翌朝に自動で有効になる予約（号機ごとに1件）。「翌朝有効」バッジを出す */
  nextMorningIds: string[];
  /** T-195: 号機内の予約列での先頭／末尾判定（絞り込み前の全件から計算） */
  queueBounds: Record<string, { canUp: boolean; canDown: boolean }>;
}) {
  const pinned = new Set(pinnedIds);
  const nextMorning = new Set(nextMorningIds);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.id));

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className={th(COL_W.check)}>
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
            <th className={`${th(COL_W.move)} px-1`}>
              <span className="sr-only">予約の並び替え</span>
            </th>
            <th className={th(COL_W.no)}>
              NO
              <br />
              設定
            </th>
            <th className={th(COL_W.copy)}>
              複製
              <br />
              削除
            </th>
            <th className={th(COL_W.machine)}>
              号機
              <br />
              担当者
            </th>
            <th className={th(COL_W.status)}>状態</th>
            <th className={th(COL_W.date)}>
              予約日
              <br />
              配信日
            </th>
            <th className={th(COL_W.executed)}>実行日時</th>
            <th className={th(COL_W.search)}>
              検索対象
              <br />
              登録日
            </th>
            <th className={th(COL_W.login)}>
              ログイン
              <br />
              卒業年度
            </th>
            <th className={th(COL_W.company)}>
              経験社数
              <br />
              居住地
            </th>
            <th className={th(COL_W.workPref)}>
              希望勤務地
              <br />
              配信テンプレート
            </th>
            <th className={th(COL_W.planned)}>
              予測
              <br />
              結果
            </th>
            <th className={th(COL_W.sent)}>
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
            // T-206: 達成率（結果÷予測）・送信率（送信÷抽出）。母数が 0 / 未入力なら % は出さない
            // T-213: 「結果」は合算ではなく初回の検索結果件数（値を持つ最も古い実行）
            const achieveRate = ratePercentLabel(c.firstSearchResultCount, c.plannedCount);
            const sentRate = ratePercentLabel(c.totalSentCount, c.totalExtractedCount);
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
                {/* T-206: NO（上段）＋「設定」ボタン（下段）。行クリックと同じ編集モーダルを開く */}
                <td className={TD}>
                  <div className="font-mono font-semibold tabular-nums">{c.recordNo ?? "-"}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(c);
                    }}
                    className={`${ROW_BTN} mt-0.5 border-[#2563EB] bg-white font-medium text-[#1D4ED8] hover:bg-[#EFF6FF]`}
                  >
                    設定
                  </button>
                </td>
                {/* T-206: 複製（上段）／削除（下段）。実績がある条件は従来どおり削除できない */}
                <td className={TD} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onDuplicate(c)}
                    className={`${ROW_BTN} border-[#D1D5DB] text-[#374151] hover:bg-white`}
                  >
                    複製
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c)}
                    disabled={hasRuns}
                    title={hasRuns ? "実績があるため削除できません（状態を「完了」にしてください）" : undefined}
                    className={`${ROW_BTN} mt-0.5 border-[#FECACA] text-[#B91C1C] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
                  >
                    削除
                  </button>
                </td>
                <td className={TD}>
                  <MachineLabel machineNo={c.machineNo} stacked />
                </td>
                <td className={TD}>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[c.status] ?? ""}`}>
                    {conditionStatusLabel(c.status)}
                  </span>
                  {dry && c.status !== "DRY" && (
                    <span className="ml-1 rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-medium text-[#B91C1C]">枯渇</span>
                  )}
                  {/* T-209: 配信日が翌日で、翌朝そのまま有効になる予約（号機ごとに1件）。当日以前は既に有効に上がっている */}
                  {c.status === "QUEUED" && nextMorning.has(c.id) && (
                    <span className="ml-1 rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[11px] font-medium text-[#B45309]">翌朝有効</span>
                  )}
                  {/* T-214: 同日の他号機（稼働中）の有効・予約と 7 軸すべてが交わる（サーバー側で一覧取得時に判定）。警告のみで保存は止めない */}
                  {c.overlapRecordNos.length > 0 && (
                    <span
                      className="ml-1 rounded border border-[#FCA5A5] bg-white px-1 py-0.5 text-[10px] font-medium text-[#B91C1C]"
                      title={`同日の ${c.overlapRecordNos.join("・")} と検索条件が重なっています`}
                    >
                      重なり
                    </span>
                  )}
                  {c.status === "QUEUED" && <span className="ml-1 text-[10px] text-[#6B7280]">#{c.queueOrder}</span>}
                </td>
                <td className={TD}>
                  <div className="text-[#6B7280]">
                    <DateTimeText iso={c.createdAt} holidays={holidays} />
                  </div>
                  <div className="font-medium">
                    <DateText ymd={c.deliveryDate} holidays={holidays} />
                  </div>
                </td>
                {/* T-213: 上段=最新の実行日時（従来どおり）／下段=実行回数（0回なら "-"） */}
                <td className={TD}>
                  <div>
                    <DateTimeText iso={run?.executedAt} holidays={holidays} />
                  </div>
                  <div className="text-[#6B7280]">{c.runCount > 0 ? `${c.runCount}回` : "-"}</div>
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
                  <div className="max-w-[380px] whitespace-normal" title={c.workPrefectures.join("/") || undefined}>
                    <span className="whitespace-nowrap">{workPrefLabel(c.workPrefMode, c.workPrefectures)}</span>
                    {c.workPrefMode !== "ALL" && c.workPrefectures.length > 0 && !isDefaultWorkPrefectures(c.workPrefectures) && (
                      <div className="text-[10px] text-[#6B7280]">{summarizePrefectures(c.workPrefectures)}</div>
                    )}
                  </div>
                  <div className="max-w-[380px] truncate" title={c.templateName ?? undefined}>
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
                {/* T-206: 予測（人の想定件数）＋結果（マイナビの検索結果件数＝母数）と達成率 */}
                <td className={`${TD} tabular-nums`} title={runsTitle}>
                  <div>{c.plannedCount ?? "-"}</div>
                  <div className="text-[#6B7280]">
                    {c.firstSearchResultCount == null
                      ? "-"
                      : `${c.firstSearchResultCount}${achieveRate ? ` (${achieveRate})` : ""}`}
                  </div>
                </td>
                {/* T-206: 抽出（RPA が取り込んだ件数）＋送信と送信率 */}
                <td className={`${TD} tabular-nums`} title={runsTitle}>
                  <div>{c.totalExtractedCount ?? "-"}</div>
                  <div className={dry ? "font-semibold text-[#B91C1C]" : "text-[#6B7280]"}>
                    {c.totalSentCount == null ? "-" : `${c.totalSentCount}${sentRate ? ` (${sentRate})` : ""}`}
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
