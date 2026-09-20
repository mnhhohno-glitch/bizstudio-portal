"use client";

// T-197: 画面中央の「検索設定」モーダル。マイナビの検索条件画面と同じく検索7軸を縦に並べ、
// 新規作成（空）と編集（値入り）を同じコンポーネントで行う。旧「配信条件の詳細」右パネルの置き換え。
// - 新規作成: 状態・並び順・レコード番号はサーバーが決める（号機に「有効」が無ければ「有効」、あれば予約の末尾）
// T-206: 状態「実行中」の表示を「有効」に改称（値は RUNNING のまま）。「予定件数」は「予測件数」に改称（列名 planned_count は据え置き）。
// - 編集:     状態のプルダウンで自動決定された値を手で直せる
// T-199: レイアウトをマイナビ「検索項目設定」画面の形式（グループ見出しバー＋左=項目名/右=入力欄の2列テーブル）に揃えた。
//   入力項目・選択肢・バリデーション・保存の挙動は T-198 のまま。見た目の配置だけを変えている。
// T-201: 配信実績（scout_runs）が1件でもある条件は「状態」以外を編集不可にする（locked）。
//   配信日や検索条件を後から上書きされると、その実績がどの条件によるものか分からなくなるため。
//   内容を変えたいときの逃げ道として「複製」は押せるままにしている。サーバー側（PATCH）でも同じ規則で弾く。
// T-214: モーダルを左右2列にし、右に「同日の他号機」パネル（SameDayPanel.tsx）を置く。
//   対象は他の稼働中号機の有効・予約で配信日がフォームの配信日と同じもの（空なら今日）。内部 API
//   GET /api/scout/conditions/same-day で取り、配信日・号機が変わったら取り直す。重なり（7軸すべてが交わる。overlap.ts）は
//   フォームを変えるたびにクライアントで判定し直し、重なる行を赤くしてフォームの一番上に赤字1行を出す。**保存は止めない**。
//   1280px 未満（xl 未満）では右パネルをフォームの下に回す。実績ブロックは「作成」「更新」（更新者/更新日時）に整理。
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import {
  AREA_MODES,
  COMPANY_COUNT_OPTIONS,
  CONDITION_STATUSES,
  DEFAULT_WORK_PREFECTURES,
  DEFAULT_WORK_PREFECTURES_LABEL,
  FIXED_VALUES,
  isDefaultWorkPrefectures,
  PERIOD_DAYS_OPTIONS,
  REGIST_DATE_MODES,
  SEARCH_TARGETS,
  TEMPLATE_KINDS,
  WORK_PREF_MODES,
  gradYearOptions,
  summarizePrefectures,
  templateKindLabel,
  isDrySentCount,
} from "@/lib/scout-conditions/constants";
import { jstTodayYmd, type HolidayMap } from "@/lib/scout-conditions/dates";
import { isOverlapping } from "@/lib/scout-conditions/overlap";
import type { ConditionDto, ConditionInput, MachineDto, TemplateDto } from "@/lib/scout-conditions/types";
import { DateField, DateText, DateTimeText } from "./DateText";
import { MachineLabel } from "./MachineLabel";
import { FormGroup, FormRow } from "./FormTable";
import SameDayPanel from "./SameDayPanel";
import TemplatePreview from "./TemplatePreview";

// 入力欄は右列の左端から始めて右に余白を残す（w-full にしない）
// T-201: disabled:* は編集不可の行（実績あり）で使う。無効なことが一目で分かるよう地をグレーにする
const DISABLED = "disabled:cursor-not-allowed disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF]";
const SELECT = `rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151] ${DISABLED}`;
const INPUT = `rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] text-[#374151] ${DISABLED}`;
const CHIP = (selected: boolean, disabled = false) =>
  [
    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
    selected ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#D1D5DB] bg-white text-[#6B7280]",
    disabled ? "cursor-not-allowed opacity-50" : "hover:bg-[#F9FAFB]",
  ].join(" ");

