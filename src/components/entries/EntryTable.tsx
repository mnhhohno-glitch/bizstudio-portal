"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { SELECTION_ENDED_DETAILS, HIDDEN_ENTRY_DETAILS } from "@/lib/constants/entry-flag-rules";
import { getJobTypeOptionsForRoute } from "@/lib/constants/job-types";
import { normalizeTimeInput } from "@/lib/timeFormat";
import type { Entry, FlagData } from "./EntryBoard";

/* ========== Types ========== */

type ColConfig = { key: string; label: string; width: number; sortKey: string | null };

type Props = {
  entries: Entry[];
  flagData: FlagData | null;
  activeTab: string;
  sortField: string | null;
  sortDir: "asc" | "desc";
  onSort: (field: string) => void;
  onFlagUpdate: (entryId: string, flags: Record<string, string | null>) => void;
  onFieldUpdate: (entryId: string, fields: Record<string, unknown>) => Promise<void>;
  onJobDbUrlEdit: (entryId: string, currentUrl: string | null) => void;
  onEntryRouteEdit: (entry: Entry) => void;
  onEditEntry: (entry: Entry) => void;
  onRowClick: (entryId: string) => void;
  selectedIds: Set<string>;
  onSelectToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  isAdmin?: boolean;
  onUnarchive?: (entryId: string) => void;
  onHardDelete?: (entry: Entry) => void;
};

/* ========== Column Definitions ========== */

const COMMON_COLS: ColConfig[] = [
  { key: "candidate", label: "求職者", width: 120, sortKey: "candidate" },
  { key: "ca", label: "担当CA", width: 80, sortKey: "ca" },
  { key: "company", label: "紹介先企業", width: 280, sortKey: "company" },
  { key: "jobDb", label: "求人DB", width: 260, sortKey: "jobDb" },
  { key: "entryFlags", label: "エントリーフラグ", width: 130, sortKey: "entryFlag" },
  { key: "statusFlags", label: "対応状況", width: 130, sortKey: "companyFlag" },
  { key: "entryDate", label: "エントリー日", width: 80, sortKey: "entryDate" },
];

const TAB_EXTRA: Record<string, ColConfig[]> = {
  "求人紹介": [],
  "エントリー": [
    { key: "docSubmit", label: "書類提出日", width: 85, sortKey: "documentSubmitDate" },
  ],
  "書類選考": [
    { key: "docDates", label: "書類提出日", width: 100, sortKey: "documentSubmitDate" },
    { key: "aptitudeDates", label: "適性検査", width: 100, sortKey: "aptitudeTestExists" },
  ],
  "面接": [
    { key: "interviewPrep", label: "面接対策", width: 95, sortKey: "interviewPrepDate" },
    // T-091 fix2: 下段=アイコン+時刻の2段レイアウトで列幅内に収まるため 95px に戻す（テーブル総幅を圧縮しメモ列まで横スクロール到達可能に）
    { key: "firstInterview", label: "一次面接", width: 95, sortKey: "firstInterviewDate" },
    { key: "secondInterview", label: "二次面接", width: 95, sortKey: "secondInterviewDate" },
    { key: "finalInterview", label: "最終面接", width: 95, sortKey: "finalInterviewDate" },
  ],
  "内定": [
    { key: "offerDate", label: "内定日", width: 85, sortKey: "offerDate" },
    { key: "offerDeadline", label: "承諾期限", width: 85, sortKey: "offerDeadline" },
    { key: "offerMeeting", label: "オファー面談", width: 95, sortKey: "offerMeetingDate" },
    { key: "acceptance", label: "承諾日", width: 85, sortKey: "acceptanceDate" },
    // T-088: 課金方式（年収％/固定）+確定金額。承諾レコードで入力可。実績表の決定売上＝この revenue を承諾日月で集計。
    { key: "revenue", label: "粗利金額", width: 240, sortKey: "revenue" },
  ],
  "入社済": [
    { key: "acceptance", label: "承諾日", width: 85, sortKey: "acceptanceDate" },
    { key: "joinDate", label: "入社日", width: 85, sortKey: "joinDate" },
    // T-088: 入社済タブでも入力可（同一 JobEntry・SSoT は revenue・二重計上なし）。
    { key: "revenue", label: "粗利金額", width: 240, sortKey: "revenue" },
  ],
  "全件": [],
};

// T-091 fix: 表示/編集アイコン2つが見切れずクリックできる幅に拡張
const MEMO_COL: ColConfig = { key: "memo", label: "メモ", width: 95, sortKey: null };

function getColumns(tab: string): ColConfig[] {
  return [...COMMON_COLS, ...(TAB_EXTRA[tab] || []), MEMO_COL];
}

/* ========== Helpers ========== */

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(5, 10).replace("-", "/");
}

function fmtDateFull(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10).replace(/-/g, "/");
}

// 本人対応が完了済み（通知送信済・辞退報告済・入社済）のみ無効化
const COMPLETED_PERSON_FLAGS = ["見送り通知送信済", "見送り通知済み", "入社済"];
const COMPLETED_COMPANY_FLAGS = ["辞退報告済"];

function isPersonActionCompleted(entry: Entry): boolean {
  if (COMPLETED_PERSON_FLAGS.includes(entry.personFlag || "")) return true;
  if (COMPLETED_COMPANY_FLAGS.includes(entry.companyFlag || "")) return true;
  return false;
}

function getRowClass(entry: Entry) {
  // 3. 無効行（完了済み）: グレー + 薄い
  if (isPersonActionCompleted(entry)) return "bg-gray-100 text-gray-400 opacity-60";
  // 2. 選考終了行: グレーのみ
  if (SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "")) return "bg-gray-100 text-gray-500";
  // 1. 通常行
  return "bg-white";
}

