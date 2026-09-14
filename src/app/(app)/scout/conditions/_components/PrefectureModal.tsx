"use client";

// T-194: 都道府県指定モーダル。マイナビと同じ2段構え（STEP1 地域リスト／STEP2 地域の親チェック＋都道府県）。
// 海外は載せない。確定後の表示は summarizePrefectures でまとめる（関東全選択→「関東」等）。
import { useState } from "react";
import { useOverlayClose } from "@/hooks/useOverlayClose";
import { ALL_AREA_GROUPS, ALL_PREFECTURES, summarizePrefectures } from "@/lib/scout-conditions/constants";

const NATIONWIDE_KEY = "全国";

export default function PrefectureModal({
  initial,
  title = "都道府県指定",
  onClose,
  onConfirm,
}: {
  initial: string[];
  /** 見出し（居住地／希望勤務地で使い分ける。T-196） */
  title?: string;
  onClose: () => void;
  onConfirm: (prefectures: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [region, setRegion] = useState<string>(NATIONWIDE_KEY);
  const overlayClose = useOverlayClose(onClose);

  const group = ALL_AREA_GROUPS.find((g) => g.region === region) ?? null;
  const groupPrefs = group ? group.prefectures : ALL_PREFECTURES;
  const allChecked = groupPrefs.every((p) => selected.has(p));
  const someChecked = !allChecked && groupPrefs.some((p) => selected.has(p));

  const toggleParent = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) groupPrefs.forEach((p) => next.delete(p));
      else groupPrefs.forEach((p) => next.add(p));
      return next;
    });
  };
  const togglePref = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const ordered = ALL_PREFECTURES.filter((p) => selected.has(p));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" {...overlayClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <div className="text-[15px] font-semibold text-[#374151]">{title}</div>
          <button type="button" onClick={onClose} className="text-[13px] text-[#6B7280] hover:text-[#374151]">
            閉じる
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* STEP1: 地域リスト */}
          <div className="w-40 shrink-0 overflow-y-auto border-r border-[#E5E7EB] bg-[#F9FAFB]">
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-[#6B7280]">STEP1 地域</div>
            {[NATIONWIDE_KEY, ...ALL_AREA_GROUPS.map((g) => g.region)].map((r) => {
              const prefs = r === NATIONWIDE_KEY ? ALL_PREFECTURES : ALL_AREA_GROUPS.find((g) => g.region === r)!.prefectures;
              const count = prefs.filter((p) => selected.has(p)).length;
              const active = region === r;
              return (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRegion(r)}
                  className={[
                    "flex w-full items-center justify-between px-3 py-2 text-left text-[13px]",
                    active ? "bg-white font-medium text-[#2563EB]" : "text-[#374151] hover:bg-[#F3F4F6]",
                  ].join(" ")}
                >
                  <span>{r}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-[#EFF6FF] px-1.5 text-[11px] text-[#2563EB]">
                      {count}/{prefs.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* STEP2: 親チェック＋都道府県 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <div className="mb-1 text-[11px] font-semibold text-[#6B7280]">STEP2 都道府県</div>
            <label className="mb-3 flex items-center gap-2 rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[13px] font-medium text-[#374151]">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={toggleParent}
              />
              {region}をすべて選択
            </label>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-4">
              {groupPrefs.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-[13px] text-[#374151]">
                  <input type="checkbox" checked={selected.has(p)} onChange={() => togglePref(p)} />
                  {p}
                </label>
              ))}
            </div>
            <div className="mt-4 rounded-[6px] bg-[#F3F4F6] px-3 py-2 text-[12px] text-[#374151]">
              <span className="text-[#6B7280]">確定後の表示: </span>
              <span className="font-medium">{summarizePrefectures(ordered)}</span>
              {ordered.length > 0 && <div className="mt-1 text-[11px] text-[#6B7280]">{ordered.join("/")}</div>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#E5E7EB] px-4 py-3">
          <div className="text-[13px] text-[#374151]">
            選択件数 <span className="font-semibold">{ordered.length}</span> / {ALL_PREFECTURES.length}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-[6px] border border-[#D1D5DB] px-3 py-1.5 text-[13px] text-[#374151] hover:bg-[#F9FAFB]"
            >
              すべてをクリア
            </button>
            <button
              type="button"
              disabled={ordered.length === 0}
              onClick={() => onConfirm(ordered)}
              className="rounded-[6px] bg-[#2563EB] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-40"
              title={ordered.length === 0 ? "空欄にはできません（何も選ばないと海外が含まれます）" : undefined}
            >
              確定する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
