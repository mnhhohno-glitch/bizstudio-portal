"use client";

import { useMemo, useState } from "react";
import { displayPatternName } from "@/lib/rpa-scout/pattern-name";
import { isRecentlyUsed, lastUsedSuffix, type RpaPattern } from "./types";
import { DropdownBand, DropdownChipRow, useDropdownList } from "./dropdown";

// 絞り込みはパターンの保存値をそのまま見る（sendStatus / registDirection / areaType）。
// 具体的な値で絞ったとき、その値を持たないパターンは出ない（エリアの県指定も同様）
const SEND_FILTERS = [
  { value: "ALL", label: "全て" },
  { value: "UNSENT", label: "未送信" },
  { value: "SENT", label: "送信済" },
] as const;

const REGIST_FILTERS = [
  { value: "ALL", label: "全て" },
  { value: "WITHIN", label: "開放日" },
  { value: "AFTER", label: "既登録" },
  { value: "NONE", label: "指定なし" }, // registDirection が入っていないパターン
] as const;

const AREA_FILTERS = [
  { value: "ALL", label: "全て" },
  { value: "EAST", label: "東日本" },
  { value: "WEST", label: "西日本" },
  { value: "NATIONWIDE", label: "全国" },
] as const;

const SORT_OPTIONS = [
  { value: "MACHINE", label: "号機順" },
  { value: "RECENT", label: "直近利用順" },
] as const;

// パターン選択。その号機用＋全号機用を先頭グループに置き、絞り込み（送信状態／登録日／エリア）と
// 並び替え（号機順／直近利用順）を持つ独自ドロップダウン。
// 絞り込み・並び替えは表示だけの操作で、選択済みの値は条件に合わなくなっても解除しない
export default function PatternSelect({
  patterns,
  value,
  onChange,
  machineNo,
}: {
  patterns: RpaPattern[];
  value: string;
  onChange: (id: string) => void;
  machineNo: number; // モーダルの対象号機（グループ分けに使う）
}) {
  const [sendFilter, setSendFilter] = useState<string>("ALL");
  const [registFilter, setRegistFilter] = useState<string>("ALL");
  const [areaFilter, setAreaFilter] = useState<string>("ALL");
  const [sortMode, setSortMode] = useState<string>("MACHINE");

  const filtered = useMemo(
    () =>
      patterns.filter((p) => {
        if (sendFilter !== "ALL" && p.sendStatus !== sendFilter) return false;
        if (registFilter === "NONE") {
          if (p.registDirection) return false;
        } else if (registFilter !== "ALL" && p.registDirection !== registFilter) {
          return false;
        }
        if (areaFilter !== "ALL" && p.areaType !== areaFilter) return false;
        return true;
      }),
    [patterns, sendFilter, registFilter, areaFilter]
  );

  const groups = useMemo(() => {
    const byName = (a: RpaPattern, b: RpaPattern) => a.name.localeCompare(b.name, "ja");

    // 直近利用順は号機をまたいだ1本のリスト（見出しなし）。未使用は最後尾
    if (sortMode === "RECENT") {
      const items = [...filtered].sort((a, b) => {
        if (a.lastUsedAt && b.lastUsedAt) return a.lastUsedAt < b.lastUsedAt ? 1 : -1;
        if (a.lastUsedAt) return -1;
        if (b.lastUsedAt) return 1;
        return byName(a, b);
      });
      return items.length > 0 ? [{ key: "recent", label: null, items }] : [];
    }

    const own = filtered
      .filter((p) => p.targetMachineNo === machineNo || p.targetMachineNo == null)
      .sort(byName);
    const others = filtered
      .filter((p) => p.targetMachineNo != null && p.targetMachineNo !== machineNo)
      .sort(byName);
    const result: { key: string; label: string | null; items: RpaPattern[] }[] = [];
    if (own.length > 0) result.push({ key: "own", label: `${machineNo}号機用・全号機用`, items: own });
    if (others.length > 0) result.push({ key: "others", label: "その他の号機用", items: others });
    return result;
  }, [filtered, sortMode, machineNo]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const ids = useMemo(() => flat.map((p) => p.id), [flat]);
  const indexOfId = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);

  const dd = useDropdownList({ ids, value, onChange });
  const selected = patterns.find((p) => p.id === value) ?? null;

  return (
    <div ref={dd.rootRef} className="relative" onKeyDown={dd.onKeyDown}>
      <button
        type="button"
        onClick={dd.toggle}
        className="flex w-full items-center justify-between gap-2 rounded-[6px] border border-[#D1D5DB] bg-white px-2 py-1.5 text-left text-[14px]"
      >
        <span
          className={
            selected
              ? isRecentlyUsed(selected.lastUsedAt)
                ? "truncate text-[#DC2626]"
                : "truncate text-[#374151]"
              : "truncate text-[#9CA3AF]"
          }
        >
          {selected
            ? displayPatternName(selected.targetMachineNo, selected.name)
            : "選択してください"}
        </span>
        <span className="shrink-0 text-[11px] text-[#9CA3AF]">▼</span>
      </button>

      {dd.open && (
        <div
          ref={dd.listRef}
          className="absolute z-30 mt-1 max-h-[340px] w-full overflow-y-auto rounded-[6px] border border-[#D1D5DB] bg-white shadow-lg"
        >
          <div
            data-dropdown-controls
            className="sticky top-0 z-10 space-y-1 border-b border-[#E5E7EB] bg-[#F9FAFB] px-2 py-2"
          >
            <DropdownChipRow
              label="送信状態"
              options={SEND_FILTERS}
              value={sendFilter}
              onChange={setSendFilter}
            />
            <DropdownChipRow
              label="登録日"
              options={REGIST_FILTERS}
              value={registFilter}
              onChange={setRegistFilter}
            />
            <DropdownChipRow
              label="エリア"
              options={AREA_FILTERS}
              value={areaFilter}
              onChange={setAreaFilter}
            />
            <DropdownChipRow
              label="並び順"
              options={SORT_OPTIONS}
              value={sortMode}
              onChange={setSortMode}
            />
          </div>

          {flat.length === 0 ? (
            <div className="px-2 py-3 text-[13px] text-[#9CA3AF]">
              該当するパターンがありません
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                {g.label && <DropdownBand>{g.label}</DropdownBand>}
                {g.items.map((p) => {
                  const idx = indexOfId.get(p.id)!;
                  const active = idx === dd.activeIndex;
                  const recent = isRecentlyUsed(p.lastUsedAt);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      data-idx={idx}
                      onMouseEnter={() => dd.setActiveIndex(idx)}
                      onClick={() => dd.commit(p.id)}
                      className={`flex w-full items-start gap-2 px-2 py-1.5 text-left text-[13px] ${
                        active ? "bg-[#F3F4F6]" : "bg-white"
                      } ${
                        recent
                          ? "text-[#DC2626]"
                          : p.id === value
                            ? "text-[#1D4ED8]"
                            : "text-[#374151]"
                      } ${p.id === value ? "font-semibold" : ""}`}
                    >
                      <span className="min-w-0 flex-1 break-all">
                        {displayPatternName(p.targetMachineNo, p.name)}{" "}
                        <span className={recent ? "text-[#DC2626]" : "text-[#6B7280]"}>
                          {lastUsedSuffix(p)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
