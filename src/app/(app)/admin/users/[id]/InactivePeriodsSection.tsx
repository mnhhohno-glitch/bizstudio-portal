"use client";

import { useState } from "react";
import { BlockTitle, DateInput, FormField } from "./detail-ui";
import type { InactivePeriodItem } from "./detail-types";

// T-XXX step6: 稼働しない期間（休業など）の一覧・追加・編集・削除。
// 期間（開始日・終了日）だけを扱う。理由の入力欄は作らない（保存もしない）。
// CA 分析（ChatGPT の CA実績アプリ）で、この期間は在籍していない日として CA 平均・1人あたりの分母から外れる。

type Draft = { startDate: string; endDate: string };
const EMPTY: Draft = { startDate: "", endDate: "" };

export default function InactivePeriodsSection({
  employeeId,
  initialPeriods,
}: {
  employeeId: string;
  initialPeriods: InactivePeriodItem[];
}) {
  const [periods, setPeriods] = useState<InactivePeriodItem[]>(initialPeriods);
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = `/api/admin/employees/${employeeId}/inactive-periods`;
  const sortByStart = (xs: InactivePeriodItem[]) => [...xs].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const send = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || `エラー ${res.status}`);
        return null;
      }
      return j as { period?: InactivePeriodItem };
    } catch {
      setError("通信エラーが発生しました");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    if (!adding?.startDate) return;
    const r = await send("POST", { startDate: adding.startDate, endDate: adding.endDate || null });
    if (r?.period) {
      setPeriods((xs) => sortByStart([...xs, r.period!]));
      setAdding(null);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editDraft.startDate) return;
    const r = await send("PATCH", { id, startDate: editDraft.startDate, endDate: editDraft.endDate || null });
    if (r?.period) {
      setPeriods((xs) => sortByStart(xs.map((p) => (p.id === id ? r.period! : p))));
      setEditingId(null);
    }
  };

  const handleDelete = async (p: InactivePeriodItem) => {
    if (!window.confirm(`${p.startDate} 〜 ${p.endDate ?? "終了未定"} を削除しますか？`)) return;
    const r = await send("DELETE", { id: p.id });
    if (r) setPeriods((xs) => xs.filter((x) => x.id !== p.id));
  };

  const btn = "rounded px-2.5 py-1 text-[12px] disabled:opacity-50";

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <BlockTitle>稼働しない期間</BlockTitle>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(EMPTY);
              setError(null);
            }}
            className={`${btn} border border-gray-300 text-slate-700 hover:bg-gray-50`}
          >
            ＋ 期間を追加
          </button>
        )}
      </div>
      <p className="mb-2 text-[10px] text-gray-400">
        この期間は CA 分析で在籍していない日として扱い、CA 平均・1人あたりの分母から外します。終了日が未定なら空欄のままにしてください。
      </p>
      {error && <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}

      {periods.length === 0 && !adding && <div className="text-[12px] text-gray-400">登録なし</div>}

      <ul className="space-y-1.5">
        {periods.map((p) =>
          editingId === p.id ? (
            <li key={p.id} className="flex items-end gap-3">
              <div className="w-40">
                <FormField label="開始日">
                  <DateInput value={editDraft.startDate} onChange={(v) => setEditDraft((d) => ({ ...d, startDate: v }))} />
                </FormField>
              </div>
              <div className="w-40">
                <FormField label="終了日（空欄＝未定）">
                  <DateInput value={editDraft.endDate} onChange={(v) => setEditDraft((d) => ({ ...d, endDate: v }))} />
                </FormField>
              </div>
              <button type="button" disabled={busy || !editDraft.startDate} onClick={() => handleUpdate(p.id)} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                保存
              </button>
              <button type="button" disabled={busy} onClick={() => setEditingId(null)} className={`${btn} text-gray-500 hover:text-slate-700`}>
                キャンセル
              </button>
            </li>
          ) : (
            <li key={p.id} className="flex items-center gap-3 text-[13px] text-slate-800">
              <span className="w-64">
                {p.startDate} 〜 {p.endDate ?? <span className="text-gray-500">終了未定</span>}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditingId(p.id);
                  setEditDraft({ startDate: p.startDate, endDate: p.endDate ?? "" });
                  setError(null);
                }}
                className={`${btn} text-blue-700 hover:underline`}
              >
                編集
              </button>
              <button type="button" disabled={busy} onClick={() => handleDelete(p)} className={`${btn} text-red-600 hover:underline`}>
                削除
              </button>
            </li>
          ),
        )}
        {adding && (
          <li className="flex items-end gap-3">
            <div className="w-40">
              <FormField label="開始日">
                <DateInput value={adding.startDate} onChange={(v) => setAdding((d) => ({ ...(d ?? EMPTY), startDate: v }))} />
              </FormField>
            </div>
            <div className="w-40">
              <FormField label="終了日（空欄＝未定）">
                <DateInput value={adding.endDate} onChange={(v) => setAdding((d) => ({ ...(d ?? EMPTY), endDate: v }))} />
              </FormField>
            </div>
            <button type="button" disabled={busy || !adding.startDate} onClick={handleAdd} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
              追加
            </button>
            <button type="button" disabled={busy} onClick={() => setAdding(null)} className={`${btn} text-gray-500 hover:text-slate-700`}>
              キャンセル
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