export type ModalMode = { kind: "new" } | { kind: "edit"; condition: ConditionDto };

function toForm(c: ConditionDto | null, machines: MachineDto[], today: string): ConditionInput {
  if (c) {
    return {
      machineId: c.machineId,
      status: c.status,
      queueOrder: c.queueOrder,
      searchTarget: c.searchTarget,
      registDateMode: c.registDateMode,
      registDays: c.registDays,
      registDateFrom: c.registDateFrom,
      registDateTo: c.registDateTo,
      lastLoginDays: c.lastLoginDays,
      gradYearFrom: c.gradYearFrom,
      gradYearTo: c.gradYearTo,
      companyCount: c.companyCount,
      residenceMode: c.residenceMode,
      residencePrefectures: c.residencePrefectures,
      workPrefMode: c.workPrefMode,
      workPrefectures: c.workPrefectures,
      templateId: c.templateId,
      plannedCount: c.plannedCount,
      deliveryDate: c.deliveryDate,
    };
  }
  const firstActive = machines.find((m) => m.isActive) ?? machines[0];
  return {
    machineId: firstActive?.id ?? "",
    status: "QUEUED", // 新規作成ではサーバーが決めるので送っても無視される
    queueOrder: 0,
    searchTarget: "EXCLUDE",
    registDateMode: "PERIOD",
    registDays: 7,
    registDateFrom: null,
    registDateTo: null,
    lastLoginDays: 1,
    gradYearFrom: null,
    gradYearTo: null,
    companyCount: null,
    residenceMode: "NATIONWIDE",
    residencePrefectures: [],
    workPrefMode: "SELECTED",
    workPrefectures: DEFAULT_WORK_PREFECTURES,
    templateId: firstActive?.defaultTemplateId ?? null,
    plannedCount: null,
    deliveryDate: today,
  };
}