function isEnded(entry: Entry) {
  // ソート用: 完了済みは最下部、選考終了はその上
  if (isPersonActionCompleted(entry)) return true;
  if (SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "")) return true;
  return false;
}

function isCompanyFlagRed(entry: Entry): boolean {
  const f = entry.companyFlag;
  if (!f) return false;
  if (f === "希望日提出済") return true;
  if (!f.includes("済")) return true;
  if (entry.entryFlagDetail === "承諾" && f !== "入社報告済") return true;
  return false;
}

function isPersonFlagRed(entry: Entry): boolean {
  const f = entry.personFlag;
  if (!f) return false;
  if (f === "日程回収済") return true;
  if (!f.includes("済")) return true;
  if (entry.entryFlagDetail === "承諾" && f !== "入社済") return true;
  return false;
}

const isWithdrawalDetail = (entryFlagDetail?: string | null): boolean =>
  !!entryFlagDetail && entryFlagDetail.startsWith("本人辞退");

// 矛盾ハイライト: 企業=日程確定返信済 / 本人=日程通知済 / 対応段階の面接日入力済 で
// 進行ステータスが「日程調整中」のまま残っている行を CA に気づかせる。
function isScheduleStatusMismatch(entry: Entry): boolean {
  if (entry.companyFlag !== "日程確定返信済") return false;
  if (entry.personFlag !== "日程通知済") return false;
  const detail = entry.entryFlagDetail || "";
  if (!detail.includes("日程調整中")) return false;
  // 段階に対応する面接日の presence のみ判定（罠 #17 回避のため日付パース・比較は行わない）。
  const stageDate =
    detail === "一次日程調整中" ? entry.firstInterviewDate :
    detail === "二次日程調整中" ? entry.secondInterviewDate :
    detail === "最終日程調整中" ? entry.finalInterviewDate :
    null;
  return !!stageDate && String(stageDate).trim() !== "";
}

const isWithdrawalOption = (label: string): boolean => label.includes("辞退");

function filterFlagOptions(
  allOptions: string[],
  entryFlagDetail: string | null | undefined,
  currentValue: string | null | undefined
): string[] {
  const wd = isWithdrawalDetail(entryFlagDetail);
  return allOptions.filter((opt) => {
    if (!opt) return true;
    if (opt === currentValue) return true;
    return wd ? isWithdrawalOption(opt) : !isWithdrawalOption(opt);
  });
}

// entryFlagDetail の値に応じて企業対応／本人対応の選択肢を絞る。
// 値は src/lib/constants/entry-flag-rules.ts の verbatim 文字列と一致させる。
// - 面接「選考中」3値（T-066 運用要件）
// - 適性検査受講中（同要件）
// - 日程調整中3値（本人対応のみ制限。企業対応は制限なし）
// 各エントリの company/person は **片側のみ optional**。未定義の側は従来どおり全選択肢。
const PERSON_FLAGS_IN_SCHEDULING = [
  "見送り通知未送信", "見送り通知送信済", "選考通過連絡前",
  "日程回収中", "日程回収済", "日程通知前", "日程通知済",
];
const DETAIL_FLAG_RESTRICTIONS: Record<string, { company?: string[]; person?: string[] }> = {
  "一次面接選考中": { company: ["所感報告前", "所感報告済"], person: ["本人所感回収中", "本人所感回収済"] },
  "二次面接選考中": { company: ["所感報告前", "所感報告済"], person: ["本人所感回収中", "本人所感回収済"] },
  "最終面接選考中": { company: ["所感報告前", "所感報告済"], person: ["本人所感回収中", "本人所感回収済"] },
  "適性検査受講中": { company: ["受講完了報告前", "受講完了報告済"], person: ["受講完了未確認", "受講完了確認済"] },
  "一次日程調整中": { person: PERSON_FLAGS_IN_SCHEDULING },
  "二次日程調整中": { person: PERSON_FLAGS_IN_SCHEDULING },
  "最終日程調整中": { person: PERSON_FLAGS_IN_SCHEDULING },
};

// 制限対象の entryFlagDetail のとき、表示する選択肢を許可セットに絞る。
// 現在値が制限外の場合は「現在値だけは残す」（データを書き換えない）。
// flagType の許可セットが未定義なら制限なし（=従来どおり全選択肢）。
function restrictByDetail(
  options: string[],
  entryFlagDetail: string | null | undefined,
  flagType: "company" | "person",
  currentValue: string | null | undefined
): string[] {
  if (!entryFlagDetail) return options;
  const rule = DETAIL_FLAG_RESTRICTIONS[entryFlagDetail];
  if (!rule) return options;
  const allowed = rule[flagType];
  if (!allowed) return options;
  const result = options.filter((opt) => allowed.includes(opt));
  if (currentValue && options.includes(currentValue) && !result.includes(currentValue)) {
    result.push(currentValue);
  }
  return result;
}

// T-048: 面接日超過判定。entryFlagDetail が "{stage}面接実施前" の状態で
// 面接日が今日より過去なら true。JST 日付ベース比較（罠 #17 準拠）。
function isInterviewOverdue(entry: Entry, stage: "first" | "second" | "final"): boolean {
  const detailMap = {
    first: "一次面接実施前",
    second: "二次面接実施前",
    final: "最終面接実施前",
  };
  if (entry.entryFlagDetail !== detailMap[stage]) return false;
  const dateRaw =
    stage === "first" ? entry.firstInterviewDate :
    stage === "second" ? entry.secondInterviewDate :
    entry.finalInterviewDate;
  if (!dateRaw) return false;
  const interview = new Date(dateRaw).toLocaleDateString("sv-SE");
  const today = new Date().toLocaleDateString("sv-SE");
  return interview < today;
}

