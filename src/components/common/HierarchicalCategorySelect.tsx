"use client";

import { useState, useEffect, useCallback } from "react";

type CatItem = { id: string; name: string; sortOrder: number };

export interface HierarchicalValue {
  level1: string | null;
  level2: string | null;
  level3: string | null;
}

interface Props {
  apiBase: string;
  level1Label: string;
  level2Label: string;
  level3Label: string;
  value: HierarchicalValue;
  onChange: (value: HierarchicalValue) => void;
  disabled?: boolean;
}

const selectCls =
  "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF]";

export default function HierarchicalCategorySelect({
  apiBase,
  level1Label,
  level2Label,
  level3Label,
  value,
  onChange,
  disabled,
}: Props) {
  const [majors, setMajors] = useState<CatItem[]>([]);
  const [middles, setMiddles] = useState<CatItem[]>([]);
  const [minors, setMinors] = useState<CatItem[]>([]);
  const [majorId, setMajorId] = useState("");
  const [middleId, setMiddleId] = useState("");

  useEffect(() => {
    fetch(apiBase)
      .then((r) => r.json())
      .then((data) => setMajors(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [apiBase]);

  const findMajorId = useCallback(
    (name: string) => majors.find((m) => m.name === name)?.id ?? "",
    [majors]
  );

  useEffect(() => {
    if (value.level1 && majors.length > 0) {
      const mId = findMajorId(value.level1);
      if (mId && mId !== majorId) setMajorId(mId);
    } else if (!value.level1) {
      setMajorId("");
    }
  }, [value.level1, majors, findMajorId, majorId]);

  useEffect(() => {
    if (!majorId) { setMiddles([]); setMinors([]); return; }
    fetch(`${apiBase}/${majorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        const mids = Array.isArray(data) ? data : [];
        setMiddles(mids);
        if (value.level2) {
          const mid = mids.find((m: CatItem) => m.name === value.level2);
          if (mid) setMiddleId(mid.id);
        }
      })
      .catch(() => setMiddles([]));
  }, [majorId, apiBase, value.level2]);

  useEffect(() => {
    if (!middleId) { setMinors([]); return; }
    fetch(`${apiBase}/middles/${middleId}/minors`)
      .then((r) => r.json())
      .then((data) => setMinors(Array.isArray(data) ? data : []))
      .catch(() => setMinors([]));
  }, [middleId, apiBase]);

  const handleLevel1Change = (id: string) => {
    setMajorId(id);
    setMiddleId("");
    const name = majors.find((m) => m.id === id)?.name ?? null;
    onChange({ level1: name, level2: null, level3: null });
  };

  const handleLevel2Change = (id: string) => {
    setMiddleId(id);
    const name = middles.find((m) => m.id === id)?.name ?? null;
    onChange({ level1: value.level1, level2: name, level3: null });
  };

  const handleLevel3Change = (id: string) => {
    const name = minors.find((m) => m.id === id)?.name ?? null;
    onChange({ level1: value.level1, level2: value.level2, level3: name });
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      <select
        value={majorId}
        onChange={(e) => handleLevel1Change(e.target.value)}
        className={selectCls}
        disabled={disabled}
      >
        <option value="">{level1Label}</option>
        {majors.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <select
        value={middleId}
        onChange={(e) => handleLevel2Change(e.target.value)}
        className={selectCls}
        disabled={disabled || !majorId}
      >
        <option value="">{level2Label}</option>
        {middles.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <select
        value={minors.find((m) => m.name === value.level3)?.id ?? ""}
        onChange={(e) => handleLevel3Change(e.target.value)}
        className={selectCls}
        disabled={disabled || !middleId}
      >
        <option value="">{level3Label}</option>
        {minors.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  );
}
