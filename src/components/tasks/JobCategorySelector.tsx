"use client";

import { useState, useEffect, useCallback } from "react";

type JobCatItem = { id: string; name: string; sortOrder: number };

export type JobAxis = {
  axis: number;
  major: string;
  middle: string | null;
  minor: string | null;
};

type Props = {
  value: JobAxis[];
  onChange: (axes: JobAxis[]) => void;
};

const selectCls =
  "w-full rounded-[6px] border border-[#D1D5DB] px-3 py-2 text-[14px] outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]";

export default function JobCategorySelector({ value, onChange }: Props) {
  const [majors, setMajors] = useState<JobCatItem[]>([]);

  useEffect(() => {
    fetch("/api/job-categories")
      .then((r) => r.json())
      .then((data) => setMajors(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Ensure at least 1 axis
  const axes: JobAxis[] = value.length > 0 ? value : [{ axis: 1, major: "", middle: null, minor: null }];

  const updateAxis = (index: number, updated: Partial<JobAxis>) => {
    const next = axes.map((a, i) => (i === index ? { ...a, ...updated } : a));
    onChange(next);
  };

  const addAxis = () => {
    if (axes.length >= 10) return;
    onChange([...axes, { axis: axes.length + 1, major: "", middle: null, minor: null }]);
  };

  const removeAxis = (index: number) => {
    const next = axes.filter((_, i) => i !== index).map((a, i) => ({ ...a, axis: i + 1 }));
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {axes.map((ax, idx) => (
        <AxisRow
          key={idx}
          axis={ax}
          index={idx}
          majors={majors}
          canDelete={axes.length > 1}
          onUpdate={(updated) => updateAxis(idx, updated)}
          onRemove={() => removeAxis(idx)}
        />
      ))}
      {axes.length < 10 && (
        <button
          type="button"
          onClick={addAxis}
          className="rounded-[6px] border border-dashed border-[#D1D5DB] px-3 py-2 text-[13px] text-[#2563EB] font-medium hover:bg-[#F9FAFB] transition-colors w-full"
        >
          + 職種を追加
        </button>
      )}
    </div>
  );
}

function AxisRow({
  axis,
  index,
  majors,
  canDelete,
  onUpdate,
  onRemove,
}: {
  axis: JobAxis;
  index: number;
  majors: JobCatItem[];
  canDelete: boolean;
  onUpdate: (updated: Partial<JobAxis>) => void;
  onRemove: () => void;
}) {
  const [middles, setMiddles] = useState<JobCatItem[]>([]);
  const [minors, setMinors] = useState<JobCatItem[]>([]);
  const [majorId, setMajorId] = useState("");
  const [middleId, setMiddleId] = useState("");

  // Find major ID from name
  const findMajorId = useCallback(
    (name: string) => majors.find((m) => m.name === name)?.id ?? "",
    [majors]
  );

  // Initialize IDs from names when majors load
  useEffect(() => {
    if (axis.major && majors.length > 0) {
      const mId = findMajorId(axis.major);
      if (mId && mId !== majorId) setMajorId(mId);
    }
  }, [axis.major, majors, findMajorId, majorId]);

  // Fetch middles when major changes
  useEffect(() => {
    if (!majorId) { setMiddles([]); setMinors([]); return; }
    fetch(`/api/job-categories/${majorId}/middles`)
      .then((r) => r.json())
      .then((data) => {
        const mids = Array.isArray(data) ? data : [];
        setMiddles(mids);
        // Find middleId from name
        if (axis.middle) {
          const mid = mids.find((m: JobCatItem) => m.name === axis.middle);
          if (mid) setMiddleId(mid.id);
        }
      })
      .catch(() => setMiddles([]));
  }, [majorId, axis.middle]);

  // Fetch minors when middle changes
  useEffect(() => {
    if (!middleId) { setMinors([]); return; }
    fetch(`/api/job-categories/middles/${middleId}/minors`)
      .then((r) => r.json())
      .then((data) => setMinors(Array.isArray(data) ? data : []))
      .catch(() => setMinors([]));
  }, [middleId]);

  const handleMajorChange = (id: string) => {
    setMajorId(id);
    setMiddleId("");
    const name = majors.find((m) => m.id === id)?.name ?? "";
    onUpdate({ major: name, middle: null, minor: null });
  };

  const handleMiddleChange = (id: string) => {
    setMiddleId(id);
    const name = middles.find((m) => m.id === id)?.name ?? "";
    onUpdate({ middle: name || null, minor: null });
  };

  const handleMinorChange = (id: string) => {
    const name = minors.find((m) => m.id === id)?.name ?? "";
    onUpdate({ minor: name || null });
  };

  return (
    <div className="rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-medium text-[#6B7280]">第{index + 1}軸</span>
        {canDelete && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[#9CA3AF] hover:text-red-500 transition-colors p-0.5"
            title="削除"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select
          value={majorId}
          onChange={(e) => handleMajorChange(e.target.value)}
          className={selectCls}
        >
          <option value="">大項目</option>
          {majors.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={middleId}
          onChange={(e) => handleMiddleChange(e.target.value)}
          className={selectCls}
          disabled={!majorId}
        >
          <option value="">中項目</option>
          {middles.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={minors.find((m) => m.name === axis.minor)?.id ?? ""}
          onChange={(e) => handleMinorChange(e.target.value)}
          className={selectCls}
          disabled={!middleId}
        >
          <option value="">小項目</option>
          {minors.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** タスク詳細画面用: パンくず表示 */
export function JobCategoryDisplay({ value }: { value: string }) {
  let axes: JobAxis[] = [];
  try {
    axes = JSON.parse(value);
  } catch {
    return <span className="text-[14px] text-[#374151]">{value}</span>;
  }

  if (!Array.isArray(axes) || axes.length === 0) {
    return <span className="text-[14px] text-[#374151]">{value}</span>;
  }

  return (
    <div className="space-y-1">
      {axes.map((ax, i) => (
        <div key={i} className="text-[14px] text-[#374151]">
          <span className="text-[12px] text-[#9CA3AF] mr-1.5">第{ax.axis}軸:</span>
          {[ax.major, ax.middle, ax.minor].filter(Boolean).join(" > ")}
        </div>
      ))}
    </div>
  );
}