export default function ConditionModal({
  mode,
  machines,
  templates,
  conditions,
  holidays,
  onClose,
  onSaved,
  onDuplicate,
  onDelete,
  onOpenPrefModal,
}: {
  mode: ModalMode;
  machines: MachineDto[];
  templates: TemplateDto[];
  /** 全条件（新規作成時に「この号機は有効が有るか」を案内するため） */
  conditions: ConditionDto[];
  holidays: HolidayMap;
  onClose: () => void;
  /** T-198: demoted = 「有効」を1件に保つため「完了」へ畳まれた同じ号機の条件（画面の表示を合わせる） */
  onSaved: (c: ConditionDto, isNew: boolean, demoted: ConditionDto[]) => void;
  onDuplicate: (c: ConditionDto) => void;
  onDelete: (c: ConditionDto) => void;
  onOpenPrefModal: (current: string[], onConfirm: (prefs: string[]) => void, title: string) => void;
}) {
  const today = jstTodayYmd();
  const current = mode.kind === "edit" ? mode.condition : null;
  // T-201: 一度でも配信された条件は状態以外を編集不可にする（判定は実績の有無だけ。状態では見ない）
  const locked = (current?.runs.length ?? 0) > 0;
  const [form, setForm] = useState<ConditionInput>(() => toForm(current, machines, today));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // T-200: 配信日は必須。保存を押した時点で空ならエラーを入力欄の直下に出す
  const [deliveryDateError, setDeliveryDateError] = useState<string | null>(null);
  const deliveryDateRef = useRef<HTMLDivElement | null>(null);
  const overlayClose = useOverlayClose(onClose);

  // 別の行を開いたらフォームを入れ替える
  const modeKey = mode.kind === "edit" ? `${mode.condition.id}:${mode.condition.updatedAt}` : "new";
  const [loadedKey, setLoadedKey] = useState(modeKey);
  useEffect(() => {
    if (loadedKey !== modeKey) {
      setForm(toForm(current, machines, today));
      setDirty(false);
      setDeliveryDateError(null);
      setLoadedKey(modeKey);
    }
  }, [modeKey, loadedKey, current, machines, today]);

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof ConditionInput>(key: K, value: ConditionInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const years = gradYearOptions(Number(today.slice(0, 4)));
  const template = useMemo(() => templates.find((t) => t.id === form.templateId) ?? null, [templates, form.templateId]);
  const machine = machines.find((m) => m.id === form.machineId) ?? null;
  const templatesByKind = useMemo(
    () => TEMPLATE_KINDS.map((k) => ({ kind: k, items: templates.filter((t) => t.kind === k.value && (t.isActive || t.id === form.templateId)) })),
    [templates, form.templateId],
  );
  // 新規作成時の案内: 選んだ号機に「有効」が有るか（保存時の状態はサーバーが同じ規則で決める）
  const machineHasRunning = useMemo(
    () => conditions.some((c) => c.machineId === form.machineId && c.status === "RUNNING"),
    [conditions, form.machineId],
  );

  // T-214: 同日の他号機の条件（右パネル）。配信日が空なら今日。配信日・号機が変わったら取り直す（初回はモーダルを開いたとき）
  const sameDayDate = form.deliveryDate || today;
  const sameDayKey = `${sameDayDate}|${form.machineId}`;
  // key が今の配信日・号機と一致している間だけ rows を使う（取り直し中は読み込み中扱い。effect 内で同期的に setState しない）
  const [sameDay, setSameDay] = useState<{ key: string; rows: ConditionDto[] }>({ key: "", rows: [] });
  useEffect(() => {
    let cancelled = false;
    const sp = new URLSearchParams({ date: sameDayDate });
    if (form.machineId) sp.set("machineId", form.machineId);
    fetch(`/api/scout/conditions/same-day?${sp.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          toast.error("同日の他号機の条件を読み込めませんでした");
          setSameDay({ key: sameDayKey, rows: [] });
          return;
        }
        const json = (await res.json()) as { conditions: ConditionDto[] };
        if (!cancelled) setSameDay({ key: sameDayKey, rows: json.conditions });
      })
      .catch(() => {
        if (!cancelled) setSameDay({ key: sameDayKey, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [sameDayDate, sameDayKey, form.machineId]);
  const sameDayLoaded = sameDay.key === sameDayKey;
  const sameDayRows = useMemo(() => (sameDayLoaded ? sameDay.rows : []), [sameDayLoaded, sameDay.rows]);

  // T-214: フォームを変えるたびにクライアント側で判定し直す（右パネルのデータは取得済みのものを使う）
  const overlapRows = useMemo(
    () => sameDayRows.filter((c) => c.machineId !== form.machineId && isOverlapping(form, c, today)),
    [sameDayRows, form, today],
  );
  const overlapIds = useMemo(() => new Set(overlapRows.map((c) => c.id)), [overlapRows]);
  const overlapText = useMemo(() => overlapRows.map((c) => `${c.machineNo}号機 ${c.recordNo ?? "-"}`).join("、"), [overlapRows]);

  const save = async () => {
    if (saving) return;
    // T-200: 配信日が空のままでは保存しない（サーバー側でも parseConditionInput が弾く）。
    //   ただしロック中（実績あり＝状態以外は編集不可）の行は、配信日が空のまま実績を持ってしまった
    //   古い行の「状態だけ変える」操作を止めないよう必須チェックを飛ばす（サーバー側も同じ判定）。
    if (!locked && !form.deliveryDate) {
      setDeliveryDateError("配信日を入力してください");
      deliveryDateRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    setDeliveryDateError(null);
    setSaving(true);
    try {
      const isNew = mode.kind === "new";
      const res = await fetch(isNew ? "/api/scout/conditions" : `/api/scout/conditions/${mode.condition.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "保存に失敗しました");
        return;
      }
      const saved = json.condition as ConditionDto;
      // T-198: 「有効」は号機ごとに1件。手動で「有効」に戻したときは畳まれた条件をトーストで伝える
      const demoted = (Array.isArray(json.demoted) ? json.demoted : []) as ConditionDto[];
      const demotedNos = demoted.map((d) => d.recordNo ?? "").join("・");
      toast.success(
        isNew
          ? `${saved.recordNo ?? ""} を${saved.status === "RUNNING" ? "「有効」" : "「予約」（末尾）"}として登録しました`
          : demoted.length
            ? `保存しました（「有効」は号機ごとに1件のため ${demotedNos} を「完了」にしました）`
            : "保存しました",
      );
      setDirty(false);
      onSaved(saved, isNew, demoted);
    } finally {
      setSaving(false);
    }
  };

  const latest = current?.latestRun ?? null;
  const dry = current ? current.status === "DRY" || isDrySentCount(latest?.sentCount) : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" {...overlayClose}>
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[1560px] flex-col rounded-[10px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 見出し（スクロールしても固定）: 例「1-001　1号機　藤本 なつみ　検索設定の編集」 */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-5 py-3">
          <div className="flex items-center gap-3">
            {current ? (
              <>
                <span className="rounded bg-[#111827] px-2 py-0.5 font-mono text-[13px] font-semibold tracking-wide text-white">
                  {current.recordNo ?? "-"}
                </span>
                <MachineLabel machineNo={current.machineNo} />
                {dry && <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-medium text-[#B91C1C]">枯渇</span>}
                <span className="text-[12px] text-[#6B7280]">検索設定の編集</span>
              </>
            ) : (
              <>
                <span className="rounded bg-[#111827] px-2 py-0.5 text-[13px] font-semibold tracking-wide text-white">新規</span>
                <span className="text-[15px] font-semibold text-[#374151]">検索設定</span>
                <span className="text-[12px] text-[#6B7280]">NO は保存時に号機ごとの通し番号で採番されます</span>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
            閉じる ✕
          </button>
        </div>

        {/* T-214: 左＝フォーム（従来どおり）／右＝同日の他号機パネル。xl（1280px）未満では右パネルをフォームの下に回す */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 pb-4 pt-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          {/* T-214: 同日の他号機と重なるときは一番上に赤字1行（保存は止めない） */}
          {overlapRows.length > 0 && (
            <div className="mb-3 rounded-[6px] border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] font-semibold text-[#B91C1C]">
              {overlapText} と重なっています
            </div>
          )}

          {/* T-201: 編集できない理由を先頭に出す。逃げ道（複製）も同じ場所で案内する */}
          {locked && (
            <div className="mb-3 rounded-[6px] border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[12px] leading-relaxed text-[#92400E]">
              <span className="mr-1 font-semibold">配信実績があるため、状態以外は変更できません。</span>
              内容を変えるには下の「複製」から新しい条件を作ってください（複製した条件は実績が無いのですべて編集できます）。
            </div>
          )}

          {/* ---- 基本 ---- */}
          <FormGroup title="基本">
            <FormRow label="号機">
              <select className={`${SELECT} w-[240px]`} value={form.machineId} disabled={locked} onChange={(e) => set("machineId", e.target.value)}>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.machineNo}号機{m.isActive ? "" : "（停止）"}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow
              label="状態"
              note={
                current
                  ? locked
                    ? "この条件で変更できるのは状態だけです（配信を止めるときは「完了」にしてください）"
                    : undefined
                  : machineHasRunning
                    ? "この号機には「有効」の条件があるため、保存時に「予約（末尾）」になります"
                    : "この号機に「有効」の条件が無いため、保存時に「有効」になります"
              }
            >
              {current ? (
                <select className={`${SELECT} w-[240px]`} value={form.status} onChange={(e) => set("status", e.target.value)}>
                  {CONDITION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="inline-block rounded-[6px] border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-3 py-1.5 text-[12px] text-[#374151]">
                  保存時に自動決定：<span className="font-semibold">{machineHasRunning ? "予約（末尾）" : "有効"}</span>
                </div>
              )}
            </FormRow>
            {current && form.status === "QUEUED" && (
              <FormRow label="予約の並び順" note="小さいほど先に消化">
                <input
                  type="number"
                  min={0}
                  className={`${INPUT} w-[120px]`}
                  value={form.queueOrder}
                  disabled={locked}
                  onChange={(e) => set("queueOrder", Number(e.target.value) || 0)}
                />
              </FormRow>
            )}
            <div ref={deliveryDateRef}>
              <FormRow label="配信日" required error={deliveryDateError ?? undefined}>
                <DateField
                  className="w-[240px]"
                  value={form.deliveryDate ?? ""}
                  onChange={(v) => {
                    set("deliveryDate", v || null);
                    if (v) setDeliveryDateError(null);
                  }}
                  holidays={holidays}
                  disabled={locked}
                />
              </FormRow>
            </div>
            <FormRow label="予測件数" note="人が見込みで入れる想定件数（マイナビの検索結果件数は「結果」として実績に記録されます）">
              <input
                type="number"
                min={0}
                className={`${INPUT} w-[120px]`}
                value={form.plannedCount ?? ""}
                disabled={locked}
                onChange={(e) => set("plannedCount", e.target.value === "" ? null : Number(e.target.value))}
              />
            </FormRow>
          </FormGroup>

          {/* ---- 会員情報 ---- */}
          <FormGroup title="会員情報">
            <FormRow no="2." label="登録日">
              <div className={`mb-2 flex gap-4 text-[12px] ${locked ? "text-[#9CA3AF]" : "text-[#374151]"}`}>
                {REGIST_DATE_MODES.map((m) => (
                  <label key={m.value} className={`flex items-center gap-1 ${locked ? "cursor-not-allowed" : ""}`}>
                    <input
                      type="radio"
                      name="d-regist"
                      checked={form.registDateMode === m.value}
                      disabled={locked}
                      onChange={() => set("registDateMode", m.value)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              {form.registDateMode === "PERIOD" ? (
                <select
                  className={`${SELECT} w-[240px]`}
                  value={form.registDays ?? ""}
                  disabled={locked}
                  onChange={(e) => set("registDays", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">選択してください</option>
                  {PERIOD_DAYS_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}日以内
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-start gap-2">
                  <DateField
                    className="w-[200px]"
                    value={form.registDateFrom ?? ""}
                    onChange={(v) => set("registDateFrom", v || null)}
                    holidays={holidays}
                    disabled={locked}
                  />
                  <span className="pt-1.5 text-[12px] text-[#6B7280]">〜</span>
                  <DateField
                    className="w-[200px]"
                    value={form.registDateTo ?? ""}
                    onChange={(v) => set("registDateTo", v || null)}
                    holidays={holidays}
                    disabled={locked}
                  />
                </div>
              )}
            </FormRow>

            <FormRow no="3." label="最終ログイン日" note="マイナビ側で必須。基本は1日以内">
              <select className={`${SELECT} w-[240px]`} value={form.lastLoginDays} disabled={locked} onChange={(e) => set("lastLoginDays", Number(e.target.value))}>
                {PERIOD_DAYS_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}日以内
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow no="6." label="居住地" note="毎回指定する。空欄にはしない（海外が含まれるため）">
              <div className="flex flex-wrap gap-1.5">
                {AREA_MODES.filter((m) => m.value !== "PREFECTURE").map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    disabled={locked}
                    className={CHIP(form.residenceMode === m.value, locked)}
                    onClick={() => {
                      set("residenceMode", m.value);
                      set("residencePrefectures", []);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={locked}
                  className={CHIP(form.residenceMode === "PREFECTURE", locked)}
                  onClick={() =>
                    onOpenPrefModal(
                      form.residencePrefectures,
                      (prefs) => {
                        set("residenceMode", "PREFECTURE");
                        set("residencePrefectures", prefs);
                      },
                      "居住地（都道府県指定）",
                    )
                  }
                >
                  都道府県指定
                  {form.residenceMode === "PREFECTURE" && form.residencePrefectures.length > 0 ? `：${summarizePrefectures(form.residencePrefectures)}` : ""}
                </button>
              </div>
              {form.residenceMode === "PREFECTURE" && form.residencePrefectures.length > 0 && (
                <div className="mt-1 text-[11px] text-[#6B7280]">{form.residencePrefectures.join("/")}</div>
              )}
            </FormRow>
          </FormGroup>

          {/* ---- 最終学歴 ---- */}
          <FormGroup title="最終学歴">
            <FormRow no="4." label="卒業年度" note="配信調整の最重要レバー。年齢不問なら両方とも指定なし">
              <div className="flex items-center gap-2">
                <select
                  className={`${SELECT} w-[160px]`}
                  value={form.gradYearFrom ?? ""}
                  disabled={locked}
                  onChange={(e) => set("gradYearFrom", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">指定なし</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}年
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[#6B7280]">〜</span>
                <select
                  className={`${SELECT} w-[160px]`}
                  value={form.gradYearTo ?? ""}
                  disabled={locked}
                  onChange={(e) => set("gradYearTo", e.target.value === "" ? null : Number(e.target.value))}
                >
                  <option value="">指定なし</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}年
                    </option>
                  ))}
                </select>
              </div>
            </FormRow>
          </FormGroup>

          {/* ---- 経験 ---- */}
          <FormGroup title="経験">
            <FormRow no="5." label="経験社数" note="「0社を除く」は常にチェックなし（固定）">
              <select
                className={`${SELECT} w-[240px]`}
                value={form.companyCount === null ? "null" : String(form.companyCount)}
                disabled={locked}
                onChange={(e) => set("companyCount", e.target.value === "null" ? null : Number(e.target.value))}
              >
                {COMPANY_COUNT_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value === null ? "null" : String(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormRow>
          </FormGroup>

          {/* ---- 希望条件 ---- */}
          <FormGroup title="希望条件">
            <FormRow no="7." label="希望勤務地" note="基本は有効エリア8都府県（東京・埼玉・神奈川・千葉・愛知・大阪・兵庫・京都）で固定。個別配信で稀に絞る">
              <div className="flex flex-wrap items-center gap-1.5">
                {WORK_PREF_MODES.map((m) =>
                  m.value === "ALL" ? (
                    <button
                      key={m.value}
                      type="button"
                      disabled={locked}
                      className={CHIP(form.workPrefMode === "ALL", locked)}
                      onClick={() => {
                        set("workPrefMode", "ALL");
                        set("workPrefectures", []);
                      }}
                    >
                      {m.label}
                    </button>
                  ) : (
                    <button
                      key={m.value}
                      type="button"
                      disabled={locked}
                      className={CHIP(form.workPrefMode === "SELECTED", locked)}
                      onClick={() =>
                        onOpenPrefModal(
                          form.workPrefectures.length > 0 ? form.workPrefectures : DEFAULT_WORK_PREFECTURES,
                          (prefs) => {
                            set("workPrefMode", "SELECTED");
                            set("workPrefectures", prefs);
                          },
                          "希望勤務地（都道府県指定）",
                        )
                      }
                    >
                      {m.label}
                      {form.workPrefMode === "SELECTED" && form.workPrefectures.length > 0
                        ? `：${isDefaultWorkPrefectures(form.workPrefectures) ? DEFAULT_WORK_PREFECTURES_LABEL : summarizePrefectures(form.workPrefectures)}`
                        : ""}
                    </button>
                  ),
                )}
                {!locked && form.workPrefMode === "SELECTED" && !isDefaultWorkPrefectures(form.workPrefectures) && (
                  <button
                    type="button"
                    className="text-[11px] text-[#2563EB] underline"
                    onClick={() => {
                      set("workPrefMode", "SELECTED");
                      set("workPrefectures", DEFAULT_WORK_PREFECTURES);
                    }}
                  >
                    有効エリアに戻す
                  </button>
                )}
              </div>
              {form.workPrefMode === "SELECTED" && form.workPrefectures.length > 0 && (
                <div className="mt-1 text-[11px] text-[#6B7280]">{form.workPrefectures.join("/")}</div>
              )}
            </FormRow>
          </FormGroup>

          {/* ---- 検索対象 ---- */}
          <FormGroup title="検索対象">
            <FormRow no="1." label="検索対象" note="自社がスカウトを送信した会員">
              <div className="flex flex-wrap gap-1.5">
                {SEARCH_TARGETS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    disabled={locked}
                    className={CHIP(form.searchTarget === s.value, locked)}
                    onClick={() => set("searchTarget", s.value)}
                  >
                    {s.label}
                    {s.sub && <span className="ml-1 text-[10px] opacity-70">({s.sub})</span>}
                  </button>
                ))}
              </div>
            </FormRow>
          </FormGroup>

          {/* ---- 固定値（RPA が常にこの値で入力・表示のみ） ---- */}
          <FormGroup title="固定値" titleNote="RPA が常にこの値で入力（表示のみ）">
            {FIXED_VALUES.map((f) => (
              <FormRow key={f.label} label={f.label} dense>
                <span className="text-[12px] text-[#374151]">{f.value}</span>
              </FormRow>
            ))}
          </FormGroup>

          {/* ---- 配信文 ---- */}
          <FormGroup title="配信文">
            <FormRow label="配信文" note={template ? `種別: ${templateKindLabel(template.kind)}` : undefined}>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  className={`${SELECT} w-[320px]`}
                  value={form.templateId ?? ""}
                  disabled={locked}
                  onChange={(e) => set("templateId", e.target.value || null)}
                >
                  <option value="">未設定</option>
                  {templatesByKind.map((g) =>
                    g.items.length ? (
                      <optgroup key={g.kind.value} label={g.kind.label}>
                        {g.items.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.isActive ? "" : "（無効）"}
                          </option>
                        ))}
                      </optgroup>
                    ) : null,
                  )}
                </select>
                {!locked && machine?.defaultTemplateId && machine.defaultTemplateId !== form.templateId && (
                  <button type="button" className="text-[11px] text-[#2563EB] underline" onClick={() => set("templateId", machine.defaultTemplateId)}>
                    {machine.machineNo}号機のデフォルト（{templates.find((t) => t.id === machine.defaultTemplateId)?.name ?? "-"}）を使う
                  </button>
                )}
              </div>
            </FormRow>
            {/* プレビューは行の下に全幅で置く（左右に並べない） */}
            <div className="p-3">
              <TemplatePreview template={template} />
            </div>
          </FormGroup>

          {/* ---- 実績 ---- */}
          {current && (
            <FormGroup title="実績">
              <FormRow label="配信日" dense>
                <span className="text-[12px]">
                  <DateText ymd={current.deliveryDate} holidays={holidays} />
                </span>
              </FormRow>
              {/* T-214: 作成日時と登録者を1行に。「登録者」の単独行は廃止 */}
              <FormRow label="作成" dense>
                <span className="text-[12px]">
                  <DateTimeText iso={current.createdAt} holidays={holidays} />
                  <span className="ml-3">{current.createdByName ?? "-"}</span>
                </span>
              </FormRow>
              {/* T-214: 人が最後に保存した日時・操作者（自動処理・▲▼では動かない）。未更新なら "-" */}
              <FormRow label="更新" dense>
                <span className="text-[12px]">
                  {current.editedAt ? (
                    <>
                      <DateTimeText iso={current.editedAt} holidays={holidays} />
                      <span className="ml-3">{current.editedByName ?? "-"}</span>
                    </>
                  ) : (
                    <span className="text-[#9CA3AF]">-</span>
                  )}
                </span>
              </FormRow>
              <FormRow label="最終実行" dense>
                <span className="text-[12px]">
                  <DateTimeText iso={latest?.executedAt} holidays={holidays} />
                </span>
              </FormRow>
              {/* T-206: 予測（人の想定）／結果（マイナビの検索結果件数＝母数。RPA 未送信の間は "-"）／抽出／送信 */}
              {/* T-213: 結果は最新ではなく初回の値（値を持つ最も古い実行）。一覧・CSV と同じ firstSearchResultCount を使う */}
              <FormRow label="予測 / 結果 / 抽出 / 送信" dense>
                <span className="text-[12px] tabular-nums">
                  {current.plannedCount ?? "-"} / {current.firstSearchResultCount ?? "-"} / {latest?.extractedCount ?? "-"} /{" "}
                  <span className={dry ? "font-semibold text-[#B91C1C]" : ""}>{latest?.sentCount ?? "-"}</span>
                </span>
              </FormRow>
              <div className="p-3">
                {current.runs.length > 0 && (
                  <div className="overflow-x-auto rounded border border-[#E5E7EB]">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-[#F9FAFB] text-[#6B7280]">
                        <tr>
                          <th className="px-2 py-1 text-left">実行日時</th>
                          <th className="px-2 py-1 text-right">結果</th>
                          <th className="px-2 py-1 text-right">抽出</th>
                          <th className="px-2 py-1 text-right">送信</th>
                          <th className="px-2 py-1 text-left">枯渇</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.runs.slice(0, 20).map((r) => (
                          <tr key={r.id} className="border-t border-[#F3F4F6]" title={r.rawNotification ?? undefined}>
                            <td className="px-2 py-1">
                              <DateTimeText iso={r.executedAt} holidays={holidays} />
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.searchResultCount ?? "-"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{r.extractedCount}</td>
                            <td className={`px-2 py-1 text-right tabular-nums ${isDrySentCount(r.sentCount) ? "font-semibold text-[#B91C1C]" : ""}`}>{r.sentCount}</td>
                            <td className="px-2 py-1">{r.isDry || isDrySentCount(r.sentCount) ? "枯渇" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {current.runs.length > 20 && (
                  <div className="mt-1 text-[10px] text-[#9CA3AF]">新しい順に20件まで表示（全{current.runs.length}件）</div>
                )}
                {current.runs.length === 0 && <div className="text-[11px] text-[#9CA3AF]">実行実績はまだありません（RPA が配信するたびに記録されます）</div>}
              </div>
            </FormGroup>
          )}
        </div>

        {/* T-214: 右パネル（xl 以上ではスクロールしても上に留まる。xl 未満ではフォームの下） */}
        <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
          <SameDayPanel date={sameDayDate} rows={sameDayRows} loading={!sameDayLoaded} overlapIds={overlapIds} />
        </div>
        </div>

        {/* 下部ボタン（スクロールしても固定。主ボタンは右下） */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#E5E7EB] px-5 py-3">
          <div className="flex gap-2">
            {current && (
              <>
                <button type="button" onClick={() => onDuplicate(current)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]">
                  複製
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(current)}
                  disabled={locked}
                  title={locked ? "実績があるため削除できません（状態を「完了」にしてください）" : undefined}
                  className="rounded-[6px] border border-[#FECACA] px-3 py-1.5 text-[13px] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  削除
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-[11px] text-[#D97706]">未保存の変更があります</span>}
            <button type="button" onClick={onClose} className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]">
              キャンセル
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? "保存中…" : mode.kind === "new" ? "登録する" : "保存する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