function getFieldValue(entry: Entry, key: string): string | null {
  switch (key) {
    case "candidate": return entry.candidate.name;
    case "ca": return entry.candidate.employee?.name || null;
    case "company": return entry.companyName;
    case "jobDb": return entry.jobDb;
    case "entryFlag": return entry.entryFlag;
    case "entryFlagDetail": return entry.entryFlagDetail;
    case "companyFlag": return entry.companyFlag;
    case "personFlag": return entry.personFlag;
    case "entryDate": return entry.entryDate;
    case "documentSubmitDate": return entry.documentSubmitDate;
    case "documentPassDate": return entry.documentPassDate;
    case "aptitudeTestExists": return entry.aptitudeTestExists ? "1" : "0";
    case "aptitudeTestDeadline": return entry.aptitudeTestDeadline;
    case "interviewPrepDate": return entry.interviewPrepDate;
    case "firstInterviewDate": return entry.firstInterviewDate;
    case "secondInterviewDate": return entry.secondInterviewDate;
    case "finalInterviewDate": return entry.finalInterviewDate;
    case "offerDate": return entry.offerDate;
    case "offerDeadline": return entry.offerDeadline;
    case "offerMeetingDate": return entry.offerMeetingDate;
    case "acceptanceDate": return entry.acceptanceDate;
    case "joinDate": return entry.joinDate;
    case "revenue": return entry.revenue == null ? null : String(entry.revenue).padStart(15, "0");
    default: return null;
  }
}

function getSortTier(entry: Entry): number {
  if (isPersonActionCompleted(entry)) return 2; // 無効行（最下部）
  if (SELECTION_ENDED_DETAILS.includes(entry.entryFlagDetail || "")) return 1; // 選考終了
  return 0; // 通常
}

function applySortAndGroup(entries: Entry[], sortField: string | null, sortDir: "asc" | "desc") {
  return [...entries].sort((a, b) => {
    const aTier = getSortTier(a);
    const bTier = getSortTier(b);
    if (aTier !== bTier) return aTier - bTier;
    if (!sortField) return 0;
    const aVal = getFieldValue(a, sortField);
    const bVal = getFieldValue(b, sortField);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = aVal.localeCompare(bVal);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

/* ========== Cell Components ========== */

function InlineDateCell({ value, entryId, field, onUpdate }: {
  value: string | null; entryId: string; field: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const cur = value ? value.slice(0, 10) : "";

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v !== cur) onUpdate(entryId, { [field]: v ? `${v}T12:00:00.000Z` : null });
    setEditing(false);
  };

  if (editing) {
    return (
      <input type="date" autoFocus defaultValue={cur} onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full text-[11px] border border-[#2563EB] rounded px-0.5 py-0.5 outline-none"
        onClick={(e) => e.stopPropagation()} />
    );
  }

  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title={fmtDateFull(value)}
      className={`cursor-pointer rounded px-0.5 block min-h-[20px] w-full text-center leading-[20px] ${value ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 text-[10px] hover:border-gray-400"}`}>
      {fmtDate(value) || "MM/DD"}
    </span>
  );
}

function InlineDateTimeCell({ dateValue, timeValue, entryId, dateField, timeField, onUpdate, bottomLeftSlot }: {
  dateValue: string | null; timeValue: string | null; entryId: string;
  dateField: string; timeField: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
  bottomLeftSlot?: React.ReactNode;
}) {
  const [editDate, setEditDate] = useState(false);
  const [editTime, setEditTime] = useState(false);
  const curDate = dateValue ? dateValue.slice(0, 10) : "";

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v !== curDate) onUpdate(entryId, { [dateField]: v ? `${v}T12:00:00.000Z` : null });
    setEditDate(false);
  };

  const handleTimeBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const v = normalizeTimeInput(e.target.value);
    if (v !== e.target.value) e.target.value = v;
    if (v !== (timeValue || "")) onUpdate(entryId, { [timeField]: v || null });
    setEditTime(false);
  };

  const timeEl = editTime ? (
    <input type="text" autoFocus defaultValue={timeValue || ""} placeholder="HH:mm"
      onBlur={handleTimeBlur}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full text-[10px] border border-[#2563EB] rounded px-0.5 py-0 outline-none"
      onClick={(e) => e.stopPropagation()} />
  ) : (
    <span onClick={(e) => { e.stopPropagation(); setEditTime(true); }}
      className={`text-[10px] block cursor-pointer rounded min-h-[14px] leading-[14px] ${timeValue ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 hover:border-gray-400"}`}>
      {timeValue || "HH:mm"}
    </span>
  );

  return (
    <div className="text-center">
      {editDate ? (
        <input type="date" autoFocus defaultValue={curDate} onBlur={handleDateBlur}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-full text-[11px] border border-[#2563EB] rounded px-0.5 py-0.5 outline-none"
          onClick={(e) => e.stopPropagation()} />
      ) : (
        <span onClick={(e) => { e.stopPropagation(); setEditDate(true); }}
          title={fmtDateFull(dateValue)}
          className={`cursor-pointer rounded px-0.5 block min-h-[18px] leading-[18px] ${dateValue ? "hover:bg-blue-50" : "border border-dashed border-gray-300 text-gray-300 text-[10px] hover:border-gray-400"}`}>
          {fmtDate(dateValue) || "MM/DD"}
        </span>
      )}
      {bottomLeftSlot ? (
        // T-091 fix3: アイコンを絶対配置で左に逃がし、時刻は親の text-center で日付と縦に一直線にそろえる。
        <div className="relative mt-0.5">
          <div className="absolute inset-y-0 left-0 flex items-center pointer-events-auto">{bottomLeftSlot}</div>
          <div>{timeEl}</div>
        </div>
      ) : (
        <div className="mt-0.5">{timeEl}</div>
      )}
    </div>
  );
}

// T-091: 面接方法アイコン（オンライン/対面/電話）。
// T-091 fix2: クリックでポップオーバーを開いて単一選択。サイクル切替を廃止して操作の予測可能性を確保。
// 画面右端近くの列（最終面接など）でも見切れないよう、開く際にビューポート残幅を測って内側に展開する。
const INTERVIEW_TOOL_OPTIONS = ["オンライン", "対面", "電話"] as const;
const INTERVIEW_TOOL_ICON: Record<string, string> = {
  "": "–",
  "オンライン": "💻",
  "対面": "🤝",
  "電話": "📞",
};
const INTERVIEW_TOOL_LABEL: Record<string, string> = {
  "": "未設定",
  "オンライン": "オンライン",
  "対面": "対面",
  "電話": "電話",
};
function InterviewToolIcon({ value, entryId, field, onUpdate, alert = false }: {
  value: string | null; entryId: string; field: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
  // T-091 fix3: 「○次面接実施前」かつ方法未設定のとき true。未設定状態を赤系で強調して CA に設定忘れを気づかせる。
  alert?: boolean;
}) {
  const cur = value || "";
  const empty = !cur;
  const alertOn = alert && empty;
  const [open, setOpen] = useState(false);
  // openRight=true: 内容を左寄せ（ボタン左端起点に右へ広がる）／false: 右寄せ（ボタン右端起点に左へ広がる）。
  const [openRight, setOpenRight] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const POPOVER_WIDTH = 120;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.left;
      setOpenRight(spaceRight >= POPOVER_WIDTH + 8);
    }
    setOpen((v) => !v);
  };

  const select = (next: string) => {
    setOpen(false);
    if (next !== cur) onUpdate(entryId, { [field]: next || null });
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        title={alertOn ? "面接方法が未設定です" : (INTERVIEW_TOOL_LABEL[cur] || "未設定")}
        className={`inline-flex items-center justify-center w-[18px] h-[18px] text-[12px] leading-none rounded shrink-0 ${
          alertOn
            ? "border border-red-400 text-red-500 hover:border-red-500 hover:text-red-600"
            : empty
              ? "border border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600"
              : "hover:bg-blue-50"
        }`}
      >
        {INTERVIEW_TOOL_ICON[cur] ?? "–"}
      </button>
      {open && (
        <div
          className={`absolute z-50 top-full mt-1 ${openRight ? "left-0" : "right-0"} bg-white border border-gray-200 rounded-lg shadow-lg py-1`}
          style={{ width: POPOVER_WIDTH }}
          onClick={(e) => e.stopPropagation()}
        >
          {INTERVIEW_TOOL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => select(opt)}
              className={`flex items-center justify-between w-full px-2 py-1 text-[11px] text-left hover:bg-blue-50 ${opt === cur ? "font-semibold text-[#2563EB]" : "text-gray-700"}`}
            >
              <span><span className="mr-1">{INTERVIEW_TOOL_ICON[opt]}</span>{INTERVIEW_TOOL_LABEL[opt]}</span>
              {opt === cur && <span className="text-[#2563EB]">✓</span>}
            </button>
          ))}
          <div className="border-t border-gray-100 my-1" />
          <button
            type="button"
            onClick={() => select("")}
            className={`flex items-center justify-between w-full px-2 py-1 text-[11px] text-left hover:bg-gray-50 ${empty ? "font-semibold text-gray-700" : "text-gray-500"}`}
          >
            <span>クリア</span>
            {empty && <span className="text-[#2563EB]">✓</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function AptitudeCell({ value, entryId, onUpdate }: {
  value: boolean; entryId: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <select value={value ? "あり" : "なし"}
      onChange={(e) => { e.stopPropagation(); onUpdate(entryId, { aptitudeTestExists: e.target.value === "あり" }); }}
      onClick={(e) => e.stopPropagation()}
      className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]">
      <option value="なし">なし</option>
      <option value="あり">あり</option>
    </select>
  );
}

