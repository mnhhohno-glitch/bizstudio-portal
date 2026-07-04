"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import ScoutNav from "@/components/scout/ScoutNav";
import ApplicantListModal from "@/components/scout/ApplicantListModal";
import { TableVirtuoso, type TableComponents } from "react-virtuoso";

type ListRow = {
  id: string;
  scoutNumber: string;
  deliveryCategoryLarge: string;
  deliveryCategoryMedium: string | null;
  deliveryCategorySmall: string | null;
  mediaSource: string;
  machineId: string | null;
  machine: { id: string; recruiterName: string; machineLabel: string; machineNumber: number | null; isMachine: boolean; isActive: boolean } | null;
  deliveryDate: string;
  dayOfWeek: string;
  hourSlot: number;
  timeBlock: string;
  deliveryCount: number;
  openCount: number;
  openRate: number;
  applyCount: number;
  applyRate1: number;
  applyRate2: number;
  searchConditionName: string | null;
  isAggregationTarget: boolean;
  isMachine: boolean;
  ageGroups: { "20s": number; "30s": number; "40s": number; "50s": number; foreign: number };
  validApplyCount: number;
  invalidApplyCount: number;
  validApplyRate: number;
  invalidApplyRate: number;
};

type Machine = {
  id: string;
  recruiterName: string;
  machineLabel: string;
  machineNumber: number | null;
  isMachine: boolean;
  isActive: boolean;
};

