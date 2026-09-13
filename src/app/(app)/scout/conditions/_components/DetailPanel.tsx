"use client";

// T-194: 行クリックで右から出る詳細パネル。検索条件6軸（編集可）・固定値・配信文プレビュー・実績を表示する。
// 新規作成も同じパネル（mode="new"）で行う。
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AREA_MODES,
  COMPANY_COUNT_OPTIONS,
  CONDITION_STATUSES,
  FIXED_VALUES,
  PERIOD_DAYS_OPTIONS,
  REGIST_DATE_MODES,
  SEARCH_TARGETS,
  TEMPLATE_KINDS,
  gradYearOptions,
  summarizePrefectures,
  templateKindLabel,
  isDrySentCount,
} from "@/lib/scout-conditions/constants";
import { jstTodayYmd, type HolidayMap } from "@/lib/scout-conditions/dates";
import type { ConditionDto, ConditionInput, MachineDto, TemplateDto } from "@/lib/scout-conditions/types";
import { DateField, DateText, DateTimeText } from "./DateText";
import { MachineLabel } from "./MachineLabel";
import TemplatePreview from "./TemplatePreview";

const SELECT = "w-full rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-[13px] text-[#374151]";
const INPUT = "w-full rounded-[6px] border border-[#D1D5DB] px-2 py-1.5 text-[13px] text-[#374151]";
const CHIP = (selected: boolean) =>
  [
    "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
    selected ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-[#D1D5DB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]",
  ].join(" ")

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-[#6B7280]">{label}</div>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-[#9CA3AF]">{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-5 border-b border-[#E5E7EB] pb-1 text-[13px] font-semibold text-[#374151]">{children}</div>;
}

export type DetailMode = { kind: "new" } | { kind: "edit"; condition: ConditionDto };

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
      areaMode: c.areaMode,
      prefectures: c.prefectures,
      templateId: c.templateId,
      plannedCount: c.plannedCount,
      deliveryDate: c.deliveryDate,
    };
  }
  const firstActive = machines.find((m) => m.isActive) ?? machines[0];
  return {
    machineId: firstActive?.id ?? "",
    status: "QUEUED",
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
    areaMode: "NATIONWIDE",
    prefectures: [],
    templateId: firstActive?.defaultTemplateId ?? null,
    plannedCount: null,
    deliveryDate: today,
  };
}