// T-088: 粗利セル（T-087 の InlineRevenueCell を統合・拡張）。
// 承諾 or 入社済レコードで「課金方式（年収％/固定）」と金額を入力。
// 確定 revenue はサーバー側で計算（送信は feeType + 必要な入力のみ。表示は entry.revenue を信用）。
// 既存 revenue 入り（feeType=null・FMインポート分等）は固定金額として有効・編集可（後方互換）。
function RevenueCell({ entry, onUpdate }: {
  entry: Entry;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const editable = entry.entryFlagDetail === "承諾" || entry.entryFlag === "入社済";
  // 表示用の現在値
  const feeType: "ANNUAL_RATE" | "FIXED" | null = (entry.feeType ?? null) as "ANNUAL_RATE" | "FIXED" | null;
  // 既存 revenue ありで feeType 未設定なら、UI 上は「固定」として扱う（後方互換）。
  const uiFeeType: "ANNUAL_RATE" | "FIXED" = feeType ?? ((entry.revenue != null && entry.revenue !== 0) ? "FIXED" : "FIXED");
  const inc = entry.theoreticalAnnualIncome ?? null;
  const rate = entry.feeRatePercent != null ? Number(entry.feeRatePercent) : null;
  const rev = entry.revenue ?? null;

  if (!editable) {
    return <span className="text-[10px] text-[#C0C4CC]">—</span>;
  }
  const fmtYen = (v: number | null) => (v == null ? "—" : `¥${v.toLocaleString("ja-JP")}`);
  const handleFeeType = (newType: "ANNUAL_RATE" | "FIXED") => {
    if (newType === uiFeeType && feeType != null) return;
    // 方式切替時は revenue サーバー再計算。年収％へ切替時は値を保持、固定へ切替時は revenue を維持。
    if (newType === "ANNUAL_RATE") {
      void onUpdate(entry.id, {
        feeType: "ANNUAL_RATE",
        theoreticalAnnualIncome: inc,
        feeRatePercent: rate,
      });
    } else {
      void onUpdate(entry.id, {
        feeType: "FIXED",
        revenue: rev,
      });
    }
  };
  const handleIncomeBlur = (v: string) => {
    const n = v.replace(/[^\d]/g, "");
    const num = n ? parseInt(n, 10) : null;
    if (num === inc) return;
    void onUpdate(entry.id, { feeType: "ANNUAL_RATE", theoreticalAnnualIncome: num, feeRatePercent: rate });
  };
  const handleRateBlur = (v: string) => {
    const n = v === "" ? null : Number(v);
    const num = n != null && Number.isFinite(n) ? n : null;
    if (num === rate) return;
    void onUpdate(entry.id, { feeType: "ANNUAL_RATE", theoreticalAnnualIncome: inc, feeRatePercent: num });
  };
  const handleRevenueBlur = (v: string) => {
    const n = v.replace(/[^\d]/g, "");
    const num = n ? parseInt(n, 10) : null;
    if (num === rev) return;
    void onUpdate(entry.id, { feeType: "FIXED", revenue: num });
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select
        value={uiFeeType}
        onChange={(e) => handleFeeType(e.target.value as "ANNUAL_RATE" | "FIXED")}
        className="text-[10px] border border-gray-200 rounded px-0.5 py-0.5 bg-white"
      >
        <option value="ANNUAL_RATE">年収％</option>
        <option value="FIXED">固定</option>
      </select>
      {uiFeeType === "ANNUAL_RATE" ? (
        <>
          <input
            type="text" inputMode="numeric"
            defaultValue={inc != null ? inc.toLocaleString("ja-JP") : ""}
            onBlur={(e) => handleIncomeBlur(e.target.value)}
            placeholder="年収"
            className="w-16 text-[10px] border border-gray-200 rounded px-0.5 py-0.5 text-right tabular-nums"
            title="理論年収（円）"
          />
          <span className="text-[10px] text-[#9CA3AF]">×</span>
          <input
            type="number" step="0.01" min="0" max="100"
            defaultValue={rate != null ? String(rate) : ""}
            onBlur={(e) => handleRateBlur(e.target.value)}
            placeholder="%"
            className="w-10 text-[10px] border border-gray-200 rounded px-0.5 py-0.5 text-right tabular-nums"
            title="手数料%"
          />
          <span className="text-[10px] text-[#9CA3AF]">=</span>
          <span className="text-[10px] tabular-nums font-medium text-[#2563EB] min-w-[60px] text-right" title="サーバー側で確定計算した粗利（revenue）">{fmtYen(rev)}</span>
        </>
      ) : (
        <>
          <input
            type="text" inputMode="numeric"
            defaultValue={rev != null ? rev.toLocaleString("ja-JP") : ""}
            onBlur={(e) => handleRevenueBlur(e.target.value)}
            placeholder="粗利金額"
            className="flex-1 text-[10px] border border-gray-200 rounded px-1 py-0.5 text-right tabular-nums"
            title="固定金額（円）"
          />
          <span className="text-[10px] text-[#9CA3AF]">円</span>
        </>
      )}
    </div>
  );
}

function MemoCell({ value, entryId, onUpdate }: {
  value: string | null; entryId: string;
  onUpdate: (id: string, f: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value || "");
  const ref = useRef<HTMLDivElement>(null);

  const save = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed !== (value || "")) {
      onUpdate(entryId, { memo: trimmed || null });
    }
    setOpen(false);
  }, [text, value, entryId, onUpdate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) save();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, save]);

  return (
    <div ref={ref} className="relative flex justify-center">
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setText(value || ""); setOpen(!open); }}
        title={value || ""}
        className={`text-[14px] leading-none ${value ? "text-[#2563EB]" : "text-gray-300"}`}>
        📝
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2"
          onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder="メモを入力..." rows={4}
            className="w-full text-[12px] border border-gray-200 rounded p-2 resize-none focus:outline-none focus:border-[#2563EB]" />
          <div className="flex justify-end mt-1">
            <button type="button" onClick={save}
              className="text-[11px] bg-[#2563EB] text-white rounded px-2 py-0.5 hover:bg-[#1D4ED8]">
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== Sort Indicator ========== */