type Media = {
  id: string;
  mediaName: string;
  isActive: boolean;
};

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function today(): string {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type CreateForm = {
  deliveryDate: string;
  hourSlot: number;
  machineId: string;
  mediaSource: string;
  deliveryCategoryMedium: "個別配信" | "一斉配信";
  deliveryCategorySmall: "検索条件指定" | "検索条件未指定";
  searchConditionName: string;
  deliveryCount: number;
};

type DuplicateForm = {
  deliveryDate: string;
  hourSlot: number;
  deliveryCount: number;
  searchConditionName: string;
  deliveryCategorySmall: "検索条件指定" | "検索条件未指定";
};

type SortKey =
  | "deliveryCategoryLarge"
  | "machineId"
  | "deliveryDate"
  | "hourSlot"
  | "openCount"
  | "openRate"
  | "applyCount"
  | "applyRate1";
type SortSpec = { column: SortKey; order: "asc" | "desc" };

// T-066: 配信枠管理 list タブの仮想化（TableVirtuoso）用コンポーネント。
// 再マウント/スクロールジャンク回避のため module スコープで固定（state を参照しない表示専用）。
//  - Table: テーブル幅 minWidth:1400（横スクロール）維持
//  - TableRow: 明細行スタイル（56px・hover）
//  - EmptyPlaceholder: 0件表示
const slotsVirtuosoComponents: TableComponents<ListRow> = {
  Table: ({ style, ...props }) => (
    <table {...props} className="text-[11px]" style={{ ...style, minWidth: 1400 }} />
  ),
  TableRow: ({ item: _item, ...props }) => (
    <tr {...props} className="border-t border-[#F3F4F6] hover:bg-[#F9FAFB] align-middle" style={{ height: 56 }} />
  ),
  EmptyPlaceholder: () => (
    <tbody>
      <tr>
        <td colSpan={21} className="px-3 py-6 text-center text-[#9CA3AF]">該当するレコードがありません</td>
      </tr>
    </tbody>
  ),
};

export default function ScoutSlotsPage() {
  // T-135 step6: マトリクス表示は撤去。「この日の枠を自動作成」用に date/creating のみ残す。
  const [date, setDate] = useState(today());
  const [creating, setCreating] = useState(false);

  const [staffMachines, setStaffMachines] = useState<Machine[]>([]);
  const [allMachines, setAllMachines] = useState<Machine[]>([]);
  const [activeMedia, setActiveMedia] = useState<Media[]>([]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({
    deliveryDate: today(),
    hourSlot: 14,
    machineId: "",
    mediaSource: "マイナビ転職",
    deliveryCategoryMedium: "一斉配信",
    deliveryCategorySmall: "検索条件指定",
    searchConditionName: "",
    deliveryCount: 0,
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const [duplicateSource, setDuplicateSource] = useState<ListRow | null>(null);
  const [duplicateForm, setDuplicateForm] = useState<DuplicateForm>({
    deliveryDate: today(),
    hourSlot: 14,
    deliveryCount: 0,
    searchConditionName: "",
    deliveryCategorySmall: "検索条件指定",
  });
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [submittingDuplicate, setSubmittingDuplicate] = useState(false);

  // === レコード一覧タブ用 state ===
  const [listRows, setListRows] = useState<ListRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  // 応募数クリック→応募者一覧モーダル（枠単位）
  const [applicantModal, setApplicantModal] = useState<{ slotId: string; title: string } | null>(null);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [fLarge, setFLarge] = useState("");
  const [fMedium, setFMedium] = useState("");
  const [fMachine, setFMachine] = useState("");
  const [fMedia, setFMedia] = useState("");
  const [fHasApplications, setFHasApplications] = useState(false);
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([
    { column: "deliveryDate", order: "desc" },
    { column: "hourSlot", order: "desc" },
  ]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });
      if (sortSpecs.length > 0) {
        params.set("sortBy", sortSpecs.map((s) => `${s.column}:${s.order}`).join(","));
      }
      if (fLarge) params.set("deliveryCategoryLarge", fLarge);
      if (fMedium) params.set("deliveryCategoryMedium", fMedium);
      if (fMachine) params.set("machineId", fMachine);
      if (fMedia) params.set("mediaSource", fMedia);
      if (fHasApplications) params.set("hasApplications", "true");
      const res = await fetch(`/api/scout/slots/list?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setListRows(data.slots || []);
      }
    } finally {
      setListLoading(false);
    }
  }, [startDate, endDate, fLarge, fMedium, fMachine, fMedia, fHasApplications, sortSpecs]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    fetch("/api/scout/masters").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        const all = (data.machines || []) as Machine[];
        setAllMachines(all);
        const staff = all.filter((m) => !m.isMachine && m.isActive);
        setStaffMachines(staff);
        setActiveMedia((data.media || []).filter((m: Media) => m.isActive));
        if (staff.length > 0) {
          setCreateForm((prev) => ({ ...prev, machineId: prev.machineId || staff[0].id }));
        }
      }
    });
  }, []);

  const createDailySlots = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/scout/cron/create-daily-slots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-rpa-secret": "manual-ui-trigger",
        },
        body: JSON.stringify({ targetDate: date }),
      });
      if (!res.ok) {
        toast.error("配信枠の自動作成 API は x-rpa-secret 認証のため UI から直接叩けません。Power Automate から呼ぶか、curl で叩いてください。");
        return;
      }
      const data = await res.json();
      toast.success(`${data.message || "作成完了"} (${data.created || 0}件)`);
      // 作成後、対象日を含む期間で一覧を再取得できるよう期間を対象日に寄せて再読込
      if (date < startDate || date > endDate) {
        setStartDate(date);
        setEndDate(date);
      } else {
        loadList();
      }
    } finally {
      setCreating(false);
    }
  };

  const openDuplicateModal = (slot: ListRow) => {
    setDuplicateSource(slot);
    setDuplicateForm({
      deliveryDate: slot.deliveryDate.slice(0, 10),
      hourSlot: slot.hourSlot,
      deliveryCount: slot.deliveryCount,
      searchConditionName: slot.searchConditionName ?? "",
      deliveryCategorySmall: (slot.deliveryCategorySmall as "検索条件指定" | "検索条件未指定") ?? "検索条件指定",
    });
    setDuplicateError(null);
  };

  const submitDuplicate = async () => {
    if (!duplicateSource) return;
    setSubmittingDuplicate(true);
    setDuplicateError(null);
    try {
      const res = await fetch("/api/scout/slots/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceSlotId: duplicateSource.id,
          deliveryDate: duplicateForm.deliveryDate,
          hourSlot: duplicateForm.hourSlot,
          deliveryCount: duplicateForm.deliveryCount,
          searchConditionName: duplicateForm.searchConditionName || null,
          deliveryCategorySmall: duplicateForm.deliveryCategorySmall,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDuplicateError(data?.error || "複製に失敗しました");
        return;
      }
      toast.success(`複製しました（${data.slot?.scoutNumber || ""}）`);
      setDuplicateSource(null);
      loadList();
    } finally {
      setSubmittingDuplicate(false);
    }
  };

  const submitCreate = async () => {
    setSubmittingCreate(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/scout/slots/create-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryDate: createForm.deliveryDate,
          hourSlot: createForm.hourSlot,
          machineId: createForm.machineId,
          deliveryCategoryLarge: "社員",
          deliveryCategoryMedium: createForm.deliveryCategoryMedium,
          deliveryCategorySmall: createForm.deliveryCategorySmall,
          searchConditionName: createForm.searchConditionName || null,
          mediaSource: createForm.mediaSource,
          deliveryCount: createForm.deliveryCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data?.error || "作成に失敗しました");
        return;
      }
      toast.success(`作成しました（${data.slot?.scoutNumber || ""}）`);
      setShowCreateModal(false);
      setCreateForm((prev) => ({ ...prev, deliveryCount: 0, searchConditionName: "" }));
      loadList();
    } finally {
      setSubmittingCreate(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`コピーしました: ${text}`);
    });
  };

  // 複合ソート: 未ソート → 昇順 → 降順 → 未ソート（同じ列を3回クリック）
  const toggleSort = (key: SortKey) => {
    setSortSpecs((prev) => {
      const idx = prev.findIndex((s) => s.column === key);
      if (idx === -1) {
        return [...prev, { column: key, order: "asc" }];
      }
      const cur = prev[idx];
      if (cur.order === "asc") {
        const next = [...prev];
        next[idx] = { column: key, order: "desc" };
        return next;
      }
      // 降順 → 削除
      return prev.filter((s) => s.column !== key);
    });
  };

  const clearSort = () => {
    setSortSpecs([]);
  };

  return (
    <div>
      <ScoutNav />
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-bold text-[#374151]">配信枠管理</h1>
        <div className="flex items-center gap-2">
          {/* T-135 step6: マトリクス表示を撤去し「この日の枠を自動作成」を一覧ヘッダに移設（機能温存） */}
          <div className="flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
              title="自動作成する対象日"
            />
            <button
              onClick={createDailySlots}
              disabled={creating}
              className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              この日の枠を自動作成
            </button>
          </div>
          <button
            onClick={() => {
              setCreateForm((prev) => ({ ...prev, deliveryDate: today() }));
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="rounded-md bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D]"
          >
            + 一斉配信レコードを新規作成
          </button>
        </div>
      </div>

      {/* レコード一覧 */}
      <div className="mt-4">
          {/* フィルタ */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
            <div className="flex items-center gap-1 text-[12px]">
              <label className="text-[#6B7280]">期間</label>
              <div className="flex rounded-md border border-[#E5E7EB]">
                <button
                  onClick={() => { setStartDate(shiftDate(startDate, -1)); setEndDate(shiftDate(endDate, -1)); }}
                  className="w-[30px] h-[30px] flex items-center justify-center text-[14px] text-[#6B7280] hover:bg-[#F9FAFB] rounded-l-md"
                >◀</button>
                <button
                  onClick={() => { setStartDate(today()); setEndDate(today()); }}
                  className="w-[30px] h-[30px] flex items-center justify-center text-[14px] text-[#6B7280] hover:bg-[#F9FAFB] border-x border-[#E5E7EB]"
                  title="当日に戻る"
                >⌂</button>
                <button
                  onClick={() => { setStartDate(shiftDate(startDate, 1)); setEndDate(shiftDate(endDate, 1)); }}
                  className="w-[30px] h-[30px] flex items-center justify-center text-[14px] text-[#6B7280] hover:bg-[#F9FAFB] rounded-r-md"
                >▶</button>
              </div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
              />
              <span className="text-[#9CA3AF]">〜</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
              />
            </div>
            <select
              value={fLarge}
              onChange={(e) => setFLarge(e.target.value)}
              className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
            >
              <option value="">配信種別（全て）</option>
              <option value="RPA">RPA</option>
              <option value="社員">社員</option>
            </select>
            <select
              value={fMedium}
              onChange={(e) => setFMedium(e.target.value)}
              className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
            >
              <option value="">中フラグ（全て）</option>
              <option value="個別配信">個別配信</option>
              <option value="一斉配信">一斉配信</option>
            </select>
            <select
              value={fMachine}
              onChange={(e) => setFMachine(e.target.value)}
              className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
            >
              <option value="">配信者（全て）</option>
              {allMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machineLabel} / {m.recruiterName}
                </option>
              ))}
            </select>
            <select
              value={fMedia}
              onChange={(e) => setFMedia(e.target.value)}
              className="rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px]"
            >
              <option value="">媒体（全て）</option>
              {activeMedia.map((m) => (
                <option key={m.id} value={m.mediaName}>{m.mediaName}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[12px] text-[#6B7280]">
              <input
                type="checkbox"
                checked={fHasApplications}
                onChange={(e) => setFHasApplications(e.target.checked)}
                className="h-[14px] w-[14px] accent-[#2563EB]"
              />
              応募あり
            </label>
            <span className="ml-auto text-[11px] text-[#9CA3AF]">
              {listLoading ? "読み込み中..." : `${listRows.length}件`}
            </span>
          </div>

          {/* ソート状態表示 */}
          {sortSpecs.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[#6B7280]">ソート:</span>
              {sortSpecs.map((s, i) => (
                <span
                  key={s.column}
                  className="inline-flex items-center gap-1 rounded-md bg-[#EEF2FF] px-2 py-0.5 text-[#2563EB]"
                >
                  <sup>{i + 1}</sup>
                  {SORT_LABELS[s.column]}
                  {s.order === "asc" ? "▲" : "▼"}
                </span>
              ))}
              <button
                onClick={clearSort}
                className="ml-1 rounded border border-[#E5E7EB] px-2 py-0.5 text-[#6B7280] hover:bg-[#F9FAFB]"
              >
                ソートをクリア
              </button>
            </div>
          )}

          {/* テーブル（T-066: TableVirtuoso で tbody を仮想化。ヘッダ＋合計行は fixedHeaderContent= sticky thead に固定） */}
          <TableVirtuoso
            data={listRows}
            className="mt-3 rounded-lg border border-[#E5E7EB] bg-white"
            style={{ height: "70vh", overflowX: "auto" }}
            components={slotsVirtuosoComponents}
            fixedHeaderContent={() => (
              <>
                {/* 列見出し（fixedHeaderContent=sticky thead で上端固定・横スクロール維持） */}
                <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-[#F9FAFB]">
                  <th className="w-[120px] px-2 py-2 text-left font-medium border-r border-[#E5E7EB]">
                    <div>スカウトNO</div>
                    <div className="text-[10px] text-[#9CA3AF]">種別 | 媒体</div>
                  </th>
                  <th className="w-[60px] px-1 py-2 text-left font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="中" k="deliveryCategoryLarge" sortSpecs={sortSpecs} onClick={() => toggleSort("deliveryCategoryLarge")} />
                    <div className="text-[10px] text-[#9CA3AF]">小</div>
                  </th>
                  <th className="w-[60px] px-1 py-2 text-left font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="配信者" k="machineId" sortSpecs={sortSpecs} onClick={() => toggleSort("machineId")} />
                    <div className="text-[10px] text-[#9CA3AF]">号機</div>
                  </th>
                  <th className="w-[60px] px-1 py-2 text-left font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="配信日" k="deliveryDate" sortSpecs={sortSpecs} onClick={() => toggleSort("deliveryDate")} />
                    <div className="text-[10px] text-[#9CA3AF]">曜日</div>
                  </th>
                  <th className="w-[60px] px-1 py-2 text-left font-medium border-r border-[#E5E7EB]">
                    <div>時間帯</div>
                    <SortableThV2 label="時間" k="hourSlot" sortSpecs={sortSpecs} onClick={() => toggleSort("hourSlot")} dim />
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">配信数</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="開封数" k="openCount" sortSpecs={sortSpecs} onClick={() => toggleSort("openCount")} right />
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="開封率" k="openRate" sortSpecs={sortSpecs} onClick={() => toggleSort("openRate")} right />
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">
                    <SortableThV2 label="応募数" k="applyCount" sortSpecs={sortSpecs} onClick={() => toggleSort("applyCount")} right />
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">
                    <SortableThV2 label={<>応募率<br />(配信)</>} k="applyRate1" sortSpecs={sortSpecs} onClick={() => toggleSort("applyRate1")} right />
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">
                    応募率<br />(開封)
                  </th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">〜20代</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">30代</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">40代</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">50代〜</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB]">外国籍</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">有効<br />応募数</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">無効<br />応募数</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">有効<br />応募率</th>
                  <th className="w-[44px] px-2 py-2 text-right font-medium border-r border-[#E5E7EB] leading-tight">無効<br />応募率</th>
                  <th className="w-[44px] px-2 py-2 text-center font-medium">操作</th>
                </tr>
                {/* 合計行（ヘッダ直下に固定。fixedHeaderContent=sticky thead 内のため td 個別 sticky は不要・背景のみ維持）。率は行平均ではなく Σ/Σ で再計算。 */}
                {listRows.length > 0 && (() => {
                  const t = listRows.reduce(
                    (a, r) => ({
                      deliveryCount: a.deliveryCount + r.deliveryCount,
                      openCount: a.openCount + r.openCount,
                      applyCount: a.applyCount + r.applyCount,
                      a20: a.a20 + r.ageGroups["20s"],
                      a30: a.a30 + r.ageGroups["30s"],
                      a40: a.a40 + r.ageGroups["40s"],
                      a50: a.a50 + r.ageGroups["50s"],
                      foreign: a.foreign + r.ageGroups.foreign,
                      valid: a.valid + r.validApplyCount,
                      invalid: a.invalid + r.invalidApplyCount,
                    }),
                    { deliveryCount: 0, openCount: 0, applyCount: 0, a20: 0, a30: 0, a40: 0, a50: 0, foreign: 0, valid: 0, invalid: 0 },
                  );
                  const pct = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(1) : "0.0");
                  // T-064 step40: 応募率は小数第2位（開封率は第1位を維持）
                  const pctApply = (num: number, den: number) => (den > 0 ? ((num / den) * 100).toFixed(2) : "0.00");
                  return (
                    <tr className="border-b-2 border-[#9CA3AF] bg-[#EFF6FF] font-semibold text-[#374151] [&>td]:bg-[#EFF6FF]">
                      <td className="px-2 py-2 border-r border-[#E5E7EB] whitespace-nowrap">合計（{listRows.length}件）</td>
                      <td className="px-1 py-2 border-r border-[#E5E7EB]"></td>
                      <td className="px-1 py-2 border-r border-[#E5E7EB]"></td>
                      <td className="px-1 py-2 border-r border-[#E5E7EB]"></td>
                      <td className="px-1 py-2 border-r border-[#E5E7EB]"></td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.deliveryCount.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.openCount.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{pct(t.openCount, t.deliveryCount)}%</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.applyCount.toLocaleString()}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{pctApply(t.applyCount, t.deliveryCount)}%</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{pctApply(t.applyCount, t.openCount)}%</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.a20}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.a30}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.a40}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.a50}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB]">{t.foreign}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB] text-[#16A34A]">{t.valid}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB] text-[#DC2626]">{t.invalid}</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB] text-[#16A34A]">{pctApply(t.valid, t.deliveryCount)}%</td>
                      <td className="px-2 py-2 text-right border-r border-[#E5E7EB] text-[#DC2626]">{pctApply(t.invalid, t.deliveryCount)}%</td>
                      <td className="px-2 py-2 text-center"></td>
                    </tr>
                  );
                })()}
              </>
            )}
            itemContent={(_index, r) => (
              <>
                      <td className="px-2 py-1.5 border-r border-[#E5E7EB] whitespace-nowrap">
                        <div
                          className="font-mono text-[#374151] cursor-pointer hover:text-[#2563EB]"
                          onClick={() => copyToClipboard(r.scoutNumber)}
                          title="クリックでコピー"
                        >
                          {r.scoutNumber}
                        </div>
                        <div className="text-[10px]">
                          <span className={r.deliveryCategoryLarge === "RPA" ? "text-[#2563EB]" : "text-[#16A34A]"}>{r.deliveryCategoryLarge}</span>
                          <span className="text-[#9CA3AF]"> | </span>
                          <span className="text-[#6B7280]">{r.mediaSource}</span>
                        </div>
                      </td>
                      <td className="px-1 py-1.5 border-r border-[#E5E7EB] whitespace-nowrap">
                        <div>{r.deliveryCategoryMedium ?? "—"}</div>
                        <div className="text-[10px] text-[#6B7280]">{r.deliveryCategorySmall ?? "—"}</div>
                      </td>
                      <td className="px-1 py-1.5 border-r border-[#E5E7EB] whitespace-nowrap">
                        <div
                          className="text-[#374151] cursor-pointer hover:text-[#2563EB]"
                          onClick={() => r.machine?.recruiterName && copyToClipboard(r.machine.recruiterName)}
                          title="クリックでコピー"
                        >
                          {r.machine?.recruiterName ?? "—"}
                        </div>
                        <div className="text-[10px] text-[#6B7280]">
                          {r.machine?.isMachine
                            ? `RPA${r.machine.machineNumber ?? ""}号機`
                            : "—"}
                        </div>
                      </td>
                      <td className="px-1 py-1.5 border-r border-[#E5E7EB] whitespace-nowrap">
                        <div>{`${parseInt(r.deliveryDate.slice(5, 7))}/${parseInt(r.deliveryDate.slice(8, 10))}`}</div>
                        <div className="text-[10px] text-[#6B7280]">{r.dayOfWeek}</div>
                      </td>
                      <td className="px-1 py-1.5 text-left border-r border-[#E5E7EB] whitespace-nowrap">
                        <div>{r.timeBlock}</div>
                        <div className="text-[10px] text-[#6B7280]">{r.hourSlot}:00</div>
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.deliveryCount.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.openCount.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.openRate.toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">
                        {r.applyCount > 0 ? (
                          <button
                            onClick={() =>
                              setApplicantModal({
                                slotId: r.id,
                                title: `${r.deliveryDate} ${r.machine?.recruiterName ?? ""} ${r.hourSlot}:00 の応募者`,
                              })
                            }
                            className="text-[#2563EB] hover:underline"
                            title="応募者一覧を表示"
                          >
                            {r.applyCount.toLocaleString()}
                          </button>
                        ) : (
                          r.applyCount.toLocaleString()
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.applyRate1.toFixed(2)}%</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.applyRate2.toFixed(2)}%</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.ageGroups["20s"]}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.ageGroups["30s"]}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.ageGroups["40s"]}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.ageGroups["50s"]}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB]">{r.ageGroups.foreign}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB] text-[#16A34A]">{r.validApplyCount}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB] text-[#DC2626]">{r.invalidApplyCount}</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB] text-[#16A34A]">{r.validApplyRate.toFixed(2)}%</td>
                      <td className="px-2 py-1.5 text-right border-r border-[#E5E7EB] text-[#DC2626]">{r.invalidApplyRate.toFixed(2)}%</td>
                      <td className="px-2 py-1.5 text-center">
                        {!r.isMachine && (
                          <button
                            onClick={() => openDuplicateModal(r)}
                            className="rounded border border-[#E5E7EB] px-1 py-0.5 text-[10px] text-[#6B7280] hover:bg-[#F9FAFB]"
                          >
                            複製
                          </button>
                        )}
                      </td>
              </>
            )}
          />

          <p className="mt-3 text-[11px] text-[#9CA3AF]">
            応募率(配信)= 応募数 / 配信数、応募率(開封)= 応募数 / 開封数。年代別カウントは「応募日（Candidate.createdAt）」基準。〜20代は30未満、50代〜は50以上。<br />
            有効応募数 = 〜20代 + 30代、無効応募数 = 40代 + 50代〜 + 外国籍。<br />
            外国籍判定: 氏名（姓名）がカタカナ/英字のみの応募者を外国籍として集計（mynavi-rpa/judgment の isForeignNg と同一ロジック）。<br />
            並び替え: ソート可能ヘッダクリックで「未ソート → 昇順 → 降順 → 解除」の順。複数列クリックで複合ソート。
          </p>
        </div>

      {/* 新規作成モーダル */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] max-w-[92vw] rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[16px] font-bold text-[#374151]">一斉配信レコード新規作成</h2>
            <p className="mt-1 text-[11px] text-[#9CA3AF]">大フラグは「社員」固定。スカウトNOは自動採番されます。</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[12px] text-[#374151]">配信日</label>
                <input
                  type="date"
                  value={createForm.deliveryDate}
                  onChange={(e) => setCreateForm({ ...createForm, deliveryDate: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">配信時間</label>
                <select
                  value={createForm.hourSlot}
                  onChange={(e) => setCreateForm({ ...createForm, hourSlot: parseInt(e.target.value, 10) })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{h}:00</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">担当者（社員枠）</label>
                <select
                  value={createForm.machineId}
                  onChange={(e) => setCreateForm({ ...createForm, machineId: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                >
                  {staffMachines.length === 0 ? (
                    <option value="">読み込み中...</option>
                  ) : (
                    staffMachines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.recruiterName}（{m.machineLabel}）
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">媒体</label>
                <select
                  value={createForm.mediaSource}
                  onChange={(e) => setCreateForm({ ...createForm, mediaSource: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                >
                  {activeMedia.length === 0 ? (
                    <option value="マイナビ転職">マイナビ転職</option>
                  ) : (
                    activeMedia.map((m) => (
                      <option key={m.id} value={m.mediaName}>{m.mediaName}</option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">中フラグ</label>
                <div className="mt-1 flex gap-3 text-[13px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="medium"
                      checked={createForm.deliveryCategoryMedium === "一斉配信"}
                      onChange={() => setCreateForm({ ...createForm, deliveryCategoryMedium: "一斉配信" })}
                    />
                    一斉配信
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="medium"
                      checked={createForm.deliveryCategoryMedium === "個別配信"}
                      onChange={() => setCreateForm({ ...createForm, deliveryCategoryMedium: "個別配信" })}
                    />
                    個別配信
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">小フラグ</label>
                <div className="mt-1 flex gap-3 text-[13px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="small"
                      checked={createForm.deliveryCategorySmall === "検索条件指定"}
                      onChange={() => setCreateForm({ ...createForm, deliveryCategorySmall: "検索条件指定" })}
                    />
                    検索条件指定
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="small"
                      checked={createForm.deliveryCategorySmall === "検索条件未指定"}
                      onChange={() => setCreateForm({ ...createForm, deliveryCategorySmall: "検索条件未指定" })}
                    />
                    検索条件未指定
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">検索条件名</label>
                <input
                  type="text"
                  placeholder="例: 営業職_東京_30代男性"
                  value={createForm.searchConditionName}
                  onChange={(e) => setCreateForm({ ...createForm, searchConditionName: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">配信数</label>
                <input
                  type="number"
                  min={0}
                  value={createForm.deliveryCount}
                  onChange={(e) => setCreateForm({ ...createForm, deliveryCount: parseInt(e.target.value, 10) || 0 })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              {createError && (
                <div className="rounded-md bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#DC2626]">{createError}</div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#F9FAFB]"
                disabled={submittingCreate}
              >
                キャンセル
              </button>
              <button
                onClick={submitCreate}
                disabled={submittingCreate || !createForm.machineId}
                className="rounded-md bg-[#16A34A] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
              >
                {submittingCreate ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 複製モーダル */}
      {duplicateSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] max-w-[92vw] rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-[16px] font-bold text-[#374151]">配信レコード複製</h2>
            <p className="mt-1 text-[11px] text-[#9CA3AF]">
              元: {duplicateSource.scoutNumber}（{duplicateSource.machine?.recruiterName} / {duplicateSource.deliveryCategoryLarge} / {duplicateSource.deliveryCategoryMedium ?? "—"}）<br />
              担当者・媒体・大中フラグは引き継ぎます。
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[12px] text-[#374151]">配信日</label>
                <input
                  type="date"
                  value={duplicateForm.deliveryDate}
                  onChange={(e) => setDuplicateForm({ ...duplicateForm, deliveryDate: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">配信時間</label>
                <select
                  value={duplicateForm.hourSlot}
                  onChange={(e) => setDuplicateForm({ ...duplicateForm, hourSlot: parseInt(e.target.value, 10) })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{h}:00</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">小フラグ</label>
                <div className="mt-1 flex gap-3 text-[13px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="dup-small"
                      checked={duplicateForm.deliveryCategorySmall === "検索条件指定"}
                      onChange={() => setDuplicateForm({ ...duplicateForm, deliveryCategorySmall: "検索条件指定" })}
                    />
                    検索条件指定
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="dup-small"
                      checked={duplicateForm.deliveryCategorySmall === "検索条件未指定"}
                      onChange={() => setDuplicateForm({ ...duplicateForm, deliveryCategorySmall: "検索条件未指定" })}
                    />
                    検索条件未指定
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">検索条件名</label>
                <input
                  type="text"
                  value={duplicateForm.searchConditionName}
                  onChange={(e) => setDuplicateForm({ ...duplicateForm, searchConditionName: e.target.value })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              <div>
                <label className="block text-[12px] text-[#374151]">配信数</label>
                <input
                  type="number"
                  min={0}
                  value={duplicateForm.deliveryCount}
                  onChange={(e) => setDuplicateForm({ ...duplicateForm, deliveryCount: parseInt(e.target.value, 10) || 0 })}
                  className="mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px]"
                />
              </div>

              {duplicateError && (
                <div className="rounded-md bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#DC2626]">{duplicateError}</div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDuplicateSource(null)}
                className="rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#F9FAFB]"
                disabled={submittingDuplicate}
              >
                キャンセル
              </button>
              <button
                onClick={submitDuplicate}
                disabled={submittingDuplicate}
                className="rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {submittingDuplicate ? "複製中..." : "複製"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 応募数クリック→応募者一覧 */}
      <ApplicantListModal
        open={applicantModal != null}
        onClose={() => setApplicantModal(null)}
        title={applicantModal?.title ?? ""}
        query={applicantModal ? { slotId: applicantModal.slotId } : null}
      />
    </div>
  );
}

const SORT_LABELS: Record<SortKey, string> = {
  deliveryCategoryLarge: "配信種別",
  machineId: "配信者",
  deliveryDate: "配信日",
  hourSlot: "時間",
  openCount: "開封数",
  openRate: "開封率",
  applyCount: "応募数",
  applyRate1: "応募率(配信)",
};

function SortableThV2({
  label,
  k,
  sortSpecs,
  onClick,
  dim = false,
  right = false,
  center = false,
}: {
  label: React.ReactNode;
  k: SortKey;
  sortSpecs: SortSpec[];
  onClick: () => void;
  dim?: boolean;
  right?: boolean;
  center?: boolean;
}) {
  const idx = sortSpecs.findIndex((s) => s.column === k);
  const spec = idx >= 0 ? sortSpecs[idx] : null;
  const arrow = !spec ? "↕" : spec.order === "asc" ? "▲" : "▼";
  const color = spec ? "text-[#2563EB]" : "text-[#9CA3AF]";
  const align = right ? "text-right" : center ? "text-center" : "text-left";
  return (
    <div
      onClick={onClick}
      className={`${dim ? "text-[10px] text-[#9CA3AF]" : ""} ${align} cursor-pointer hover:opacity-80 select-none`}
    >
      {label}
      <span className={`ml-1 text-[10px] ${color}`}>
        {arrow}
        {spec && <sup>{idx + 1}</sup>}
      </span>
    </div>
  );
}