export default function DetailPanel({
  mode,
  machines,
  templates,
  holidays,
  onClose,
  onSaved,
  onDuplicate,
  onDelete,
  onOpenPrefModal,
}: {
  mode: DetailMode;
  machines: MachineDto[];
  templates: TemplateDto[];
  holidays: HolidayMap;
  onClose: () => void;
  onSaved: (c: ConditionDto, isNew: boolean) => void;
  onDuplicate: (c: ConditionDto) => void;
  onDelete: (c: ConditionDto) => void;
  onOpenPrefModal: (current: string[], onConfirm: (prefs: string[]) => void) => void;
}) {
  const today = jstTodayYmd();
  const current = mode.kind === "edit" ? mode.condition : null;
  const [form, setForm] = useState<ConditionInput>(() => toForm(current, machines, today));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 別の行を開いたらフォームを入れ替える
  const modeKey = mode.kind === "edit" ? `${mode.condition.id}:${mode.condition.updatedAt}` : "new";
  const [loadedKey, setLoadedKey] = useState(modeKey);
  useEffect(() => {
    if (loadedKey !== modeKey) {
      setForm(toForm(current, machines, today));
      setDirty(false);
      setLoadedKey(modeKey);
    }
  }, [modeKey, loadedKey, current, machines, today]);

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

  const save = async () => {
    if (saving) return;
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
      toast.success(isNew ? "条件を作成しました" : "保存しました");
      setDirty(false);
      onSaved(json.condition as ConditionDto, isNew);
    } finally {
      setSaving(false);
    }
  };

  const latest = current?.latestRun ?? null;
  const dry = current ? current.status === "DRY" || isDrySentCount(latest?.sentCount) : false;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-[#E5E7EB] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
        <div>
          <div className="text-[15px] font-semibold text-[#374151]">
            {mode.kind === "new" ? "条件を新規作成" : "配信条件の詳細"}
          </div>
          {current && (
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#6B7280]">
              <MachineLabel machineNo={current.machineNo} />
              {dry && <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 font-medium text-[#B91C1C]">枯渇</span>}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
          閉じる ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <SectionTitle>基本</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="号機">
            <select className={SELECT} value={form.machineId} onChange={(e) => set("machineId", e.target.value)}>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machineNo}号機{m.isActive ? "" : "（停止）"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="状態">
            <select className={SELECT} value={form.status} onChange={(e) => set("status", e.target.value)}>
              {CONDITION_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="配信日">
            <DateField value={form.deliveryDate ?? ""} onChange={(v) => set("deliveryDate", v || null)} holidays={holidays} />
          </Field>
          <Field label="予定件数">
            <input
              type="number"
              min={0}
              className={INPUT}
              value={form.plannedCount ?? ""}
              onChange={(e) => set("plannedCount", e.target.value === "" ? null : Number(e.target.value))}
            />
          </Field>
          {form.status === "QUEUED" && (
            <Field label="予約の並び順" hint="小さいほど先に消化。新規作成で未入力なら末尾に付きます">
              <input
                type="number"
                min={0}
                className={INPUT}
                value={form.queueOrder}
                onChange={(e) => set("queueOrder", Number(e.target.value) || 0)}
              />
            </Field>
          )}
        </div>

        <SectionTitle>検索条件（6軸）</SectionTitle>
        <div className="space-y-3">
          <Field label="1. 検索対象（自社がスカウトを送信した会員）">
            <div className="flex flex-wrap gap-1.5">
              {SEARCH_TARGETS.map((s) => (
                <button key={s.value} type="button" className={CHIP(form.searchTarget === s.value)} onClick={() => set("searchTarget", s.value)}>
                  {s.label}
                  {s.sub && <span className="ml-1 text-[10px] opacity-70">({s.sub})</span>}
                </button>
              ))}
            </div>
          </Field>

          <Field label="2. 登録日">
            <div className="mb-2 flex gap-4 text-[12px] text-[#374151]">
              {REGIST_DATE_MODES.map((m) => (
                <label key={m.value} className="flex items-center gap-1">
                  <input type="radio" name="d-regist" checked={form.registDateMode === m.value} onChange={() => set("registDateMode", m.value)} />
                  {m.label}
                </label>
              ))}
            </div>
            {form.registDateMode === "PERIOD" ? (
              <select className={SELECT} value={form.registDays ?? ""} onChange={(e) => set("registDays", e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">選択してください</option>
                {PERIOD_DAYS_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}日以内
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <DateField value={form.registDateFrom ?? ""} onChange={(v) => set("registDateFrom", v || null)} holidays={holidays} />
                <DateField value={form.registDateTo ?? ""} onChange={(v) => set("registDateTo", v || null)} holidays={holidays} />
              </div>
            )}
          </Field>

          <Field label="3. 最終ログイン日" hint="マイナビ側で必須。基本は1日以内">
            <select className={SELECT} value={form.lastLoginDays} onChange={(e) => set("lastLoginDays", Number(e.target.value))}>
              {PERIOD_DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}日以内
                </option>
              ))}
            </select>
          </Field>

          <Field label="4. 卒業年度" hint="配信調整の最重要レバー。年齢不問なら両方とも指定なし">
            <div className="flex items-center gap-2">
              <select className={SELECT} value={form.gradYearFrom ?? ""} onChange={(e) => set("gradYearFrom", e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">指定なし</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-[#6B7280]">〜</span>
              <select className={SELECT} value={form.gradYearTo ?? ""} onChange={(e) => set("gradYearTo", e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">指定なし</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="5. 経験社数" hint="「0社を除く」は常にチェックなし（固定）">
            <select
              className={SELECT}
              value={form.companyCount === null ? "null" : String(form.companyCount)}
              onChange={(e) => set("companyCount", e.target.value === "null" ? null : Number(e.target.value))}
            >
              {COMPANY_COUNT_OPTIONS.map((o) => (
                <option key={String(o.value)} value={o.value === null ? "null" : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="6. 希望勤務地" hint="居住地は触らない。空欄にはしない（海外が含まれるため）">
            <div className="flex flex-wrap gap-1.5">
              {AREA_MODES.filter((m) => m.value !== "PREFECTURE").map((m) => (
                <button key={m.value} type="button" className={CHIP(form.areaMode === m.value)} onClick={() => { set("areaMode", m.value); set("prefectures", []); }}>
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                className={CHIP(form.areaMode === "PREFECTURE")}
                onClick={() =>
                  onOpenPrefModal(form.prefectures, (prefs) => {
                    set("areaMode", "PREFECTURE");
                    set("prefectures", prefs);
                  })
                }
              >
                都道府県指定
                {form.areaMode === "PREFECTURE" && form.prefectures.length > 0 ? `：${summarizePrefectures(form.prefectures)}` : ""}
              </button>
            </div>
            {form.areaMode === "PREFECTURE" && form.prefectures.length > 0 && (
              <div className="mt-1 text-[11px] text-[#6B7280]">{form.prefectures.join("/")}</div>
            )}
          </Field>
        </div>

        <SectionTitle>固定値（RPA が常にこの値で入力）</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          {FIXED_VALUES.map((f) => (
            <div key={f.label} className="flex justify-between gap-2 rounded bg-[#F9FAFB] px-2 py-1">
              <dt className="text-[#6B7280]">{f.label}</dt>
              <dd className="text-[#374151]">{f.value}</dd>
            </div>
          ))}
        </dl>

        <SectionTitle>配信文</SectionTitle>
        <select className={`${SELECT} mb-2`} value={form.templateId ?? ""} onChange={(e) => set("templateId", e.target.value || null)}>
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
        {machine?.defaultTemplateId && machine.defaultTemplateId !== form.templateId && (
          <button
            type="button"
            className="mb-2 text-[11px] text-[#2563EB] underline"
            onClick={() => set("templateId", machine.defaultTemplateId)}
          >
            {machine.machineNo}号機のデフォルト（{templates.find((t) => t.id === machine.defaultTemplateId)?.name ?? "-"}）を使う
          </button>
        )}
        <TemplatePreview template={template} />
        {template && <div className="mt-1 text-[10px] text-[#6B7280]">種別: {templateKindLabel(template.kind)}</div>}

        {current && (
          <>
            <SectionTitle>実績</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <div className="flex justify-between rounded bg-[#F9FAFB] px-2 py-1">
                <dt className="text-[#6B7280]">配信日</dt>
                <dd>
                  <DateText ymd={current.deliveryDate} holidays={holidays} />
                </dd>
              </div>
              <div className="flex justify-between rounded bg-[#F9FAFB] px-2 py-1">
                <dt className="text-[#6B7280]">予約登録</dt>
                <dd>
                  <DateTimeText iso={current.createdAt} holidays={holidays} />
                </dd>
              </div>
              <div className="flex justify-between rounded bg-[#F9FAFB] px-2 py-1">
                <dt className="text-[#6B7280]">最終実行</dt>
                <dd>
                  <DateTimeText iso={latest?.executedAt} holidays={holidays} />
                </dd>
              </div>
              <div className="flex justify-between rounded bg-[#F9FAFB] px-2 py-1">
                <dt className="text-[#6B7280]">予定/抽出/送信</dt>
                <dd className="tabular-nums">
                  {current.plannedCount ?? "-"} / {latest?.extractedCount ?? "-"} /{" "}
                  <span className={dry ? "font-semibold text-[#B91C1C]" : ""}>{latest?.sentCount ?? "-"}</span>
                </dd>
              </div>
              <div className="col-span-2 flex justify-between rounded bg-[#F9FAFB] px-2 py-1">
                <dt className="text-[#6B7280]">登録者</dt>
                <dd>{current.createdByName ?? "-"}</dd>
              </div>
            </dl>
            {current.runs.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded border border-[#E5E7EB]">
                <table className="min-w-full text-[11px]">
                  <thead className="bg-[#F9FAFB] text-[#6B7280]">
                    <tr>
                      <th className="px-2 py-1 text-left">実行日時</th>
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
            {current.runs.length === 0 && <div className="mt-1 text-[11px] text-[#9CA3AF]">実行実績はまだありません（RPA が配信するたびに記録されます）</div>}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#E5E7EB] px-4 py-3">
        <div className="flex gap-2">
          {current && (
            <>
              <button type="button" onClick={() => onDuplicate(current)} className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]">
                複製
              </button>
              <button
                type="button"
                onClick={() => onDelete(current)}
                disabled={current.runs.length > 0}
                title={current.runs.length > 0 ? "実績があるため削除できません（状態を「完了」にしてください）" : undefined}
                className="rounded-[6px] border border-[#FECACA] px-3 py-1.5 text-[13px] text-[#B91C1C] hover:bg-[#FEF2F2] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                削除
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[11px] text-[#D97706]">未保存の変更があります</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? "保存中…" : mode.kind === "new" ? "作成する" : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