function SortIndicator({ sortKey, sortField, sortDir }: {
  sortKey: string | null; sortField: string | null; sortDir: "asc" | "desc";
}) {
  if (!sortKey) return null;
  const active = sortField === sortKey;
  if (active) {
    return <span className="ml-0.5 text-[9px] text-yellow-300">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
  return <span className="ml-0.5 text-[9px] text-white/30">⇅</span>;
}

/* ========== Main Component ========== */

export default function EntryTable({
  entries, flagData, activeTab, sortField, sortDir, onSort,
  onFlagUpdate, onFieldUpdate, onJobDbUrlEdit, onEntryRouteEdit, onEditEntry, onRowClick,
  selectedIds, onSelectToggle, onSelectAll, onDeselectAll,
  isAdmin, onUnarchive, onHardDelete,
}: Props) {
  const cols = getColumns(activeTab);
  const sorted = applySortAndGroup(entries, sortField, sortDir);
  const entryFlagOptions = flagData?.entryFlags.filter((f) => f !== "応募") || [];
  const allIds = entries.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const minWidth = 36 + cols.reduce((sum, c) => sum + c.width, 0);

  function renderCell(entry: Entry, col: ColConfig) {
    const rawCompanyOptions = flagData?.companyFlags[entry.entryFlag || ""] || [];
    const rawPersonOptions = flagData?.personFlags[entry.entryFlag || ""] || [];
    const companyOptions = restrictByDetail(
      filterFlagOptions(rawCompanyOptions, entry.entryFlagDetail, entry.companyFlag),
      entry.entryFlagDetail, "company", entry.companyFlag
    );
    const personOptions = restrictByDetail(
      filterFlagOptions(rawPersonOptions, entry.entryFlagDetail, entry.personFlag),
      entry.entryFlagDetail, "person", entry.personFlag
    );

    switch (col.key) {
      case "candidate":
        return (
          <td key={col.key} className="px-2 py-1.5 whitespace-nowrap">
            <Link href={`/candidates/${entry.candidateId}`} target="_blank" rel="noopener noreferrer" className="font-medium text-[#2563EB] hover:underline" onClick={(e) => e.stopPropagation()}>
              {entry.candidate.name}
            </Link>
            <div className="text-gray-400 text-[10px]">{entry.candidate.candidateNumber}</div>
          </td>
        );
      case "ca":
        return <td key={col.key} className="px-2 py-1.5 whitespace-nowrap text-[11px] text-gray-600">{entry.candidate.employee?.name || "-"}</td>;
      case "company":
        return (
          <td key={col.key} className="px-2 py-1.5" title={entry.companyName}>
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (entry.originalUrl) {
                  const previewUrl = entry.originalUrl.replace(/\/view(\?|$)/, "/preview$1");
                  window.open(previewUrl, "_blank");
                }
              }}
              className={`whitespace-nowrap truncate max-w-[280px] ${entry.originalUrl ? "cursor-pointer hover:text-[#2563EB] hover:underline" : "cursor-default"}`}
              title={entry.companyName}
              data-company-name={entry.companyName}
            >
              {entry.companyName}
            </div>
            {entry.jobTitle && <div className="text-[10px] text-gray-400 truncate max-w-[280px]" title={entry.jobTitle} data-job-title={entry.jobTitle}>{entry.jobTitle}</div>}
          </td>
        );
      case "jobDb": {
        // エントリー媒体切替済み: entryRoute を優先表示、元の媒体は小さく表示
        const switched = !!entry.entryRoute;
        const displayedDb = switched ? entry.entryRoute : entry.jobDb;
        const displayedId = switched ? entry.entryJobId : entry.externalJobNo;
        return (
          <td key={col.key} className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
            {/* Row 1: DB名(固定幅) | 求人種別ドロップダウン(固定幅) | 🔄 | ✏️ */}
            <div className="flex items-center gap-1">
              <div className="w-[84px] shrink-0 overflow-hidden">
                {displayedDb ? (
                  entry.jobDbUrl ? (
                    <a
                      href={entry.jobDbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-[11px] truncate block"
                      title={displayedDb}
                    >{displayedDb}</a>
                  ) : (
                    <button
                      onClick={() => onJobDbUrlEdit(entry.id, null)}
                      className="text-gray-800 text-[11px] hover:text-blue-600 cursor-pointer underline decoration-dotted truncate block text-left w-full"
                      title={`${displayedDb} — クリックでURL登録`}
                    >{displayedDb}</button>
                  )
                ) : (
                  <div className="text-[11px] text-gray-400">-</div>
                )}
              </div>
              <span className="text-[10px] text-gray-300 shrink-0">|</span>
              {(() => {
                const effectiveRoute = entry.entryRoute || entry.jobDb;
                const jobTypeOptions = getJobTypeOptionsForRoute(effectiveRoute);
                return (
                  <select
                    value={entry.jobType || ""}
                    onChange={(e) => onFieldUpdate(entry.id, { jobType: e.target.value || null })}
                    className={`w-[104px] shrink-0 text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${entry.jobType ? "text-gray-700" : "text-gray-400"}`}
                    title="求人種別"
                  >
                    <option value=""></option>
                    {jobTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                );
              })()}
              <button
                onClick={() => onEntryRouteEdit(entry)}
                className={`text-[11px] leading-none shrink-0 ${switched ? "text-blue-600" : "text-gray-400 hover:text-blue-600"}`}
                title={switched ? `エントリー媒体: ${entry.entryRoute}（元: ${entry.jobDb || "-"}）` : "エントリー媒体を切り替える"}
              >🔄</button>
              {entry.jobDbUrl && (
                <button
                  onClick={() => onJobDbUrlEdit(entry.id, entry.jobDbUrl)}
                  className="text-[9px] leading-none text-gray-400 hover:text-blue-600 shrink-0"
                  title="URLを編集"
                >✏️</button>
              )}
            </div>
            {/* Row 2: 切替済みの場合、元の媒体を小さく表示 */}
            {switched && entry.jobDb && (
              <div className="text-[9px] text-gray-400 mt-0.5 truncate" title={`元の媒体: ${entry.jobDb}`}>← {entry.jobDb}</div>
            )}
            {/* Row 3: ID */}
            {displayedId && <div className="text-[10px] text-gray-400 truncate">ID: {displayedId}</div>}
          </td>
        );
      }
      case "entryFlags":
        return (
          <td key={col.key} className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
            <select value={entry.entryFlag || ""}
              onChange={(e) => {
                const newFlag = e.target.value;
                const updates: Record<string, string | null> = { entryFlag: newFlag, entryFlagDetail: null, companyFlag: null, personFlag: null };
                if (newFlag === "内定") {
                  updates.entryFlagDetail = "検討中";
                  updates.companyFlag = "承諾返答前";
                  updates.personFlag = "内定通知前";
                }
                onFlagUpdate(entry.id, updates);
              }}
              className="w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB]">
              {entryFlagOptions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={entry.entryFlagDetail || ""}
              onChange={(e) => {
                const newDetail = e.target.value;
                const updates: Record<string, string | null> = { entryFlagDetail: newDetail };
                const currentFlag = entry.entryFlag || "";
                if (newDetail === "選考落ち" && (currentFlag === "書類選考" || currentFlag === "面接")) {
                  updates.companyFlag = null;
                  updates.personFlag = "見送り通知未送信";
                }
                if (newDetail === "本人辞退") {
                  updates.personFlag = "辞退受付済";
                  // companyFlag="辞退報告前" は親フラグが許可している場合のみセット。
                  // COMPANY_FLAG_RULES では "求人紹介"/"エントリー" 親は companyFlag を持たない (=[])。
                  // 親で許可されていない値を送ると flags API の validate で 400 になり保存失敗する。
                  if (currentFlag === "書類選考" || currentFlag === "面接" || currentFlag === "内定") {
                    updates.companyFlag = "辞退報告前";
                  }
                }
                onFlagUpdate(entry.id, updates);
              }}
              className={`w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 mt-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${
                isInterviewOverdue(entry, "first") || isInterviewOverdue(entry, "second") || isInterviewOverdue(entry, "final") || isScheduleStatusMismatch(entry)
                  ? "text-red-600 font-bold"
                  : "text-gray-500"
              }`}>
              <option value="">-</option>
              {flagData?.entryDetails[entry.entryFlag || ""]?.filter((d) => !HIDDEN_ENTRY_DETAILS.includes(d) || d === entry.entryFlagDetail).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </td>
        );
      case "statusFlags":
        return (
          <td key={col.key} className="px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
            {companyOptions.length > 0 ? (
              <select value={entry.companyFlag || ""}
                onChange={(e) => onFlagUpdate(entry.id, { companyFlag: e.target.value || null })}
                className={`w-full text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${isCompanyFlagRed(entry) ? "text-red-600 font-semibold" : !entry.companyFlag ? "text-gray-400" : ""}`}>
                <option value="" className="text-gray-400">企業対応</option>
                {companyOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <div className="text-gray-300 text-[11px] px-1 py-0.5">-</div>}
            {personOptions.length > 0 ? (
              <select value={entry.personFlag || ""}
                onChange={(e) => onFlagUpdate(entry.id, { personFlag: e.target.value || null })}
                className={`w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 mt-0.5 bg-white focus:ring-1 focus:ring-[#2563EB] ${isPersonFlagRed(entry) ? "text-red-600 font-semibold" : !entry.personFlag ? "text-gray-400" : ""}`}>
                <option value="" className="text-gray-400">本人対応</option>
                {personOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <div className="text-gray-300 text-[10px] px-1 py-0.5 mt-0.5">-</div>}
          </td>
        );
      case "entryDate":
        return <td key={col.key} className="px-2 py-1.5 text-center text-[11px]" title={fmtDateFull(entry.entryDate)}>{fmtDate(entry.entryDate)}</td>;
      case "docSubmit":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.documentSubmitDate} entryId={entry.id} field="documentSubmitDate" onUpdate={onFieldUpdate} /></td>;
      case "docDates":
        // T-090: 上段=提出日 / 下段=通過日 のインライン行ラベルを付与（ヘッダ2行と整合・視認性改善）。
        return (
          <td key={col.key} className="px-1 py-0.5 text-center text-[11px]">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-[#9CA3AF] shrink-0 w-6 text-right">提出</span>
              <div className="flex-1 min-w-0"><InlineDateCell value={entry.documentSubmitDate} entryId={entry.id} field="documentSubmitDate" onUpdate={onFieldUpdate} /></div>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[9px] text-[#9CA3AF] shrink-0 w-6 text-right">通過</span>
              <div className="flex-1 min-w-0"><InlineDateCell value={entry.documentPassDate} entryId={entry.id} field="documentPassDate" onUpdate={onFieldUpdate} /></div>
            </div>
          </td>
        );
      case "aptitudeDates":
        return (
          <td key={col.key} className="px-1 py-0.5 text-center text-[11px]" onClick={(e) => e.stopPropagation()}>
            <AptitudeCell value={entry.aptitudeTestExists} entryId={entry.id} onUpdate={onFieldUpdate} />
            <div className="mt-0.5"><InlineDateCell value={entry.aptitudeTestDeadline} entryId={entry.id} field="aptitudeTestDeadline" onUpdate={onFieldUpdate} /></div>
          </td>
        );
      case "interviewPrep":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.interviewPrepDate} timeValue={entry.interviewPrepTime} entryId={entry.id} dateField="interviewPrepDate" timeField="interviewPrepTime" onUpdate={onFieldUpdate} /></td>;
      case "firstInterview": {
        const warn = entry.entryFlagDetail === "一次面接実施前" && (!entry.firstInterviewDate || !entry.firstInterviewTime);
        const overdue = isInterviewOverdue(entry, "first");
        // T-091 fix3: 「実施前」かつ方法未設定なら設定忘れを赤系で警告（保存・状態変更なし、表示のみ）。
        const toolAlert = entry.entryFlagDetail === "一次面接実施前" && !entry.firstInterviewTool;
        return <td key={col.key} className={`px-1 py-0.5 text-[11px] ${warn ? "bg-red-100" : ""} ${overdue ? "text-red-600 font-bold" : ""}`}>
          <InlineDateTimeCell
            dateValue={entry.firstInterviewDate} timeValue={entry.firstInterviewTime} entryId={entry.id}
            dateField="firstInterviewDate" timeField="firstInterviewTime" onUpdate={onFieldUpdate}
            bottomLeftSlot={<InterviewToolIcon value={entry.firstInterviewTool} entryId={entry.id} field="firstInterviewTool" onUpdate={onFieldUpdate} alert={toolAlert} />}
          />
        </td>;
      }
      case "secondInterview": {
        const warn = entry.entryFlagDetail === "二次面接実施前" && (!entry.secondInterviewDate || !entry.secondInterviewTime);
        const overdue = isInterviewOverdue(entry, "second");
        const toolAlert = entry.entryFlagDetail === "二次面接実施前" && !entry.secondInterviewTool;
        return <td key={col.key} className={`px-1 py-0.5 text-[11px] ${warn ? "bg-red-100" : ""} ${overdue ? "text-red-600 font-bold" : ""}`}>
          <InlineDateTimeCell
            dateValue={entry.secondInterviewDate} timeValue={entry.secondInterviewTime} entryId={entry.id}
            dateField="secondInterviewDate" timeField="secondInterviewTime" onUpdate={onFieldUpdate}
            bottomLeftSlot={<InterviewToolIcon value={entry.secondInterviewTool} entryId={entry.id} field="secondInterviewTool" onUpdate={onFieldUpdate} alert={toolAlert} />}
          />
        </td>;
      }
      case "finalInterview": {
        const warn = entry.entryFlagDetail === "最終面接実施前" && (!entry.finalInterviewDate || !entry.finalInterviewTime);
        const overdue = isInterviewOverdue(entry, "final");
        const toolAlert = entry.entryFlagDetail === "最終面接実施前" && !entry.finalInterviewTool;
        return <td key={col.key} className={`px-1 py-0.5 text-[11px] ${warn ? "bg-red-100" : ""} ${overdue ? "text-red-600 font-bold" : ""}`}>
          <InlineDateTimeCell
            dateValue={entry.finalInterviewDate} timeValue={entry.finalInterviewTime} entryId={entry.id}
            dateField="finalInterviewDate" timeField="finalInterviewTime" onUpdate={onFieldUpdate}
            bottomLeftSlot={<InterviewToolIcon value={entry.finalInterviewTool} entryId={entry.id} field="finalInterviewTool" onUpdate={onFieldUpdate} alert={toolAlert} />}
          />
        </td>;
      }
      case "offerDate":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.offerDate} entryId={entry.id} field="offerDate" onUpdate={onFieldUpdate} /></td>;
      case "offerDeadline":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.offerDeadline} entryId={entry.id} field="offerDeadline" onUpdate={onFieldUpdate} /></td>;
      case "offerMeeting":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><InlineDateTimeCell dateValue={entry.offerMeetingDate} timeValue={entry.offerMeetingTime} entryId={entry.id} dateField="offerMeetingDate" timeField="offerMeetingTime" onUpdate={onFieldUpdate} /></td>;
      case "acceptance":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.acceptanceDate} entryId={entry.id} field="acceptanceDate" onUpdate={onFieldUpdate} /></td>;
      case "joinDate":
        return <td key={col.key} className="px-1 py-0.5 text-center text-[11px]"><InlineDateCell value={entry.joinDate} entryId={entry.id} field="joinDate" onUpdate={onFieldUpdate} /></td>;
      case "revenue":
        return <td key={col.key} className="px-1 py-0.5 text-[11px]"><RevenueCell entry={entry} onUpdate={onFieldUpdate} /></td>;
      case "memo":
        return (
          <td key={col.key} className="px-1 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEditEntry(entry); }}
                title="エントリーを編集"
                className="text-[13px] leading-none text-gray-300 hover:text-[#2563EB]"
              >
                ✏️
              </button>
              <MemoCell value={entry.memo} entryId={entry.id} onUpdate={onFieldUpdate} />
            </div>
          </td>
        );
      default:
        return <td key={col.key} />;
    }
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="text-[12px] border-collapse" style={{ minWidth }}>
        <colgroup>
          <col style={{ width: 36, minWidth: 36 }} />
          {cols.map((c, i) => <col key={i} style={{ width: c.width, minWidth: c.width }} />)}
        </colgroup>
        <thead>
          <tr className="bg-[#1E3A8A] text-white">
            <th className="px-1 py-1.5 text-center">
              <input type="checkbox" checked={allSelected}
                onChange={() => allSelected ? onDeselectAll() : onSelectAll(allIds)}
                className="w-3.5 h-3.5 rounded border-white/50 text-[#2563EB]" />
            </th>
            {cols.map((c) => (
              <th key={c.key}
                className={`px-2 py-1 text-left whitespace-nowrap text-[11px] font-semibold ${c.sortKey ? "cursor-pointer select-none hover:bg-[#1E3A8A]/80" : ""}`}
                onClick={() => c.sortKey && onSort(c.sortKey)}>
                {c.key === "entryFlags" ? (
                  <div>
                    <div>エントリーフラグ <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">フラグ詳細</div>
                  </div>
                ) : c.key === "statusFlags" ? (
                  <div>
                    <div>企業対応 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">本人対応</div>
                  </div>
                ) : c.key === "docDates" ? (
                  <div>
                    <div>書類提出日 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">書類通過日</div>
                  </div>
                ) : c.key === "aptitudeDates" ? (
                  <div>
                    <div>適性検査 <SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></div>
                    <div className="text-[10px] font-normal text-blue-200">検査期限</div>
                  </div>
                ) : (
                  <>{c.label}<SortIndicator sortKey={c.sortKey} sortField={sortField} sortDir={sortDir} /></>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const archived = !!entry.archivedAt;
            const rowClass = archived
              ? "bg-gray-100 text-gray-500 italic"
              : getRowClass(entry);
            return (
              <tr key={entry.id} className={`${rowClass} border-b border-gray-200 hover:bg-blue-50/30`}>
                <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                  {archived ? (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onUnarchive?.(entry.id)}
                        title="アーカイブ解除"
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        ↩
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => onHardDelete?.(entry)}
                          title="完全削除"
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  ) : (
                    <input type="checkbox" checked={selectedIds.has(entry.id)}
                      onChange={() => onSelectToggle(entry.id)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-[#2563EB]" />
                  )}
                </td>
                {cols.map((col) => renderCell(entry, col))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
